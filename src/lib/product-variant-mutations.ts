import { getScopedDb } from "./db/tenant-db";
import type { ActionResult } from "./action-result";

const MAX_SKU_LENGTH = 64; // reasonable bound for a human-entered SKU; no existing schema/app constraint to match

export type UpdateProductVariantInput = {
  price: number;
  sku?: string | null;
};

function validateUpdateProductVariantInput(
  productVariantId: string,
  input: UpdateProductVariantInput,
): { price: number; sku: string | null } | { error: string } {
  if (!productVariantId.trim()) {
    return { error: "Variant not found." };
  }

  if (!Number.isInteger(input.price) || input.price < 0) {
    return { error: "Price must be a non-negative whole number." };
  }

  let sku: string | null = null;
  if (input.sku !== undefined && input.sku !== null) {
    const trimmed = input.sku.trim();
    if (trimmed.length > 0) {
      if (trimmed.length > MAX_SKU_LENGTH) {
        return { error: `SKU must be ${MAX_SKU_LENGTH} characters or fewer.` };
      }
      sku = trimmed;
    }
    // trimmed === "" falls through, leaving sku as null (empty SKU -> null)
  }

  return { price: input.price, sku };
}

/**
 * Updates ONLY price and sku on an existing, tenant-owned, active
 * ProductVariant. Never touches combinationKey — that column is owned
 * exclusively by the database's deferred trigger, driven by
 * ProductVariantOptionValue rows, neither of which this function reads or
 * writes. Never touches Inventory. Does not create or archive variants —
 * that remains the exclusive responsibility of variant-generation.ts.
 *
 * tenantId must be the trusted value returned by requireTenantAdmin() —
 * never accepted from form input. Uses getScopedDb(tenantId) exclusively.
 */
export async function updateProductVariant(
  tenantId: string,
  productVariantId: string,
  input: UpdateProductVariantInput,
): Promise<ActionResult> {
  const validated = validateUpdateProductVariantInput(productVariantId, input);
  if ("error" in validated) {
    return { success: false, error: validated.error };
  }

  try {
    const db = getScopedDb(tenantId);

    const variant = await db.productVariant.findUnique({ where: { id: productVariantId, tenantId } });
    if (!variant) {
      return { success: false, error: "Variant not found." };
    }
    if (variant.status === "archived") {
      return { success: false, error: "Archived variants cannot be edited." };
    }

    await db.productVariant.update({
      where: { id: productVariantId },
      data: { price: validated.price, sku: validated.sku },
    });

    return { success: true, data: undefined };
  } catch (e) {
    // Unique violation on (tenantId, sku) — the DB remains the sole
    // authority on SKU uniqueness; no pre-check is performed here.
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
      return { success: false, error: "That SKU is already in use." };
    }
    console.error("updateProductVariant failed:", e);
    return { success: false, error: "Something went wrong updating the variant." };
  }
}
