"use client";

import { useRef, useState } from "react";
import { showToast } from "@/components/Toast";
import { ImageCropModal } from "./ImageCropModal";
import { compressImageInBrowser } from "@/lib/images/client-compress";

// Client-side-only pre-check, mirroring blob-storage.ts's BANNER_MIME_TYPES
// — an early, friendly rejection before spending effort opening the crop
// UI. This is NOT the security boundary: the compressed output still goes
// through the upload route's server-side validation regardless of what
// happens here.
const ACCEPTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// 10MB at SELECTION time — the server (blob-storage.ts's
// MAX_BANNER_IMAGE_BYTES) still caps at 4MB, a Vercel Functions platform
// limit that cannot be raised. The gap is closed by compressing the
// CROPPED output client-side (compressImageInBrowser) before it uploads —
// see uploadCroppedBlob below. Compression never re-crops; it only
// resizes/re-encodes within the aspect ratio the crop step already fixed.
const MAX_INPUT_BYTES = 10 * 1024 * 1024;

// Same imperative "upload immediately, hidden field carries the URL"
// pattern as BrandingUploadControls.tsx's logo/favicon uploads — the
// surrounding ActionForm never sees a raw File, only the resulting Blob
// URL, submitted alongside the banner's other fields. Reused for both the
// desktop (required) and mobile (optional) image slots via `variant`/
// `fieldName` — both slots use the same crop ratio; only their output
// width and whether an empty result is valid differ.
//
// Crop-before-upload: selecting a file opens ImageCropModal instead of
// uploading immediately. Cropping itself is OPTIONAL (QA round,
// 2026-11-23) — the modal offers "Giữ nguyên ảnh gốc" alongside the crop
// confirm, so a photo that's already composed at some other ratio (e.g.
// 16:9 with text near the edges) never gets force-cropped and losing
// content; either choice still goes through compressImageInBrowser
// before upload. Canceling discards the selected file entirely; nothing
// is uploaded.
export function BannerImageUpload({
  fieldName,
  variant,
  aspectRatio,
  outputWidth,
  initialUrl,
  label,
  helpText,
  required = false,
  removable = false,
}: {
  fieldName: string;
  variant: "desktop" | "mobile";
  aspectRatio: number;
  outputWidth: number;
  initialUrl?: string;
  label: string;
  helpText: string;
  required?: boolean;
  removable?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(initialUrl ?? "");
  const [optimizing, setOptimizing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingCropFile, setPendingCropFile] = useState<File | null>(null);

  // `source` is either the cropped canvas output (Blob, already at the
  // recommended ratio) or the merchant's ORIGINAL file untouched (when
  // they chose "Giữ nguyên ảnh gốc" in the crop modal — see onSkip below).
  // Either way, compression only ever resizes/re-encodes — it never
  // crops — so an original uploaded this way keeps its real aspect ratio
  // and content exactly as selected, never losing anything to a forced
  // ratio.
  async function uploadImage(source: Blob) {
    setError(null);
    setOptimizing(true);
    const compressed = await compressImageInBrowser(
      source instanceof File ? source : new File([source], "banner-image", { type: source.type || "image/jpeg" }),
    );
    setOptimizing(false);
    if (!compressed.ok) {
      setError(compressed.error);
      return;
    }

    setUploading(true);
    try {
      const response = await fetch(`/tenant-admin/banners/upload?variant=${variant}`, {
        method: "POST",
        headers: { "Content-Type": compressed.file.type },
        body: compressed.file,
      });
      const result = (await response.json()) as
        | { success: true; data: { url: string } }
        | { success: false; error: string };
      if (!response.ok || !result.success) {
        setError(result.success ? "Banner upload failed. Please try again." : result.error);
        return;
      }
      setUrl(result.data.url);
      showToast(`${label} uploaded — click Save to apply.`, "success");
    } catch (uploadError) {
      console.error("Banner image upload failed:", uploadError);
      setError("Banner upload failed. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input type="hidden" name={fieldName} value={url} />
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra, see ProductList.tsx
        <img
          src={url}
          alt=""
          className="w-full rounded-md border border-border object-cover"
          style={{ aspectRatio }}
        />
      ) : (
        <div
          className="flex w-full items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground"
          style={{ aspectRatio }}
        >
          No image
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || optimizing}
          className="w-fit rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-surface-muted disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        >
          {optimizing ? "Đang tối ưu ảnh…" : uploading ? "Đang tải lên…" : url ? "Replace" : "Upload"}
        </button>
        {removable && url && (
          <button
            type="button"
            onClick={() => {
              setUrl("");
              showToast(`${label} removed — click Save to apply.`, "success");
            }}
            className="w-fit rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            Remove
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setError(null);
          if (!ACCEPTED_MIME_TYPES.has(file.type)) {
            setError("Định dạng ảnh không được hỗ trợ. Dùng JPG, PNG hoặc WebP.");
            return;
          }
          if (file.size > MAX_INPUT_BYTES) {
            setError("Ảnh vượt 10MB, vui lòng chọn ảnh nhỏ hơn.");
            return;
          }
          setPendingCropFile(file);
        }}
      />
      <p className="text-xs text-muted-foreground">{helpText}</p>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {required && !url && <p className="text-xs text-red-600">An image is required.</p>}

      {pendingCropFile && (
        <ImageCropModal
          file={pendingCropFile}
          aspectRatio={aspectRatio}
          outputWidth={outputWidth}
          onCancel={() => setPendingCropFile(null)}
          onConfirm={(blob) => {
            setPendingCropFile(null);
            void uploadImage(blob);
          }}
          onSkip={(file) => {
            setPendingCropFile(null);
            void uploadImage(file);
          }}
        />
      )}
    </div>
  );
}
