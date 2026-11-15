"use server";

import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import {
  createVoucher,
  updateVoucher,
  deleteVoucher,
  type VoucherInput,
} from "@/lib/voucher-mutations";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";

function parseVoucherInput(formData: FormData): VoucherInput {
  return {
    triggerType: (formData.get("triggerType") as string ?? "code") as "code" | "automatic",
    code: formData.get("code") as string ?? "",
    label: formData.get("label") as string ?? "",
    discountType: (formData.get("discountType") as string ?? "percentage") as "percentage" | "fixed_amount",
    discountValue: formData.get("discountValue") as string ?? "",
    scope: (formData.get("scope") as string ?? "order") as "order" | "product",
    productIds: formData.getAll("productIds") as string[],
    minOrderAmount: formData.get("minOrderAmount") as string ?? "",
    maxDiscount: formData.get("maxDiscount") as string ?? "",
    maxUses: formData.get("maxUses") as string ?? "",
    startsAt: formData.get("startsAt") as string ?? "",
    endsAt: formData.get("endsAt") as string ?? "",
    enabled: formData.get("enabled") === "on",
  };
}

export async function createVoucherAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const { tenantId } = await requireTenantAdmin();
  const input = parseVoucherInput(formData);
  const result = await createVoucher(tenantId, input);
  if (result.success) revalidatePath("/tenant-admin/vouchers");
  return result;
}

export async function updateVoucherAction(voucherId: string, formData: FormData): Promise<ActionResult> {
  const { tenantId } = await requireTenantAdmin();
  const input = parseVoucherInput(formData);
  const result = await updateVoucher(tenantId, voucherId, input);
  if (result.success) revalidatePath("/tenant-admin/vouchers");
  return result;
}

export async function deleteVoucherAction(voucherId: string): Promise<ActionResult> {
  const { tenantId } = await requireTenantAdmin();
  const result = await deleteVoucher(tenantId, voucherId);
  if (result.success) revalidatePath("/tenant-admin/vouchers");
  return result;
}
