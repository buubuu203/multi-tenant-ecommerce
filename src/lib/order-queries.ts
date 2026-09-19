import { getScopedDb } from "./db/tenant-db";
import { getStoredPaymentInstructions } from "./payments/payment-service";
import type { PaymentInstructions } from "./payments/provider";
import type { Payment } from "@/generated/prisma/client";
import { normalizedPhoneVariants } from "./validation/phone";

// Purpose-built, read-only shapes — never leak the raw Prisma Order/
// OrderItem/ProductVariant models into the UI. combinationLabel is built
// from the real ProductVariantOptionValue relationships (never
// combinationKey); null means "simple product, no options" rather than an
// empty/misleading combination string.
export type OrderListItem = {
  id: string;
  productName: string;
  combinationLabel: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  // Product Discount (V1): snapshots taken at order-creation time (see
  // order-mutations.ts) — both null means no discount applied to this
  // line. Never re-derived from the live Discount row, which may since
  // have changed or been deleted.
  originalUnitPrice: number | null;
  discountPercent: number | null;
};

export type OrderListEntry = {
  id: string;
  status: string;
  paymentMethod: string;
  // Step 49/51: business-level payment state for the Tenant Admin. Every
  // order gets a Payment row as of Step 51 (previously only momo did) —
  // null here now only for orders placed BEFORE that change. Deliberately
  // independent of `status` (OrderStatus) — this is a read-only
  // side-by-side display, never merged into one state machine (see
  // schema.prisma's Payment doc comment). cod stays "pending" until a
  // separate, not-yet-built feature lets a merchant mark cash collected.
  paymentStatus: string | null;
  // Step 52: which adapter handled this order's Payment (null alongside
  // paymentStatus for the same pre-Step-51 orders). Lets the Tenant Admin
  // UI show "Mark as Paid" only for bank_transfer_manual, never for
  // bank_transfer_sepay_va (that one is only ever confirmed by SePay's own
  // webhook — a manual override there would fight the real payment state).
  paymentProvider: string | null;
  createdAt: Date;
  itemCount: number;
  // V1 Configurable Shipping: `subtotal` (items only) and `shippingAmount`
  // are now both exposed alongside `total` (subtotal + shippingAmount) so
  // the UI can show a real breakdown instead of one opaque number — never
  // recompute `total` again on top of these, or shipping double-counts.
  // shippingAmount reads directly off the Order row's own snapshot column
  // (0 for every order placed before this feature existed); shippingMethodName
  // is null for those same historical orders.
  subtotal: number;
  shippingAmount: number;
  shippingMethodName: string | null;
  total: number;
  items: OrderListItem[];
  // Step 33: only the three contact fields the UI needs — never the raw
  // Customer row (no id, no tenantId, no timestamps reach the UI).
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  // Step 34/35: the order-time shipping snapshot, already present on the
  // Order row this query already loads — no new query, no new include.
  // shippingNote stays null when the checkout note was empty/omitted (see
  // order-mutations.ts's validateShippingInput()), never a placeholder.
  shippingAddress: string;
  shippingWard: string;
  shippingDistrict: string;
  shippingCity: string;
  shippingNote: string | null;
};

/**
 * Lists a tenant's orders, newest first, with each order's line items
 * resolved to human-readable product/variant information. READ-ONLY — no
 * mutation behavior belongs in this file (see order-mutations.ts for
 * writes).
 *
 * tenantId must be the trusted value returned by requireTenantAdmin() —
 * never accepted from the browser. Uses getScopedDb(tenantId) exclusively;
 * the database query itself is tenant-scoped (not "query everything, then
 * filter in application code").
 *
 * Avoids N+1 queries: one query loads every order with its Customer (Step
 * 33) and its items and each item's ProductVariant (+ Product name + its
 * own ProductVariantOptionValue rows) via Prisma's nested `include`
 * (batched by Prisma, not a per-row loop); a second pair of queries
 * batch-resolves every VariantOption/VariantOptionValue name referenced
 * across ALL orders at once, not once per order or per item.
 */
// Same deterministic-ordering convention as Tenant Admin's existing
// formatCombination() (page.tsx) — sorted by option name, never by
// combinationKey, which is never read here at all. Module-scoped (not
// redefined per-call) so both listOrders() and getOrderForCustomer() share
// exactly one implementation.
function formatCombination(
  optionValues: { variantOptionId: string; variantOptionValueId: string }[],
  optionNameById: Map<string, string>,
  valueLabelById: Map<string, string>,
): string | null {
  if (optionValues.length === 0) {
    return null;
  }
  return optionValues
    .map((ov) => ({
      optionName: optionNameById.get(ov.variantOptionId) ?? "?",
      valueLabel: valueLabelById.get(ov.variantOptionValueId) ?? "?",
    }))
    .sort((a, b) => a.optionName.localeCompare(b.optionName))
    .map((pair) => `${pair.optionName}: ${pair.valueLabel}`)
    .join(" / ");
}

// Phase 2 (Tenant Admin route split, Orders at scale): status filter,
// free-text search (order id / customer name / customer email), and
// server-side pagination — all applied at the Prisma query level (never
// "fetch everything, filter in application code"), so a growing order
// history doesn't mean a growing page-load cost. Every param is optional;
// calling with no options preserves the exact previous behavior (every
// order, newest first) for any other caller.
export type ListOrdersOptions = {
  status?: "pending" | "fulfilled" | "cancelled";
  search?: string;
  page?: number;
  pageSize?: number;
};

export async function listOrders(
  tenantId: string,
  options?: ListOrdersOptions,
): Promise<{ orders: OrderListEntry[]; totalCount: number }> {
  const db = getScopedDb(tenantId);
  const page = options?.page && options.page > 0 ? Math.floor(options.page) : 1;
  const pageSize = options?.pageSize && options.pageSize > 0 ? Math.floor(options.pageSize) : 20;
  const search = options?.search?.trim();

  const where = {
    tenantId,
    ...(options?.status ? { status: options.status } : {}),
    ...(search
      ? {
          OR: [
            { id: { contains: search, mode: "insensitive" as const } },
            { customer: { name: { contains: search, mode: "insensitive" as const } } },
            { customer: { email: { contains: search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [orders, totalCount] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        customer: true,
        payment: true,
        items: {
          include: {
            productVariant: {
              include: {
                product: true,
                optionValues: true,
              },
            },
          },
        },
      },
    }),
    db.order.count({ where }),
  ]);

  const variantOptionIds = new Set<string>();
  const variantOptionValueIds = new Set<string>();
  for (const order of orders) {
    for (const item of order.items) {
      for (const ov of item.productVariant.optionValues) {
        variantOptionIds.add(ov.variantOptionId);
        variantOptionValueIds.add(ov.variantOptionValueId);
      }
    }
  }

  const [variantOptions, variantOptionValues] = await Promise.all([
    variantOptionIds.size > 0
      ? db.variantOption.findMany({ where: { tenantId, id: { in: [...variantOptionIds] } } })
      : Promise.resolve([]),
    variantOptionValueIds.size > 0
      ? db.variantOptionValue.findMany({ where: { tenantId, id: { in: [...variantOptionValueIds] } } })
      : Promise.resolve([]),
  ]);
  const optionNameById = new Map(variantOptions.map((o) => [o.id, o.name]));
  const valueLabelById = new Map(variantOptionValues.map((v) => [v.id, v.value]));

  const mapped = orders.map((order) => {
    const items: OrderListItem[] = order.items.map((item) => ({
      id: item.id,
      productName: item.productVariant.product.name,
      combinationLabel: formatCombination(item.productVariant.optionValues, optionNameById, valueLabelById),
      quantity: item.quantity,
      unitPrice: item.price,
      lineTotal: item.price * item.quantity, // integer VND * integer quantity — no floating point involved
      originalUnitPrice: item.originalUnitPrice,
      discountPercent: item.discountPercent,
    }));

    return {
      id: order.id,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.payment?.status ?? null,
      paymentProvider: order.payment?.provider ?? null,
      createdAt: order.createdAt,
      itemCount: items.length,
      subtotal: items.reduce((sum, item) => sum + item.lineTotal, 0),
      shippingAmount: order.shippingAmount,
      shippingMethodName: order.shippingMethodName,
      total: items.reduce((sum, item) => sum + item.lineTotal, 0) + order.shippingAmount,
      items,
      customer: {
        name: order.customer.name,
        email: order.customer.email,
        phone: order.customer.phone,
      },
      shippingAddress: order.shippingAddress,
      shippingWard: order.shippingWard,
      shippingDistrict: order.shippingDistrict,
      shippingCity: order.shippingCity,
      shippingNote: order.shippingNote,
    };
  });

  return { orders: mapped, totalCount };
}

// Guest order lookup (no customer accounts) — deliberately a SMALLER shape
// than OrderListEntry: no customer name/email/phone reach the UI here (the
// caller already had to supply the email to get this far; echoing it back
// serves no purpose and only widens what a guest-facing response exposes),
// and no internal ids beyond the order id itself (never tenantId, never
// Customer.id, never Inventory/onHand/reserved — this is a purpose-built
// read shape, same discipline as OrderListEntry above, just for a
// different, less-trusted caller).
export type CustomerOrderItem = {
  productName: string;
  // Step 47: the product's CURRENT image (read at lookup time, not
  // snapshotted at order-creation time) — same "display only, may drift"
  // posture as productName/combinationLabel here, which were never
  // snapshotted either. null if the product has no image set, or if it's
  // since been deleted (onDelete: Restrict on OrderItem->ProductVariant
  // means the variant/product row itself can't vanish, only its imageUrl
  // can change or be cleared).
  imageUrl: string | null;
  combinationLabel: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  // Product Discount (V1): see OrderListItem's identical fields.
  originalUnitPrice: number | null;
  discountPercent: number | null;
};

export type CustomerOrderView = {
  id: string;
  status: string;
  paymentMethod: string;
  // Step 49/51: same business-level payment state as OrderListEntry
  // (Tenant Admin) — null only for orders placed before Step 51 (every
  // order gets a Payment row as of Step 51, previously only momo did).
  paymentStatus: string | null;
  createdAt: Date;
  items: CustomerOrderItem[];
  // V1 Configurable Shipping — see OrderListEntry's identical fields for
  // the full rationale (subtotal/shippingAmount/total breakdown, snapshot
  // semantics, historical-order zero-shipping behavior).
  subtotal: number;
  shippingAmount: number;
  shippingMethodName: string | null;
  total: number;
  shippingAddress: string;
  shippingWard: string;
  shippingDistrict: string;
  shippingCity: string;
  shippingNote: string | null;
  // Step 51: the same canonical, provider-agnostic shape checkout itself
  // renders — reconstructed read-only from the persisted Payment row (see
  // payment-service.ts's getStoredPaymentInstructions), never a fresh
  // provider API call. Null only for a pre-Step-51 order with no Payment
  // row at all.
  paymentInstructions: PaymentInstructions | null;
};

/**
 * Looks up a single order for a guest customer, requiring BOTH the correct
 * order id AND the checkout email as proof of ownership — there are no
 * customer accounts/sessions, so this pairing is the entire access-control
 * mechanism (see src/app/orders/actions.ts, which is the only caller and
 * is responsible for never leaking *why* a lookup failed).
 *
 * Returns null for every failure case — order not found, wrong tenant,
 * wrong email — so the caller cannot distinguish "no such order" from
 * "right order, wrong email" from "order belongs to another tenant" and
 * therefore cannot build an order-existence oracle out of repeated
 * guesses.
 *
 * tenantId must be the trusted `x-tenant-id` value already established by
 * every other storefront read (see checkout-actions.ts/
 * get-tenant-products.ts) — never accepted from the browser. The email
 * match is performed inside the same tenant-scoped query (via the Order ->
 * Customer relation, itself keyed on the composite (customerId, tenantId)
 * FK — see schema.prisma) rather than as a separate, later check, so a
 * cross-tenant Customer row can never satisfy it. Case-insensitive on
 * email only (Postgres `mode: "insensitive"`), matching how a guest would
 * naturally retype an email — the order id itself must match exactly.
 */
// Shared by every guest-lookup query below (single-order and
// multi-order alike) — the `include` shape and the raw-row ->
// CustomerOrderView mapping were previously duplicated verbatim across
// getOrderForCustomer/getOrdersForCustomerEmail; the two NEW lookup
// functions (by phone, by name+phone) would otherwise have been a THIRD
// and FOURTH copy of the exact same ~40 lines. The different `where`
// clauses (email vs phone vs name+phone) stay separate, deliberately —
// that's the "two things that look similar but change for different
// reasons" duplication this file's own existing doc comments already
// call out as fine; the mapping logic below is not that kind.
const CUSTOMER_ORDER_INCLUDE = {
  payment: true,
  items: {
    include: {
      productVariant: {
        include: {
          // Step 50: only the primary (sortOrder 0) media item — this is
          // a thumbnail on an order line, not a full gallery.
          product: { include: { media: { where: { sortOrder: 0 as const }, take: 1 } } },
          optionValues: true,
        },
      },
    },
  },
} as const;

type RawCustomerOrder = {
  id: string;
  status: string;
  paymentMethod: string;
  createdAt: Date;
  shippingAmount: number;
  shippingMethodName: string | null;
  shippingAddress: string;
  shippingWard: string;
  shippingDistrict: string;
  shippingCity: string;
  shippingNote: string | null;
  payment: Payment | null;
  items: {
    quantity: number;
    price: number;
    originalUnitPrice: number | null;
    discountPercent: number | null;
    productVariant: {
      product: { name: string; media: { url: string }[] };
      optionValues: { variantOptionId: string; variantOptionValueId: string }[];
    };
  }[];
};

// Batch-resolves every VariantOption/VariantOptionValue name referenced
// across a set of orders in one pair of queries — same N+1-avoidance
// reasoning as listOrders() above, just parameterized over "however many
// orders this particular lookup returned" (one, for a single-order
// lookup; N, for a history-style lookup).
async function resolveVariantLabelMaps(tenantId: string, orders: RawCustomerOrder[]) {
  const db = getScopedDb(tenantId);
  const variantOptionIds = new Set<string>();
  const variantOptionValueIds = new Set<string>();
  for (const order of orders) {
    for (const item of order.items) {
      for (const ov of item.productVariant.optionValues) {
        variantOptionIds.add(ov.variantOptionId);
        variantOptionValueIds.add(ov.variantOptionValueId);
      }
    }
  }
  const [variantOptions, variantOptionValues] = await Promise.all([
    variantOptionIds.size > 0
      ? db.variantOption.findMany({ where: { tenantId, id: { in: [...variantOptionIds] } } })
      : Promise.resolve([]),
    variantOptionValueIds.size > 0
      ? db.variantOptionValue.findMany({ where: { tenantId, id: { in: [...variantOptionValueIds] } } })
      : Promise.resolve([]),
  ]);
  return {
    optionNameById: new Map(variantOptions.map((o) => [o.id, o.name])),
    valueLabelById: new Map(variantOptionValues.map((v) => [v.id, v.value])),
  };
}

async function toCustomerOrderView(
  tenantId: string,
  order: RawCustomerOrder,
  optionNameById: Map<string, string>,
  valueLabelById: Map<string, string>,
): Promise<CustomerOrderView> {
  const items: CustomerOrderItem[] = order.items.map((item) => ({
    productName: item.productVariant.product.name,
    imageUrl: item.productVariant.product.media[0]?.url ?? null,
    combinationLabel: formatCombination(item.productVariant.optionValues, optionNameById, valueLabelById),
    quantity: item.quantity,
    unitPrice: item.price,
    lineTotal: item.price * item.quantity,
    originalUnitPrice: item.originalUnitPrice,
    discountPercent: item.discountPercent,
  }));

  const paymentInstructions = order.payment ? await getStoredPaymentInstructions(tenantId, order.payment) : null;

  return {
    id: order.id,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.payment?.status ?? null,
    createdAt: order.createdAt,
    items,
    subtotal: items.reduce((sum, item) => sum + item.lineTotal, 0),
    shippingAmount: order.shippingAmount,
    shippingMethodName: order.shippingMethodName,
    total: items.reduce((sum, item) => sum + item.lineTotal, 0) + order.shippingAmount,
    shippingAddress: order.shippingAddress,
    shippingWard: order.shippingWard,
    shippingDistrict: order.shippingDistrict,
    shippingCity: order.shippingCity,
    shippingNote: order.shippingNote,
    paymentInstructions,
  };
}

export async function getOrderForCustomer(
  tenantId: string,
  orderId: string,
  email: string,
): Promise<CustomerOrderView | null> {
  const trimmedOrderId = orderId.trim();
  const trimmedEmail = email.trim();
  if (!trimmedOrderId || !trimmedEmail) {
    return null;
  }

  const db = getScopedDb(tenantId);

  const order = await db.order.findFirst({
    where: {
      id: trimmedOrderId,
      tenantId,
      customer: { email: { equals: trimmedEmail, mode: "insensitive" } },
    },
    include: CUSTOMER_ORDER_INCLUDE,
  });
  if (!order) {
    return null;
  }

  const { optionNameById, valueLabelById } = await resolveVariantLabelMaps(tenantId, [order]);
  return toCustomerOrderView(tenantId, order, optionNameById, valueLabelById);
}

/**
 * Order Lookup by phone (V1): the exact same security posture as
 * getOrderForCustomer() above — Order ID + a second proof-of-ownership
 * field, here the checkout phone number instead of the checkout email.
 * Order ID is a high-entropy UUID; requiring it AND a matching phone is
 * the same bar as requiring it AND a matching email, not a weaker one.
 *
 * Matches EITHER stored phone form (`0xxx` / `+84xxx` — see
 * normalizedPhoneVariants()'s doc comment for why both must be tried)
 * rather than rewriting historical Customer.phone data, which this V1
 * deliberately does not touch.
 *
 * Returns null uniformly for every failure case, same as
 * getOrderForCustomer() — never distinguishes "no such order" from
 * "wrong phone" from "wrong tenant."
 */
export async function getOrderForCustomerByPhone(
  tenantId: string,
  orderId: string,
  phone: string,
): Promise<CustomerOrderView | null> {
  const trimmedOrderId = orderId.trim();
  const phoneVariants = normalizedPhoneVariants(phone);
  if (!trimmedOrderId || phoneVariants.length === 0) {
    return null;
  }

  const db = getScopedDb(tenantId);

  const order = await db.order.findFirst({
    where: {
      id: trimmedOrderId,
      tenantId,
      customer: { phone: { in: phoneVariants } },
    },
    include: CUSTOMER_ORDER_INCLUDE,
  });
  if (!order) {
    return null;
  }

  const { optionNameById, valueLabelById } = await resolveVariantLabelMaps(tenantId, [order]);
  return toCustomerOrderView(tenantId, order, optionNameById, valueLabelById);
}

/**
 * Order Lookup by name + phone (V1): a "history" style lookup — every
 * order under this tenant matching BOTH the given name AND phone —
 * deliberately requiring BOTH, never either alone.
 *
 * Name and phone are each individually low-entropy (many people share a
 * name; a phone number can be known to more than just its owner, e.g. a
 * family plan) — see this repo's roadmap doc for the explicit decision
 * that neither may ever be used ALONE as a full-history search vector,
 * unlike email (see getOrdersForCustomerEmail()), which this V1 treats as
 * an already-accepted, higher-entropy exception. Combining two
 * independently-weak factors raises the bar close to email-alone without
 * requiring a schema change to store a stronger identifier.
 *
 * Exact (not fuzzy/`contains`) match on both fields, case-insensitive on
 * name only (trimmed) — a `contains` match here would make the two-factor
 * requirement meaningfully weaker (e.g. a one-character name substring
 * matching many customers), defeating the reason both fields are
 * required together.
 */
export async function getOrdersForCustomerNameAndPhone(
  tenantId: string,
  name: string,
  phone: string,
): Promise<CustomerOrderView[]> {
  const trimmedName = name.trim();
  const phoneVariants = normalizedPhoneVariants(phone);
  if (!trimmedName || phoneVariants.length === 0) {
    return [];
  }

  const db = getScopedDb(tenantId);

  const orders = await db.order.findMany({
    where: {
      tenantId,
      customer: {
        name: { equals: trimmedName, mode: "insensitive" },
        phone: { in: phoneVariants },
      },
    },
    orderBy: { createdAt: "desc" },
    include: CUSTOMER_ORDER_INCLUDE,
  });
  if (orders.length === 0) {
    return [];
  }

  const { optionNameById, valueLabelById } = await resolveVariantLabelMaps(tenantId, orders);
  return Promise.all(orders.map((order) => toCustomerOrderView(tenantId, order, optionNameById, valueLabelById)));
}

/**
 * Order history for a guest customer — every order under this tenant
 * placed with this email, newest first. Same access-control posture as
 * getOrderForCustomer (email is the entire proof of ownership, no
 * accounts/sessions), just without an order id to narrow to one row.
 *
 * Kept as a separate, independent query rather than a thin wrapper around
 * getOrderForCustomer: that function's single-order shape is baked around
 * `findFirst` + one order's worth of variant-option resolution, and
 * reshaping it to also handle N orders would obscure both cases for
 * marginal reuse — the duplication here is the "two things that look
 * similar but change for different reasons" kind, not the harmful kind.
 */
export async function getOrdersForCustomerEmail(tenantId: string, email: string): Promise<CustomerOrderView[]> {
  const trimmedEmail = email.trim();
  if (!trimmedEmail) {
    return [];
  }

  const db = getScopedDb(tenantId);

  const orders = await db.order.findMany({
    where: {
      tenantId,
      customer: { email: { equals: trimmedEmail, mode: "insensitive" } },
    },
    orderBy: { createdAt: "desc" },
    include: CUSTOMER_ORDER_INCLUDE,
  });
  if (orders.length === 0) {
    return [];
  }

  const { optionNameById, valueLabelById } = await resolveVariantLabelMaps(tenantId, orders);
  return Promise.all(orders.map((order) => toCustomerOrderView(tenantId, order, optionNameById, valueLabelById)));
}
