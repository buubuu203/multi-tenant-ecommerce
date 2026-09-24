"use client";

import { useRef, useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import { showToast } from "@/components/Toast";
import { ImageCropModal } from "./ImageCropModal";

// Client-side-only pre-check, mirroring blob-storage.ts's BANNER_MIME_TYPES
// / MAX_BANNER_IMAGE_BYTES — an early, friendly rejection before spending
// effort opening the crop UI. This is NOT the security boundary: the
// cropped output still goes through uploadBannerImageFile()'s own
// server-side validation regardless of what happens here.
const ACCEPTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_INPUT_BYTES = 8 * 1024 * 1024;

// Same imperative "upload immediately, hidden field carries the URL"
// pattern as BrandingUploadControls.tsx's logo/favicon uploads — the
// surrounding ActionForm never sees a raw File, only the resulting Blob
// URL, submitted alongside the banner's other fields. Reused for both the
// desktop (required) and mobile (optional) image slots via `action`/
// `fieldName` — the two slots differ only in which upload action they
// call, which crop aspect ratio they enforce, and whether an empty result
// is a valid, submittable state.
//
// Crop-before-upload (V1): selecting a file opens ImageCropModal instead
// of uploading immediately — only the CROPPED output (a JPEG Blob) is
// ever sent to uploadBannerImageAction/uploadBannerMobileImageAction.
// Canceling the crop discards the selected file entirely; nothing is
// uploaded, matching "do not upload the original before crop
// confirmation."
export function BannerImageUpload({
  fieldName,
  action,
  aspectRatio,
  outputWidth,
  initialUrl,
  label,
  helpText,
  required = false,
  removable = false,
}: {
  fieldName: string;
  action: (formData: FormData) => Promise<ActionResult<{ url: string }>>;
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
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingCropFile, setPendingCropFile] = useState<File | null>(null);

  async function uploadCroppedBlob(blob: Blob) {
    setError(null);
    setUploading(true);
    const croppedFile = new File([blob], "crop.jpg", { type: "image/jpeg" });
    const formData = new FormData();
    formData.append("file", croppedFile);
    const result = await action(formData);
    setUploading(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setUrl(result.data.url);
    showToast(`${label} uploaded — click Save to apply.`, "success");
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input type="hidden" name={fieldName} value={url} />
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra, see ProductList.tsx
        <img src={url} alt="" className="h-24 w-full rounded-md border border-border object-cover" />
      ) : (
        <div className="flex h-24 w-full items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
          No image
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-fit rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-surface-muted disabled:opacity-50"
        >
          {uploading ? "Uploading…" : url ? "Replace" : "Upload"}
        </button>
        {removable && url && (
          <button
            type="button"
            onClick={() => {
              setUrl("");
              showToast(`${label} removed — click Save to apply.`, "success");
            }}
            className="w-fit rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-muted"
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
            setError("Unsupported image type. Use JPG, PNG, or WebP.");
            return;
          }
          if (file.size > MAX_INPUT_BYTES) {
            setError("Image exceeds the 8MB limit.");
            return;
          }
          setPendingCropFile(file);
        }}
      />
      <p className="text-xs text-muted-foreground">{helpText}</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {required && !url && <p className="text-xs text-red-600">An image is required.</p>}

      {pendingCropFile && (
        <ImageCropModal
          file={pendingCropFile}
          aspectRatio={aspectRatio}
          outputWidth={outputWidth}
          onCancel={() => setPendingCropFile(null)}
          onConfirm={(blob) => {
            setPendingCropFile(null);
            void uploadCroppedBlob(blob);
          }}
        />
      )}
    </div>
  );
}
