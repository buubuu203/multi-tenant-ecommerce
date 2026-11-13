import { createHash } from 'node:crypto';
import { PREVIEW_DISPLAY_LIMIT } from './product-csv-preview-types';
import type { ImportPreview, PreviewRow } from './product-csv-preview-types';
import { planIsImportable, type ImportPlan } from './product-csv-plan';

/**
 * Turns an ImportPlan into the serializable shape the UI renders.
 *
 * Presentation only — every classification was decided by the pure plan
 * builder, from records resolved through the tenant-scoped client. This
 * module writes nothing and holds no database client.
 */

export {
  PREVIEW_DISPLAY_LIMIT,
  type PreviewAction,
  type PreviewChange,
  type PreviewRow,
  type ImportPreview,
  type ImportOutcomeView,
} from './product-csv-preview-types';

/** Stable identity of the source text, for stale-confirmation detection. */
export function csvFingerprint(csvText: string): string {
  return createHash('sha256').update(csvText, 'utf8').digest('hex');
}

export function toPreview(plan: ImportPlan, fingerprint: string): ImportPreview {
  const rows: PreviewRow[] = plan.rows.map((row) => ({
    rowNumber: row.rowNumber,
    action: row.action,
    sku: row.sku,
    name: row.name,
    changes: row.changes,
    message: row.message,
  }));

  const truncated = rows.length > PREVIEW_DISPLAY_LIMIT;

  return {
    format: plan.format,
    totalRows: plan.totalRows,
    counts: plan.counts,
    rows: truncated ? rows.slice(0, PREVIEW_DISPLAY_LIMIT) : rows,
    truncated,
    mutatingRows: plan.mutatingRows,
    inventoryChanges: plan.inventoryChanges,
    importable: planIsImportable(plan),
    fingerprint,
    atomic: true,
  };
}
