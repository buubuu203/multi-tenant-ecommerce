export const SHIPPING_ORIGIN_PROVINCE = 'Tp Hồ Chí Minh';
export const SHIPPING_INCLUDED_WEIGHT_GRAMS = 500;
export const INTERPROVINCIAL_SURCHARGE_VND = 20_000;
export const EXTRA_HALF_KILO_FEE_VND = 10_000;
const MAX_STORED_AMOUNT_VND = 2_147_483_647;

export type WeightedShippingItem = {
  weightGrams: number;
  quantity: number;
};

function normalizeProvinceName(province: string): string {
  return province
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/^(thanh pho|tp\.?|tinh)\s+/, '')
    .replace(/[^a-z0-9]/g, '');
}

export function estimateShippingAmount(
  baseAmount: number,
  destinationProvince: string,
  items: readonly WeightedShippingItem[],
): number {
  if (!Number.isSafeInteger(baseAmount) || baseAmount < 0) {
    throw new RangeError('Shipping base amount must be a non-negative whole number.');
  }
  if (!destinationProvince.trim()) {
    throw new RangeError('Shipping destination province is required.');
  }

  const totalWeightGrams = items.reduce((total, item) => {
    if (!Number.isSafeInteger(item.weightGrams) || item.weightGrams <= 0) {
      throw new RangeError('Shipping item weight must be a positive whole number of grams.');
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new RangeError('Shipping item quantity must be a positive whole number.');
    }
    return total + item.weightGrams * item.quantity;
  }, 0);

  if (!Number.isSafeInteger(totalWeightGrams)) {
    throw new RangeError('Estimated shipment weight exceeds the supported range.');
  }

  const billableHalfKiloBlocks = Math.max(
    1,
    Math.ceil(totalWeightGrams / SHIPPING_INCLUDED_WEIGHT_GRAMS),
  );
  const interprovincialSurcharge =
    normalizeProvinceName(destinationProvince) === normalizeProvinceName(SHIPPING_ORIGIN_PROVINCE)
      ? 0
      : INTERPROVINCIAL_SURCHARGE_VND;

  const amount =
    baseAmount +
    interprovincialSurcharge +
    (billableHalfKiloBlocks - 1) * EXTRA_HALF_KILO_FEE_VND;
  if (!Number.isSafeInteger(amount) || amount > MAX_STORED_AMOUNT_VND) {
    throw new RangeError('Estimated shipping amount exceeds the supported VND range.');
  }
  return amount;
}
