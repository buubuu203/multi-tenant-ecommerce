import { getScopedDb } from "./db/tenant-db";
import { deleteProductMediaFile, MAX_MEDIA_ITEMS, MAX_IMAGES, MAX_VIDEOS, type MediaKind } from "./blob-storage";
import type { ActionResult } from "./action-result";

// Step 50: add/remove/reorder ProductMedia on an EXISTING product (the
// Tenant Admin inline edit form) — creation-time media is handled inline
// inside createProduct() (product-mutations.ts) instead, since it's part
// of one atomic transaction with the Product row itself. These three
// functions are separate, later mutations against an already-existing
// product, so each independently re-verifies tenant ownership rather than
// trusting a caller-supplied productId/mediaId — the same rule every
// other tenant-scoped mutation in this codebase follows.

async function loadOwnedProduct(tenantId: string, productId: string) {
  const db = getScopedDb(tenantId);
  return db.product.findUnique({ where: { id: productId, tenantId } });
}

/**
 * Appends newly-uploaded media to an existing product, after re-checking
 * the combined (existing + new) count against the same limits
 * createProduct() enforces at creation time. sortOrder continues from the
 * current max, so newly added items land at the end of the gallery.
 */
export async function addProductMedia(
  tenantId: string,
  productId: string,
  newMedia: { url: string; type: MediaKind }[],
): Promise<ActionResult<{ ids: string[] }>> {
  const product = await loadOwnedProduct(tenantId, productId);
  if (!product) {
    return { success: false, error: "Product not found." };
  }

  const db = getScopedDb(tenantId);
  const existing = await db.productMedia.findMany({ where: { productId, tenantId } });

  const totalCount = existing.length + newMedia.length;
  if (totalCount > MAX_MEDIA_ITEMS) {
    return { success: false, error: `A product can have at most ${MAX_MEDIA_ITEMS} media items.` };
  }
  const imageCount = existing.filter((m) => m.type === "image").length + newMedia.filter((m) => m.type === "image").length;
  const videoCount = existing.filter((m) => m.type === "video").length + newMedia.filter((m) => m.type === "video").length;
  if (imageCount > MAX_IMAGES) {
    return { success: false, error: `A product can have at most ${MAX_IMAGES} images.` };
  }
  if (videoCount > MAX_VIDEOS) {
    return { success: false, error: `A product can have at most ${MAX_VIDEOS} videos.` };
  }

  const startOrder = existing.reduce((max, m) => Math.max(max, m.sortOrder), -1) + 1;
  const created = await db.$transaction(
    newMedia.map((item, i) =>
      db.productMedia.create({
        data: { tenantId, productId, type: item.type, url: item.url, sortOrder: startOrder + i },
      }),
    ),
  );

  return { success: true, data: { ids: created.map((m) => m.id) } };
}

/**
 * Removes one media item. Re-sequences the remaining items' sortOrder to
 * stay contiguous (0..n-1) so "the first item is the primary media" keeps
 * meaning exactly what it says after a deletion in the middle. Best-effort
 * blob deletion — a failed storage delete does not block the database
 * removal (see blob-storage.ts's own doc comment on this tradeoff); it is
 * logged, not silently ignored.
 */
export async function removeProductMedia(tenantId: string, productId: string, mediaId: string): Promise<ActionResult> {
  const product = await loadOwnedProduct(tenantId, productId);
  if (!product) {
    return { success: false, error: "Product not found." };
  }

  const db = getScopedDb(tenantId);
  const media = await db.productMedia.findUnique({ where: { id: mediaId, tenantId } });
  if (!media || media.productId !== productId) {
    return { success: false, error: "Media not found." };
  }

  await db.productMedia.delete({ where: { id: mediaId } });

  const remaining = await db.productMedia.findMany({ where: { productId, tenantId }, orderBy: { sortOrder: "asc" } });
  await db.$transaction(
    remaining.map((m, i) => db.productMedia.update({ where: { id: m.id }, data: { sortOrder: i } })),
  );

  try {
    await deleteProductMediaFile(tenantId, media.url);
  } catch (e) {
    console.error("removeProductMedia: blob delete failed (database row already removed):", e);
  }

  return { success: true, data: undefined };
}

/**
 * Persists a new display order. orderedMediaIds must be exactly the set of
 * media ids currently belonging to this product — verified before writing
 * anything, so a caller can never smuggle in another product's (or
 * tenant's) media id to move it into this gallery.
 */
export async function reorderProductMedia(
  tenantId: string,
  productId: string,
  orderedMediaIds: string[],
): Promise<ActionResult> {
  const product = await loadOwnedProduct(tenantId, productId);
  if (!product) {
    return { success: false, error: "Product not found." };
  }

  const db = getScopedDb(tenantId);
  const existing = await db.productMedia.findMany({ where: { productId, tenantId } });
  const existingIds = new Set(existing.map((m) => m.id));

  if (orderedMediaIds.length !== existing.length || !orderedMediaIds.every((id) => existingIds.has(id))) {
    return { success: false, error: "Reorder list does not match this product's media." };
  }

  await db.$transaction(
    orderedMediaIds.map((id, i) => db.productMedia.update({ where: { id }, data: { sortOrder: i } })),
  );

  return { success: true, data: undefined };
}
