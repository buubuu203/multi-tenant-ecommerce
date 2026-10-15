/**
 * Whether a store can take an order at all, as far as shipping is
 * concerned.
 *
 * Checkout requires at least one ENABLED shipping method, so "no methods"
 * was never the only blocked state — a store with three methods all
 * switched off is equally unable to sell. This was derived inline in the
 * Shipping admin page; it is pulled out so the rule can be tested directly
 * rather than only read.
 *
 * Pure, and derived entirely from rows the page already loads. It decides
 * nothing: checkout's own enforcement remains authoritative, and these
 * strings are exactly the ones the page already displayed.
 */

export type ShippingMethodAvailability = { enabled: boolean };

export const NO_METHODS_BLOCKED_REASON =
  'Checkout is blocked because no shipping method is configured.';

export const ALL_DISABLED_BLOCKED_REASON =
  'Checkout is blocked because all shipping methods are disabled.';

/** The number of methods a customer could actually choose. */
export function enabledShippingMethodCount(methods: readonly ShippingMethodAvailability[]): number {
  return methods.filter((method) => method.enabled).length;
}

/**
 * The reason checkout is blocked, or null when at least one method is
 * enabled. The two cases are distinguished because the fix differs: add a
 * method, versus enable one you already have.
 */
export function shippingBlockedReason(
  methods: readonly ShippingMethodAvailability[],
): string | null {
  if (methods.length === 0) return NO_METHODS_BLOCKED_REASON;
  if (enabledShippingMethodCount(methods) === 0) return ALL_DISABLED_BLOCKED_REASON;
  return null;
}
