// Product Discount (V1): the ONE place discount math happens — both
// order-mutations.ts (the authoritative, server-side charge) and
// get-tenant-products.ts (the storefront's display price) import this
// exact function, so what a customer sees before checkout and what they
// are actually charged can never drift apart from two separate
// implementations of "apply a percentage."
//
// Rounding: nearest whole VND (Math.round) — this codebase has no
// currency subunit concept (see ShippingMethodInput's identical
// whole-VND convention), so a discount amount is always a whole number,
// same as every other money value here.

export type DiscountInfo = {
  percentOff: number;
  enabled: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

export type DiscountedPrice = {
  finalPrice: number;
  originalPrice: number;
  discountPercent: number | null; // null means "no discount applied"
};

/**
 * Whether a Discount row is currently in effect — enabled AND (if dates
 * are set) within [startsAt, endsAt]. A discount with no dates is active
 * for as long as it's enabled, no time-boxing required (V1's default).
 */
export function isDiscountActive(discount: DiscountInfo | null | undefined, now: Date = new Date()): boolean {
  if (!discount || !discount.enabled) return false;
  if (discount.startsAt && now < discount.startsAt) return false;
  if (discount.endsAt && now > discount.endsAt) return false;
  return true;
}

/**
 * Applies an active discount (if any) to a unit price. Never returns a
 * negative finalPrice — percentOff is validated to [1, 100] at write time
 * (discount-mutations.ts), so this clamp is defensive, not load-bearing,
 * but a discount system must never be ABLE to produce a negative total
 * even if that invariant were ever violated upstream.
 */
export function applyDiscount(unitPrice: number, discount: DiscountInfo | null | undefined, now: Date = new Date()): DiscountedPrice {
  if (!isDiscountActive(discount, now)) {
    return { finalPrice: unitPrice, originalPrice: unitPrice, discountPercent: null };
  }
  const percentOff = discount!.percentOff;
  const discountAmount = Math.round((unitPrice * percentOff) / 100);
  const finalPrice = Math.max(0, unitPrice - discountAmount);
  return { finalPrice, originalPrice: unitPrice, discountPercent: percentOff };
}
