'use client';

import { useEffect, useRef, useState } from 'react';
import { upload } from '@vercel/blob/client';
import {
  uploadProductMediaAction,
  deleteUploadedProductMediaAction,
  addProductMediaAction,
  removeProductMediaAction,
  reorderProductMediaAction,
  createProductVideoPathnameAction,
} from './actions';
import { compressImageInBrowser } from '@/lib/images/client-compress';

const MAX_MEDIA_ITEMS = 10;
const MAX_IMAGES = 8;
const MAX_VIDEOS = 2;
// Caps how many files upload at once — unbounded parallelism would fire
// every selected file's request simultaneously, which on a merchant's
// upload bandwidth just makes each individual file slower rather than
// actually finishing the batch sooner. Images and videos share this one
// pool (not a separate budget each), for the same bandwidth reason.
const MAX_PARALLEL_UPLOADS = 3;
// A rough pre-check only, at SELECTION time — the server (blob-storage.ts's
// MAX_IMAGE_BYTES) still caps at 4MB, a Vercel Functions platform limit
// that cannot be raised. The gap is closed by client-side compression
// (compressImageInBrowser): the admin can pick up to 10MB, and it is
// resized/re-encoded to clear 4MB BEFORE it ever leaves the browser.
const MAX_IMAGE_INPUT_BYTES = 10 * 1024 * 1024;
// Video uploads directly from the browser to Vercel Blob (never through
// our server — see uploadSingleVideo below), so it isn't bound by the
// 4.5MB Vercel Functions limit at all. 30MB matches the token's own
// maximumSizeInBytes in product-media/upload-video/route.ts.
const MAX_VIDEO_INPUT_BYTES = 30 * 1024 * 1024;
// HEIC/HEIF accepted here for the file PICKER only — they are never sent
// to the server as-is. Some phones report an empty/generic MIME type for
// .heic files, so the extensions are listed too, not just the MIME types.
const ACCEPTED_TYPES =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/webm';

type MediaItem = {
  // In "create" mode this is a client-generated key (nothing persisted
  // yet); in "edit" mode it's the real ProductMedia.id.
  key: string;
  type: 'image' | 'video';
  url: string;
  uploading?: boolean;
  // Distinguishes three sequential, mutually-exclusive busy states so a
  // merchant always knows what's actually happening: HEIC->JPEG
  // conversion (images only, rare), then client-side resize/compress
  // (images only, every file), then the network upload itself (both).
  converting?: boolean;
  optimizing?: boolean;
  // Video only — percentage (0-100) from @vercel/blob's onUploadProgress.
  progress?: number;
  error?: string;
  // Whether this item's original File is still available for a "Thử lại"
  // retry — false for errors with no stored file to resubmit (e.g. a
  // server-side DB error after the upload itself already succeeded and
  // was cleared from pendingFilesRef).
  canRetry?: boolean;
};

function isHeic(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  );
}

function isMov(file: File): boolean {
  const name = file.name.toLowerCase();
  return file.type === 'video/quicktime' || name.endsWith('.mov');
}

/**
 * Runs `tasks` with at most `limit` running concurrently. Each task's
 * outcome is captured independently (like Promise.allSettled) — one
 * task throwing never cancels or fails the others, and the caller gets
 * every result once all have settled, never a short-circuit.
 */
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      try {
        const value = await tasks[i]();
        results[i] = { status: 'fulfilled', value };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/**
 * Browser-side HEIC/HEIF -> JPEG conversion via heic2any (WASM libheif,
 * dynamically imported so its ~2.7MB payload is only ever fetched when a
 * merchant actually selects a HEIC file — everyone uploading JPG/PNG/WebP
 * pays zero extra bundle cost). The server (blob-storage.ts) never sees or
 * stores the original HEIC bytes — only the converted JPEG, which then
 * still goes through the same client-side compression step as any other
 * image before upload.
 */
async function convertHeicToJpeg(file: File): Promise<File> {
  const heic2any = (await import('heic2any')).default;
  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
  const blob = Array.isArray(converted) ? converted[0] : converted;
  const newName = file.name.replace(/\.(heic|heif)$/i, '') + '.jpg';
  return new File([blob], newName, { type: 'image/jpeg' });
}

// Step 50: one shared gallery component for both contexts —
//   - "create": productId is undefined; media lives only in local state
//     until the enclosing <ActionForm> submits (a hidden `media` input
//     carries the current [{url,type}] JSON — see the form field below).
//     Uploads happen immediately on file selection so the admin sees
//     progress/previews before ever clicking "Add product" (per Step 50
//     §7); a file removed before submit is deleted from Blob immediately
//     (deleteUploadedProductMediaAction) so nothing orphaned survives.
//   - "edit": productId is a real existing product's id; every add/
//     remove/reorder is a persisted, immediate server mutation (each
//     independently re-verified server-side against tenant + product
//     ownership — see product-media-mutations.ts).
export function ProductMediaGallery({
  productId,
  initialMedia = [],
  onUploadingChange,
}: {
  productId?: string;
  initialMedia?: { id: string; type: 'image' | 'video'; url: string }[];
  // Step 50: lets the enclosing form (create mode only — see
  // page.tsx/ActionForm's `disabled` prop) block submission while an
  // upload is still in flight. Without this, submitting mid-upload sends
  // the local `blob:` preview URL instead of the real Blob URL, which
  // validateMedia() now also rejects server-side — this callback exists
  // so the UI can prevent that submission from ever happening, rather
  // than round-tripping to the server just to show an error.
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const mode = productId ? 'edit' : 'create';
  const [items, setItems] = useState<MediaItem[]>(
    initialMedia.map((m) => ({ key: m.id, type: m.type, url: m.url })),
  );
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Native HTML5 drag-and-drop, not a library — same reasoning as
  // ImageCropModal's own pan/zoom: this interaction (drag a tile to a new
  // slot in a small, flat list) is small enough that a dependency costs
  // more than it saves. The `‹`/`›` buttons below are NOT replaced by
  // this — HTML5 drag-and-drop fires no events on touch and is not
  // keyboard-operable, so they remain the accessible path; dragging is
  // purely an added convenience for a mouse.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // Keeps each file keyed by its item's `key` so a failed item's "Thử
  // lại" button can resubmit the exact same File without asking the
  // merchant to reselect it. Not React state — the File objects
  // themselves never need to trigger a re-render.
  const pendingFilesRef = useRef<Map<string, File>>(new Map());
  // Edit mode's addProductMediaAction reads the product's current media
  // count/sortOrder before writing — running two of those concurrently
  // would race on the same snapshot and could assign duplicate sortOrder
  // values or blow past MAX_MEDIA_ITEMS server-side. Every DB-persisting
  // call in this component (initial batch AND later retries, images AND
  // videos) chains onto this single queue so they always run one at a
  // time, in the order their upload finished.
  const dbQueueRef = useRef<Promise<void>>(Promise.resolve());
  // One AbortController per in-flight video upload, so its "Hủy" button
  // can cancel exactly that upload without touching any other file.
  const videoAbortControllersRef = useRef<Map<string, AbortController>>(new Map());

  const imageCount = items.filter((i) => i.type === 'image' && !i.error).length;
  const videoCount = items.filter((i) => i.type === 'video' && !i.error).length;
  const totalCount = items.filter((i) => !i.error).length;
  const anyUploading = items.some((i) => i.uploading || i.converting || i.optimizing);

  useEffect(() => {
    onUploadingChange?.(anyUploading);
  }, [anyUploading, onUploadingChange]);

  // Leaving mid-upload would silently lose that file (or, in "create"
  // mode, strand it as an orphaned blob with no ProductMedia row ever
  // created for it) — this is the browser's own native confirm prompt,
  // which is the only one a beforeunload handler is allowed to trigger.
  useEffect(() => {
    if (!anyUploading) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [anyUploading]);

  function classifyFile(file: File): 'image' | 'video' | null {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || isHeic(file))
      return 'image';
    if (['video/mp4', 'video/webm'].includes(file.type)) return 'video';
    return null;
  }

  // One image's full pipeline (HEIC conversion -> client-side resize/
  // compress -> Blob upload (proxied through the server, still capped at
  // 4MB) -> DB persist in edit mode), isolated so a thrown error here
  // only ever marks THIS item as failed.
  async function uploadSingleImage(key: string, file: File) {
    try {
      let fileToUpload = file;
      if (isHeic(file)) {
        try {
          fileToUpload = await convertHeicToJpeg(file);
        } catch {
          setItems((prev) =>
            prev.map((i) =>
              i.key === key
                ? {
                    ...i,
                    converting: false,
                    error: "Couldn't convert this HEIC image — try exporting it as JPEG first.",
                    canRetry: true,
                  }
                : i,
            ),
          );
          return;
        }
        setItems((prev) =>
          prev.map((i) => (i.key === key ? { ...i, converting: false, optimizing: true } : i)),
        );
      }

      const compressed = await compressImageInBrowser(fileToUpload);
      if (!compressed.ok) {
        setItems((prev) =>
          prev.map((i) =>
            i.key === key
              ? { ...i, optimizing: false, error: compressed.error, canRetry: true }
              : i,
          ),
        );
        return;
      }
      fileToUpload = compressed.file;
      setItems((prev) =>
        prev.map((i) => (i.key === key ? { ...i, optimizing: false, uploading: true } : i)),
      );

      const formData = new FormData();
      formData.append('file', fileToUpload);
      const result = await uploadProductMediaAction(formData);

      if (!result.success) {
        setItems((prev) =>
          prev.map((i) =>
            i.key === key ? { ...i, uploading: false, error: result.error, canRetry: true } : i,
          ),
        );
        return;
      }

      const uploaded = result.data;
      if (mode === 'edit' && productId) {
        const thisWrite = dbQueueRef.current.then(async () => {
          const addFormData = new FormData();
          addFormData.append('productId', productId);
          addFormData.append(
            'media',
            JSON.stringify([{ url: uploaded.url, type: uploaded.type }]),
          );
          const addResult = await addProductMediaAction(addFormData);
          if (!addResult.success) {
            setItems((prev) =>
              prev.map((i) =>
                i.key === key
                  ? { ...i, uploading: false, error: addResult.error, canRetry: true }
                  : i,
              ),
            );
            return;
          }
          // addProductMediaAction already persisted the row and ran
          // revalidatePath() server-side. Swap the local placeholder's
          // key for the REAL ProductMedia.id it returned — remove/
          // reorder calls made later in this same session must target
          // the real row, not the client-generated placeholder key.
          const realId = addResult.data.ids[0];
          pendingFilesRef.current.delete(key);
          setItems((prev) =>
            prev.map((i) =>
              i.key === key ? { key: realId, type: uploaded.type, url: uploaded.url } : i,
            ),
          );
        });
        dbQueueRef.current = thisWrite;
        await thisWrite;
      } else {
        pendingFilesRef.current.delete(key);
        setItems((prev) =>
          prev.map((i) => (i.key === key ? { key, type: uploaded.type, url: uploaded.url } : i)),
        );
      }
    } catch {
      setItems((prev) =>
        prev.map((i) =>
          i.key === key
            ? {
                ...i,
                uploading: false,
                converting: false,
                optimizing: false,
                error: 'Tải lên thất bại, vui lòng thử lại.',
                canRetry: true,
              }
            : i,
        ),
      );
    }
  }

  // Video's full pipeline: the file goes DIRECTLY from the browser to
  // Vercel Blob — @vercel/blob's upload() only round-trips our server for
  // a short-lived token (product-media/upload-video/route.ts), never for
  // the bytes themselves. That's what makes this immune to the 4.5MB
  // Vercel Functions body limit that caps every other path in this file.
  async function uploadSingleVideo(key: string, file: File) {
    const controller = new AbortController();
    videoAbortControllersRef.current.set(key, controller);
    try {
      const pathnameResult = await createProductVideoPathnameAction(file.name);
      if (!pathnameResult.success) {
        setItems((prev) =>
          prev.map((i) =>
            i.key === key
              ? { ...i, uploading: false, error: pathnameResult.error, canRetry: true }
              : i,
          ),
        );
        return;
      }

      const blobResult = await upload(pathnameResult.data.pathname, file, {
        access: 'public',
        handleUploadUrl: '/tenant-admin/product-media/upload-video',
        contentType: file.type,
        abortSignal: controller.signal,
        onUploadProgress: ({ percentage }) => {
          setItems((prev) => prev.map((i) => (i.key === key ? { ...i, progress: percentage } : i)));
        },
      });
      videoAbortControllersRef.current.delete(key);

      if (mode === 'edit' && productId) {
        const thisWrite = dbQueueRef.current.then(async () => {
          const addFormData = new FormData();
          addFormData.append('productId', productId);
          addFormData.append('media', JSON.stringify([{ url: blobResult.url, type: 'video' }]));
          const addResult = await addProductMediaAction(addFormData);
          if (!addResult.success) {
            setItems((prev) =>
              prev.map((i) =>
                i.key === key
                  ? { ...i, uploading: false, error: addResult.error, canRetry: true }
                  : i,
              ),
            );
            return;
          }
          const realId = addResult.data.ids[0];
          pendingFilesRef.current.delete(key);
          setItems((prev) =>
            prev.map((i) => (i.key === key ? { key: realId, type: 'video', url: blobResult.url } : i)),
          );
        });
        dbQueueRef.current = thisWrite;
        await thisWrite;
      } else {
        pendingFilesRef.current.delete(key);
        setItems((prev) =>
          prev.map((i) => (i.key === key ? { key, type: 'video', url: blobResult.url } : i)),
        );
      }
    } catch (e) {
      videoAbortControllersRef.current.delete(key);
      const canceled = e instanceof Error && e.name === 'AbortError';
      setItems((prev) =>
        prev.map((i) =>
          i.key === key
            ? {
                ...i,
                uploading: false,
                progress: undefined,
                error: canceled ? 'Đã hủy tải lên.' : 'Tải video thất bại, vui lòng thử lại.',
                canRetry: true,
              }
            : i,
        ),
      );
    }
  }

  function handleCancelVideo(item: MediaItem) {
    videoAbortControllersRef.current.get(item.key)?.abort();
  }

  function handleRetry(item: MediaItem) {
    const file = pendingFilesRef.current.get(item.key);
    if (!file) return;
    if (item.type === 'video') {
      setItems((prev) =>
        prev.map((i) =>
          i.key === item.key
            ? { ...i, error: undefined, canRetry: false, uploading: true, progress: undefined }
            : i,
        ),
      );
      void runWithConcurrency([() => uploadSingleVideo(item.key, file)], 1);
      return;
    }
    const needsConversion = isHeic(file);
    setItems((prev) =>
      prev.map((i) =>
        i.key === item.key
          ? {
              ...i,
              error: undefined,
              canRetry: false,
              converting: needsConversion,
              optimizing: !needsConversion,
              uploading: false,
            }
          : i,
      ),
    );
    void runWithConcurrency([() => uploadSingleImage(item.key, file)], 1);
  }

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setFormError(null);
    const files = Array.from(fileList);

    // Client-side limit pre-check — a UX convenience only; the server
    // (createProductAction / addProductMedia) independently re-enforces
    // the same limits as the real authority.
    let nextImageCount = imageCount;
    let nextVideoCount = videoCount;
    let nextTotal = totalCount;
    const accepted: { file: File; kind: 'image' | 'video' }[] = [];
    for (const file of files) {
      if (isMov(file)) {
        setFormError("MOV isn't supported yet. Please upload MP4 or WebM.");
        continue;
      }
      const kind = classifyFile(file);
      if (!kind) {
        setFormError(`${file.name}: unsupported file type.`);
        continue;
      }
      if (kind === 'image' && file.size > MAX_IMAGE_INPUT_BYTES) {
        setFormError(`${file.name}: ảnh vượt 10MB, vui lòng chọn ảnh nhỏ hơn.`);
        continue;
      }
      if (kind === 'video' && file.size > MAX_VIDEO_INPUT_BYTES) {
        setFormError(`${file.name}: video vượt 30MB, vui lòng chọn file nhỏ hơn.`);
        continue;
      }
      if (nextTotal >= MAX_MEDIA_ITEMS) {
        setFormError(`You can only add up to ${MAX_MEDIA_ITEMS} media items.`);
        break;
      }
      if (kind === 'image' && nextImageCount >= MAX_IMAGES) {
        setFormError(`You can only add up to ${MAX_IMAGES} images.`);
        continue;
      }
      if (kind === 'video' && nextVideoCount >= MAX_VIDEOS) {
        setFormError(`You can only add up to ${MAX_VIDEOS} videos.`);
        continue;
      }
      accepted.push({ file, kind });
      nextTotal++;
      if (kind === 'image') nextImageCount++;
      else nextVideoCount++;
    }

    if (accepted.length === 0) return;

    // Every accepted file gets its tile and busy state added UP FRONT,
    // before any upload starts — a multi-file selection shows every tile
    // immediately, each with its own independent progress.
    const queued = accepted.map(({ file, kind }) => ({
      file,
      kind,
      key: `${file.name}-${crypto.randomUUID()}`,
      needsConversion: kind === 'image' && isHeic(file),
      objectUrl: URL.createObjectURL(file),
    }));
    queued.forEach(({ key, file }) => pendingFilesRef.current.set(key, file));
    setItems((prev) => [
      ...prev,
      ...queued.map(({ key, kind, needsConversion, objectUrl }) => ({
        key,
        type: kind,
        url: objectUrl,
        converting: needsConversion,
        optimizing: kind === 'image' && !needsConversion,
        uploading: kind === 'video',
      })),
    ]);

    // Bounded to MAX_PARALLEL_UPLOADS concurrent files (images and videos
    // share the one pool), and each file's outcome is independent — one
    // file failing never stops or slows the rest of the batch.
    await runWithConcurrency(
      queued.map(
        ({ file, key, kind }) =>
          () =>
            kind === 'video' ? uploadSingleVideo(key, file) : uploadSingleImage(key, file),
      ),
      MAX_PARALLEL_UPLOADS,
    );
  }

  async function handleRemove(item: MediaItem) {
    if (mode === 'edit' && productId && !item.error) {
      const formData = new FormData();
      formData.append('productId', productId);
      formData.append('mediaId', item.key);
      await removeProductMediaAction(null, formData);
    } else if (mode === 'create' && !item.error && !item.uploading) {
      const formData = new FormData();
      formData.append('url', item.url);
      await deleteUploadedProductMediaAction(formData);
    }
    pendingFilesRef.current.delete(item.key);
    setItems((prev) => prev.filter((i) => i.key !== item.key));
  }

  async function persistReorder(next: MediaItem[]) {
    setItems(next);
    if (mode === 'edit' && productId) {
      const formData = new FormData();
      formData.append('productId', productId);
      formData.append('orderedMediaIds', JSON.stringify(next.map((i) => i.key)));
      await reorderProductMediaAction(formData);
    }
  }

  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    void persistReorder(next);
  }

  // Live preview only — moves the tile in local state as the pointer
  // crosses into a new slot, with NO server call. The actual persistence
  // happens once, in handleDrop, exactly like the buttons' moveItem()
  // already does one persistReorder() per completed move rather than per
  // intermediate position.
  function handleDragOver(e: React.DragEvent, overIndex: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === overIndex) return;
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(overIndex, 0, moved);
      return next;
    });
    setDragIndex(overIndex);
  }

  function handleDragEnd() {
    setDragIndex(null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragIndex(null);
    // `items` already reflects every handleDragOver move made during this
    // drag, so this just commits the array already shown on screen.
    void persistReorder(items);
  }

  const validItems = items.filter((i) => !i.error);
  const mediaJson = JSON.stringify(validItems.map((i) => ({ url: i.url, type: i.type })));

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Product media
      </h4>
      <p className="text-xs text-muted-foreground">
        Upload up to {MAX_IMAGES} images and {MAX_VIDEOS} videos (max {MAX_MEDIA_ITEMS} media
        items total)
      </p>
      <p className="text-xs text-muted-foreground">
        Images: JPG, PNG, WebP, HEIC/HEIF, up to 10MB — optimized to WebP in your browser before
        upload. Videos: MP4, WebM, up to 30MB — uploaded directly from your browser.
      </p>

      {/* Only meaningful in "create" mode — the enclosing <ActionForm>'s
          own submit reads this field. In "edit" mode each change is
          already persisted immediately, so this field is inert there. */}
      {mode === 'create' && <input type="hidden" name="media" value={mediaJson} />}

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No media added yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item, index) => (
            <div
              key={item.key}
              draggable={!item.error}
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              className={`relative flex h-20 w-20 flex-col items-center justify-center rounded-md border border-border ${
                dragIndex === index ? 'opacity-40' : ''
              } ${!item.error ? 'cursor-grab active:cursor-grabbing' : ''}`}
            >
              {item.type === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra, see ProductList.tsx
                <img src={item.url} alt="" className="h-full w-full rounded-md object-cover" />
              ) : (
                <div className="relative h-full w-full">
                  <video src={item.url} className="h-full w-full rounded-md object-cover" muted />
                  <span className="absolute inset-0 flex items-center justify-center text-lg text-white">
                    ▶
                  </span>
                </div>
              )}
              {(item.uploading || item.converting || item.optimizing) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-md bg-black/50 text-center text-[10px] text-white">
                  <span>
                    {item.converting
                      ? 'Converting…'
                      : item.optimizing
                        ? 'Đang tối ưu ảnh…'
                        : item.type === 'video' && item.progress != null
                          ? `Đang tải lên… ${Math.round(item.progress)}%`
                          : 'Đang tải lên…'}
                  </span>
                  {item.type === 'video' && item.uploading && (
                    <button
                      type="button"
                      onClick={() => handleCancelVideo(item)}
                      className="rounded bg-white/20 px-1.5 py-0.5 text-[9px] font-medium hover:bg-white/30"
                    >
                      Hủy
                    </button>
                  )}
                </div>
              )}
              {item.error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-md bg-red-600/80 p-1 text-center text-[9px] text-white">
                  <span>{item.error}</span>
                  {item.canRetry && (
                    <button
                      type="button"
                      onClick={() => handleRetry(item)}
                      className="rounded bg-white/20 px-1.5 py-0.5 text-[9px] font-medium hover:bg-white/30"
                    >
                      Thử lại
                    </button>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={() => handleRemove(item)}
                aria-label="Remove media"
                className="absolute top-0 right-0 flex h-5 w-5 items-center justify-center rounded-bl bg-black/70 text-xs text-white"
              >
                ×
              </button>
              {!item.error && (
                <div className="absolute right-0 bottom-0 left-0 flex justify-between bg-black/50 px-1">
                  <button
                    type="button"
                    onClick={() => moveItem(index, -1)}
                    disabled={index === 0}
                    aria-label="Move left"
                    className="text-xs text-white disabled:opacity-30"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() => moveItem(index, 1)}
                    disabled={index === items.length - 1}
                    aria-label="Move right"
                    className="text-xs text-white disabled:opacity-30"
                  >
                    ›
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {formError && <p className="text-xs text-red-600">{formError}</p>}
      {anyUploading && (
        <p className="text-xs text-muted-foreground">
          Đang xử lý/tải lên — bạn vẫn có thể tiếp tục điền các phần khác của form.
        </p>
      )}

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="w-fit rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-surface-muted"
      >
        + Upload media
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFilesSelected(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
