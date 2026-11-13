// Platform Admin status-change copy, kept out of page.tsx so the wording
// rules are unit-testable without a DOM (the same reasoning as
// product-sort.ts and cart-reconcile.ts).
//
// The problem this solves: one form changes a tenant to any status, so a
// single fixed confirm() string had to warn about the worst case. It read
// "Suspending or archiving takes its storefront offline" even when the
// operator was REACTIVATING a suspended store — the opposite of what was
// about to happen. The message is now derived from the transition.

export const TENANT_STATUSES = ["pending", "active", "suspended", "archived"] as const;
export type TenantStatusValue = (typeof TENANT_STATUSES)[number];

/** Which statuses take a live storefront offline for customers. */
export const DISRUPTIVE_STATUSES = new Set<TenantStatusValue>(["suspended", "archived"]);

export function isTenantStatus(value: unknown): value is TenantStatusValue {
  return typeof value === "string" && (TENANT_STATUSES as readonly string[]).includes(value);
}

/**
 * What each status means for customers visiting the storefront. A
 * Record over TenantStatusValue rather than a switch, so adding a status
 * to TENANT_STATUSES is a type error here until its copy is written.
 */
const OUTCOME: Record<TenantStatusValue, string> = {
  active: "Its storefront will go live for customers immediately.",
  pending: "Its storefront will show “coming soon” to customers.",
  suspended: "This takes its storefront offline for customers immediately.",
  archived:
    "This takes its storefront offline for customers immediately. Archived is the strongest state, for stores that are gone for good.",
};

/**
 * The confirm() text for changing `tenantName` from `from` to `to`.
 *
 * Every status change still confirms — the point is accuracy, not fewer
 * prompts. A no-op save says so plainly rather than warning about a
 * change that is not happening.
 */
export function tenantStatusConfirmMessage(
  tenantName: string,
  from: TenantStatusValue,
  to: unknown,
): string {
  // `to` arrives from FormData, so it is unknown until validated. An
  // unrecognised value gets a deliberately vague prompt rather than a
  // confident wrong one; updateTenantStatusAction rejects it server-side
  // regardless, which is where the real guard lives.
  if (!isTenantStatus(to)) {
    return `Change “${tenantName}” status?`;
  }
  if (to === from) {
    return `“${tenantName}” is already ${from}. Save anyway?`;
  }
  return `Change “${tenantName}” from ${from} to ${to}? ${OUTCOME[to]}`;
}
