import { getScopedDb } from "./db/tenant-db";
import { reserveInventoryInTx, releaseInventoryInTx, consumeReservedInventoryInTx, InventoryError } from "./inventory-mutations";
import { isValidVietnamesePhone } from "./validation/phone";
import { resolveShippingMethod } from "./shipping-service";
import type { ActionResult } from "./action-result";

// The client cart (see cart-context.tsx) is NOT authoritative — this is
// the entire reason this input type carries only identity + quantity.
// Price, product name, SKU, variant label, productId, and combinationKey
// are all deliberately absent here: even if a caller supplied them, this
// module would never read them. Every authoritative fact about an order
// item (its real price, its real tenant ownership, whether the variant
// even exists) is re-derived from the database inside createOrder().
export type OrderItemInput = {
  productVariantId: string;
  quantity: number;
};

export type CreatedOrderItem = {
  productVariantId: string;
  quantity: number;
  price: number; // the snapshot actually written, for the caller's confirmation UI
};

// Step 30: the customer's chosen payment method. Kept as a plain string
// union here (mirroring ProductInput.status's existing convention
// elsewhere in this codebase) rather than importing the generated Prisma
// enum type directly into a function signature — validated explicitly
// below before ever reaching the database.
export const PAYMENT_METHODS = ["cod", "momo", "bank_transfer"] as const;
export type PaymentMethodInput = (typeof PAYMENT_METHODS)[number];

function validatePaymentMethod(paymentMethod: string): { error: string } | null {
  if (!PAYMENT_METHODS.includes(paymentMethod as PaymentMethodInput)) {
    return { error: "Invalid payment method." };
  }
  return null;
}

// Step 32: minimal guest-checkout contact info. NOT an authenticated
// account — no password, no session field exists here or anywhere in this
// type. email is the identity key (see Customer model doc comment in
// schema.prisma) — this input is used to find-or-create exactly one
// Customer row per (tenantId, email); name/phone are refreshed to these
// values on reuse, email itself is never changed by this flow.
export type CustomerInput = {
  name: string;
  email: string;
  phone: string;
};

const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateCustomerInput(
  input: CustomerInput,
): { name: string; email: string; phone: string } | { error: string } {
  const name = input.name.trim();
  if (!name) {
    return { error: "Name is required." };
  }

  const email = input.email.trim();
  if (!email || !BASIC_EMAIL_PATTERN.test(email)) {
    return { error: "A valid email address is required." };
  }

  const phone = input.phone.trim();
  if (!phone) {
    return { error: "Phone is required." };
  }
  if (!isValidVietnamesePhone(phone)) {
    return { error: "A valid Vietnamese phone number is required." };
  }

  return { name, email, phone };
}

// Step 34: order-time shipping address SNAPSHOT — stored directly on
// Order (see schema.prisma doc comment), never on Customer, never a
// separate Address model, never reused across orders. No province/ward
// IDs, no postal code, no geocoding — plain required text fields plus one
// optional note, V1 scope only.
export type ShippingInput = {
  address: string;
  ward: string;
  district: string;
  city: string;
  note?: string;
};

function validateShippingInput(
  input: ShippingInput,
): { address: string; ward: string; district: string; city: string; note: string | null } | { error: string } {
  const address = input.address.trim();
  if (!address) {
    return { error: "Shipping address is required." };
  }

  const ward = input.ward.trim();
  if (!ward) {
    return { error: "Ward is required." };
  }

  // District is no longer a real administrative tier as of Vietnam's July
  // 2025 reform (63 provinces/districts/wards -> 34 provinces/wards, see
  // public/vn-address.json) — the storefront's address picker (CartWidget)
  // no longer collects it and always sends "". The column itself stays
  // (schema.prisma) for orders placed before this change, which still
  // have a real value; not required going forward.
  const district = input.district.trim();

  const city = input.city.trim();
  if (!city) {
    return { error: "City is required." };
  }

  const note = (input.note ?? "").trim();

  return { address, ward, district, city, note: note || null };
}

function validateItemsInput(items: OrderItemInput[]): { error: string } | null {
  if (items.length === 0) {
    return { error: "Cannot create an order with no items." };
  }
  for (const item of items) {
    if (!item.productVariantId || !item.productVariantId.trim()) {
      return { error: "Invalid item in order." };
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return { error: "Quantity must be a positive whole number for every item." };
    }
  }
  // Merge duplicate productVariantId entries defensively (the cart layer
  // already prevents this — addItemToList merges by productVariantId — but
  // this function must not assume its caller enforced that; two entries
  // for the same variant must still resolve to one atomic reservation for
  // their combined quantity, not two separate ones that could interleave
  // around each other's availability check).
  return null;
}

function mergeDuplicateItems(items: OrderItemInput[]): OrderItemInput[] {
  const byVariant = new Map<string, number>();
  for (const item of items) {
    byVariant.set(item.productVariantId, (byVariant.get(item.productVariantId) ?? 0) + item.quantity);
  }
  return [...byVariant.entries()].map(([productVariantId, quantity]) => ({ productVariantId, quantity }));
}

/**
 * Creates an Order + its OrderItems from a set of (productVariantId,
 * quantity) pairs, atomically reserving inventory for every item in the
 * SAME transaction as the order rows themselves.
 *
 * Flow (all inside one db.$transaction):
 *   1. Merge any duplicate productVariantId entries into one combined
 *      quantity (see mergeDuplicateItems).
 *   2. For each item, load the authoritative ProductVariant via the
 *      tenant-scoped client — verifies it exists AND belongs to this
 *      tenant. A nonexistent or cross-tenant id fails the whole order.
 *   3. Reserve inventory for that exact quantity via
 *      reserveInventoryInTx() (Step 27's proven atomic UPDATE...WHERE
 *      pattern, reused directly — not reimplemented). Insufficient stock
 *      fails the whole order.
 *   4. Snapshot variant.price into OrderItem.price at this exact moment —
 *      never read again afterward; a later price change on the variant
 *      cannot alter this order.
 *   5. Create the Order row, then one OrderItem row per input item.
 *
 * Any failure at any step throws, which aborts the transaction — nothing
 * partial is left behind: no Order, no OrderItem, no reservation change.
 * Two customers racing for the same limited stock cannot both succeed
 * beyond available quantity, for the same reason Step 27's reservation
 * alone cannot: each reservation is its own atomic, row-locked conditional
 * UPDATE, evaluated by Postgres before either transaction commits.
 *
 * tenantId must be the trusted value returned by requireTenantAdmin() (or
 * an equivalent verified-tenant source once a customer-facing checkout
 * exists) — never accepted from client-supplied cart data. Uses
 * getScopedDb(tenantId) exclusively.
 *
 * paymentMethod (Step 30) is the customer's selected payment method,
 * validated against PAYMENT_METHODS and stored on the Order row. Only
 * "cod" is functionally complete — no external call is made for any
 * method; MoMo/Bank Transfer are recorded but have no gateway integration
 * yet (a later step's responsibility).
 *
 * customer (Step 32) is guest-checkout contact info — NOT authentication.
 * Inside this SAME transaction (no second transaction, no separate
 * customer-mutations module — atomicity requires this to live here): the
 * Customer row for (tenantId, email) is found or created; if found, its
 * name/phone are refreshed to the latest checkout values while email
 * (the identity key) is left untouched. The resulting customer.id is what
 * Order.customerId points to. A failure anywhere after this point (an
 * invalid item, insufficient stock) rolls the Customer upsert back too —
 * exactly as untested/expected of anything inside one transaction.
 *
 * shipping (Step 34) is an order-time delivery-address snapshot, validated
 * and persisted directly on the Order row inside this same transaction —
 * a later failure rolls the entire Order back, so partial shipping data
 * can never persist on its own.
 */
export async function createOrder(
  tenantId: string,
  items: OrderItemInput[],
  paymentMethod: string,
  customer: CustomerInput,
  shipping: ShippingInput,
  shippingMethodId: string,
): Promise<ActionResult<{ orderId: string; items: CreatedOrderItem[]; shippingAmount: number }>> {
  const inputError = validateItemsInput(items);
  if (inputError) {
    return { success: false, error: inputError.error };
  }
  const paymentMethodError = validatePaymentMethod(paymentMethod);
  if (paymentMethodError) {
    return { success: false, error: paymentMethodError.error };
  }
  // V1 Configurable Shipping: authoritative resolution BEFORE the
  // transaction, same "read outside the transaction, accept the rare
  // merchant-changes-config-mid-checkout race" posture already
  // established (and explicitly documented) for the payment-method check
  // just below — re-reads the CURRENT amount from the database and
  // re-confirms the method is still enabled, never trusting whatever
  // amount/name the client displayed. A tenant with zero enabled methods
  // fails here with the same "not available" posture as zero enabled
  // payment methods.
  const resolvedShipping = await resolveShippingMethod(tenantId, shippingMethodId);
  if (!resolvedShipping) {
    return { success: false, error: "The selected shipping method is not available for this store." };
  }
  // Step 51: server-authoritative — a tenant must never end up with a
  // customer able to select a method the tenant hasn't enabled/configured
  // (closing the gap where any of the 3 global enum values was previously
  // selectable regardless of tenant configuration). Read outside the
  // transaction below: a race where a merchant disables a method between
  // this check and order creation is an acceptable, extremely rare edge
  // case — not worth serializing order creation against admin config
  // changes for.
  const tenantMethod = await getScopedDb(tenantId).tenantPaymentMethod.findUnique({
    where: { tenantId_method: { tenantId, method: paymentMethod as PaymentMethodInput } },
  });
  if (!tenantMethod || !tenantMethod.enabled) {
    return { success: false, error: "This payment method is not available for this store." };
  }
  const customerInput = validateCustomerInput(customer);
  if ("error" in customerInput) {
    return { success: false, error: customerInput.error };
  }
  const shippingInput = validateShippingInput(shipping);
  if ("error" in shippingInput) {
    return { success: false, error: shippingInput.error };
  }

  const merged = mergeDuplicateItems(items);
  const db = getScopedDb(tenantId);

  try {
    const result = await db.$transaction(async (tx) => {
      // Customer identity is (tenantId, email) — explicit tenantId in
      // both the where and data below, the same manual-scoping pattern
      // already used throughout this function for productVariant/order/
      // orderItem (getScopedDb()'s automatic extension-based scoping does
      // not cover Customer any more than it already covers Order/
      // OrderItem — see this file's Step 32 architectural note).
      const customerRecord = await tx.customer.upsert({
        where: { tenantId_email: { tenantId, email: customerInput.email } },
        create: { tenantId, email: customerInput.email, name: customerInput.name, phone: customerInput.phone },
        update: { name: customerInput.name, phone: customerInput.phone },
      });

      const order = await tx.order.create({
        data: {
          tenantId,
          customerId: customerRecord.id,
          status: "pending",
          paymentMethod: paymentMethod as PaymentMethodInput,
          shippingAddress: shippingInput.address,
          shippingWard: shippingInput.ward,
          shippingDistrict: shippingInput.district,
          shippingCity: shippingInput.city,
          shippingNote: shippingInput.note,
          // Snapshots, taken once, here, from the already-resolved value
          // above — never a live reference to TenantShippingMethod (see
          // schema.prisma's doc comment on these two columns).
          shippingAmount: resolvedShipping.amount,
          shippingMethodName: resolvedShipping.name,
        },
      });

      const createdItems: CreatedOrderItem[] = [];
      for (const item of merged) {
        // Authoritative lookup — the client never supplies price, name,
        // SKU, or anything else about this variant. Also re-verifies
        // tenant ownership independently of whatever getScopedDb() already
        // enforces, since this value drives the money-bearing snapshot
        // below.
        const variant = await tx.productVariant.findUnique({
          where: { id: item.productVariantId, tenantId },
          include: { product: true },
        });
        if (!variant) {
          throw new InventoryError("One or more items in your order could not be found.");
        }
        if (variant.status === "archived") {
          throw new InventoryError("One or more items in your order are no longer available.");
        }
        // Step 41: the storefront only ever lists status: "active" products
        // (get-tenant-products.ts), but that is a UI-side filter, not an
        // authoritative guarantee — this transaction must not assume a
        // submitted productVariantId came from that listing. `variant.product`
        // is reached via the same tenant-scoped relation as the variant
        // lookup itself (ProductVariant.product is keyed on [productId,
        // tenantId]), so no additional tenant check is needed here. Same
        // customer-facing wording as the archived-variant case above — a
        // draft product must be indistinguishable to the customer from any
        // other "not currently orderable" reason.
        if (variant.product.status !== "active") {
          throw new InventoryError("One or more items in your order are no longer available.");
        }

        await reserveInventoryInTx(tx, tenantId, item.productVariantId, item.quantity);

        const orderItem = await tx.orderItem.create({
          data: {
            tenantId,
            orderId: order.id,
            productVariantId: item.productVariantId,
            quantity: item.quantity,
            price: variant.price, // snapshot — see doc comment above
          },
        });
        createdItems.push({ productVariantId: orderItem.productVariantId, quantity: orderItem.quantity, price: orderItem.price });
      }

      return { orderId: order.id, items: createdItems, shippingAmount: resolvedShipping.amount };
    });

    return { success: true, data: result };
  } catch (e) {
    if (e instanceof InventoryError) {
      return { success: false, error: e.message };
    }
    console.error("createOrder failed:", e);
    return { success: false, error: "Something went wrong creating the order." };
  }
}

// Step 36: minimal order status lifecycle. pending -> fulfilled and
// pending -> cancelled are the only valid transitions; both are terminal
// (no restoration to pending, no transition between them). No
// payment-related or shipping-related status exists — see schema.prisma's
// OrderStatus doc comment.
export const ORDER_STATUS_TRANSITIONS = ["fulfilled", "cancelled"] as const;
export type OrderStatusTransition = (typeof ORDER_STATUS_TRANSITIONS)[number];

/** Thrown for an invalid/unavailable status transition — same throw-inside-tx pattern as InventoryError. */
export class OrderStatusError extends Error {}

/**
 * Transitions an Order from `pending` to either `fulfilled` or `cancelled`.
 * Server-authoritative: the caller's requested tenantId/orderId are the
 * only inputs trusted here, same as every other mutation in this file —
 * the UI's confirmation dialog is UX only, not a security boundary.
 *
 * Race-safe by construction: the status change itself is a single
 * conditional `updateMany({ where: { id, tenantId, status: "pending" } })`
 * — the same atomic-guarded-UPDATE philosophy as
 * reserveInventoryInTx/releaseInventoryInTx (Step 27). If the order does
 * not exist, belongs to a different tenant, or is no longer `pending`
 * (already fulfilled/cancelled by a concurrent request), zero rows match
 * and this throws rather than silently doing nothing or overwriting a
 * newer state — there is no separate read-then-write step that could open
 * a race window.
 *
 * For `cancelled`: this order's existing inventory reservation is released
 * via releaseInventoryInTx() (Step 27, reused directly — not
 * reimplemented) for every OrderItem, inside this SAME transaction as the
 * status change. If releasing any item's reservation fails, the whole
 * transaction rolls back and the order remains `pending` — the status
 * change and the reservation release succeed or fail together.
 *
 * For `fulfilled` (Step 37): this order's reserved stock is CONSUMED via
 * consumeReservedInventoryInTx() for every OrderItem, inside this SAME
 * transaction as the status change — onHand and reserved both decrease by
 * the item's quantity together, in one atomic guarded UPDATE per item, so
 * `available` (onHand - reserved) is left mathematically unchanged by
 * fulfillment alone (the stock left the building, but the reservation
 * holding it is released at the same moment). If consuming any item's
 * inventory fails (insufficient onHand and/or reserved), the whole
 * transaction rolls back and the order remains `pending` — no partial
 * consumption across a multi-item order can ever persist.
 */
export async function updateOrderStatus(
  tenantId: string,
  orderId: string,
  nextStatus: string,
): Promise<ActionResult> {
  if (!ORDER_STATUS_TRANSITIONS.includes(nextStatus as OrderStatusTransition)) {
    return { success: false, error: "Invalid order status." };
  }

  const db = getScopedDb(tenantId);

  try {
    await db.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id: orderId, tenantId, status: "pending" },
        data: { status: nextStatus as OrderStatusTransition },
      });
      if (updated.count === 0) {
        throw new OrderStatusError("This order can no longer be changed — it may have already been updated.");
      }

      if (nextStatus === "cancelled") {
        const items = await tx.orderItem.findMany({ where: { orderId, tenantId } });
        for (const item of items) {
          await releaseInventoryInTx(tx, tenantId, item.productVariantId, item.quantity);
        }
      }

      if (nextStatus === "fulfilled") {
        const items = await tx.orderItem.findMany({ where: { orderId, tenantId } });
        for (const item of items) {
          await consumeReservedInventoryInTx(tx, tenantId, item.productVariantId, item.quantity);
        }
      }
    });

    return { success: true, data: undefined };
  } catch (e) {
    if (e instanceof OrderStatusError || e instanceof InventoryError) {
      return { success: false, error: e.message };
    }
    console.error("updateOrderStatus failed:", e);
    return { success: false, error: "Something went wrong updating the order status." };
  }
}
