import { getScopedDb } from "./db/tenant-db";
import type { ActionResult } from "./action-result";
import type { VariantOption } from "@/generated/prisma/client";

/**
 * Creates a reusable, tenant-global VariantOption (e.g. "Color", "Size").
 * tenantId must be the trusted value returned by requireTenantAdmin() —
 * never accepted from form input. Uses getScopedDb(tenantId) exclusively.
 */
export async function createVariantOption(
  tenantId: string,
  name: string,
): Promise<ActionResult<{ variantOptionId: string }>> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { success: false, error: "Name is required." };
  }

  try {
    const db = getScopedDb(tenantId);
    const variantOption = await db.variantOption.create({
      data: { name: trimmed, tenantId },
    });
    return { success: true, data: { variantOptionId: variantOption.id } };
  } catch (e) {
    // Unique violation on (tenantId, name) — same option name already exists.
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
      return { success: false, error: "An option with this name already exists." };
    }
    console.error("createVariantOption failed:", e);
    return { success: false, error: "Something went wrong creating the option." };
  }
}

/**
 * Lists all VariantOptions for the calling tenant, ordered by name.
 * tenantId must be the trusted value returned by requireTenantAdmin() —
 * never accepted from form input. Uses getScopedDb(tenantId) exclusively.
 */
export async function listVariantOptions(tenantId: string): Promise<VariantOption[]> {
  const db = getScopedDb(tenantId);
  return db.variantOption.findMany({
    where: { tenantId },
    orderBy: { name: "asc" },
  });
}
