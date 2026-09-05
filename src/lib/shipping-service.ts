import { getScopedDb } from "./db/tenant-db";

export type ShippingMethodOption = {
  id: string;
  name: string;
  amount: number;
  isDefault: boolean;
};

/**
 * The set of shipping methods this tenant has enabled — drives the
 * storefront's shipping-method selector, same UX-only role
 * getEnabledPaymentMethods() plays for payment methods (the real
 * enforcement is server-side in createOrder(), unaffected by this list).
 * Ordered by sortOrder so a merchant's chosen display order is respected.
 *
 * "Choose another enabled method appropriately" (per the approved design)
 * is handled entirely by what this function returns, not by any write to
 * TenantShippingMethod: if the method currently flagged isDefault is
 * disabled (or has been deleted), it simply isn't in this list, so no
 * entry here has isDefault: true — the caller (CartWidget) falls back to
 * pre-selecting the first entry in that case. No reassignment of the
 * isDefault flag itself ever happens automatically.
 */
export async function getEnabledShippingMethods(tenantId: string): Promise<ShippingMethodOption[]> {
  const rows = await getScopedDb(tenantId).tenantShippingMethod.findMany({
    where: { tenantId, enabled: true },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((row) => ({ id: row.id, name: row.name, amount: row.amount, isDefault: row.isDefault }));
}

export type ResolvedShippingMethod = { name: string; amount: number };

/**
 * Authoritative shipping-method resolution for order creation — the
 * server-side counterpart to the client's selection. Re-reads the CURRENT
 * amount from the database (never trusts whatever the client displayed)
 * and confirms the method both belongs to this tenant and is still
 * enabled at this exact moment, closing the same "selected at page load,
 * changed before submit" race already accepted (and documented) for
 * payment methods in createOrder(). Returns null for "not found or not
 * enabled" uniformly — the caller is responsible for turning that into a
 * clean rejection, never a partial order.
 */
export async function resolveShippingMethod(tenantId: string, methodId: string): Promise<ResolvedShippingMethod | null> {
  const method = await getScopedDb(tenantId).tenantShippingMethod.findUnique({ where: { id: methodId, tenantId } });
  if (!method || !method.enabled) {
    return null;
  }
  return { name: method.name, amount: method.amount };
}
