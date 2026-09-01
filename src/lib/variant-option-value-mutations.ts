import { getScopedDb } from "./db/tenant-db";
import type { ActionResult } from "./action-result";
import type { VariantOptionValue } from "@/generated/prisma/client";

/**
 * Creates a value (e.g. "White") for an existing, tenant-owned VariantOption.
 * tenantId must be the trusted value returned by requireTenantAdmin() —
 * never accepted from form input or any client-controlled object. Uses
 * getScopedDb(tenantId) exclusively.
 */
export async function createVariantOptionValue(
  tenantId: string,
  variantOptionId: string,
  value: string,
): Promise<ActionResult<{ variantOptionValueId: string }>> {
  const trimmed = value.trim();
  if (!trimmed) {
    return { success: false, error: "Value is required." };
  }

  try {
    const db = getScopedDb(tenantId);

    // getScopedDb() scopes reads/writes by tenantId, but does not itself
    // verify that a caller-supplied foreign id (variantOptionId here)
    // belongs to this tenant — that's the composite FK's job at the DB
    // layer. This existence check catches the common "wrong/foreign id"
    // case with a clean error before we even attempt the write, rather
    // than relying solely on the FK violation.
    const variantOption = await db.variantOption.findUnique({
      where: { id: variantOptionId, tenantId },
    });
    if (!variantOption) {
      return { success: false, error: "Option not found." };
    }

    const variantOptionValue = await db.variantOptionValue.create({
      data: { tenantId, variantOptionId, value: trimmed },
    });
    return { success: true, data: { variantOptionValueId: variantOptionValue.id } };
  } catch (e) {
    // Unique violation on (tenantId, variantOptionId, value) — same value
    // already exists under this option.
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
      return { success: false, error: "This value already exists for this option." };
    }
    console.error("createVariantOptionValue failed:", e);
    return { success: false, error: "Something went wrong creating the value." };
  }
}

/**
 * Lists all values for a tenant-owned VariantOption, ordered by value.
 * tenantId must be the trusted value returned by requireTenantAdmin() —
 * never accepted from form input. Uses getScopedDb(tenantId) exclusively.
 */
export async function listVariantOptionValues(
  tenantId: string,
  variantOptionId: string,
): Promise<ActionResult<VariantOptionValue[]>> {
  const db = getScopedDb(tenantId);

  const variantOption = await db.variantOption.findUnique({
    where: { id: variantOptionId, tenantId },
  });
  if (!variantOption) {
    return { success: false, error: "Option not found." };
  }

  const values = await db.variantOptionValue.findMany({
    where: { tenantId, variantOptionId },
    orderBy: { value: "asc" },
  });
  return { success: true, data: values };
}

/**
 * Deletes a tenant-owned VariantOptionValue. tenantId must be the trusted
 * value returned by requireTenantAdmin() — never accepted from form input.
 * Uses getScopedDb(tenantId) exclusively.
 *
 * Never cascade-deletes ProductVariantOptionValue rows from application
 * code — whatever the database's own FK behavior is for a referenced value
 * is left entirely to the database, not overridden or replicated here.
 */
export async function deleteVariantOptionValue(
  tenantId: string,
  variantOptionValueId: string,
): Promise<ActionResult> {
  try {
    const db = getScopedDb(tenantId);
    await db.variantOptionValue.delete({
      where: { id: variantOptionValueId, tenantId },
    });
    return { success: true, data: undefined };
  } catch (e) {
    // P2025: record not found (already deleted, or belongs to another
    // tenant — getScopedDb()'s injected tenantId in `where` makes a
    // foreign id simply match no row, same as the rest of the codebase).
    // P2003: FK constraint violation, if the database ever rejects this
    // delete outright (e.g. a future onDelete: Restrict on this FK).
    if (typeof e === "object" && e !== null && "code" in e) {
      if (e.code === "P2025") {
        return { success: false, error: "Value not found." };
      }
      if (e.code === "P2003") {
        return { success: false, error: "This value is still in use and cannot be deleted." };
      }
    }
    console.error("deleteVariantOptionValue failed:", e);
    return { success: false, error: "Something went wrong deleting the value." };
  }
}
