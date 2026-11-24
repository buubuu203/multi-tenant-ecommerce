import { put, del } from '@vercel/blob';
import { randomUUID } from 'crypto';
import { convertImageToWebp } from './images/webp-conversion';

// Step 50: the ONLY module that talks to Vercel Blob directly — every
// upload/delete in the app goes through here, so the tenant-scoping
// convention (pathname embeds tenantId) and the format/size limits live
// in exactly one place.

export const MAX_MEDIA_ITEMS = 10;
export const MAX_IMAGES = 8;
export const MAX_VIDEOS = 2;
// Production incident (2026-11-19): every server-side upload path here —
// product images, banner, logo — runs through a Vercel Function (Server
// Action or Route Handler), which enforces a HARD, non-configurable 4.5MB
// request body limit (see https://vercel.com/docs/functions/limitations).
// Requests over that are rejected by the platform itself with a bare 413
// before this code ever runs, regardless of any limit set here or in
// Next.js's own serverActions.bodySizeLimit. 4MB keeps every one of these
// paths safely under that ceiling with headroom for multipart overhead.
// Video never goes through this limit at all: it uploads directly from
// the browser to Vercel Blob (see product-media/upload-video/route.ts +
// ProductMediaGallery.tsx's uploadSingleVideo), bypassing our server —
// and therefore this 4.5MB ceiling — entirely. Its own cap lives at
// MAX_VIDEO_UPLOAD_BYTES below, enforced by Vercel Blob's own token.
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_VIDEO_UPLOAD_BYTES = 30 * 1024 * 1024;
export const MAX_LOGO_BYTES = 4 * 1024 * 1024;
export const MAX_FAVICON_BYTES = 1 * 1024 * 1024;
// Storefront Carousel/Banner (V1): same 4MB ceiling as every other
// server-proxied upload here, for the same Vercel Functions hard-limit
// reason — not a banner-specific design choice anymore.
export const MAX_BANNER_IMAGE_BYTES = 4 * 1024 * 1024;

export type MediaKind = 'image' | 'video';

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm']);
const LOGO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']);
// Deliberately NOT including SVG — unlike a logo (small, often
// vector-authored), a banner is a photographic hero image; excluding SVG
// here means this upload path never needs the SVG-sanitization concerns
// LOGO_MIME_TYPES/FAVICON_MIME_TYPES carry, keeping this V1's attack
// surface smaller.
const BANNER_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const FAVICON_MIME_TYPES = new Set([
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/png',
  'image/svg+xml',
]);

async function validateSvgUpload(file: File): Promise<string | null> {
  if (file.type !== 'image/svg+xml') return null;
  const source = await file.text();
  if (/<script\b|<foreignObject\b|javascript:|on[a-z]+\s*=|data:text\/html/i.test(source)) {
    return 'SVG files may not contain scripts, event handlers, or embedded HTML.';
  }
  return null;
}

export function classifyMediaMimeType(mimeType: string): MediaKind | null {
  if (IMAGE_MIME_TYPES.has(mimeType)) return 'image';
  if (VIDEO_MIME_TYPES.has(mimeType)) return 'video';
  return null;
}

/**
 * The tenant-scoped path convention every product-media blob uses,
 * regardless of whether it got there via uploadProductMediaFile() (images,
 * proxied through this server) or the direct-to-browser video upload route
 * (which calls this same helper to mint the pathname it hands the client,
 * then re-validates that the client uploaded to exactly this prefix).
 * Centralised so the convention — and therefore deleteProductMediaFile()'s
 * ownership check — can never drift between the two paths.
 */
export function buildProductMediaPathname(tenantId: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  return `product-media/${tenantId}/${randomUUID()}-${safeName}`;
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
    return {
      error: 'Định dạng không được hỗ trợ. Dùng JPG, PNG hoặc WebP cho ảnh.',
    };
  }

  // This function is the server-PROXIED image path only. Video never
  // reaches here — it uploads directly from the browser to Blob (see the
  // MAX_VIDEO_UPLOAD_BYTES comment above), so this is purely a defensive
  // invariant check, not a user-facing path.
  if (kind === 'video') {
    return { error: 'Video phải tải lên qua đường tải trực tiếp, không qua đường này.' };
  }

  if (file.size > MAX_IMAGE_BYTES) {
    const limitMb = Math.round(MAX_IMAGE_BYTES / (1024 * 1024));
    return { error: `Ảnh vượt ${limitMb}MB, vui lòng chọn ảnh nhỏ hơn.` };
  }

  // Raster images are normalised to WebP BEFORE the key is derived, so
  // the stored extension and content type always describe the actual
  // bytes. Videos are never sent through the image pipeline.
  let upload = file;
  let contentType = file.type;
  if (kind === 'image') {
    const converted = await convertImageToWebp(file, IMAGE_MIME_TYPES);
    if (!converted.ok) return { error: converted.error };
    upload = converted.file;
    contentType = converted.contentType;
  }

  const pathname = buildProductMediaPathname(tenantId, upload.name);

  const blob = await put(pathname, upload, { access: 'public', contentType });
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

export async function uploadBrandingLogoFile(
  tenantId: string,
  file: File,
): Promise<{ url: string } | { error: string }> {
  if (!LOGO_MIME_TYPES.has(file.type)) {
    return { error: 'Định dạng logo không được hỗ trợ. Dùng JPG, PNG, WebP hoặc SVG.' };
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { error: 'Logo vượt 4MB, vui lòng chọn ảnh nhỏ hơn.' };
  }
  // SVG sanitisation runs FIRST and is unchanged: SVG is an exception to
  // conversion, never to validation.
  const svgError = await validateSvgUpload(file);
  if (svgError) return { error: svgError };

  // A vector logo stays vector (mandated); a raster logo is normalised to
  // WebP like any other raster upload. convertImageToWebp() makes that
  // decision from the real content type, so this path states no policy of
  // its own.
  const converted = await convertImageToWebp(file, LOGO_MIME_TYPES);
  if (!converted.ok) return { error: converted.error };

  const safeName = converted.file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const blob = await put(`branding/${tenantId}/${randomUUID()}-${safeName}`, converted.file, {
    access: 'public',
    contentType: converted.contentType,
  });
  return { url: blob.url };
}

/**
 * Favicons are stored in the format they arrive in — the one image surface
 * here that does NOT convert.
 *
 * Why: this app emits the favicon as `icons: { icon: url }` in Next's
 * metadata (src/app/layout.tsx), which becomes a bare <link rel="icon">.
 * The browser, not the app, decides what it will accept there. ICO is a
 * multi-resolution container libvips cannot write at all, and a WebP tab
 * icon, while supported by current Chrome/Firefox/Safari, is still the
 * format most likely to be ignored by a crawler, a feed reader or an older
 * browser — for a 1MB-capped piece of UI chrome, that trade buys nothing.
 * So ICO stays ICO, PNG stays PNG, SVG stays SVG, and the generated
 * metadata and URL stay valid for every one of them.
 *
 * Validation is unchanged and still applies, SVG sanitisation included.
 */
export async function uploadBrandingFaviconFile(
  tenantId: string,
  file: File,
): Promise<{ url: string } | { error: string }> {
  if (!FAVICON_MIME_TYPES.has(file.type)) {
    return { error: 'Định dạng favicon không được hỗ trợ. Dùng ICO, PNG hoặc SVG.' };
  }
  if (file.size > MAX_FAVICON_BYTES) {
    return { error: 'Favicon vượt 1MB, vui lòng chọn ảnh nhỏ hơn.' };
  }
  const svgError = await validateSvgUpload(file);
  if (svgError) return { error: svgError };

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const blob = await put(`branding/${tenantId}/favicon-${randomUUID()}-${safeName}`, file, {
    access: 'public',
  });
  return { url: blob.url };
}

export async function deleteBrandingLogoFile(tenantId: string, url: string): Promise<void> {
  if (!url.includes(`/branding/${tenantId}/`)) {
    throw new Error("Refusing to delete a blob outside this tenant's branding namespace.");
  }
  await del(url);
}

export async function uploadBannerImageFile(
  tenantId: string,
  file: File,
  variant: 'desktop' | 'mobile' = 'desktop',
): Promise<{ url: string } | { error: string }> {
  if (!BANNER_MIME_TYPES.has(file.type)) {
    return { error: 'Định dạng ảnh không được hỗ trợ. Dùng JPG, PNG hoặc WebP.' };
  }
  if (file.size > MAX_BANNER_IMAGE_BYTES) {
    return { error: 'Ảnh banner vượt 4MB, vui lòng chọn ảnh nhỏ hơn.' };
  }

  const converted = await convertImageToWebp(file, BANNER_MIME_TYPES);
  if (!converted.ok) return { error: converted.error };

  // The desktop/mobile distinction is carried by the key prefix exactly as
  // before — conversion changes the bytes, never the namespace.
  const safeName = converted.file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const prefix = variant === 'mobile' ? 'mobile-' : '';
  const blob = await put(
    `banners/${tenantId}/${prefix}${randomUUID()}-${safeName}`,
    converted.file,
    { access: 'public', contentType: converted.contentType },
  );
  return { url: blob.url };
}

export async function deleteBannerImageFile(tenantId: string, url: string): Promise<void> {
  if (!url.includes(`/banners/${tenantId}/`)) {
    throw new Error("Refusing to delete a blob outside this tenant's banner namespace.");
  }
  await del(url);
}
