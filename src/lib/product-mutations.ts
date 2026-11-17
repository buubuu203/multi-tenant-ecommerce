import { getScopedDb } from "./db/tenant-db";
import type { ActionResult } from "./action-result";
import { runVariantGeneration, VariantGenerationError } from "./variant-generation";
import { MAX_MEDIA_ITEMS, MAX_IMAGES, MAX_VIDEOS, type MediaKind } from "./blob-storage";

const VALID_STATUSES = ["draft", "active"] as const;
type ProductStatusInput = (typeof VALID_STATUSES)[number];

export type ProductInput = {
  name: string;
  price: string;
  status: string;
  // Step 43: optional plain text — no Markdown, no HTML. Omitted or
  // whitespace-only becomes `null` (see validateDescription()), never an
  // empty string.
  description?: string;
  // Optional id of a tenant-managed category. Omitted or whitespace-only
  // means the product is uncategorized; ownership is verified at write time.
  categoryId?: string;
  // Step 50: already-uploaded media (via uploadProductMediaAction/
  // uploadProductMediaFile — see blob-storage.ts) to attach at creation
  // time, in display order. Optional here (the shared foundation used by
  // BOTH the manual-creation form AND CSV import — CSV products are
  // explicitly allowed to have zero media, Step 50 §10) — the "at least
  // one media item required" rule for manual creation is enforced one
  // layer up, in the Tenant Admin action, not here.
  media?: { url: string; type: MediaKind }[];
  // Optional: ids of existing, tenant-owned VariantOptions to declare and
  // generate real variants for at creation time. Omitted/empty keeps the
  // existing simple-product path unchanged. Never trusted blindly — each
  // id is verified to belong to the tenant (via the tenant-scoped client,
  // inside the same transaction) before anything is created. Only ids are
  // accepted here; VariantOptionValues are never selected by the caller —
  // generation (runVariantGeneration) always uses every value that
  // currently exists under each declared option, same as calling
  // generateProductVariants() standalone.
  variantOptionIds?: string[];
};

// Plain text only — trimmed; whitespace-only or omitted becomes `null`,
// never an empty string, so "no description" has exactly one
// representation in the database.
function validateDescription(description: string | undefined): string | null {
  const trimmed = (description ?? "").trim();
  return trimmed || null;
}

// Step 50: authoritative limit check on the media array — this is the
// real enforcement point (the Tenant Admin UI also checks client-side for
// immediate feedback, but that is UX only, same "server remains
// authoritative" rule as everywhere else in this codebase).
//
// Also rejects anything that isn't a real absolute http(s) URL. This
// catches the case where the client submits before an upload finished —
// ProductMediaGallery's local preview uses `URL.createObjectURL(file)`
// (a `blob:...` URL, valid only in the browser tab that created it) until
// uploadProductMediaFile() returns the real Blob URL to swap in; if the
// form is submitted in that window, the stale `blob:` URL would otherwise
// be persisted permanently and render as a broken image for every other
// visitor. Does not verify the URL points at this tenant's blob namespace
// specifically — only that it's a real, fetchable URL at all.
function validateMedia(media: { url: string; type: MediaKind }[] | undefined): { error: string } | null {
  const items = media ?? [];
  if (items.length > MAX_MEDIA_ITEMS) {
    return { error: `A product can have at most ${MAX_MEDIA_ITEMS} media items.` };
  }
  const imageCount = items.filter((m) => m.type === "image").length;
  const videoCount = items.filter((m) => m.type === "video").length;
  if (imageCount > MAX_IMAGES) {
    return { error: `A product can have at most ${MAX_IMAGES} images.` };
  }
  if (videoCount > MAX_VIDEOS) {
    return { error: `A product can have at most ${MAX_VIDEOS} videos.` };
  }
  for (const item of items) {
    if (!item.url.startsWith("http://") && !item.url.startsWith("https://")) {
      return { error: "One or more media items did not finish uploading — please wait for uploads to complete before saving." };
    }
  }
  return null;
}

/**
 * Exported so the CSV import PREVIEW can apply the identical rule without
 * touching the database. Pure, and the only validator createProduct() uses
 * — sharing it is what stops preview and import from drifting apart.
 */
export function validateProductInput(
  input: ProductInput,
): {
  name: string;
  price: number;
  status: ProductStatusInput;
  description: string | null;
  categoryId: string | null;
} | { error: string } {
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

  const description = validateDescription(input.description);
  const categoryId = input.categoryId?.trim() || null;

  const mediaError = validateMedia(input.media);
  if (mediaError) {
    return { error: mediaError.error };
  }

  return { name, price, status: input.status as ProductStatusInput, description, categoryId };
}

class InvalidProductCategoryError extends Error {}

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

// Step 50: shared by both createProduct() paths (simple + variant-bearing)
// so the media-row-creation logic exists exactly once. sortOrder is
// derived purely from array position — the caller (Tenant Admin UI) is
// responsible for handing media in the order it should display, sortOrder
// 0 becoming the primary/first item everywhere the app reads it.
async function createProductMediaRowsInTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tx type varies by call site (simple vs variant-bearing transaction), both structurally support productMedia.create
  tx: any,
  tenantId: string,
  productId: string,
  media: { url: string; type: MediaKind }[] | undefined,
): Promise<void> {
  const items = media ?? [];
  for (let i = 0; i < items.length; i++) {
    await tx.productMedia.create({
      data: { tenantId, productId, type: items[i].type, url: items[i].url, sortOrder: i },
    });
  }
}

/**
 * Creates a product for the calling tenant. tenantId must be the trusted
 * value returned by requireTenantAdmin() — never accepted from form input.
 * Uses getScopedDb(tenantId) exclusively.
 *
 * Two paths, chosen by whether `input.variantOptionIds` is non-empty:
 *
 * Simple product (no variantOptionIds, unchanged from before this step):
 * creates Product + its single simple-product ProductVariant
 * (combinationKey="") + that variant's Inventory row, all in one
 * transaction. No ProductOption / ProductVariantOptionValue rows.
 *
 * Variant-bearing product (variantOptionIds provided): creates the bare
 * Product, declares ProductOption for each given VariantOption id (each
 * independently verified to belong to the tenant), then generates real
 * variants via runVariantGeneration() — all inside this SAME transaction,
 * so the product, its option declarations, and its generated
 * variants/PVOV/inventory rows are created atomically, or nothing is. No
 * separate simple variant is created for this path — there is nothing to
 * archive, since the product never existed as simple in the first place.
 * `input.price` is used as the starting price for every generated variant
 * (the same role `defaultPrice` plays in generateProductVariants()).
 */
export async function createProduct(
  tenantId: string,
  input: ProductInput,
): Promise<ActionResult<{ productId: string }>> {
  const validated = validateProductInput(input);
  if ("error" in validated) {
    return { success: false, error: validated.error };
  }

  const variantOptionIds = (input.variantOptionIds ?? []).filter((id) => id.trim() !== "");

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

    if (variantOptionIds.length === 0) {
      const productId = await db.$transaction(async (tx) => {
        if (validated.categoryId) {
          const category = await tx.productCategory.findUnique({
            where: { id: validated.categoryId, tenantId },
          });
          if (!category) throw new InvalidProductCategoryError();
        }

        const product = await tx.product.create({
          data: {
            name: validated.name,
            status: validated.status,
            description: validated.description,
            categoryId: validated.categoryId,
            tenantId,
          },
        });

        await createProductMediaRowsInTx(tx, tenantId, product.id, input.media);

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
    }

    const productId = await db.$transaction(async (tx) => {
      if (validated.categoryId) {
        const category = await tx.productCategory.findUnique({
          where: { id: validated.categoryId, tenantId },
        });
        if (!category) throw new InvalidProductCategoryError();
      }

      const product = await tx.product.create({
        data: {
          name: validated.name,
          status: validated.status,
          description: validated.description,
          categoryId: validated.categoryId,
          tenantId,
        },
      });

      await createProductMediaRowsInTx(tx, tenantId, product.id, input.media);

      for (const variantOptionId of variantOptionIds) {
        // Never trust a caller-supplied id directly into a write — verify
        // it belongs to this tenant first, via the same transactional
        // client every other read/write in this function uses.
        const variantOption = await tx.variantOption.findUnique({ where: { id: variantOptionId, tenantId } });
        if (!variantOption) {
          throw new VariantGenerationError("Option not found.");
        }
        await tx.productOption.create({ data: { tenantId, productId: product.id, variantOptionId } });
      }

      await runVariantGeneration(tx, tenantId, product.id, validated.price);

      return product.id;
    });

    return { success: true, data: { productId } };
  } catch (e) {
    if (e instanceof InvalidProductCategoryError) {
      return { success: false, error: 'Selected category not found.' };
    }
    if (e instanceof VariantGenerationError) {
      return { success: false, error: e.message };
    }
    console.error("createProduct failed:", e);
    return { success: false, error: "Something went wrong creating the product." };
  }
}

/**
 * Deletes a product belonging to the calling tenant, and (via the
 * database's own Cascade rules, not application code) its variants,
 * inventory, media, option declarations and discount slot with it.
 *
 * Never cascades over an OrderItem: ProductVariant's FK from OrderItem is
 * onDelete: Restrict (see OrderItem in schema.prisma), so Postgres itself
 * refuses this delete if any variant of this product was ever ordered —
 * surfaced here as P2003, never worked around. A product with order
 * history has no delete path; that is deliberate, not a gap to fill in.
 */
export async function deleteProduct(tenantId: string, productId: string): Promise<ActionResult> {
  try {
    const db = getScopedDb(tenantId);
    await db.product.delete({ where: { id: productId, tenantId } });
    return { success: true, data: undefined };
  } catch (e) {
    // P2025: record not found (already deleted, or belongs to another
    // tenant — getScopedDb()'s injected tenantId in `where` makes a
    // foreign id simply match no row, same as the rest of the codebase).
    if (typeof e === "object" && e !== null && "code" in e) {
      if (e.code === "P2025") {
        return { success: false, error: "Product not found." };
      }
      if (e.code === "P2003") {
        return {
          success: false,
          error: "This product has order history and cannot be deleted.",
        };
      }
    }
    console.error("deleteProduct failed:", e);
    return { success: false, error: "Something went wrong deleting the product." };
  }
}

class ProductsNotFoundError extends Error {}

/**
 * Deletes several products belonging to the calling tenant in one
 * transaction — all or nothing, same reasoning as the CSV importer's own
 * atomic apply: a batch that partially deletes leaves the operator unable
 * to tell which half survived. Every id is re-verified against this
 * tenant inside the transaction before anything is deleted; an id that
 * does not resolve (wrong tenant, already gone, typo) aborts the whole
 * batch rather than silently deleting fewer rows than requested.
 *
 * Same Restrict rule as the single-product deleteProduct(): a product
 * whose variant was ever ordered blocks the entire batch (P2003), not
 * just its own row.
 */
export async function deleteProducts(
  tenantId: string,
  productIds: string[],
): Promise<ActionResult<{ deleted: number }>> {
  const ids = [...new Set(productIds.map((id) => id.trim()).filter((id) => id !== ""))];
  if (ids.length === 0) {
    return { success: false, error: "No products selected." };
  }

  try {
    const db = getScopedDb(tenantId);
    const deleted = await db.$transaction(async (tx) => {
      const found = await tx.product.findMany({ where: { id: { in: ids }, tenantId }, select: { id: true } });
      if (found.length !== ids.length) {
        throw new ProductsNotFoundError();
      }
      const result = await tx.product.deleteMany({ where: { id: { in: ids }, tenantId } });
      return result.count;
    });
    return { success: true, data: { deleted } };
  } catch (e) {
    if (e instanceof ProductsNotFoundError) {
      return {
        success: false,
        error: "One or more selected products were not found. Nothing was deleted.",
      };
    }
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2003") {
      return {
        success: false,
        error:
          "One or more selected products have order history and cannot be deleted. Nothing was deleted.",
      };
    }
    console.error("deleteProducts failed:", e);
    return { success: false, error: "Something went wrong deleting the selected products." };
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
 * Always updates Product.name/status. Price is updated ONLY when the
 * product is still a simple product — i.e. it has exactly one non-archived
 * variant and that variant is the combinationKey="" sentinel. Once a
 * product has real (variant-bearing) combinations, combinationKey=""
 * no longer identifies "the" variant (there may be several, or none), so
 * this function deliberately does NOT guess which variant `validated.price`
 * should apply to, does NOT overwrite every variant's price, and does NOT
 * regenerate variants just because name/status changed. Editing individual
 * variant prices on a variant-bearing product is out of scope for this
 * step — this function silently leaves variant prices untouched in that
 * case rather than inventing a new (unrequested) editing behavior.
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
      const product = await tx.product.findUnique({ where: { id: productId, tenantId } });
      if (!product) {
        throw new Error(`updateProduct: product ${productId} not found for tenant`);
      }

      if (validated.categoryId) {
        const category = await tx.productCategory.findUnique({
          where: { id: validated.categoryId, tenantId },
        });
        if (!category) throw new InvalidProductCategoryError();
      }

      await tx.product.update({
        where: { id: productId },
        data: {
          name: validated.name,
          status: validated.status,
          description: validated.description,
          categoryId: validated.categoryId,
        },
      });

      const activeVariants = await tx.productVariant.findMany({
        where: { tenantId, productId, status: { not: "archived" } },
      });

      const isStillSimpleProduct = activeVariants.length === 1 && activeVariants[0].combinationKey === "";
      if (isStillSimpleProduct) {
        await tx.productVariant.update({
          where: { id: activeVariants[0].id },
          data: { price: validated.price, status: toVariantStatus() },
        });
      }
      // else: variant-bearing product — price is intentionally left
      // untouched on every variant; see the function doc comment above.
    });

    return { success: true, data: undefined };
  } catch (e) {
    if (e instanceof InvalidProductCategoryError) {
      return { success: false, error: 'Selected category not found.' };
    }
    console.error("updateProduct failed:", e);
    return { success: false, error: "Product not found." };
  }
}
