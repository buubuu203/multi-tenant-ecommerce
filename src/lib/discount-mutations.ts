import { getScopedDb } from "./db/tenant-db";
import type { ActionResult } from "./action-result";
import type { Discount } from "@/generated/prisma/client";

export type DiscountInput = {
  percentOff: string; // whole-number-from-form-field convention, same as ShippingMethodInput.amount
  enabled: boolean;
  startsAt: string; // "" or a datetime-local input value
  endsAt: string;
};

function parseOptionalDate(value: string, fieldLabel: string): { date: Date | null } | { error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { date: null };
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return { error: `${fieldLabel} is not a valid date.` };
  }
  return { date };
}

function validateDiscountInput(
  input: DiscountInput,
): { percentOff: number; enabled: boolean; startsAt: Date | null; endsAt: Date | null } | { error: string } {
  if (!/^\d+$/.test(input.percentOff.trim())) {
    return { error: "Discount percent must be a whole number." };
  }
  const percentOff = Number(input.percentOff.trim());
  if (!Number.isSafeInteger(percentOff) || percentOff < 1 || percentOff > 100) {
    return { error: "Discount percent must be between 1 and 100." };
  }

  const startsAtResult = parseOptionalDate(input.startsAt, "Start date");
  if ("error" in startsAtResult) return startsAtResult;
  const endsAtResult = parseOptionalDate(input.endsAt, "End date");
  if ("error" in endsAtResult) return endsAtResult;

  if (startsAtResult.date && endsAtResult.date && startsAtResult.date >= endsAtResult.date) {
    return { error: "Start date must be before end date." };
  }

  return { percentOff, enabled: input.enabled, startsAt: startsAtResult.date, endsAt: endsAtResult.date };
}

/**
 * Creates or replaces the ONE discount slot for a product (see
 * Discount.@@unique([productId]) in schema.prisma — "one active discount
 * per product," enforced at the database level, not just by convention).
 * `upsert` is the correct primitive here: a merchant editing an existing
 * product's discount and a merchant setting a discount for the first time
 * are the same operation from this function's point of view.
 *
 * productId is verified to belong to this tenant via the same
 * tenant-scoped `product` delegate every other product mutation in this
 * codebase already uses (product-mutations.ts) — never trusted from the
 * caller alone.
 */
export async function upsertProductDiscount(
  tenantId: string,
  productId: string,
  input: DiscountInput,
): Promise<ActionResult> {
  const validated = validateDiscountInput(input);
  if ("error" in validated) {
    return { success: false, error: validated.error };
  }

  const db = getScopedDb(tenantId);
  const product = await db.product.findUnique({ where: { id: productId, tenantId } });
  if (!product) {
    return { success: false, error: "Product not found." };
  }

  try {
    await db.discount.upsert({
      where: { productId },
      create: {
        tenantId,
        productId,
        percentOff: validated.percentOff,
        enabled: validated.enabled,
        startsAt: validated.startsAt,
        endsAt: validated.endsAt,
      },
      update: {
        percentOff: validated.percentOff,
        enabled: validated.enabled,
        startsAt: validated.startsAt,
        endsAt: validated.endsAt,
      },
    });
    return { success: true, data: undefined };
  } catch (e) {
    console.error("upsertProductDiscount failed:", e);
    return { success: false, error: "Something went wrong saving the discount." };
  }
}

export async function deleteProductDiscount(tenantId: string, productId: string): Promise<ActionResult> {
  const db = getScopedDb(tenantId);
  try {
    await db.discount.deleteMany({ where: { productId, tenantId } });
    return { success: true, data: undefined };
  } catch (e) {
    console.error("deleteProductDiscount failed:", e);
    return { success: false, error: "Something went wrong removing the discount." };
  }
}

export async function listDiscountsByProduct(tenantId: string): Promise<Map<string, Discount>> {
  const db = getScopedDb(tenantId);
  const discounts = await db.discount.findMany({ where: { tenantId } });
  return new Map(discounts.map((d) => [d.productId, d]));
}
