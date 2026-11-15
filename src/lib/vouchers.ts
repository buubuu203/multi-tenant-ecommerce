import { getScopedDb } from "./db/tenant-db";

export type VoucherScope = "order" | "product";

export type VoucherInfo = {
  id: string;
  code: string | null;
  label: string | null;
  triggerType: "code" | "automatic";
  discountType: "percentage" | "fixed_amount";
  discountValue: number;
  scope: VoucherScope;
  minOrderAmount: number | null;
  maxDiscount: number | null;
  maxUses: number | null;
  usedCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  enabled: boolean;
  targetProductIds: string[];
};

export type VoucherValidationResult =
  | { valid: true; voucher: VoucherInfo; discountAmount: number; perItemDiscounts: PerItemDiscount[] }
  | { valid: false; error: string };

export type PerItemDiscount = {
  productVariantId: string;
  productId: string;
  unitDiscount: number;
  quantity: number;
};

export type CartItemForVoucher = {
  productVariantId: string;
  productId: string;
  unitPrice: number;
  quantity: number;
};

export function isVoucherActive(v: VoucherInfo, now: Date = new Date()): boolean {
  if (!v.enabled) return false;
  if (v.startsAt && now < v.startsAt) return false;
  if (v.endsAt && now > v.endsAt) return false;
  if (v.maxUses !== null && v.usedCount >= v.maxUses) return false;
  return true;
}

export function calculateVoucherDiscount(v: VoucherInfo, orderSubtotal: number): number {
  if (v.discountType === "fixed_amount") {
    return Math.min(v.discountValue, orderSubtotal);
  }
  let amount = Math.round((orderSubtotal * v.discountValue) / 100);
  if (v.maxDiscount !== null) {
    amount = Math.min(amount, v.maxDiscount);
  }
  return Math.min(amount, orderSubtotal);
}

export function calculatePerItemDiscounts(
  v: VoucherInfo,
  items: CartItemForVoucher[],
): PerItemDiscount[] {
  const targeted = v.targetProductIds.length > 0
    ? items.filter((item) => v.targetProductIds.includes(item.productId))
    : items;

  if (targeted.length === 0) return [];

  if (v.discountType === "percentage") {
    const results: PerItemDiscount[] = [];
    let totalDiscount = 0;
    for (const item of targeted) {
      const unitDiscount = Math.round((item.unitPrice * v.discountValue) / 100);
      const lineDiscount = unitDiscount * item.quantity;
      totalDiscount += lineDiscount;
      results.push({
        productVariantId: item.productVariantId,
        productId: item.productId,
        unitDiscount,
        quantity: item.quantity,
      });
    }
    if (v.maxDiscount !== null && totalDiscount > v.maxDiscount) {
      const ratio = v.maxDiscount / totalDiscount;
      for (const r of results) {
        r.unitDiscount = Math.round(r.unitDiscount * ratio);
      }
    }
    return results;
  }

  // fixed_amount: spread across targeted items proportionally by line total
  const targetedSubtotal = targeted.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const totalDiscount = Math.min(v.discountValue, targetedSubtotal);
  if (totalDiscount <= 0) return [];

  const results: PerItemDiscount[] = [];
  let remaining = totalDiscount;
  for (let i = 0; i < targeted.length; i++) {
    const item = targeted[i];
    const lineTotal = item.unitPrice * item.quantity;
    const share = i === targeted.length - 1
      ? remaining
      : Math.round((lineTotal / targetedSubtotal) * totalDiscount);
    const unitDiscount = item.quantity > 0 ? Math.round(share / item.quantity) : 0;
    remaining -= unitDiscount * item.quantity;
    results.push({
      productVariantId: item.productVariantId,
      productId: item.productId,
      unitDiscount,
      quantity: item.quantity,
    });
  }
  return results;
}

function toVoucherInfo(voucher: {
  id: string;
  code: string | null;
  label?: string | null;
  triggerType?: string;
  discountType: string;
  discountValue: number;
  scope: string;
  minOrderAmount: number | null;
  maxDiscount: number | null;
  maxUses: number | null;
  usedCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  enabled: boolean;
  products?: { productId: string }[];
}): VoucherInfo {
  return {
    id: voucher.id,
    code: voucher.code,
    label: voucher.label ?? null,
    triggerType: (voucher.triggerType as "code" | "automatic") ?? "code",
    discountType: voucher.discountType as "percentage" | "fixed_amount",
    discountValue: voucher.discountValue,
    scope: voucher.scope as VoucherScope,
    minOrderAmount: voucher.minOrderAmount,
    maxDiscount: voucher.maxDiscount,
    maxUses: voucher.maxUses,
    usedCount: voucher.usedCount,
    startsAt: voucher.startsAt,
    endsAt: voucher.endsAt,
    enabled: voucher.enabled,
    targetProductIds: voucher.products?.map((p) => p.productId) ?? [],
  };
}

export { toVoucherInfo };

export async function validateVoucher(
  tenantId: string,
  code: string,
  orderSubtotal: number,
  cartItems?: CartItemForVoucher[],
): Promise<VoucherValidationResult> {
  const db = getScopedDb(tenantId);
  const normalizedCode = code.trim().toUpperCase();

  if (!normalizedCode) {
    return { valid: false, error: "Please enter a voucher code." };
  }

  const voucher = await db.voucher.findUnique({
    where: { tenantId_code: { tenantId, code: normalizedCode } },
    include: { products: { select: { productId: true } } },
  });

  if (!voucher) {
    return { valid: false, error: "Invalid voucher code." };
  }

  const info = toVoucherInfo(voucher);

  if (!isVoucherActive(info)) {
    if (!info.enabled) return { valid: false, error: "This voucher is no longer active." };
    if (info.startsAt && new Date() < info.startsAt) return { valid: false, error: "This voucher is not active yet." };
    if (info.endsAt && new Date() > info.endsAt) return { valid: false, error: "This voucher has expired." };
    if (info.maxUses !== null && info.usedCount >= info.maxUses) return { valid: false, error: "This voucher has been fully redeemed." };
    return { valid: false, error: "This voucher is not available." };
  }

  if (info.scope === "product") {
    if (!cartItems || cartItems.length === 0) {
      return { valid: true, voucher: info, discountAmount: 0, perItemDiscounts: [] };
    }
    const targeted = info.targetProductIds.length > 0
      ? cartItems.filter((item) => info.targetProductIds.includes(item.productId))
      : cartItems;
    if (targeted.length === 0) {
      return { valid: false, error: "This voucher doesn't apply to any items in your cart." };
    }
    const targetedSubtotal = targeted.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    if (info.minOrderAmount !== null && targetedSubtotal < info.minOrderAmount) {
      const formatted = info.minOrderAmount.toLocaleString("vi-VN");
      return { valid: false, error: `Minimum ${formatted} ₫ of eligible items required for this voucher.` };
    }
    const perItemDiscounts = calculatePerItemDiscounts(info, cartItems);
    const discountAmount = perItemDiscounts.reduce((sum, d) => sum + d.unitDiscount * d.quantity, 0);
    return { valid: true, voucher: info, discountAmount, perItemDiscounts };
  }

  // scope === "order"
  if (info.minOrderAmount !== null && orderSubtotal < info.minOrderAmount) {
    const formatted = info.minOrderAmount.toLocaleString("vi-VN");
    return { valid: false, error: `Minimum order of ${formatted} ₫ required for this voucher.` };
  }

  const discountAmount = calculateVoucherDiscount(info, orderSubtotal);
  return { valid: true, voucher: info, discountAmount, perItemDiscounts: [] };
}

export async function findBestAutoPromotion(
  tenantId: string,
  cartItems: CartItemForVoucher[],
  orderSubtotal: number,
): Promise<VoucherValidationResult | null> {
  const db = getScopedDb(tenantId);
  const now = new Date();
  const autoPromotions = await db.voucher.findMany({
    where: {
      tenantId,
      triggerType: "automatic",
      enabled: true,
      OR: [{ startsAt: null }, { startsAt: { lte: now } }],
    },
    include: { products: { select: { productId: true } } },
  });

  let bestResult: VoucherValidationResult | null = null;
  let bestDiscount = 0;

  for (const promo of autoPromotions) {
    const info = toVoucherInfo(promo);
    if (!isVoucherActive(info, now)) continue;
    if (info.endsAt && now > info.endsAt) continue;
    if (info.maxUses !== null && info.usedCount >= info.maxUses) continue;

    if (info.scope === "product") {
      if (cartItems.length === 0) continue;
      const targeted = info.targetProductIds.length > 0
        ? cartItems.filter((item) => info.targetProductIds.includes(item.productId))
        : cartItems;
      if (targeted.length === 0) continue;
      const targetedSubtotal = targeted.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
      if (info.minOrderAmount !== null && targetedSubtotal < info.minOrderAmount) continue;
      const perItemDiscounts = calculatePerItemDiscounts(info, cartItems);
      const discountAmount = perItemDiscounts.reduce((sum, d) => sum + d.unitDiscount * d.quantity, 0);
      if (discountAmount > bestDiscount) {
        bestDiscount = discountAmount;
        bestResult = { valid: true, voucher: info, discountAmount, perItemDiscounts };
      }
    } else {
      if (info.minOrderAmount !== null && orderSubtotal < info.minOrderAmount) continue;
      const discountAmount = calculateVoucherDiscount(info, orderSubtotal);
      if (discountAmount > bestDiscount) {
        bestDiscount = discountAmount;
        bestResult = { valid: true, voucher: info, discountAmount, perItemDiscounts: [] };
      }
    }
  }

  return bestResult;
}
