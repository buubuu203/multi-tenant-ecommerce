import { put, del } from "@vercel/blob";
import { randomUUID } from "crypto";

// Step 50: the ONLY module that talks to Vercel Blob directly — every
// upload/delete in the app goes through here, so the tenant-scoping
// convention (pathname embeds tenantId) and the format/size limits live
// in exactly one place.

export const MAX_MEDIA_ITEMS = 10;
export const MAX_IMAGES = 8;
export const MAX_VIDEOS = 2;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export type MediaKind = "image" | "video";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm"]);

export function classifyMediaMimeType(mimeType: string): MediaKind | null {
  if (IMAGE_MIME_TYPES.has(mimeType)) return "image";
  if (VIDEO_MIME_TYPES.has(mimeType)) return "video";
  return null;
}

/**
 * Uploads one file to Vercel Blob for the given tenant. The pathname
 * ALWAYS embeds the tenantId (`product-media/<tenantId>/<uuid>-<name>`) —
 * this is what lets deleteProductMediaFile() verify ownership from the URL
 * alone, without needing a database lookup, for the pre-product-creation
 * case where no ProductMedia row exists yet to check against.
 *
 * Never trusts the caller's claimed file type — reclassifies from the
 * actual MIME type on the File object.
 */
export async function uploadProductMediaFile(
  tenantId: string,
  file: File,
): Promise<{ url: string; type: MediaKind } | { error: string }> {
  const kind = classifyMediaMimeType(file.type);
  if (!kind) {
    return { error: "Unsupported file type. Use JPG, PNG, or WebP for images, or MP4 or WebM for videos." };
  }

  const maxBytes = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (file.size > maxBytes) {
    const limitMb = Math.round(maxBytes / (1024 * 1024));
    return { error: `${kind === "image" ? "Image" : "Video"} exceeds the ${limitMb}MB limit.` };
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const pathname = `product-media/${tenantId}/${randomUUID()}-${safeName}`;

  const blob = await put(pathname, file, { access: "public" });
  return { url: blob.url, type: kind };
}

/**
 * Deletes a previously-uploaded blob. Refuses to delete any URL whose path
 * doesn't embed this exact tenantId — this is the entire tenant-isolation
 * guard for blob deletion, since Vercel Blob itself has no tenant concept.
 * Best-effort: callers should not fail their own operation just because a
 * blob delete failed (see product-media-mutations.ts).
 */
export async function deleteProductMediaFile(tenantId: string, url: string): Promise<void> {
  if (!url.includes(`/product-media/${tenantId}/`)) {
    throw new Error("Refusing to delete a blob outside this tenant's media namespace.");
  }
  await del(url);
}
