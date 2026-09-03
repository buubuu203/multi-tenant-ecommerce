"use client";

import { useState } from "react";
import { ActionForm } from "@/components/ActionForm";
import { ProductMediaGallery } from "./ProductMediaGallery";
import { createProductAction } from "./actions";
import { PRODUCT_STATUSES } from "./product-status";

// Step 50: split out of page.tsx (a Server Component) purely so this piece
// can hold client state — whether ProductMediaGallery has an upload still
// in flight — and use it to disable ActionForm's Save button. Without
// this, submitting while an upload is pending sends the local `blob:`
// preview URL instead of the real Blob URL (validateMedia() now also
// rejects that server-side, but blocking submission here means the admin
// never sees the round-trip error at all).
export function CreateProductForm() {
  const [uploading, setUploading] = useState(false);

  return (
    <ActionForm
      action={createProductAction}
      submitLabel="Add product"
      className="flex max-w-md flex-col gap-2"
      disabled={uploading}
    >
      <label className="flex flex-col gap-1 text-sm">
        Name
        <input name="name" className="rounded border px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Price (VND)
        <input name="price" inputMode="numeric" className="rounded border px-2 py-1" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Description (optional)
        <textarea name="description" rows={3} className="rounded border px-2 py-1" />
      </label>
      <ProductMediaGallery onUploadingChange={setUploading} />
      {uploading && <p className="text-xs text-black/60 dark:text-white/60">Waiting for media to finish uploading…</p>}
      <label className="flex flex-col gap-1 text-sm">
        Status
        <select name="status" defaultValue="draft" className="rounded border px-2 py-1">
          {PRODUCT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
    </ActionForm>
  );
}
