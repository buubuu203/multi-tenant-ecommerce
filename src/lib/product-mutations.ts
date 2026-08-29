import { getScopedDb } from "./db/tenant-db";
import type { ActionResult } from "./action-result";

const VALID_STATUSES = ["draft", "active"] as const;
type ProductStatusInput = (typeof VALID_STATUSES)[number];

export type ProductInput = {
  name: string;
  price: string;
  status: string;
};

function validateProductInput(
  input: ProductInput,
): { name: string; price: number; status: ProductStatusInput } | { error: string } {
  const name = input.name.trim();
  if (!name) {
    return { error: "Name is required." };
  }

  if (!/^\d+$/.test(input.price.trim())) {
    return { error: "Price must be a whole number of VND (no decimals)." };
  }
  const price = Number(input.price.trim());
  if (!Number.isSafeInteger(price) || price < 0) {
    return { error: "Price must be a non-negative whole number." };
  }

  if (!VALID_STATUSES.includes(input.status as ProductStatusInput)) {
    return { error: "Status must be draft or active." };
  }

  return { name, price, status: input.status as ProductStatusInput };
}

// Architecture v4.1 (Checkpoint 4F): Product no longer carries price —
// price lives on ProductVariant. Every Product still has exactly one
// variant in the simple-product path this file handles (no options), with
// combinationKey = '' (mirrors the migration's own backfill for existing
// products). ProductVariantStatus has no "draft" value — it describes
// whether a specific variant is orderable, a different axis from the
// Product's own draft/active publish state, which is unchanged and still
// lives on Product.status. The simple-product path always creates/keeps
// the variant 'active'; there is no variant-level archiving surfaced by
// this UI yet, so there is nothing else it could correctly map to.
function toVariantStatus(): "active" {
  return "active";
}

/**
 * Creates a product for the calling tenant. tenantId must be the trusted
 * value returned by requireTenantAdmin() — never accepted from form input.
 * Uses getScopedDb(tenantId) exclusively.
 *
 * Creates Product + its single simple-product ProductVariant + that
 * variant's Inventory row (at the tenant's existing default Location) all
 * in one transaction — either all three rows exist or none do. No
 * ProductOption / ProductVariantOptionValue rows are created here; this is
 * the no-options path only.
 */
export async function createProduct(
  tenantId: string,
  input: ProductInput,
): Promise<ActionResult<{ productId: string }>> {
  const validated = validateProductInput(input);
  if ("error" in validated) {
    return { success: false, error: validated.error };
  }

  try {
    const db = getScopedDb(tenantId);

    // The default Location is provisioned once per tenant by the v4.1
    // migration's backfill, enforced unique by the partial index
    // locations_one_default_per_tenant — this step never creates one.
    const defaultLocation = await db.location.findFirst({
      where: { tenantId, isDefault: true },
    });
    if (!defaultLocation) {
      console.error(`createProduct: no default Location found for tenant ${tenantId}`);
      return { success: false, error: "Something went wrong creating the product." };
    }

    const productId = await db.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: { name: validated.name, status: validated.status, tenantId },
      });

      const variant = await tx.productVariant.create({
        data: {
          tenantId,
          productId: product.id,
          price: validated.price,
          status: toVariantStatus(),
          combinationKey: "",
        },
      });

      await tx.inventory.create({
        data: {
          tenantId,
          productVariantId: variant.id,
          locationId: defaultLocation.id,
          onHand: 0,
          reserved: 0,
        },
      });

      return product.id;
    });

    return { success: true, data: { productId } };
  } catch (e) {
    console.error("createProduct failed:", e);
    return { success: false, error: "Something went wrong creating the product." };
  }
}

/**
 * Updates a product belonging to the calling tenant. productId identifies
 * WHICH product, but tenantId (trusted, from requireTenantAdmin()) is what
 * getScopedDb() uses to scope the write — getScopedDb(tenantId) merges
 * tenantId into `where`, so a productId belonging to a different tenant
 * simply matches no row (confirmed in Checkpoint 4C's verification: this
 * throws "record not found", not a silent no-op or cross-tenant write).
 *
 * Updates Product.name/status directly, and price/status on the product's
 * existing simple-product ProductVariant (identified by combinationKey ===
 * '' — the no-options variant every product in this path has exactly one
 * of) — never creates a new variant here.
 */
export async function updateProduct(
  tenantId: string,
  productId: string,
  input: ProductInput,
): Promise<ActionResult> {
  const validated = validateProductInput(input);
  if ("error" in validated) {
    return { success: false, error: validated.error };
  }

  try {
    const db = getScopedDb(tenantId);

    await db.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: { name: validated.name, status: validated.status },
      });

      const variant = await tx.productVariant.findFirst({
        where: { tenantId, productId, combinationKey: "" },
      });
      if (!variant) {
        throw new Error(`updateProduct: no simple-product variant found for product ${productId}`);
      }

      await tx.productVariant.update({
        where: { id: variant.id },
        data: { price: validated.price, status: toVariantStatus() },
      });
    });

    return { success: true, data: undefined };
  } catch (e) {
    console.error("updateProduct failed:", e);
    return { success: false, error: "Product not found." };
  }
}
