/**
 * The shapes and constants the import-preview UI needs.
 *
 * Deliberately separate from product-csv-preview.ts, which is server-only:
 * that module imports node:crypto and the product validator, and the
 * validator transitively reaches Prisma and sharp. A Client Component that
 * imported a runtime value from it would drag that whole graph into the
 * browser bundle — which is exactly what happened, and what this file
 * prevents. Nothing here may import anything server-side.
 */

/** How many rows the UI renders. Counts in the preview are always complete. */
export const PREVIEW_DISPLAY_LIMIT = 50;

export type PreviewAction = 'create' | 'conflict' | 'invalid';

export type PreviewRow = {
  /** 1-indexed line in the file, counting the header — matches the importer. */
  rowNumber: number;
  action: PreviewAction;
  name: string;
  price: string;
  status: string;
  /** Why the row is invalid, or why it conflicts. */
  message: string | null;
};

export type ImportPreview = {
  totalRows: number;
  counts: {
    create: number;
    conflict: number;
    invalid: number;
    /** Always 0: the importer has no update path. */
    update: number;
    /** Always 0, for the same reason. */
    unchanged: number;
  };
  rows: PreviewRow[];
  /** True when `rows` was cut to PREVIEW_DISPLAY_LIMIT; counts stay exact. */
  truncated: boolean;
  /** Rows that would be sent to createProduct(): create + conflict. */
  importableRows: number;
  /** sha256 of the exact bytes previewed, so confirmation can detect a swap. */
  fingerprint: string;
  /** Stated in the UI so no one reads atomicity into a partial import. */
  atomic: false;
};

export type PreviewFailure = { error: string };
