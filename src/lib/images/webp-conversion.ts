import sharp from 'sharp';

/**
 * Server-side raster -> WebP normalisation, shared by every image upload
 * surface (product media, banners, branding logo). One module, so the
 * format policy, the validation and the failure behaviour cannot drift
 * between upload paths.
 *
 * It deliberately does NOT talk to storage or to the database: callers
 * hand it a File and get a File back, which keeps every surface's existing
 * key convention, ownership check and record shape untouched.
 */

/** WebP effort/quality. 82 is a deliberate ecommerce default: visually
 *  indistinguishable from source for product photography at roughly a
 *  third of the bytes of equivalent JPEG. Raised here rather than per
 *  caller so one number governs every surface. */
export const WEBP_QUALITY = 82;

/** Decompression-bomb ceiling. A 20000x20000 PNG is only a few hundred KB
 *  compressed but 1.6GB decoded, so the byte-size limits the upload paths
 *  already enforce are not sufficient on their own. 50MP is far above any
 *  legitimate product photo or hero banner. */
export const MAX_PIXELS = 50_000_000;

/** Longest edge sharp will accept before we reject outright. */
export const MAX_DIMENSION = 20_000;

/** The raster inputs we normalise to WebP. */
const CONVERTIBLE_MIME_TYPES = new Set(['image/jpeg', 'image/png']);

/**
 * Formats that are stored byte-for-byte, never converted. Each is an
 * exception for a stated consumer reason, not an oversight:
 *
 *  - image/svg+xml: a store logo is frequently vector-authored, and
 *    rasterising it would permanently lose that. Mandated to stay SVG.
 *    It remains subject to the existing sanitisation — an exception to
 *    CONVERSION, never to validation.
 *  - image/x-icon, image/vnd.microsoft.icon: ICO is a multi-resolution
 *    container that libvips cannot write, and browser tab icons are the
 *    one place a legacy format is still the safest choice.
 *  - image/webp: already the target format. Re-encoding it would be a
 *    second generation of lossy compression for no gain, so an uploaded
 *    WebP passes through untouched (see the normalisation note below).
 */
const PRESERVED_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/webp',
]);

/**
 * The preserved formats that must not be handed to the raster decoder at
 * all: SVG has no raster metadata to read, and ICO is not a format libvips
 * will write. Everything else preserved (WebP) is still decoded, because
 * it still has to be validated.
 */
const NON_DECODABLE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

export type ImageConversionError = 'empty' | 'unsupported' | 'corrupt' | 'too-large' | 'animated';

export type ImageConversionResult =
  | {
      ok: true;
      /** The file to persist — converted, or the original when preserved. */
      file: File;
      /** True only when bytes were re-encoded to WebP. */
      converted: boolean;
      contentType: string;
      width: number | null;
      height: number | null;
    }
  | { ok: false; code: ImageConversionError; error: string };

function replaceExtension(name: string, extension: string): string {
  return `${name.replace(/\.[^./\\]+$/, '')}.${extension}`;
}

/**
 * Whether this MIME type would be re-encoded. Exported so an upload path
 * can describe its own behaviour without re-stating the policy.
 */
export function willConvertToWebp(mimeType: string): boolean {
  return CONVERTIBLE_MIME_TYPES.has(mimeType);
}

/**
 * Validates real image CONTENT (never the filename or the client's claimed
 * MIME type) and converts PNG/JPEG to WebP.
 *
 * Preserved formats are returned unchanged, so a caller can run every
 * upload through this one function and let the policy decide, rather than
 * branching on format at each call site.
 *
 * Normalisation policy for an already-WebP upload: passed through as-is.
 * Re-encoding would add a generation of loss and save nothing, and the
 * stored object is already in the target format. It is still validated —
 * dimensions, pixel count and decodability are all checked.
 */
export async function convertImageToWebp(
  file: File,
  allowedMimeTypes: ReadonlySet<string>,
): Promise<ImageConversionResult> {
  if (file.size === 0) {
    return { ok: false, code: 'empty', error: 'That file is empty.' };
  }
  if (!allowedMimeTypes.has(file.type)) {
    return { ok: false, code: 'unsupported', error: 'Unsupported image type.' };
  }

  // A preserved format still gets its bytes read, but SVG has no raster
  // metadata to inspect and ICO is not a libvips-writable format, so
  // neither is sent through the decoder.
  if (NON_DECODABLE_MIME_TYPES.has(file.type)) {
    return {
      ok: true,
      file,
      converted: false,
      contentType: file.type,
      width: null,
      height: null,
    };
  }

  const input = Buffer.from(await file.arrayBuffer());

  let metadata;
  try {
    // limitInputPixels makes libvips itself refuse a decompression bomb
    // before allocating for it, rather than trusting our own check alone.
    metadata = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    // Narrow by construction: a throw here means libvips could not parse
    // the bytes. No broad catch around the whole function, and the
    // underlying message is never surfaced to the browser.
    return {
      ok: false,
      code: 'corrupt',
      error: 'That file is not a readable image, or it is corrupt.',
    };
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) {
    return {
      ok: false,
      code: 'corrupt',
      error: 'That file is not a readable image, or it is corrupt.',
    };
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    return {
      ok: false,
      code: 'too-large',
      error: `That image is too large to process (${width}x${height}). Resize it below ${MAX_DIMENSION}px per side.`,
    };
  }

  // Animation is rejected rather than silently flattened to frame one.
  // libvips can write animated WebP, but nothing in this app renders or
  // tests animated media, so accepting it would be an untested promise —
  // and keeping only the first frame is the exact silent data loss the
  // policy forbids.
  if ((metadata.pages ?? 1) > 1) {
    return {
      ok: false,
      code: 'animated',
      error: 'Animated images are not supported. Upload a single-frame image.',
    };
  }

  if (PRESERVED_MIME_TYPES.has(file.type)) {
    // Already WebP: validated above, stored unchanged.
    return {
      ok: true,
      file,
      converted: false,
      contentType: file.type,
      width,
      height,
    };
  }

  let output: Buffer;
  try {
    output = await sharp(input, { limitInputPixels: MAX_PIXELS })
      // .rotate() with no argument applies the EXIF orientation tag and
      // then drops it, so the stored pixels are already upright.
      .rotate()
      // No resize: the existing pipeline does not resize, and banners are
      // already cropped client-side before upload. Dimensions are
      // preserved exactly (allowing for an orientation swap).
      .webp({ quality: WEBP_QUALITY, alphaQuality: 100, effort: 4 })
      // Metadata is NOT copied forward, which is what strips EXIF and GPS.
      // sharp drops it by default; stated explicitly because it is a
      // privacy property of this pipeline, not an incidental one.
      .toBuffer();
  } catch {
    return {
      ok: false,
      code: 'corrupt',
      error: 'That image could not be converted. Try re-saving it and uploading again.',
    };
  }

  // Dimensions of the ACTUAL output, so a caller never reports the
  // pre-rotation values.
  const outMeta = await sharp(output).metadata();

  return {
    ok: true,
    file: new File([new Uint8Array(output)], replaceExtension(file.name, 'webp'), {
      type: 'image/webp',
    }),
    converted: true,
    contentType: 'image/webp',
    width: outMeta.width ?? null,
    height: outMeta.height ?? null,
  };
}
