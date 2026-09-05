"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { updateBranding } from "@/lib/branding-mutations";
import { createProduct, updateProduct } from "@/lib/product-mutations";
import { uploadProductMediaFile, deleteProductMediaFile, type MediaKind } from "@/lib/blob-storage";
import { addProductMedia, removeProductMedia, reorderProductMedia } from "@/lib/product-media-mutations";
import { importProductsFromCsv, type ImportSummary } from "@/lib/product-csv";
import { createVariantOption } from "@/lib/variant-option-mutations";
import { createVariantOptionValue, deleteVariantOptionValue } from "@/lib/variant-option-value-mutations";
import { createProductOption, deleteProductOption } from "@/lib/product-option-mutations";
import { generateProductVariants, type GenerationResult } from "@/lib/variant-generation";
import { updateProductVariant } from "@/lib/product-variant-mutations";
import { updateOrderStatus } from "@/lib/order-mutations";
import { adjustInventoryOnHand } from "@/lib/inventory-mutations";
import { updateTenantPaymentMethod } from "@/lib/tenant-payment-mutations";
import { markManualPaymentReceived } from "@/lib/payments/payment-service";
import { createShippingMethod, updateShippingMethod, deleteShippingMethod } from "@/lib/shipping-mutations";
import type { PaymentMethod, PaymentProviderType } from "@/generated/prisma/client";
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
    bankName: String(formData.get("bankName") ?? ""),
    bankAccountNumber: String(formData.get("bankAccountNumber") ?? ""),
    bankAccountHolder: String(formData.get("bankAccountHolder") ?? ""),
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

  // Step 50: at least one media item is required for a manually-created
  // product (CSV import remains media-optional — see product-csv.ts,
  // unchanged — createProduct() itself never enforces this, only this
  // manual-form action does).
  let media: { url: string; type: MediaKind }[];
  try {
    media = JSON.parse(String(formData.get("media") ?? "[]"));
  } catch {
    return { success: false, error: "Invalid media payload." };
  }
  if (media.length === 0) {
    return { success: false, error: "At least one product image or video is required." };
  }

  const result = await createProduct(tenantId, {
    name: String(formData.get("name") ?? ""),
    price: String(formData.get("price") ?? ""),
    status: String(formData.get("status") ?? ""),
    description: String(formData.get("description") ?? ""),
    media,
  });

  if (result.success) {
    revalidatePath("/tenant-admin");
  } else {
    // The media files named in `media` were already uploaded to Blob by
    // earlier uploadProductMediaAction calls (before this form was ever
    // submitted) — if the product itself fails to create (validation
    // error, variant generation failure, etc.), no ProductMedia row ever
    // gets created to reference them, so they'd otherwise be orphaned
    // forever. Best-effort: a failed cleanup here must not mask the real
    // error being returned to the caller.
    for (const item of media) {
      try {
        await deleteProductMediaFile(tenantId, item.url);
      } catch (e) {
        console.error("createProductAction: orphaned blob cleanup failed:", e);
      }
    }
  }
  return result;
}

// Step 50: uploads exactly one file to this tenant's Vercel Blob
// namespace. Called imperatively from the client (not via a <form
// action=...> submit) as soon as a file is selected, so the Tenant Admin
// UI can show per-file upload progress before the product itself is
// created. Returns only the resulting public URL + classified type —
// never any storage credential, which never reaches the browser at all.
export async function uploadProductMediaAction(
  formData: FormData,
): Promise<ActionResult<{ url: string; type: MediaKind }>> {
  const { tenantId } = await requireTenantAdmin();

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { success: false, error: "No file provided." };
  }

  const result = await uploadProductMediaFile(tenantId, file);
  if ("error" in result) {
    return { success: false, error: result.error };
  }
  return { success: true, data: result };
}

// Cleans up a file the admin uploaded but then removed from the gallery
// before submitting the "Add product" form — otherwise it would be an
// orphaned blob with no ProductMedia row ever pointing at it. Best-effort:
// deleteProductMediaFile() already scopes by tenantId in the blob path.
export async function deleteUploadedProductMediaAction(formData: FormData): Promise<ActionResult> {
  const { tenantId } = await requireTenantAdmin();
  const url = String(formData.get("url") ?? "");
  if (!url) {
    return { success: false, error: "No URL provided." };
  }
  try {
    await deleteProductMediaFile(tenantId, url);
  } catch (e) {
    console.error("deleteUploadedProductMediaAction: blob delete failed:", e);
  }
  return { success: true, data: undefined };
}

// --- Product media on an EXISTING product (edit-time) -------------------
// Same rule as every action in this file: tenantId comes exclusively from
// requireTenantAdmin(); productId/mediaId are the only client-supplied
// identifiers, and product-media-mutations.ts independently re-verifies
// tenant ownership of both the product and the media row before writing
// anything.

export async function addProductMediaAction(formData: FormData): Promise<ActionResult<{ ids: string[] }>> {
  const { tenantId } = await requireTenantAdmin();
  const productId = String(formData.get("productId") ?? "");
  let media: { url: string; type: MediaKind }[];
  try {
    media = JSON.parse(String(formData.get("media") ?? "[]"));
  } catch {
    return { success: false, error: "Invalid media payload." };
  }
  const result = await addProductMedia(tenantId, productId, media);
  if (result.success) {
    revalidatePath("/tenant-admin");
  } else {
    // Same orphaned-blob concern as createProductAction above: `media`
    // was already uploaded to Blob before this call (imperatively, per
    // file, from ProductMediaGallery) — if addProductMedia rejects it
    // (limit exceeded, product not found), no ProductMedia row exists to
    // reference it, so it must be cleaned up here instead.
    for (const item of media) {
      try {
        await deleteProductMediaFile(tenantId, item.url);
      } catch (e) {
        console.error("addProductMediaAction: orphaned blob cleanup failed:", e);
      }
    }
  }
  return result;
}

export async function removeProductMediaAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { tenantId } = await requireTenantAdmin();
  const productId = String(formData.get("productId") ?? "");
  const mediaId = String(formData.get("mediaId") ?? "");
  const result = await removeProductMedia(tenantId, productId, mediaId);
  if (result.success) {
    revalidatePath("/tenant-admin");
  }
  return result;
}

export async function reorderProductMediaAction(formData: FormData): Promise<ActionResult> {
  const { tenantId } = await requireTenantAdmin();
  const productId = String(formData.get("productId") ?? "");
  let orderedMediaIds: string[];
  try {
    orderedMediaIds = JSON.parse(String(formData.get("orderedMediaIds") ?? "[]"));
  } catch {
    return { success: false, error: "Invalid order payload." };
  }
  const result = await reorderProductMedia(tenantId, productId, orderedMediaIds);
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

// Confirms a bank_transfer_manual Payment after the merchant has verified
// the transfer landed in their own bank account — see
// markManualPaymentReceived's doc comment for why this is restricted to
// that one provider only.
export async function markManualPaymentReceivedAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { tenantId } = await requireTenantAdmin();
  const orderId = String(formData.get("orderId") ?? "");

  const result = await markManualPaymentReceived(tenantId, orderId);
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

// --- Payment settings (Step 51) ------------------------------------------
// Same rule as every action in this file: independently re-checks auth +
// authorization; tenantId is NEVER read from formData.

export async function updateTenantPaymentMethodAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { tenantId } = await requireTenantAdmin();

  const result = await updateTenantPaymentMethod(tenantId, {
    method: String(formData.get("method") ?? "") as PaymentMethod,
    provider: String(formData.get("provider") ?? "") as PaymentProviderType,
    enabled: formData.get("enabled") === "on",
    bankName: String(formData.get("bankName") ?? ""),
    bankAccountNumber: String(formData.get("bankAccountNumber") ?? ""),
    bankAccountHolder: String(formData.get("bankAccountHolder") ?? ""),
    sepayBaUuid: String(formData.get("sepayBaUuid") ?? ""),
  });

  if (result.success) {
    revalidatePath("/tenant-admin");
  }
  return result;
}

// --- V1 Configurable Shipping -----------------------------------------
// Same independent-requireTenantAdmin()-per-action rule as every mutation
// above; tenantId is never read from formData.

export async function createShippingMethodAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { tenantId } = await requireTenantAdmin();

  const result = await createShippingMethod(tenantId, {
    name: String(formData.get("name") ?? ""),
    amount: String(formData.get("amount") ?? ""),
    enabled: formData.get("enabled") === "on",
    isDefault: formData.get("isDefault") === "on",
  });

  if (result.success) {
    revalidatePath("/tenant-admin");
  }
  return result;
}

export async function updateShippingMethodAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { tenantId } = await requireTenantAdmin();
  const methodId = String(formData.get("methodId") ?? "");

  const result = await updateShippingMethod(tenantId, methodId, {
    name: String(formData.get("name") ?? ""),
    amount: String(formData.get("amount") ?? ""),
    enabled: formData.get("enabled") === "on",
    isDefault: formData.get("isDefault") === "on",
  });

  if (result.success) {
    revalidatePath("/tenant-admin");
  }
  return result;
}

export async function deleteShippingMethodAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { tenantId } = await requireTenantAdmin();
  const methodId = String(formData.get("methodId") ?? "");

  const result = await deleteShippingMethod(tenantId, methodId);
  if (result.success) {
    revalidatePath("/tenant-admin");
  }
  return result;
}
