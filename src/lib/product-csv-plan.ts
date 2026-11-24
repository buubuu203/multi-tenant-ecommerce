import type { ParsedCsv, ParsedRow, RowError } from './product-csv-contract';

/**
 * Turns validated rows plus a snapshot of what already exists into a plan.
 *
 * Pure. It holds no database client, so it cannot write even by accident —
 * the caller reads the snapshot and passes it in. The same plan drives the
 * preview and the import, so what a merchant was shown is what runs.
 */

export type ExistingVariant = {
  variantId: string;
  productId: string;
  productName: string;
  price: number;
  weightGrams: number;
  status: 'draft' | 'active';
  description: string | null;
  category: string | null;
  onHand: number;
  reserved: number;
};

/** Keyed by SKU — the only stable tenant-scoped identifier in the schema. */
export type ExistingIndex = ReadonlyMap<string, ExistingVariant>;

export type RowAction = 'create' | 'update' | 'unchanged' | 'conflict' | 'duplicate' | 'invalid';

export type FieldChange = { field: string; from: string; to: string };

export type PlannedRow = {
  rowNumber: number;
  action: RowAction;
  sku: string | null;
  name: string;
  /** What will change, for the preview. Empty for create/unchanged/invalid. */
  changes: FieldChange[];
  message: string | null;
  /** Resolved target. Null for create, conflict and invalid. */
  target: { variantId: string; productId: string } | null;
  row: ParsedRow | null;
};

export type ImportPlan = {
  format: ParsedCsv['format'];
  totalRows: number;
  counts: Record<RowAction, number>;
  rows: PlannedRow[];
  /** Rows that will actually be written: create + update. */
  mutatingRows: number;
  /** Inventory deltas that will be applied, for the summary. */
  inventoryChanges: number;
};

/** Trims and case-folds a product name for duplicate comparison — "Áo Thun" and "áo thun " are the same product name to a merchant, even though they are different strings. */
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function describeInventory(row: ParsedRow, existing: ExistingVariant | null): FieldChange | null {
  if (row.onHand === null || row.inventoryMode === null) return null;

  if (row.inventoryMode === 'adjust_on_hand') {
    const from = existing ? String(existing.onHand) : '(new)';
    const to = existing ? String(existing.onHand + row.onHand) : String(row.onHand);
    return { field: 'on_hand', from, to: `${to} (${row.onHand > 0 ? '+' : ''}${row.onHand})` };
  }
  return {
    field: 'on_hand',
    from: existing ? String(existing.onHand) : '(new)',
    to: String(row.onHand),
  };
}

export function buildImportPlan(parsed: ParsedCsv, existing: ExistingIndex): ImportPlan {
  const counts: Record<RowAction, number> = {
    create: 0,
    update: 0,
    unchanged: 0,
    conflict: 0,
    duplicate: 0,
    invalid: 0,
  };
  const planned: PlannedRow[] = [];
  let inventoryChanges = 0;

  // One entry per distinct existing product name (case/whitespace-folded),
  // built once from the existing-variants snapshot — several SKUs can
  // belong to the same product, but a name only needs to be flagged once.
  // ExistingVariant carries no sku field of its own (it IS the value for
  // a given sku key in `existing`), so the key is captured alongside it
  // here for the duplicate message below.
  const existingNames = new Map<string, { sku: string; variant: ExistingVariant }>();
  for (const [sku, variant] of existing.entries()) {
    const key = normalizeName(variant.productName);
    if (!existingNames.has(key)) existingNames.set(key, { sku, variant });
  }

  // Invalid rows first, so the plan lists every row in file order.
  const byRow = new Map<number, PlannedRow>();
  for (const error of parsed.errors) {
    if (!byRow.has(error.rowNumber)) {
      byRow.set(error.rowNumber, {
        rowNumber: error.rowNumber,
        action: 'invalid',
        sku: null,
        name: '',
        changes: [],
        message: error.message,
        target: null,
        row: null,
      });
      counts.invalid += 1;
    }
  }

  const seenSku = new Map<string, number>();
  // Only names destined to CREATE a product are tracked here — an update
  // row (matched by SKU) renaming itself to something another row also
  // uses is a legitimate rename, not a duplicate-product risk, and is
  // already fully visible in that row's own 'name' field change.
  const seenNewName = new Map<string, number>();

  for (const row of parsed.rows) {
    // A SKU repeated inside one file is ambiguous: two rows claim the same
    // record. Rejected rather than letting the last one silently win.
    if (row.sku !== null) {
      const firstSeen = seenSku.get(row.sku);
      if (firstSeen !== undefined) {
        counts.conflict += 1;
        byRow.set(row.rowNumber, {
          rowNumber: row.rowNumber,
          action: 'conflict',
          sku: row.sku,
          name: row.name,
          changes: [],
          message: `SKU "${row.sku}" also appears on row ${firstSeen}. Each SKU may appear once per file.`,
          target: null,
          row: null,
        });
        continue;
      }
      seenSku.set(row.sku, row.rowNumber);
    }

    const match = row.sku === null ? undefined : existing.get(row.sku);

    if (!match) {
      // A row with no SKU match is about to CREATE a new product — reject
      // it as a duplicate if its name already belongs to an existing
      // product, or to another row earlier in this same file, rather than
      // silently creating a second product sharing that name.
      const nameKey = normalizeName(row.name);
      const existingByName = existingNames.get(nameKey);
      if (existingByName) {
        counts.duplicate += 1;
        byRow.set(row.rowNumber, {
          rowNumber: row.rowNumber,
          action: 'duplicate',
          sku: row.sku,
          name: row.name,
          changes: [],
          message:
            `A product named "${existingByName.variant.productName}" already exists ` +
            `(SKU "${existingByName.sku}"). Set sku to that SKU to update it, ` +
            `or give this row a different name to create a genuinely new product.`,
          target: null,
          row: null,
        });
        continue;
      }
      const firstNewNameRow = seenNewName.get(nameKey);
      if (firstNewNameRow !== undefined) {
        counts.duplicate += 1;
        byRow.set(row.rowNumber, {
          rowNumber: row.rowNumber,
          action: 'duplicate',
          sku: row.sku,
          name: row.name,
          changes: [],
          message: `Name "${row.name}" also appears on row ${firstNewNameRow}. Each new product needs a distinct name.`,
          target: null,
          row: null,
        });
        continue;
      }
      seenNewName.set(nameKey, row.rowNumber);

      if (row.weightGrams === null) {
        counts.invalid += 1;
        byRow.set(row.rowNumber, {
          rowNumber: row.rowNumber,
          action: 'invalid',
          sku: row.sku,
          name: row.name,
          changes: [],
          message: 'weight_grams is required when creating a product.',
          target: null,
          row: null,
        });
        continue;
      }
      counts.create += 1;
      const inventory = describeInventory(row, null);
      if (inventory) inventoryChanges += 1;
      byRow.set(row.rowNumber, {
        rowNumber: row.rowNumber,
        action: 'create',
        sku: row.sku,
        name: row.name,
        changes: inventory ? [inventory] : [],
        message: null,
        target: null,
        row,
      });
      continue;
    }

    const changes: FieldChange[] = [];
    if (match.productName !== row.name) {
      changes.push({ field: 'name', from: match.productName, to: row.name });
    }
    if (match.price !== row.price) {
      changes.push({ field: 'price', from: String(match.price), to: String(row.price) });
    }
    if (row.weightGrams !== null && match.weightGrams !== row.weightGrams) {
      changes.push({
        field: 'weight_grams',
        from: String(match.weightGrams),
        to: String(row.weightGrams),
      });
    }
    if (match.status !== row.status) {
      changes.push({ field: 'status', from: match.status, to: row.status });
    }
    // An omitted description column leaves the existing text alone rather
    // than blanking it — import must not delete content it never carried.
    if (row.description !== null && match.description !== row.description) {
      changes.push({
        field: 'description',
        from: match.description ?? '(none)',
        to: row.description,
      });
    }
    // Same rule as description: an empty/omitted category cell means
    // "leave it alone," never "clear it" — see product-csv-contract.ts.
    if (row.category !== null && match.category !== row.category) {
      changes.push({
        field: 'category',
        from: match.category ?? '(none)',
        to: row.category,
      });
    }

    const inventory = describeInventory(row, match);
    if (inventory) {
      const noop = row.inventoryMode === 'set_on_hand' && row.onHand === match.onHand;
      if (!noop) {
        changes.push(inventory);
        inventoryChanges += 1;
      }
    }

    if (changes.length === 0) {
      counts.unchanged += 1;
      byRow.set(row.rowNumber, {
        rowNumber: row.rowNumber,
        action: 'unchanged',
        sku: row.sku,
        name: row.name,
        changes: [],
        message: 'Already matches this file.',
        target: { variantId: match.variantId, productId: match.productId },
        row,
      });
      continue;
    }

    counts.update += 1;
    byRow.set(row.rowNumber, {
      rowNumber: row.rowNumber,
      action: 'update',
      sku: row.sku,
      name: row.name,
      changes,
      message: null,
      target: { variantId: match.variantId, productId: match.productId },
      row,
    });
  }

  for (const rowNumber of [...byRow.keys()].sort((a, b) => a - b)) {
    const entry = byRow.get(rowNumber);
    if (entry) planned.push(entry);
  }

  return {
    format: parsed.format,
    totalRows: parsed.totalRows,
    counts,
    rows: planned,
    mutatingRows: counts.create + counts.update,
    inventoryChanges,
  };
}

/** Row-level failures that must block the whole import, not just a row. */
export function planIsImportable(plan: ImportPlan): boolean {
  return (
    plan.counts.invalid === 0 &&
    plan.counts.conflict === 0 &&
    plan.counts.duplicate === 0 &&
    plan.mutatingRows > 0
  );
}

export type { ParsedRow, RowError };
