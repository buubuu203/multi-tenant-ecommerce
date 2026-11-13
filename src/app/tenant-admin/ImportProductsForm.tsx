'use client';

import { useId, useRef, useState } from 'react';
import type { ActionResult } from '@/lib/action-result';
import type { ImportOutcomeView, ImportPreview, PreviewRow } from '@/lib/product-csv-preview-types';
import { PREVIEW_DISPLAY_LIMIT } from '@/lib/product-csv-preview-types';

/**
 * Two-step CSV import: validate first, then confirm.
 *
 * Step A sends the file to a read-only server action that parses,
 * validates and classifies it without writing anything. Step B sends the
 * SAME FILE AGAIN to the unchanged import action.
 *
 * Why re-upload rather than hand the preview back to the server: the
 * preview object lives in the browser and is therefore untrusted. Nothing
 * in it is authority — not the counts, not the classifications. The import
 * re-reads and re-validates every row from the file itself. The only thing
 * carried across is the previewed file's fingerprint, which the server
 * recomputes purely to detect that the file changed in between.
 */

type Phase =
  | { kind: 'idle' }
  | { kind: 'selected' }
  | { kind: 'previewing' }
  | { kind: 'previewFailed'; error: string }
  | { kind: 'previewReady'; preview: ImportPreview }
  | { kind: 'importing'; preview: ImportPreview }
  | { kind: 'imported'; summary: ImportOutcomeView }
  | { kind: 'importFailed'; preview: ImportPreview; error: string };

const ACTION_LABEL: Record<PreviewRow['action'], string> = {
  create: 'Create',
  update: 'Update',
  unchanged: 'No change',
  conflict: 'Conflict — blocks import',
  invalid: 'Invalid — blocks import',
};

// Word + shape, never colour alone.
const ACTION_STYLE: Record<PreviewRow['action'], string> = {
  create:
    'border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-400',
  update:
    'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300',
  unchanged: 'border-border bg-surface-muted text-muted-foreground',
  conflict:
    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400',
  invalid:
    'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400',
};

function confirmLabel(preview: ImportPreview): string {
  const { create, update } = preview.counts;
  if (create > 0 && update > 0) {
    return `Import ${create} new and update ${update}`;
  }
  if (update > 0) return `Apply ${update} update${update === 1 ? '' : 's'}`;
  return `Import ${create} product${create === 1 ? '' : 's'}`;
}

export function ImportProductsForm({
  previewAction,
  importAction,
}: {
  previewAction: (
    prevState: ActionResult<ImportPreview> | null,
    formData: FormData,
  ) => Promise<ActionResult<ImportPreview>>;
  importAction: (
    prevState: ActionResult<ImportOutcomeView> | null,
    formData: FormData,
  ) => Promise<ActionResult<ImportOutcomeView>>;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const summaryId = useId();
  const tableId = useId();

  const busy = phase.kind === 'previewing' || phase.kind === 'importing';

  function reset() {
    setFile(null);
    setPhase({ kind: 'idle' });
    if (inputRef.current) inputRef.current.value = '';
  }

  async function runPreview() {
    if (!file) return;
    setPhase({ kind: 'previewing' });
    const data = new FormData();
    data.set('file', file);
    const result = await previewAction(null, data);
    if (!result.success) {
      setPhase({ kind: 'previewFailed', error: result.error });
      return;
    }
    setPhase({ kind: 'previewReady', preview: result.data });
  }

  async function runImport(preview: ImportPreview) {
    if (!file) return;
    setPhase({ kind: 'importing', preview });
    const data = new FormData();
    // The file itself, again — the server re-validates from these bytes.
    data.set('file', file);
    // Integrity only: lets the server reject a file swapped after preview.
    data.set('previewFingerprint', preview.fingerprint);
    const result = await importAction(null, data);
    if (!result.success) {
      setPhase({ kind: 'importFailed', preview, error: result.error });
      return;
    }
    setPhase({ kind: 'imported', summary: result.data });
  }

  const preview =
    phase.kind === 'previewReady' || phase.kind === 'importing' || phase.kind === 'importFailed'
      ? phase.preview
      : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Step 1 — choose a file. Hidden while a preview is on screen so the
          flow reads as one path rather than two competing forms. */}
      {phase.kind !== 'imported' && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm" htmlFor={`${summaryId}-file`}>
            Product CSV file
            <input
              id={`${summaryId}-file`}
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              className="text-sm"
              onChange={(event) => {
                const chosen = event.target.files?.[0] ?? null;
                setFile(chosen);
                setPhase(chosen ? { kind: 'selected' } : { kind: 'idle' });
              }}
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void runPreview()}
              disabled={!file || busy}
              className="w-fit rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-muted disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
            >
              {phase.kind === 'previewing' ? 'Checking…' : 'Preview import'}
            </button>
            {file && (
              <button
                type="button"
                onClick={reset}
                disabled={busy}
                className="w-fit rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              >
                Choose another file
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Nothing is written until you confirm. Previewing only validates the file.
          </p>
        </div>
      )}

      {phase.kind === 'previewing' && (
        <p role="status" className="text-sm text-muted-foreground">
          Checking the file…
        </p>
      )}

      {phase.kind === 'previewFailed' && (
        <p role="alert" className="text-sm text-red-600">
          {phase.error}
        </p>
      )}

      {preview && (
        <section
          aria-labelledby={summaryId}
          className="flex flex-col gap-3 border-t border-border pt-3"
        >
          <h4 id={summaryId} className="text-sm font-semibold tracking-tight">
            Preview — nothing has been imported yet
          </h4>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-5">
            <div>
              <dt className="text-muted-foreground">Rows in file</dt>
              <dd className="font-medium tabular-nums">{preview.totalRows}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Create</dt>
              <dd className="font-medium tabular-nums">{preview.counts.create}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Update</dt>
              <dd className="font-medium tabular-nums">{preview.counts.update}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">No change</dt>
              <dd className="font-medium tabular-nums">{preview.counts.unchanged}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Blocking</dt>
              <dd className="font-medium tabular-nums">
                {preview.counts.invalid + preview.counts.conflict}
              </dd>
            </div>
          </dl>

          {/* The import has no update path, so saying so is more honest than
              rendering two permanently-zero counters. */}
          <p className="text-xs text-muted-foreground">
            {preview.format === 'v1-minimal'
              ? 'This file uses the simple name,price format, which has no SKU and can only create products.'
              : 'Rows are matched to existing products by SKU. A new SKU creates; a known SKU updates.'}
            {preview.inventoryChanges > 0
              ? ` ${preview.inventoryChanges} stock change${preview.inventoryChanges === 1 ? '' : 's'} included.`
              : ''}
          </p>

          <p className="text-xs text-muted-foreground">
            The whole file is imported in one transaction: if any row fails, nothing is saved.
          </p>

          {preview.counts.invalid + preview.counts.conflict > 0 && (
            <p role="alert" className="text-xs text-red-700 dark:text-red-400">
              {preview.counts.invalid} invalid and {preview.counts.conflict} conflicting row
              {preview.counts.invalid + preview.counts.conflict === 1 ? '' : 's'} block this import.
              Nothing is imported until every row is valid — rows are never skipped silently.
            </p>
          )}

          <details className="group rounded-md border border-border">
            <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium marker:content-none">
              <span className="inline-flex items-center gap-1.5">
                <span className="text-muted-foreground transition-transform group-open:rotate-90">
                  ›
                </span>
                Row-by-row detail
              </span>
            </summary>
            <div id={tableId} className="overflow-x-auto px-3 pb-3">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="py-1.5 pr-2 font-medium">
                      Row
                    </th>
                    <th scope="col" className="py-1.5 pr-2 font-medium">
                      Name
                    </th>
                    <th scope="col" className="py-1.5 pr-2 font-medium">
                      SKU
                    </th>
                    <th scope="col" className="py-1.5 pr-2 font-medium">
                      Action
                    </th>
                    <th scope="col" className="py-1.5 font-medium">
                      Note
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.rowNumber} className="border-b border-border last:border-0">
                      <td className="py-1.5 pr-2 align-top tabular-nums">{row.rowNumber}</td>
                      <td className="py-1.5 pr-2 align-top break-words">{row.name || '—'}</td>
                      <td className="py-1.5 pr-2 align-top break-all">{row.sku ?? '—'}</td>
                      <td className="py-1.5 pr-2 align-top">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 font-medium whitespace-nowrap ${ACTION_STYLE[row.action]}`}
                        >
                          {ACTION_LABEL[row.action]}
                        </span>
                      </td>
                      <td className="py-1.5 align-top break-words text-muted-foreground">
                        {row.changes.length > 0
                          ? row.changes.map((c) => `${c.field}: ${c.from} → ${c.to}`).join('; ')
                          : (row.message ?? '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.truncated && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Showing the first {PREVIEW_DISPLAY_LIMIT} rows of {preview.totalRows}. The counts
                  above cover every row.
                </p>
              )}
            </div>
          </details>

          {!preview.importable ? (
            <p role="alert" className="text-sm text-red-600">
              No row in this file can be imported. Fix the errors above and preview again.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <button
                type="button"
                onClick={() => void runImport(preview)}
                disabled={busy}
                className="w-fit rounded-md bg-foreground px-3.5 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              >
                {phase.kind === 'importing' ? 'Importing…' : confirmLabel(preview)}
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={busy}
                className="w-fit rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-muted disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              >
                Choose another file
              </button>
            </div>
          )}
        </section>
      )}

      {phase.kind === 'importing' && (
        <p role="status" className="text-sm text-muted-foreground">
          Importing…
        </p>
      )}

      {phase.kind === 'importFailed' && (
        <p role="alert" className="text-sm text-red-600">
          {phase.error}
        </p>
      )}

      {phase.kind === 'imported' && (
        <div role="status" className="flex flex-col gap-2 border-t border-border pt-3 text-sm">
          <p>
            Imported successfully: {phase.summary.created} created, {phase.summary.updated} updated,{' '}
            {phase.summary.unchanged} unchanged
            {phase.summary.inventoryChanged > 0
              ? `, ${phase.summary.inventoryChanged} stock change${phase.summary.inventoryChanged === 1 ? '' : 's'}`
              : ''}
            .
          </p>

          <button
            type="button"
            onClick={reset}
            className="w-fit rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            Import another file
          </button>
        </div>
      )}
    </div>
  );
}
