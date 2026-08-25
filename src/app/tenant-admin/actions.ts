"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { updateBranding } from "@/lib/branding-mutations";
import type { ActionResult } from "@/lib/action-result";

// Independently re-checks auth + authorization before touching the
// database — the tenant-admin/layout.tsx gate is not treated as
// sufficient on its own (same rule as Platform Admin's mutations).
//
// tenantId is NEVER read from formData here — the only tenant identity
// this action ever uses is the trusted value requireTenantAdmin() itself
// verifies (Clerk metadata role + tenantId matched against the
// hostname-resolved tenant). There is no field for a client to tamper
// with, by construction.
export async function updateBrandingAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { tenantId } = await requireTenantAdmin();

  const result = await updateBranding(tenantId, {
    storeName: String(formData.get("storeName") ?? ""),
    logoUrl: String(formData.get("logoUrl") ?? ""),
    faviconUrl: String(formData.get("faviconUrl") ?? ""),
    primaryColor: String(formData.get("primaryColor") ?? ""),
    secondaryColor: String(formData.get("secondaryColor") ?? ""),
  });

  if (result.success) {
    revalidatePath("/tenant-admin");
  }
  return result;
}
