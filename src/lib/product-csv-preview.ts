import { createHash } from 'node:crypto';
import { MAX_BYTES, MAX_ROWS, parseCsv, validateHeader } from './product-csv';
import { validateProductInput } from './product-mutations';
import type { ImportPreview, PreviewFailure, PreviewRow } from './product-csv-preview-types';
import { PREVIEW_DISPLAY_LIMIT } from './product-csv-preview-types';

/**
 * Read-only preview of a product CSV import.
 *
 * Everything here is PURE: it parses, validates and classifies, and never
 * touches the database. The caller supplies the existing product names it
 * read separately, so this module has no way to mutate anything even by
 * accident.
 *
 * It reuses the importer's own parser and header check, and the identical
 * validateProductInput() that createProduct() runs, so a row the preview
 * calls valid is a row the importer will accept — no second copy of the
 * rules to drift.
 *
 * WHAT THE CURRENT IMPORT CONTRACT ACTUALLY IS, because the classification
 * follows from it rather than from what one might expect:
 *
 *   importProductsFromCsv() calls createProduct() for EVERY data row. It
 *   never looks up an existing product, so there is no matching key and no
 *   update path. Importing the same file twice creates duplicates. The
 *   classifications 'update' and 'unchanged' therefore cannot occur, and
 *   this module does not invent them — it reports them as zero.
 *
 *   A row whose name collides with an existing product, or with an earlier
 *   row in the same file, STILL CREATES a second product. That is existing
 *   behaviour and is not changed here. It is surfaced as a `conflict` so a
 *   merchant sees the duplicate coming instead of discovering it after.
 */

// Shapes and the display limit live in product-csv-preview-types.ts so the
// Client Component can import them without pulling this module's
// server-only dependencies into the browser bundle.
export {
  PREVIEW_DISPLAY_LIMIT,
  type PreviewAction,
  type PreviewRow,
  type ImportPreview,
  type PreviewFailure,
} from './product-csv-preview-types';

/** Stable identity of the source text, for stale-confirmation detection. */
export function csvFingerprint(csvText: string): string {
  return createHash('sha256').update(csvText, 'utf8').digest('hex');
}

/**
 * Name matching for conflict detection ONLY.
 *
 * Deliberately conservative: trim plus case folding, nothing fuzzy. It is
 * used to warn, never to decide what gets written — the importer still
 * creates the row either way — so a false positive costs a warning and a
 * false negative costs nothing that is not already today's behaviour.
 */
function conflictKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export function buildImportPreview(
  csvText: string,
  existingProductNames: readonly string[],
): ImportPreview | PreviewFailure {
  // Same guards, same order, same messages as importProductsFromCsv, so
  // the preview rejects exactly what the import would reject.
  if (Buffer.byteLength(csvText, 'utf8') > MAX_BYTES) {
    return { error: 'File is too large. Maximum size is 1 MB.' };
  }

  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return { error: 'File is empty.' };
  }

  const headerResult = validateHeader(rows[0]);
  if ('error' in headerResult) {
    return { error: headerResult.error };
  }
  const { hasStatus } = headerResult;

  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_ROWS) {
    return { error: `File has ${dataRows.length} data rows; maximum is ${MAX_ROWS}.` };
  }
  if (dataRows.length === 0) {
    return { error: 'File has no data rows.' };
  }

  const expectedColumns = hasStatus ? 3 : 2;
  const existing = new Set(existingProductNames.map(conflictKey));
  const seenInFile = new Set<string>();

  const previewRows: PreviewRow[] = [];
  let create = 0;
  let conflict = 0;
  let invalid = 0;

  for (let idx = 0; idx < dataRows.length; idx++) {
    const rowNumber = idx + 2; // +1 header, +1 for 1-indexed
    const cols = dataRows[idx];

    if (cols.length !== expectedColumns) {
      invalid += 1;
      previewRows.push({
        rowNumber,
        action: 'invalid',
        name: cols[0] ?? '',
        price: cols[1] ?? '',
        status: '',
        message: `Expected ${expectedColumns} columns, got ${cols.length}.`,
      });
      continue;
    }

    const [name, price, statusRaw] = cols;
    const status = hasStatus ? statusRaw.trim() : '';
    const effectiveStatus = status === '' ? 'draft' : status;

    // The importer's own validator, not a copy of its rules.
    const validated = validateProductInput({ name, price, status: effectiveStatus });
    if ('error' in validated) {
      invalid += 1;
      previewRows.push({
        rowNumber,
        action: 'invalid',
        name,
        price,
        status: effectiveStatus,
        message: validated.error,
      });
      continue;
    }

    const key = conflictKey(validated.name);
    const clashesWithExisting = existing.has(key);
    const clashesWithEarlierRow = seenInFile.has(key);
    seenInFile.add(key);

    if (clashesWithExisting || clashesWithEarlierRow) {
      conflict += 1;
      previewRows.push({
        rowNumber,
        action: 'conflict',
        name: validated.name,
        price: String(validated.price),
        status: validated.status,
        message: clashesWithEarlierRow
          ? 'Another row in this file has the same name. Import creates a separate product for each row — it does not merge them.'
          : 'A product with this name already exists. Import creates a second product — it does not update the existing one.',
      });
      continue;
    }

    create += 1;
    previewRows.push({
      rowNumber,
      action: 'create',
      name: validated.name,
      price: String(validated.price),
      status: validated.status,
      message: null,
    });
  }

  const truncated = previewRows.length > PREVIEW_DISPLAY_LIMIT;

  return {
    totalRows: dataRows.length,
    counts: { create, conflict, invalid, update: 0, unchanged: 0 },
    rows: truncated ? previewRows.slice(0, PREVIEW_DISPLAY_LIMIT) : previewRows,
    truncated,
    importableRows: create + conflict,
    fingerprint: csvFingerprint(csvText),
    atomic: false,
  };
}
