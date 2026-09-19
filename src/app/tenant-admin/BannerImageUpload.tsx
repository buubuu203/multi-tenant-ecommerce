"use client";

import { useRef, useState } from "react";
import { uploadBannerImageAction } from "./actions";

// Same imperative "upload immediately, hidden field carries the URL"
// pattern as BrandingUploadControls.tsx's logo/favicon uploads — the
// surrounding ActionForm never sees a raw File, only the resulting Blob
// URL, submitted alongside the banner's other text fields.
export function BannerImageUpload({ initialUrl }: { initialUrl?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(initialUrl ?? "");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    const result = await uploadBannerImageAction(formData);
    setUploading(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setUrl(result.data.url);
  }

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name="imageUrl" value={url} />
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra, see ProductList.tsx
        <img src={url} alt="" className="h-28 w-full rounded-md border border-border object-cover" />
      )}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-fit rounded-md border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-surface-muted disabled:opacity-50"
      >
        {uploading ? "Uploading…" : url ? "Replace image" : "Upload image"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          void handleUpload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <p className="text-xs text-muted-foreground">JPG, PNG, or WebP — max 8MB.</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!url && <p className="text-xs text-red-600">An image is required.</p>}
    </div>
  );
}
