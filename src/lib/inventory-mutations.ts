import { getScopedDb } from "./db/tenant-db";
import type { ActionResult } from "./action-result";

function validateQuantity(quantity: number): { error: string } | null {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { error: "Quantity must be a positive whole number." };
  }
  return null;
}

type ScopedDb = ReturnType<typeof getScopedDb>;
type ScopedTx = Parameters<Parameters<ScopedDb["$transaction"]>[0]>[0];

/**
 * A clean, expected reservation/release failure (not found, insufficient
 * stock, nothing to release). Thrown rather than returned so this same
 * logic can run either inside its own transaction (reserveInventory()) or
 * inside a caller's existing transaction (e.g. order-mutations.ts creating
 * an order + reserving stock atomically) — in both cases, throwing is what
 * correctly aborts/rolls back the enclosing `db.$transaction`. Same
 * pattern as VariantGenerationError in variant-generation.ts.
 */
export class InventoryError extends Error {}

/**
 * Core reservation logic, parameterized on an already-open transactional
 * client (`tx`). Never opens its own transaction — callers own the
 * transaction boundary. This is what lets order-mutations.ts fold "reserve
 * stock" + "create Order/OrderItem rows" into ONE flat, atomic transaction
 * without nesting Prisma transactions (unsupported) — it opens exactly one
 * `db.$transaction` and passes that same `tx` in here.
 *
 * Race-safe by construction: a single, atomic, conditional SQL UPDATE
 * (`SET reserved = reserved + $qty WHERE ... AND onHand - reserved >= $qty`)
 * — the exact pattern already proven correct under Postgres row-level
 * locking in Step 10's test-inventory-atomic.js (over-reservation
 * correctly rejected, reserved never mutated on the rejected attempt).
 * onHand is never written here — only reserved.
 *
 * getScopedDb()'s automatic scoping does not extend to $executeRaw, so
 * tenantId is included directly in the WHERE clause below — required for
 * real tenant isolation on this call, not just the read-side existence
 * check performed first.
 */
export async function reserveInventoryInTx(
  tx: ScopedTx,
  tenantId: string,
  productVariantId: string,
  quantity: number,
): Promise<void> {
  if (!productVariantId.trim()) {
    throw new InventoryError("Variant not found.");
  }
  const quantityError = validateQuantity(quantity);
  if (quantityError) {
    throw new InventoryError(quantityError.error);
  }

  const variant = await tx.productVariant.findUnique({ where: { id: productVariantId, tenantId } });
  if (!variant) {
    throw new InventoryError("Variant not found.");
  }

  const affected = await tx.$executeRaw`
    UPDATE "inventory"
    SET "reserved" = "reserved" + ${quantity}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "tenantId" = ${tenantId}
      AND "productVariantId" = ${productVariantId}
      AND "onHand" - "reserved" >= ${quantity}
  `;

  if (affected === 0) {
    // Either there is genuinely no Inventory row for this variant, or
    // there is one but insufficient available stock — both distinct from
    // the invariant this call exists to protect (onHand - reserved never
    // goes below the requested quantity), so both are reported the same
    // way: the reservation did not happen.
    throw new InventoryError("Not enough stock available.");
  }
}

/** Same shared-tx pattern as reserveInventoryInTx() — see its doc comment. */
export async function releaseInventoryInTx(
  tx: ScopedTx,
  tenantId: string,
  productVariantId: string,
  quantity: number,
): Promise<void> {
  if (!productVariantId.trim()) {
    throw new InventoryError("Variant not found.");
  }
  const quantityError = validateQuantity(quantity);
  if (quantityError) {
    throw new InventoryError(quantityError.error);
  }

  const variant = await tx.productVariant.findUnique({ where: { id: productVariantId, tenantId } });
  if (!variant) {
    throw new InventoryError("Variant not found.");
  }

  const affected = await tx.$executeRaw`
    UPDATE "inventory"
    SET "reserved" = "reserved" - ${quantity}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "tenantId" = ${tenantId}
      AND "productVariantId" = ${productVariantId}
      AND "reserved" >= ${quantity}
  `;

  if (affected === 0) {
    throw new InventoryError("Cannot release more than is currently reserved.");
  }
}

/**
 * Step 37: consumes previously-reserved stock at fulfillment time — the
 * physical stock has left the building, and the reservation that was
 * holding it for this order is released at the same moment. Both changes
 * happen in one atomic, guarded UPDATE:
 *
 *   SET onHand = onHand - qty, reserved = reserved - qty
 *   WHERE ... AND onHand >= qty AND reserved >= qty
 *
 * Deliberately NOT a composition of "deduct onHand" + reuse of
 * releaseInventoryInTx() — a two-step version could leave onHand deducted
 * with reserved not yet released (or vice versa) if the second step failed
 * outside a shared atomic statement, and reusing releaseInventoryInTx()
 * alone never touches onHand at all. One atomic statement makes a partial
 * consumption structurally impossible, matching reserveInventoryInTx's/
 * releaseInventoryInTx's own single-statement guard style.
 *
 * available = onHand - reserved is left mathematically unchanged by this
 * call: (onHand - qty) - (reserved - qty) = onHand - reserved. Only
 * order-mutations.ts's updateOrderStatus() calls this today, always inside
 * its own existing transaction alongside the pending -> fulfilled status
 * guard — same shared-tx pattern as reserveInventoryInTx/
 * releaseInventoryInTx.
 */
export async function consumeReservedInventoryInTx(
  tx: ScopedTx,
  tenantId: string,
  productVariantId: string,
  quantity: number,
): Promise<void> {
  if (!productVariantId.trim()) {
    throw new InventoryError("Variant not found.");
  }
  const quantityError = validateQuantity(quantity);
  if (quantityError) {
    throw new InventoryError(quantityError.error);
  }

  const variant = await tx.productVariant.findUnique({ where: { id: productVariantId, tenantId } });
  if (!variant) {
    throw new InventoryError("Variant not found.");
  }

  const affected = await tx.$executeRaw`
    UPDATE "inventory"
    SET "onHand" = "onHand" - ${quantity}, "reserved" = "reserved" - ${quantity}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "tenantId" = ${tenantId}
      AND "productVariantId" = ${productVariantId}
      AND "onHand" >= ${quantity}
      AND "reserved" >= ${quantity}
  `;

  if (affected === 0) {
    // Either there is no Inventory row for this variant, or onHand and/or
    // reserved is insufficient to cover this quantity — all distinct from
    // the invariant this call exists to protect, so all reported the same
    // way: the consumption did not happen.
    throw new InventoryError("Cannot fulfill: insufficient inventory to consume.");
  }
}

/**
 * Step 38: the smallest safe mechanism for a Tenant Admin to correct a
 * variant's physical on-hand stock — NOT a warehouse/receiving/history
 * system, just a signed adjustment to onHand. reserved is NEVER touched
 * here (mirrors reserveInventoryInTx/releaseInventoryInTx/
 * consumeReservedInventoryInTx's own single-field-at-a-time discipline,
 * where each function changes only the field(s) its own operation
 * concerns).
 *
 * One atomic, guarded UPDATE — never a read-calculate-write sequence,
 * which would be a lost-update race under concurrent adjustments:
 *
 *   SET onHand = onHand + adjustment
 *   WHERE ... AND onHand + adjustment >= reserved AND onHand + adjustment >= 0
 *
 * The `onHand + adjustment >= reserved` guard is what protects the
 * application's existing `available = onHand - reserved` invariant — an
 * adjustment is rejected outright if it would leave onHand below the
 * quantity currently held by pending orders' reservations, exactly as if
 * available stock could go negative. `adjustment` may be positive or
 * negative but never zero (a zero adjustment is meaningless, not merely a
 * no-op) and must be a whole number — VND-style integer quantities only,
 * same convention as every other inventory field in this codebase.
 */
export async function adjustInventoryOnHandInTx(
  tx: ScopedTx,
  tenantId: string,
  productVariantId: string,
  adjustment: number,
): Promise<void> {
  if (!productVariantId.trim()) {
    throw new InventoryError("Variant not found.");
  }
  if (!Number.isInteger(adjustment) || adjustment === 0) {
    throw new InventoryError("Adjustment must be a nonzero whole number.");
  }

  const variant = await tx.productVariant.findUnique({ where: { id: productVariantId, tenantId } });
  if (!variant) {
    throw new InventoryError("Variant not found.");
  }

  const affected = await tx.$executeRaw`
    UPDATE "inventory"
    SET "onHand" = "onHand" + ${adjustment}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "tenantId" = ${tenantId}
      AND "productVariantId" = ${productVariantId}
      AND "onHand" + ${adjustment} >= "reserved"
      AND "onHand" + ${adjustment} >= 0
  `;

  if (affected === 0) {
    // Either there is no Inventory row for this variant, or the adjustment
    // would take onHand below the currently reserved quantity or below
    // zero — all distinct from the invariant this call protects, so all
    // reported the same way: the adjustment did not happen.
    throw new InventoryError("This adjustment would leave stock below what is currently reserved, or below zero.");
  }
}

/**
 * Thin wrapper around adjustInventoryOnHandInTx() that owns its own
 * transaction — this is an independent inventory operation, never coupled
 * to an Order transaction (there is no Order/reservation context for a
 * manual stock correction), same "thin standalone wrapper" role as
 * reserveInventory()/releaseInventory() play for their *InTx() cores.
 */
export async function adjustInventoryOnHand(
  tenantId: string,
  productVariantId: string,
  adjustment: number,
): Promise<ActionResult> {
  const db = getScopedDb(tenantId);
  try {
    await db.$transaction((tx) => adjustInventoryOnHandInTx(tx, tenantId, productVariantId, adjustment));
    return { success: true, data: undefined };
  } catch (e) {
    if (e instanceof InventoryError) {
      return { success: false, error: e.message };
    }
    console.error("adjustInventoryOnHand failed:", e);
    return { success: false, error: "Something went wrong adjusting inventory." };
  }
}

/**
 * Reserves `quantity` units of stock for a specific ProductVariant, at
 * whichever Location currently holds inventory for it (V1 has exactly one
 * Location per tenant — the default — so this targets that tenant's single
 * Inventory row for the variant; not hardcoded to "the default location"
 * by name, so it keeps working unmodified if a tenant ever has more than
 * one Location's worth of Inventory rows for the same variant in a later
 * step — though V1 never creates more than one).
 *
 * tenantId must be the trusted value returned by requireTenantAdmin() (or
 * an equivalent verified-tenant source once a customer-facing checkout
 * exists) — never accepted from client-supplied cart data, which Step 26
 * explicitly documents as non-authoritative.
 *
 * Thin wrapper around reserveInventoryInTx() that owns its own
 * transaction — use this for standalone calls. order-mutations.ts instead
 * calls reserveInventoryInTx() directly inside its own transaction, to
 * fold order creation and inventory reservation into one atomic unit.
 */
export async function reserveInventory(
  tenantId: string,
  productVariantId: string,
  quantity: number,
): Promise<ActionResult> {
  const db = getScopedDb(tenantId);
  try {
    await db.$transaction((tx) => reserveInventoryInTx(tx, tenantId, productVariantId, quantity));
    return { success: true, data: undefined };
  } catch (e) {
    if (e instanceof InventoryError) {
      return { success: false, error: e.message };
    }
    console.error("reserveInventory failed:", e);
    return { success: false, error: "Something went wrong reserving inventory." };
  }
}

/**
 * Releases a previously-reserved `quantity` units for a ProductVariant.
 * Same atomic, single-statement, conditional-UPDATE pattern as
 * reserveInventory() — `WHERE reserved >= $qty` is what makes it
 * impossible for reserved to ever go negative, race-safe under concurrent
 * releases for the same row for the same reason the reservation side is.
 * onHand is never written here — only reserved.
 */
export async function releaseInventory(
  tenantId: string,
  productVariantId: string,
  quantity: number,
): Promise<ActionResult> {
  const db = getScopedDb(tenantId);
  try {
    await db.$transaction((tx) => releaseInventoryInTx(tx, tenantId, productVariantId, quantity));
    return { success: true, data: undefined };
  } catch (e) {
    if (e instanceof InventoryError) {
      return { success: false, error: e.message };
    }
    console.error("releaseInventory failed:", e);
    return { success: false, error: "Something went wrong releasing inventory." };
  }
}
