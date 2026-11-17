'use client';

import { ConfirmActionForm } from '@/components/ConfirmActionForm';
import { deleteProductsAction } from './actions';

/**
 * Shared between this file and the Server Component catalog page: each
 * product's checkbox lives OUTSIDE this form's own DOM subtree (next to
 * that product's own per-row forms, which cannot nest inside this one),
 * and associates itself via the standard HTML `form` attribute instead.
 */
export const BULK_DELETE_PRODUCTS_FORM_ID = 'bulk-delete-products';

/**
 * The submit button and confirm() for batch product deletion.
 *
 * A Client Component for the same reason TenantStatusForm is one:
 * confirmMessage needs to read the submitted FormData (how many
 * checkboxes were actually checked) to word the dialog accurately, and a
 * plain closure cannot cross the Server Component boundary — only the
 * Server Action itself (deleteProductsAction) can.
 */
export function BulkDeleteProductsForm() {
  return (
    <ConfirmActionForm
      id={BULK_DELETE_PRODUCTS_FORM_ID}
      action={deleteProductsAction}
      submitLabel="Delete selected"
      variant="danger"
      successMessage="Selected products deleted."
      confirmMessage={(formData) => {
        const count = formData.getAll('productIds').length;
        if (count === 0) return 'Select at least one product below first.';
        return (
          `Delete ${count} selected product${count === 1 ? '' : 's'} permanently? ` +
          `This also removes their variants, media and stock. A product that has ever ` +
          `been ordered blocks the ENTIRE batch — nothing is deleted if even one is blocked.`
        );
      }}
    />
  );
}
