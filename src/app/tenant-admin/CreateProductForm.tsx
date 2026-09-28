"use client";

import { useState } from "react";
import { ActionForm } from "@/components/ActionForm";
import { ProductMediaGallery } from "./ProductMediaGallery";
import { DescriptionEditor } from "./DescriptionEditor";
import { createProductAction } from "./actions";
import { PRODUCT_STATUSES } from "./product-status";
import {
  productInputClassName,
  productLabelClassName,
  productFieldGroupClassName,
  productSectionHeadingClassName,
} from "./styles";

// Step 50 (revised): now rendered on its own page
// (/tenant-admin/products/new) rather than inline on the dashboard, so it
// can afford the more spacious, grouped-by-section layout below — holds
// client state for whether ProductMediaGallery has an upload still in
// flight, used to disable ActionForm's Save button. Without this,
// submitting while an upload is pending sends the local `blob:` preview
// URL instead of the real Blob URL (validateMedia() now also rejects that
// server-side, but blocking submission here means the admin never sees
// the round-trip error at all).
export function CreateProductForm() {
  const [uploading, setUploading] = useState(false);

  return (
    <ActionForm
      action={createProductAction}
      submitLabel="Add product"
      successMessage="Product created."
      className="flex max-w-3xl flex-col gap-6"
      disabled={uploading}
    >
      <div className={productFieldGroupClassName}>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Catalog</p>
          <h2 className={productSectionHeadingClassName}>Basic info</h2>
        </div>
        <label className={productLabelClassName}>
          Name
          <input name="name" className={productInputClassName} />
        </label>
        <label className={productLabelClassName}>
          Price (VND)
          <input name="price" inputMode="numeric" className={productInputClassName} />
        </label>
      </div>

      <div className={productFieldGroupClassName}>
        <h2 className={productSectionHeadingClassName}>Description</h2>
        <label className={productLabelClassName}>
          Optional — supports Markdown formatting
          <DescriptionEditor />
        </label>
      </div>

      <div className={productFieldGroupClassName}>
        <h2 className={productSectionHeadingClassName}>Media</h2>
        <ProductMediaGallery onUploadingChange={setUploading} />
        {uploading && <p className="text-sm text-muted-foreground">Waiting for media to finish uploading…</p>}
      </div>

      <div className={productFieldGroupClassName}>
        <h2 className={productSectionHeadingClassName}>Status</h2>
        <label className={productLabelClassName}>
          Visibility
          <select name="status" defaultValue="draft" className={productInputClassName}>
            {PRODUCT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      </div>
    </ActionForm>
  );
}
