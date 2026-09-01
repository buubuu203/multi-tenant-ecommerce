import { getScopedDb } from "./db/tenant-db";
import type { ActionResult } from "./action-result";

/**
 * Declares that a Product supports an existing VariantOption (e.g.
 * "T-Shirt" supports "Color"). Does not create any ProductVariant,
 * VariantOptionValue, ProductVariantOptionValue, or Inventory rows — this
 * is the declaration step only; variant generation is a later phase.
 *
 * tenantId must be the trusted value returned by requireTenantAdmin() —
 * never accepted from form input or any client-controlled object. Uses
 * getScopedDb(tenantId) exclusively.
 */
export async function createProductOption(
  tenantId: string,
  productId: string,
  variantOptionId: string,
): Promise<ActionResult<{ productOptionId: string }>> {
  try {
    const db = getScopedDb(tenantId);

    const product = await db.product.findUnique({ where: { id: productId, tenantId } });
    if (!product) {
      return { success: false, error: "Product not found." };
    }

    const variantOption = await db.variantOption.findUnique({ where: { id: variantOptionId, tenantId } });
    if (!variantOption) {
      return { success: false, error: "Option not found." };
    }

    const productOption = await db.productOption.create({
      data: { tenantId, productId, variantOptionId },
    });
    return { success: true, data: { productOptionId: productOption.id } };
  } catch (e) {
    // Unique violation on (productId, variantOptionId) — this option is
    // already assigned to this product.
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
      return { success: false, error: "This option is already assigned to the product." };
    }
    console.error("createProductOption failed:", e);
    return { success: false, error: "Something went wrong assigning the option." };
  }
}

/**
 * Lists the VariantOptions a tenant-owned Product has declared support for,
 * ordered by option name. tenantId must be the trusted value returned by
 * requireTenantAdmin() — never accepted from form input. Uses
 * getScopedDb(tenantId) exclusively.
 */
export async function listProductOptions(tenantId: string, productId: string) {
  const db = getScopedDb(tenantId);

  const product = await db.product.findUnique({ where: { id: productId, tenantId } });
  if (!product) {
    return { success: false as const, error: "Product not found." };
  }

  const productOptions = await db.productOption.findMany({
    where: { tenantId, productId },
    include: { variantOption: true },
    orderBy: { variantOption: { name: "asc" } },
  });
  return { success: true as const, data: productOptions };
}

/**
 * Removes a Product's declared support for an option. tenantId must be the
 * trusted value returned by requireTenantAdmin() — never accepted from
 * form input. Uses getScopedDb(tenantId) exclusively.
 *
 * Never cascade-deletes ProductVariantOptionValue rows from application
 * code — whatever the database's own FK behavior is for a referenced
 * ProductOption is left entirely to the database, not overridden or
 * replicated here.
 */
export async function deleteProductOption(
  tenantId: string,
  productOptionId: string,
): Promise<ActionResult> {
  try {
    const db = getScopedDb(tenantId);
    await db.productOption.delete({ where: { id: productOptionId, tenantId } });
    return { success: true, data: undefined };
  } catch (e) {
    // P2025: record not found (already deleted, or belongs to another
    // tenant — getScopedDb()'s injected tenantId in `where` makes a
    // foreign id simply match no row, same as the rest of the codebase).
    // P2003: FK constraint violation, if the database ever rejects this
    // delete outright (e.g. a future onDelete: Restrict on this FK).
    if (typeof e === "object" && e !== null && "code" in e) {
      if (e.code === "P2025") {
        return { success: false, error: "Option assignment not found." };
      }
      if (e.code === "P2003") {
        return { success: false, error: "This option assignment is still in use and cannot be removed." };
      }
    }
    console.error("deleteProductOption failed:", e);
    return { success: false, error: "Something went wrong removing the option assignment." };
  }
}
