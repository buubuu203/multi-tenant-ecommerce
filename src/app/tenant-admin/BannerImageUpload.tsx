"use client";

import { useRef, useState } from "react";
import type { ActionResult } from "@/lib/action-result";

// Same imperative "upload immediately, hidden field carries the URL"
// pattern as BrandingUploadControls.tsx's logo/favicon uploads — the
// surrounding ActionForm never sees a raw File, only the resulting Blob
// URL, submitted alongside the banner's other fields. Reused for both the
// desktop (required) and mobile (optional) image slots via `action`/
// `fieldName` — the two slots differ only in which upload action they
// call and whether an empty result is a valid, submittable state.
export function BannerImageUpload({
  fieldName,
  action,
  initialUrl,
  label,
  helpText,
  required = false,
  removable = false,
}: {
  fieldName: string;
  action: (formData: FormData) => Promise<ActionResult<{ url: string }>>;
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

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    const result = await action(formData);
    setUploading(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setUrl(result.data.url);
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
            onClick={() => setUrl("")}
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
          void handleUpload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <p className="text-xs text-muted-foreground">{helpText}</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {required && !url && <p className="text-xs text-red-600">An image is required.</p>}
    </div>
  );
}
