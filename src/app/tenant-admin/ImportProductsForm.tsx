'use client';

import { useActionState } from 'react';
import type { ActionResult } from '@/lib/action-result';
import type { ImportSummary } from '@/lib/product-csv';

// Not reusing the shared ActionForm here: ActionForm only renders inline
// error text on failure, with no way to render structured success detail
// (total/imported/failed/per-row reasons). Rather than change the shared
// component's shape for every other form that uses it, this is a small,
// self-contained component for this one case. Same useActionState wiring,
// same ActionResult contract — no parallel error-handling architecture.
export function ImportProductsForm({
  action,
}: {
  action: (
    prevState: ActionResult<ImportSummary> | null,
    formData: FormData,
  ) => Promise<ActionResult<ImportSummary>>;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input
        type="file"
        name="file"
        accept=".csv,text/csv"
        required
        aria-label="Product CSV file"
        className="text-sm"
      />
      {/* Secondary treatment, matching ExportCsvButton: importing is a data
          chore, not the thing a merchant came to the catalog to do, and it
          must not read as visually equal to "Add a product". */}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-muted disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
      >
        {pending ? 'Importing…' : 'Import products'}
      </button>

      {state && !state.success && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      {state && state.success && (
        <div role="status" className="text-sm">
          <p>
            Imported {state.data.imported} of {state.data.totalRows} rows
            {state.data.failed > 0 ? ` (${state.data.failed} failed)` : ''}.
          </p>
          {state.data.failures.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-red-600">
              {state.data.failures.map((f) => (
                <li key={f.row}>
                  Row {f.row}: {f.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
