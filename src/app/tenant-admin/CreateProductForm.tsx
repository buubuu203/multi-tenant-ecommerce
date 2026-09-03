"use client";

import { useState } from "react";
import { ActionForm } from "@/components/ActionForm";
import { ProductMediaGallery } from "./ProductMediaGallery";
import { createProductAction } from "./actions";
import { PRODUCT_STATUSES } from "./product-status";
import { adminInputClassName, adminLabelClassName } from "./styles";

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
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-3 text-sm font-medium">Add a product</h3>
      <ActionForm
        action={createProductAction}
        submitLabel="Add product"
        className="flex max-w-md flex-col gap-3"
        disabled={uploading}
      >
        <label className={adminLabelClassName}>
          Name
          <input name="name" className={adminInputClassName} />
        </label>
        <label className={adminLabelClassName}>
          Price (VND)
          <input name="price" inputMode="numeric" className={adminInputClassName} />
        </label>
        <label className={adminLabelClassName}>
          Description (optional)
          <textarea name="description" rows={3} className={adminInputClassName} />
        </label>
        <ProductMediaGallery onUploadingChange={setUploading} />
        {uploading && <p className="text-xs text-muted-foreground">Waiting for media to finish uploading…</p>}
        <label className={adminLabelClassName}>
          Status
          <select name="status" defaultValue="draft" className={adminInputClassName}>
            {PRODUCT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      </ActionForm>
    </div>
  );
}
