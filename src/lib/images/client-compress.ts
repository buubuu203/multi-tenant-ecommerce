// Browser-only image optimization, run BEFORE a file ever leaves the
// device. The point: the server stays capped at 4MB (Vercel Functions'
// hard, non-configurable 4.5MB request body limit — see blob-storage.ts),
// while the PO can still select real-world photos up to 10MB. This is
// what reconciles the two: resize to a sane max width, then re-encode to
// WebP, stepping quality down until the result clears the server's cap.
//
// Never imported from a server file — createImageBitmap/canvas/document
// only exist in the browser.

export const CLIENT_COMPRESS_MAX_WIDTH = 2000;
export const CLIENT_COMPRESS_TARGET_BYTES = 4 * 1024 * 1024;
// Each step is tried in order until the encoded blob clears
// CLIENT_COMPRESS_TARGET_BYTES. 0.88 matches the server's own WebP default
// closely enough to be visually lossless for product/banner photography;
// 0.6 is the floor where quality loss starts being visible, so a file that
// still doesn't fit there is a real "too big" case, not a tuning problem.
export const CLIENT_COMPRESS_QUALITY_STEPS = [0.88, 0.8, 0.7, 0.6] as const;

export type ClientCompressResult =
  | { ok: true; file: File; beforeBytes: number; afterBytes: number; quality: number }
  | { ok: false; error: string; beforeBytes: number };

/**
 * Resizes (never upscales, never crops — aspect ratio is always
 * preserved) to at most CLIENT_COMPRESS_MAX_WIDTH wide, then re-encodes to
 * WebP at the first quality step that lands at or under
 * CLIENT_COMPRESS_TARGET_BYTES. WebP's alpha channel survives this path
 * automatically — canvas.toBlob('image/webp', …) encodes whatever the
 * source had, transparent or not.
 *
 * Any cropping (e.g. the banner's fixed aspect ratio) must happen BEFORE
 * this is called — this function only ever resizes proportionally.
 */
export async function compressImageInBrowser(file: File): Promise<ClientCompressResult> {
  const beforeBytes = file.size;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, error: 'Không đọc được ảnh này, vui lòng thử ảnh khác.', beforeBytes };
  }

  const scale = Math.min(1, CLIENT_COMPRESS_MAX_WIDTH / bitmap.width);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return { ok: false, error: 'Trình duyệt không hỗ trợ xử lý ảnh này.', beforeBytes };
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let bestBlob: Blob | null = null;
  let bestQuality: number = CLIENT_COMPRESS_QUALITY_STEPS[0];
  for (const quality of CLIENT_COMPRESS_QUALITY_STEPS) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', quality),
    );
    if (!blob) continue;
    bestBlob = blob;
    bestQuality = quality;
    if (blob.size <= CLIENT_COMPRESS_TARGET_BYTES) break;
  }

  if (!bestBlob) {
    return { ok: false, error: 'Không nén được ảnh này, vui lòng thử ảnh khác.', beforeBytes };
  }

  if (bestBlob.size > CLIENT_COMPRESS_TARGET_BYTES) {
    const stillMb = (bestBlob.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      error: `Ảnh vẫn vượt 4MB sau khi nén (còn ${stillMb}MB). Vui lòng chọn ảnh khác hoặc giảm độ phân giải trước khi tải lên.`,
      beforeBytes,
    };
  }

  const newName = file.name.replace(/\.[^./\\]+$/, '') + '.webp';
  const outFile = new File([bestBlob], newName, { type: 'image/webp' });

  if (process.env.NODE_ENV !== 'production') {
    console.log(
      `[image-compress] ${file.name}: ${beforeBytes.toLocaleString()}B -> ${outFile.size.toLocaleString()}B (quality ${bestQuality}, ${width}x${height})`,
    );
  }

  return { ok: true, file: outFile, beforeBytes, afterBytes: outFile.size, quality: bestQuality };
}
