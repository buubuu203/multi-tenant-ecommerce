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

/**
 * Creates a product for the calling tenant. tenantId must be the trusted
 * value returned by requireTenantAdmin() — never accepted from form input.
 * Uses getScopedDb(tenantId) exclusively.
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
    // tenantId is passed explicitly to satisfy Prisma's static create type;
    // getScopedDb()'s extension also injects it at runtime (redundant, not
    // conflicting — same value either way).
    const product = await db.product.create({ data: { ...validated, tenantId } });
    return { success: true, data: { productId: product.id } };
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
    await db.product.update({ where: { id: productId }, data: validated });
    return { success: true, data: undefined };
  } catch (e) {
    console.error("updateProduct failed:", e);
    return { success: false, error: "Product not found." };
  }
}
