export type DiscountInfo = {
  discountType: "percentage" | "fixed_amount";
  discountValue: number;
  enabled: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

export type DiscountedPrice = {
  finalPrice: number;
  originalPrice: number;
  discountPercent: number | null;
  discountAmount: number;
};

export function isDiscountActive(discount: DiscountInfo | null | undefined, now: Date = new Date()): boolean {
  if (!discount || !discount.enabled) return false;
  if (discount.startsAt && now < discount.startsAt) return false;
  if (discount.endsAt && now > discount.endsAt) return false;
  return true;
}

export function applyDiscount(unitPrice: number, discount: DiscountInfo | null | undefined, now: Date = new Date()): DiscountedPrice {
  if (!isDiscountActive(discount, now)) {
    return { finalPrice: unitPrice, originalPrice: unitPrice, discountPercent: null, discountAmount: 0 };
  }
  let discountAmount: number;
  let discountPercent: number | null;

  if (discount!.discountType === "fixed_amount") {
    discountAmount = Math.min(discount!.discountValue, unitPrice);
    discountPercent = null;
  } else {
    const pct = discount!.discountValue;
    discountAmount = Math.round((unitPrice * pct) / 100);
    discountPercent = pct;
  }

  const finalPrice = Math.max(0, unitPrice - discountAmount);
  return { finalPrice, originalPrice: unitPrice, discountPercent, discountAmount };
}
