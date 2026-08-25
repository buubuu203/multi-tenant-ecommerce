"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import * as tenantMutations from "@/lib/tenant-mutations";
import type { ActionResult } from "@/lib/tenant-mutations";

// Every action here independently re-checks auth + authorization before
// touching platformDb — the platform-admin/layout.tsx gate is not treated
// as sufficient on its own (see Notion, Checkpoint 3C).

export async function createTenantAction(
  _prevState: ActionResult<{ tenantId: string; slug: string; hostname: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ tenantId: string; slug: string; hostname: string }>> {
  try {
    await requirePlatformAdmin();
  } catch {
    return { success: false, error: "Not authorized." };
  }

  const result = await tenantMutations.createTenant({
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
  });

  if (result.success) {
    revalidatePath("/platform-admin");
  }
  return result;
}

export async function updateTenantNameAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requirePlatformAdmin();
  } catch {
    return { success: false, error: "Not authorized." };
  }

  const tenantId = String(formData.get("tenantId") ?? "");
  const name = String(formData.get("name") ?? "");

  const result = await tenantMutations.updateTenantName(tenantId, name);
  if (result.success) {
    revalidatePath("/platform-admin");
  }
  return result;
}

export async function updateTenantStatusAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requirePlatformAdmin();
  } catch {
    return { success: false, error: "Not authorized." };
  }

  const tenantId = String(formData.get("tenantId") ?? "");
  const status = String(formData.get("status") ?? "");

  const result = await tenantMutations.updateTenantStatus(tenantId, status);
  if (result.success) {
    revalidatePath("/platform-admin");
  }
  return result;
}
