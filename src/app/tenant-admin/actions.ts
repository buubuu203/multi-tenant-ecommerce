"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { updateBranding } from "@/lib/branding-mutations";
import { createProduct, updateProduct } from "@/lib/product-mutations";
import { importProductsFromCsv, type ImportSummary } from "@/lib/product-csv";
import { createVariantOption } from "@/lib/variant-option-mutations";
import { createVariantOptionValue, deleteVariantOptionValue } from "@/lib/variant-option-value-mutations";
import { createProductOption, deleteProductOption } from "@/lib/product-option-mutations";
import { generateProductVariants, type GenerationResult } from "@/lib/variant-generation";
import { updateProductVariant } from "@/lib/product-variant-mutations";
import { updateOrderStatus } from "@/lib/order-mutations";
import { adjustInventoryOnHand } from "@/lib/inventory-mutations";
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

// Same rule as updateBrandingAction: independently re-checks auth +
// authorization; tenantId is NEVER read from formData — only productId
// (which product) comes from the client, never which tenant.
export async function createProductAction(
  _prevState: ActionResult<{ productId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ productId: string }>> {
  const { tenantId } = await requireTenantAdmin();

  const result = await createProduct(tenantId, {
    name: String(formData.get("name") ?? ""),
    price: String(formData.get("price") ?? ""),
    status: String(formData.get("status") ?? ""),
    description: String(formData.get("description") ?? ""),
    imageUrl: String(formData.get("imageUrl") ?? ""),
  });

  if (result.success) {
    revalidatePath("/tenant-admin");
  }
  return result;
}

// Same rule: independently re-checks auth + authorization; tenantId is
// NEVER read from the CSV file or formData. Each row is imported via the
// existing createProduct() — no duplicated/conflicting validation.
export async function importProductsAction(
  _prevState: ActionResult<ImportSummary> | null,
  formData: FormData,
): Promise<ActionResult<ImportSummary>> {
  const { tenantId } = await requireTenantAdmin();

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { success: false, error: "No file selected." };
  }

  const csvText = await file.text();
  const result = await importProductsFromCsv(tenantId, csvText);

  if (result.success) {
    revalidatePath("/tenant-admin");
  }
  return result;
}

export async function updateProductAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { tenantId } = await requireTenantAdmin();

  const productId = String(formData.get("productId") ?? "");
  const result = await updateProduct(tenantId, productId, {
    name: String(formData.get("name") ?? ""),
    price: String(formData.get("price") ?? ""),
    status: String(formData.get("status") ?? ""),
    description: String(formData.get("description") ?? ""),
    imageUrl: String(formData.get("imageUrl") ?? ""),
  });

  if (result.success) {
    revalidatePath("/tenant-admin");
  }
  return result;
}

// --- Variant Options (tenant-global) -----------------------------------
// Same rule as every action above: independently re-checks auth +
// authorization; tenantId is NEVER read from formData — only IDs
// identifying WHICH row (option/value/product) come from the client.
// All database access goes through the existing tenant-scoped mutation
// functions (Steps 17-20) — no raw Prisma access here or in the page.

export async function createVariantOptionAction(
  _prevState: ActionResult<{ variantOptionId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ variantOptionId: string }>> {
  const { tenantId } = await requireTenantAdmin();
  const result = await createVariantOption(tenantId, String(formData.get("name") ?? ""));
  if (result.success) {
    revalidatePath("/tenant-admin");
  }
  return result;
}

export async function createVariantOptionValueAction(
  _prevState: ActionResult<{ variantOptionValueId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ variantOptionValueId: string }>> {
  const { tenantId } = await requireTenantAdmin();
  const variantOptionId = String(formData.get("variantOptionId") ?? "");
  const result = await createVariantOptionValue(tenantId, variantOptionId, String(formData.get("value") ?? ""));
  if (result.success) {
    revalidatePath("/tenant-admin");
  }
  return result;
}

export async function deleteVariantOptionValueAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { tenantId } = await requireTenantAdmin();
  const variantOptionValueId = String(formData.get("variantOptionValueId") ?? "");
  const result = await deleteVariantOptionValue(tenantId, variantOptionValueId);
  if (result.success) {
    revalidatePath("/tenant-admin");
  }
  return result;
}

// --- Product option assignment ------------------------------------------

export async function assignProductOptionAction(
  _prevState: ActionResult<{ productOptionId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ productOptionId: string }>> {
  const { tenantId } = await requireTenantAdmin();
  const productId = String(formData.get("productId") ?? "");
  const variantOptionId = String(formData.get("variantOptionId") ?? "");
  const result = await createProductOption(tenantId, productId, variantOptionId);
  if (result.success) {
    revalidatePath("/tenant-admin");
  }
  return result;
}

export async function removeProductOptionAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { tenantId } = await requireTenantAdmin();
  const productOptionId = String(formData.get("productOptionId") ?? "");
  const result = await deleteProductOption(tenantId, productOptionId);
  if (result.success) {
    revalidatePath("/tenant-admin");
  }
  return result;
}

// --- Variant generation ---------------------------------------------------
// Thin wrapper only — all Cartesian-product/idempotency/archival logic
// lives in generateProductVariants() (Step 20/21); this action just
// validates the submitted starting price the same way validateProductInput
// does for the simple-product price field, then delegates.

export async function generateVariantsAction(
  _prevState: ActionResult<GenerationResult> | null,
  formData: FormData,
): Promise<ActionResult<GenerationResult>> {
  const { tenantId } = await requireTenantAdmin();
  const productId = String(formData.get("productId") ?? "");
  const priceRaw = String(formData.get("defaultPrice") ?? "").trim();

  if (!/^\d+$/.test(priceRaw)) {
    return { success: false, error: "Starting price must be a whole number of VND (no decimals)." };
  }
  const defaultPrice = Number(priceRaw);
  if (!Number.isSafeInteger(defaultPrice) || defaultPrice < 0) {
    return { success: false, error: "Starting price must be a non-negative whole number." };
  }

  const result = await generateProductVariants(tenantId, productId, defaultPrice);
  if (result.success) {
    revalidatePath("/tenant-admin");
  }
  return result;
}

// --- Variant-level editing (price/SKU only) -------------------------------
// All Cartesian-generation/archival/combinationKey logic remains exclusively
// in variant-generation.ts — this action only ever updates one existing
// variant's price/sku, via the existing updateProductVariant() mutation.

export async function updateProductVariantAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { tenantId } = await requireTenantAdmin();
  const productVariantId = String(formData.get("productVariantId") ?? "");
  const priceRaw = String(formData.get("price") ?? "").trim();
  const skuRaw = formData.get("sku");

  if (!/^\d+$/.test(priceRaw)) {
    return { success: false, error: "Price must be a whole number of VND (no decimals)." };
  }

  const result = await updateProductVariant(tenantId, productVariantId, {
    price: Number(priceRaw),
    sku: typeof skuRaw === "string" ? skuRaw : null,
  });
  if (result.success) {
    revalidatePath("/tenant-admin");
  }
  return result;
}

// --- Step 36: order status lifecycle ---------------------------------------
// tenantId comes exclusively from requireTenantAdmin() — never from
// formData — same rule as every action above. orderId and the requested
// status are the only client-supplied inputs; updateOrderStatus() itself
// re-verifies the order belongs to this tenant and is still `pending`
// before changing anything.

export async function updateOrderStatusAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { tenantId } = await requireTenantAdmin();
  const orderId = String(formData.get("orderId") ?? "");
  const nextStatus = String(formData.get("nextStatus") ?? "");

  const result = await updateOrderStatus(tenantId, orderId, nextStatus);
  if (result.success) {
    revalidatePath("/tenant-admin");
  }
  return result;
}

// --- Step 38: minimal on-hand stock adjustment ------------------------------
// tenantId comes exclusively from requireTenantAdmin() — never from
// formData — same rule as every action above. productVariantId and the
// requested adjustment are the only client-supplied inputs;
// adjustInventoryOnHand() itself re-verifies the variant belongs to this
// tenant and enforces the onHand >= reserved / onHand >= 0 invariants
// before changing anything.

export async function adjustInventoryOnHandAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { tenantId } = await requireTenantAdmin();
  const productVariantId = String(formData.get("productVariantId") ?? "");
  const adjustmentRaw = String(formData.get("adjustment") ?? "").trim();

  if (!/^-?\d+$/.test(adjustmentRaw)) {
    return { success: false, error: "Adjustment must be a whole number." };
  }

  const result = await adjustInventoryOnHand(tenantId, productVariantId, Number(adjustmentRaw));
  if (result.success) {
    revalidatePath("/tenant-admin");
  }
  return result;
}
