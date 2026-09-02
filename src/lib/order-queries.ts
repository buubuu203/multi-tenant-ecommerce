import { getScopedDb } from "./db/tenant-db";

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
};

export type OrderListEntry = {
  id: string;
  status: string;
  paymentMethod: string;
  // Step 49: business-level payment state for the Tenant Admin — null for
  // every order that never gets a Payment row (cod/bank_transfer, see
  // payment-mutations.ts) rather than a fabricated "n/a" status; a real
  // Payment always has one of pending/succeeded/failed. Deliberately
  // independent of `status` (OrderStatus) — this is a read-only
  // side-by-side display, never merged into one state machine (see
  // schema.prisma's Payment doc comment).
  paymentStatus: string | null;
  createdAt: Date;
  itemCount: number;
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

export async function listOrders(tenantId: string): Promise<OrderListEntry[]> {
  const db = getScopedDb(tenantId);

  const orders = await db.order.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
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
  });

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

  return orders.map((order) => {
    const items: OrderListItem[] = order.items.map((item) => ({
      id: item.id,
      productName: item.productVariant.product.name,
      combinationLabel: formatCombination(item.productVariant.optionValues, optionNameById, valueLabelById),
      quantity: item.quantity,
      unitPrice: item.price,
      lineTotal: item.price * item.quantity, // integer VND * integer quantity — no floating point involved
    }));

    return {
      id: order.id,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.payment?.status ?? null,
      createdAt: order.createdAt,
      itemCount: items.length,
      total: items.reduce((sum, item) => sum + item.lineTotal, 0),
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
};

export type CustomerOrderView = {
  id: string;
  status: string;
  paymentMethod: string;
  // Step 49: same business-level payment state as OrderListEntry (Tenant
  // Admin) — null for cod/bank_transfer orders, which never get a
  // Payment row.
  paymentStatus: string | null;
  createdAt: Date;
  items: CustomerOrderItem[];
  total: number;
  shippingAddress: string;
  shippingWard: string;
  shippingDistrict: string;
  shippingCity: string;
  shippingNote: string | null;
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
    include: {
      payment: true,
      items: {
        include: {
          productVariant: {
            include: {
              // Step 50: only the primary (sortOrder 0) media item — this
              // is a thumbnail on an order line, not a full gallery.
              product: { include: { media: { where: { sortOrder: 0 }, take: 1 } } },
              optionValues: true,
            },
          },
        },
      },
    },
  });
  if (!order) {
    return null;
  }

  const variantOptionIds = new Set<string>();
  const variantOptionValueIds = new Set<string>();
  for (const item of order.items) {
    for (const ov of item.productVariant.optionValues) {
      variantOptionIds.add(ov.variantOptionId);
      variantOptionValueIds.add(ov.variantOptionValueId);
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

  const items: CustomerOrderItem[] = order.items.map((item) => ({
    productName: item.productVariant.product.name,
    imageUrl: item.productVariant.product.media[0]?.url ?? null,
    combinationLabel: formatCombination(item.productVariant.optionValues, optionNameById, valueLabelById),
    quantity: item.quantity,
    unitPrice: item.price,
    lineTotal: item.price * item.quantity,
  }));

  return {
    id: order.id,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.payment?.status ?? null,
    createdAt: order.createdAt,
    items,
    total: items.reduce((sum, item) => sum + item.lineTotal, 0),
    shippingAddress: order.shippingAddress,
    shippingWard: order.shippingWard,
    shippingDistrict: order.shippingDistrict,
    shippingCity: order.shippingCity,
    shippingNote: order.shippingNote,
  };
}
