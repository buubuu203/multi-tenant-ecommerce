"use client";

import { useEffect, useRef, useState } from "react";
import {
  uploadProductMediaAction,
  deleteUploadedProductMediaAction,
  addProductMediaAction,
  removeProductMediaAction,
  reorderProductMediaAction,
} from "./actions";

const MAX_MEDIA_ITEMS = 10;
const MAX_IMAGES = 8;
const MAX_VIDEOS = 2;
const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp,video/mp4,video/webm";

type MediaItem = {
  // In "create" mode this is a client-generated key (nothing persisted
  // yet); in "edit" mode it's the real ProductMedia.id.
  key: string;
  type: "image" | "video";
  url: string;
  uploading?: boolean;
  error?: string;
};

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
  initialMedia?: { id: string; type: "image" | "video"; url: string }[];
  // Step 50: lets the enclosing form (create mode only — see
  // page.tsx/ActionForm's `disabled` prop) block submission while an
  // upload is still in flight. Without this, submitting mid-upload sends
  // the local `blob:` preview URL instead of the real Blob URL, which
  // validateMedia() now also rejects server-side — this callback exists
  // so the UI can prevent that submission from ever happening, rather
  // than round-tripping to the server just to show an error.
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const mode = productId ? "edit" : "create";
  const [items, setItems] = useState<MediaItem[]>(
    initialMedia.map((m) => ({ key: m.id, type: m.type, url: m.url })),
  );
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const imageCount = items.filter((i) => i.type === "image" && !i.error).length;
  const videoCount = items.filter((i) => i.type === "video" && !i.error).length;
  const totalCount = items.filter((i) => !i.error).length;
  const anyUploading = items.some((i) => i.uploading);

  useEffect(() => {
    onUploadingChange?.(anyUploading);
  }, [anyUploading, onUploadingChange]);

  function classifyFile(file: File): "image" | "video" | null {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) return "image";
    if (["video/mp4", "video/webm"].includes(file.type)) return "video";
    return null;
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
    const accepted: File[] = [];
    for (const file of files) {
      const kind = classifyFile(file);
      if (!kind) {
        setFormError(`${file.name}: unsupported file type.`);
        continue;
      }
      if (nextTotal >= MAX_MEDIA_ITEMS) {
        setFormError(`You can only add up to ${MAX_MEDIA_ITEMS} media items.`);
        break;
      }
      if (kind === "image" && nextImageCount >= MAX_IMAGES) {
        setFormError(`You can only add up to ${MAX_IMAGES} images.`);
        continue;
      }
      if (kind === "video" && nextVideoCount >= MAX_VIDEOS) {
        setFormError(`You can only add up to ${MAX_VIDEOS} videos.`);
        continue;
      }
      accepted.push(file);
      nextTotal++;
      if (kind === "image") nextImageCount++;
      else nextVideoCount++;
    }

    for (const file of accepted) {
      const key = `${file.name}-${crypto.randomUUID()}`;
      const kind = classifyFile(file) as "image" | "video";
      const objectUrl = URL.createObjectURL(file);
      setItems((prev) => [...prev, { key, type: kind, url: objectUrl, uploading: true }]);

      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadProductMediaAction(formData);

      if (!result.success) {
        setItems((prev) => prev.map((i) => (i.key === key ? { ...i, uploading: false, error: result.error } : i)));
        continue;
      }

      const uploaded = result.data;
      if (mode === "edit" && productId) {
        const addFormData = new FormData();
        addFormData.append("productId", productId);
        addFormData.append("media", JSON.stringify([{ url: uploaded.url, type: uploaded.type }]));
        const addResult = await addProductMediaAction(addFormData);
        if (!addResult.success) {
          setItems((prev) => prev.map((i) => (i.key === key ? { ...i, uploading: false, error: addResult.error } : i)));
          continue;
        }
        // addProductMediaAction already persisted the row and ran
        // revalidatePath() server-side. Swap the local placeholder's key
        // for the REAL ProductMedia.id it returned — remove/reorder calls
        // made later in this same session must target the real row, not
        // the client-generated placeholder key.
        const realId = addResult.data.ids[0];
        setItems((prev) => prev.map((i) => (i.key === key ? { key: realId, type: uploaded.type, url: uploaded.url } : i)));
      } else {
        setItems((prev) => prev.map((i) => (i.key === key ? { key, type: uploaded.type, url: uploaded.url } : i)));
      }
    }
  }

  async function handleRemove(item: MediaItem) {
    if (mode === "edit" && productId && !item.error) {
      const formData = new FormData();
      formData.append("productId", productId);
      formData.append("mediaId", item.key);
      await removeProductMediaAction(null, formData);
    } else if (mode === "create" && !item.error && !item.uploading) {
      const formData = new FormData();
      formData.append("url", item.url);
      await deleteUploadedProductMediaAction(formData);
    }
    setItems((prev) => prev.filter((i) => i.key !== item.key));
  }

  async function persistReorder(next: MediaItem[]) {
    setItems(next);
    if (mode === "edit" && productId) {
      const formData = new FormData();
      formData.append("productId", productId);
      formData.append("orderedMediaIds", JSON.stringify(next.map((i) => i.key)));
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

  const validItems = items.filter((i) => !i.error);
  const mediaJson = JSON.stringify(validItems.map((i) => ({ url: i.url, type: i.type })));

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Product media</h4>
      <p className="text-xs text-muted-foreground">
        Upload up to {MAX_MEDIA_ITEMS} files — Max {MAX_IMAGES} images · Max {MAX_VIDEOS} videos
      </p>
      <p className="text-xs text-muted-foreground">
        Images: JPG, PNG, WebP (max 10MB) · Videos: MP4, WebM (max 100MB)
      </p>

      {/* Only meaningful in "create" mode — the enclosing <ActionForm>'s
          own submit reads this field. In "edit" mode each change is
          already persisted immediately, so this field is inert there. */}
      {mode === "create" && <input type="hidden" name="media" value={mediaJson} />}

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No media added yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item, index) => (
            <div key={item.key} className="relative flex h-20 w-20 flex-col items-center justify-center rounded-md border border-border">
              {item.type === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra, see ProductList.tsx
                <img src={item.url} alt="" className="h-full w-full rounded-md object-cover" />
              ) : (
                <div className="relative h-full w-full">
                  <video src={item.url} className="h-full w-full rounded-md object-cover" muted />
                  <span className="absolute inset-0 flex items-center justify-center text-lg text-white">▶</span>
                </div>
              )}
              {item.uploading && (
                <span className="absolute inset-0 flex items-center justify-center rounded-md bg-black/50 text-[10px] text-white">
                  Uploading…
                </span>
              )}
              {item.error && (
                <span className="absolute inset-0 flex items-center justify-center rounded-md bg-red-600/80 p-1 text-center text-[9px] text-white">
                  {item.error}
                </span>
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
      {anyUploading && <p className="text-xs text-muted-foreground">Uploading…</p>}

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
          e.target.value = "";
        }}
      />
    </div>
  );
}
