import { getScopedDb } from "./db/tenant-db";
import { prisma } from "./prisma";
import type { ActionResult } from "./action-result";
import type { VoucherScope } from "./vouchers";

export type VoucherInput = {
  triggerType: "code" | "automatic";
  code: string;
  label: string;
  discountType: "percentage" | "fixed_amount";
  discountValue: string;
  scope: VoucherScope;
  productIds: string[];
  minOrderAmount: string;
  maxDiscount: string;
  maxUses: string;
  startsAt: string;
  endsAt: string;
  enabled: boolean;
};

function parseOptionalInt(value: string, label: string): { value: number | null } | { error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { value: null };
  if (!/^\d+$/.test(trimmed)) return { error: `${label} must be a whole number.` };
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n < 0) return { error: `${label} must be a non-negative integer.` };
  return { value: n };
}

function parseOptionalDate(value: string, label: string): { date: Date | null } | { error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { date: null };
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return { error: `${label} is not a valid date.` };
  return { date };
}

function validateVoucherInput(input: VoucherInput) {
  const triggerType = input.triggerType === "automatic" ? "automatic" as const : "code" as const;

  let code: string | null = null;
  let label: string | null = null;

  if (triggerType === "code") {
    const rawCode = input.code.trim().toUpperCase();
    if (!rawCode) return { error: "Voucher code is required." };
    if (!/^[A-Z0-9_-]+$/.test(rawCode)) return { error: "Code can only contain letters, numbers, hyphens and underscores." };
    if (rawCode.length > 32) return { error: "Code must be 32 characters or fewer." };
    code = rawCode;
  } else {
    const rawLabel = input.label.trim();
    if (!rawLabel) return { error: "Label is required for automatic promotions." };
    if (rawLabel.length > 100) return { error: "Label must be 100 characters or fewer." };
    label = rawLabel;
  }

  if (!["percentage", "fixed_amount"].includes(input.discountType)) {
    return { error: "Invalid discount type." };
  }

  const scope = input.scope === "product" ? "product" as const : "order" as const;
  if (scope === "product" && input.productIds.length === 0) {
    return { error: "Product vouchers must target at least one product." };
  }

  const rawValue = input.discountValue.trim();
  if (!/^\d+$/.test(rawValue)) return { error: "Discount value must be a whole number." };
  const discountValue = Number(rawValue);
  if (input.discountType === "percentage") {
    if (discountValue < 1 || discountValue > 100) return { error: "Percentage must be between 1 and 100." };
  } else {
    if (discountValue < 1) return { error: "Discount amount must be at least 1 ₫." };
  }

  const minResult = parseOptionalInt(input.minOrderAmount, "Minimum order amount");
  if ("error" in minResult) return minResult;
  const maxDiscountResult = parseOptionalInt(input.maxDiscount, "Max discount");
  if ("error" in maxDiscountResult) return maxDiscountResult;
  const maxUsesResult = parseOptionalInt(input.maxUses, "Max uses");
  if ("error" in maxUsesResult) return maxUsesResult;

  const startsAtResult = parseOptionalDate(input.startsAt, "Start date");
  if ("error" in startsAtResult) return startsAtResult;
  const endsAtResult = parseOptionalDate(input.endsAt, "End date");
  if ("error" in endsAtResult) return endsAtResult;

  if (startsAtResult.date && endsAtResult.date && startsAtResult.date >= endsAtResult.date) {
    return { error: "Start date must be before end date." };
  }

  return {
    triggerType,
    code,
    label,
    discountType: input.discountType,
    discountValue,
    scope,
    productIds: input.productIds,
    minOrderAmount: minResult.value,
    maxDiscount: maxDiscountResult.value,
    maxUses: maxUsesResult.value,
    startsAt: startsAtResult.date,
    endsAt: endsAtResult.date,
    enabled: input.enabled,
  };
}

export async function createVoucher(
  tenantId: string,
  input: VoucherInput,
): Promise<ActionResult<{ id: string }>> {
  const validated = validateVoucherInput(input);
  if ("error" in validated) return { success: false, error: validated.error };

  const db = getScopedDb(tenantId);
  if (validated.code) {
    const existing = await db.voucher.findUnique({
      where: { tenantId_code: { tenantId, code: validated.code } },
    });
    if (existing) return { success: false, error: "A voucher with this code already exists." };
  }
  if (validated.label) {
    const existing = await db.voucher.findUnique({
      where: { tenantId_label: { tenantId, label: validated.label } },
    });
    if (existing) return { success: false, error: "A promotion with this label already exists." };
  }

  const { productIds, ...voucherData } = validated;

  try {
    const voucher = await db.voucher.create({
      data: {
        tenantId,
        ...voucherData,
        products: productIds.length > 0
          ? { create: productIds.map((productId) => ({ productId })) }
          : undefined,
      },
    });
    return { success: true, data: { id: voucher.id } };
  } catch (e) {
    console.error("createVoucher failed:", e);
    return { success: false, error: "Something went wrong creating the voucher." };
  }
}

export async function updateVoucher(
  tenantId: string,
  voucherId: string,
  input: VoucherInput,
): Promise<ActionResult> {
  const validated = validateVoucherInput(input);
  if ("error" in validated) return { success: false, error: validated.error };

  const db = getScopedDb(tenantId);
  const existing = await db.voucher.findUnique({ where: { id: voucherId, tenantId } });
  if (!existing) return { success: false, error: "Voucher not found." };

  if (validated.code && validated.code !== existing.code) {
    const duplicate = await db.voucher.findUnique({
      where: { tenantId_code: { tenantId, code: validated.code } },
    });
    if (duplicate) return { success: false, error: "A voucher with this code already exists." };
  }
  if (validated.label && validated.label !== existing.label) {
    const duplicate = await db.voucher.findUnique({
      where: { tenantId_label: { tenantId, label: validated.label } },
    });
    if (duplicate) return { success: false, error: "A promotion with this label already exists." };
  }

  const { productIds, ...voucherData } = validated;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.voucher.update({
        where: { id: voucherId, tenantId },
        data: voucherData,
      });
      await tx.voucherProduct.deleteMany({ where: { voucherId, voucher: { tenantId } } });
      if (productIds.length > 0) {
        await tx.voucherProduct.createMany({
          data: productIds.map((productId) => ({ voucherId, productId })),
        });
      }
    });
    return { success: true, data: undefined };
  } catch (e) {
    console.error("updateVoucher failed:", e);
    return { success: false, error: "Something went wrong updating the voucher." };
  }
}

export async function deleteVoucher(tenantId: string, voucherId: string): Promise<ActionResult> {
  const db = getScopedDb(tenantId);
  try {
    await db.voucher.deleteMany({ where: { id: voucherId, tenantId } });
    return { success: true, data: undefined };
  } catch (e) {
    console.error("deleteVoucher failed:", e);
    return { success: false, error: "Something went wrong deleting the voucher." };
  }
}

export async function listVouchers(tenantId: string) {
  const db = getScopedDb(tenantId);
  return db.voucher.findMany({
    where: { tenantId },
    include: {
      products: {
        select: { productId: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}
