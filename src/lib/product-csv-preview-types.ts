/**
 * Shapes the import UI needs, kept free of server-only imports.
 *
 * Separate from the server modules on purpose: those reach Prisma and
 * sharp through the product validator, and a Client Component importing a
 * runtime value from them drags that whole graph into the browser bundle.
 * Nothing here may import anything server-side.
 */

/** How many rows the UI renders. Counts are always complete. */
export const PREVIEW_DISPLAY_LIMIT = 50;

export type PreviewAction = 'create' | 'update' | 'unchanged' | 'conflict' | 'invalid';

export type PreviewChange = { field: string; from: string; to: string };

export type PreviewRow = {
  /** 1-indexed line in the file, counting the header. */
  rowNumber: number;
  action: PreviewAction;
  sku: string | null;
  name: string;
  /** Field-level diff for an update. Empty otherwise. */
  changes: PreviewChange[];
  message: string | null;
};

export type ImportPreview = {
  /** Which CSV contract this file used. */
  format: 'v1-minimal' | 'v2-extended';
  totalRows: number;
  counts: Record<PreviewAction, number>;
  rows: PreviewRow[];
  /** True when `rows` was capped; counts stay exact. */
  truncated: boolean;
  /** create + update. */
  mutatingRows: number;
  inventoryChanges: number;
  /** False when invalid/conflict rows exist, or nothing would change. */
  importable: boolean;
  /** sha256 of the exact bytes previewed, so confirm can detect a swap. */
  fingerprint: string;
  /** The import runs in one transaction. */
  atomic: true;
};

/** What the server reports after a confirmed import. */
export type ImportOutcomeView = {
  created: number;
  updated: number;
  unchanged: number;
  inventoryChanged: number;
  atomic: true;
  rolledBack: boolean;
  fileHash: string;
};
