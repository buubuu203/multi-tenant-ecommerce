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

/** Resolved, group-level fields for a brand-new multi-variant product — see buildImportPlan's grouping pass. Null for every other action. */
export type GroupPrimary = {
  name: string;
  weightGrams: number;
  status: 'draft' | 'active';
  description: string | null;
  category: string | null;
};

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
  /** The row's product_key, verbatim, when this row belongs to a multi-row variant group. Null for a plain single-row product. */
  groupKey: string | null;
  /**
   * Set only on a 'create' row that is part of a brand-new multi-variant
   * product group (product_key given, or a lone row with option_name set,
   * where zero SKUs in the group matched an existing product). Every row
   * in the same group carries the SAME object, so product-csv-apply.ts can
   * create the Product ONCE (on the first row of the group it processes)
   * and attach every row's own variant to it, instead of the
   * one-product-per-row path a plain 'create' still uses.
   */
  groupPrimary: GroupPrimary | null;
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

/** One entry per distinct existing product name (case/whitespace-folded), built once from the existing-variants snapshot. */
type ExistingNameIndex = Map<string, { sku: string; variant: ExistingVariant }>;

function buildExistingNameIndex(existing: ExistingIndex): ExistingNameIndex {
  const index: ExistingNameIndex = new Map();
  for (const [sku, variant] of existing.entries()) {
    const key = normalizeName(variant.productName);
    if (!index.has(key)) index.set(key, { sku, variant });
  }
  return index;
}

/** The exact diff/update logic a single matched (SKU-known) row has always used — extracted so a grouped row sharing an existing product can reuse it unchanged. */
function planUpdateRow(row: ParsedRow, match: ExistingVariant): PlannedRow {
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
    if (!noop) changes.push(inventory);
  }

  if (changes.length === 0) {
    return {
      rowNumber: row.rowNumber,
      action: 'unchanged',
      sku: row.sku,
      name: row.name,
      changes: [],
      message: 'Already matches this file.',
      target: { variantId: match.variantId, productId: match.productId },
      row,
      groupKey: row.productKey,
      groupPrimary: null,
    };
  }

  return {
    rowNumber: row.rowNumber,
    action: 'update',
    sku: row.sku,
    name: row.name,
    changes,
    message: null,
    target: { variantId: match.variantId, productId: match.productId },
    row,
    groupKey: row.productKey,
    groupPrimary: null,
  };
}

/** A single row with no product_key and no option1 — the plain, pre-existing single-SKU-per-product path, entirely unchanged in behavior. */
function planSingletonRow(
  row: ParsedRow,
  existing: ExistingIndex,
  existingNames: ExistingNameIndex,
  seenNewName: Map<string, number>,
): PlannedRow {
  const match = row.sku === null ? undefined : existing.get(row.sku);

  if (match) {
    return planUpdateRow(row, match);
  }

  // A row with no SKU match is about to CREATE a new product — reject it
  // as a duplicate if its name already belongs to an existing product, or
  // to another row earlier in this same file, rather than silently
  // creating a second product sharing that name.
  const nameKey = normalizeName(row.name);
  const existingByName = existingNames.get(nameKey);
  if (existingByName) {
    return {
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
      groupKey: null,
      groupPrimary: null,
    };
  }
  const firstNewNameRow = seenNewName.get(nameKey);
  if (firstNewNameRow !== undefined) {
    return {
      rowNumber: row.rowNumber,
      action: 'duplicate',
      sku: row.sku,
      name: row.name,
      changes: [],
      message: `Name "${row.name}" also appears on row ${firstNewNameRow}. Each new product needs a distinct name.`,
      target: null,
      row: null,
      groupKey: null,
      groupPrimary: null,
    };
  }
  seenNewName.set(nameKey, row.rowNumber);

  if (row.weightGrams === null) {
    return {
      rowNumber: row.rowNumber,
      action: 'invalid',
      sku: row.sku,
      name: row.name,
      changes: [],
      message: 'weight_grams is required when creating a product.',
      target: null,
      row: null,
      groupKey: null,
      groupPrimary: null,
    };
  }

  const inventory = describeInventory(row, null);
  return {
    rowNumber: row.rowNumber,
    action: 'create',
    sku: row.sku,
    name: row.name,
    changes: inventory ? [inventory] : [],
    message: null,
    target: null,
    row,
    groupKey: null,
    groupPrimary: null,
  };
}

/**
 * Every row in a >1-row variant group must set option_name/option_value
 * (how else would they be distinct variants of the same product?), all
 * rows must agree on the axis NAMEs, option2 must be all-or-nothing, and
 * no two rows may repeat the exact same combination. A lone row (its own
 * product_key, or no product_key at all) needs none of this — there is
 * nothing to compare it against.
 */
function validateGroupOptions(rows: ParsedRow[]): { error: string } | null {
  if (rows.length <= 1) return null;

  if (rows.some((r) => !r.option1)) {
    return {
      error:
        'Every row sharing this product_key needs option_name/option_value — that is how rows ' +
        'become distinct variants of the same product.',
    };
  }
  const option1Names = new Set(rows.map((r) => r.option1!.name));
  if (option1Names.size > 1) {
    return {
      error: `Rows sharing this product_key disagree on option_name: ${[...option1Names].join(', ')}.`,
    };
  }
  const withOption2 = rows.filter((r) => r.option2).length;
  if (withOption2 !== 0 && withOption2 !== rows.length) {
    return {
      error: 'option2_name/option2_value must be given on every row of this product_key group, or on none of them.',
    };
  }
  if (withOption2 > 0) {
    const option2Names = new Set(rows.map((r) => r.option2!.name));
    if (option2Names.size > 1) {
      return {
        error: `Rows sharing this product_key disagree on option2_name: ${[...option2Names].join(', ')}.`,
      };
    }
  }
  const combos = new Set<string>();
  for (const r of rows) {
    const key = `${r.option1!.value.trim().toLowerCase()}\u0000${(r.option2?.value ?? '').trim().toLowerCase()}`;
    if (combos.has(key)) {
      return { error: 'This product_key group has two rows with the identical option combination.' };
    }
    combos.add(key);
  }
  return null;
}

/** Resolves the one set of product-level fields (name, weight, status, description, category) a brand-new group's rows must agree on. */
function resolveGroupPrimary(rows: ParsedRow[]): { primary: GroupPrimary } | { error: string } {
  let name: string | null = null;
  for (const r of rows) {
    const trimmed = r.name.trim();
    if (name === null) name = trimmed;
    else if (name !== trimmed) {
      return { error: `Rows sharing this product_key disagree on name ("${name}" vs "${trimmed}").` };
    }
  }

  let weightGrams: number | null = null;
  for (const r of rows) {
    if (r.weightGrams === null) continue;
    if (weightGrams === null) weightGrams = r.weightGrams;
    else if (weightGrams !== r.weightGrams) {
      return { error: `Rows sharing this product_key disagree on weight_grams (${weightGrams} vs ${r.weightGrams}).` };
    }
  }
  if (weightGrams === null) {
    return { error: 'weight_grams is required on at least one row when creating a product.' };
  }

  let status: 'draft' | 'active' | null = null;
  for (const r of rows) {
    if (status === null) status = r.status;
    else if (status !== r.status) {
      return { error: `Rows sharing this product_key disagree on status ("${status}" vs "${r.status}").` };
    }
  }

  let description: string | null = null;
  for (const r of rows) {
    if (r.description === null) continue;
    if (description === null) description = r.description;
    else if (description !== r.description) {
      return { error: 'Rows sharing this product_key disagree on description.' };
    }
  }

  let category: string | null = null;
  for (const r of rows) {
    if (r.category === null) continue;
    if (category === null) category = r.category;
    else if (category !== r.category) {
      return { error: 'Rows sharing this product_key disagree on category.' };
    }
  }

  return { primary: { name: name!, weightGrams, status: status!, description, category } };
}

function blockGroup(key: string | null, rows: ParsedRow[], action: 'invalid' | 'conflict' | 'duplicate', message: string): PlannedRow[] {
  return rows.map((r) => ({
    rowNumber: r.rowNumber,
    action,
    sku: r.sku,
    name: r.name,
    changes: [],
    message,
    target: null,
    row: null,
    groupKey: key,
    groupPrimary: null,
  }));
}

/** A group of >=1 rows sharing a product_key (or a lone row that set option_name without one). */
function planGroup(
  key: string | null,
  rows: ParsedRow[],
  existing: ExistingIndex,
  existingNames: ExistingNameIndex,
  seenNewName: Map<string, number>,
): PlannedRow[] {
  const optionError = validateGroupOptions(rows);
  if (optionError) return blockGroup(key, rows, 'invalid', optionError.error);

  // Resolve which existing product (if any) this group's SKUs already belong to.
  const matchedProductIds = new Set<string>();
  const matchesBySku = new Map<string, ExistingVariant>();
  for (const r of rows) {
    if (r.sku === null) continue;
    const m = existing.get(r.sku);
    if (m) {
      matchedProductIds.add(m.productId);
      matchesBySku.set(r.sku, m);
    }
  }

  if (matchedProductIds.size > 1) {
    return blockGroup(
      key,
      rows,
      'conflict',
      'These SKUs already belong to different existing products and cannot be imported as one product_key group.',
    );
  }

  if (matchedProductIds.size === 1) {
    // Updating an existing (possibly already multi-variant) product. Rows
    // with a matched SKU update exactly like a plain single-SKU row does.
    // An unmatched row would be a brand-new VARIANT of this existing
    // product — CSV import does not support that yet (see
    // docs/catalog-csv-import.md), so it's rejected rather than silently
    // creating a confusing second product.
    return rows.map((r) => {
      const match = r.sku !== null ? matchesBySku.get(r.sku) : undefined;
      if (!match) {
        return {
          rowNumber: r.rowNumber,
          action: 'duplicate' as const,
          sku: r.sku,
          name: r.name,
          changes: [],
          message:
            'This looks like a new variant for an existing product already matched by another row in ' +
            'this product_key group — adding a new variant to an already-existing product is not ' +
            'supported via CSV import yet. Add it in the product editor instead.',
          target: null,
          row: null,
          groupKey: key,
          groupPrimary: null,
        };
      }
      return planUpdateRow(r, match);
    });
  }

  // Brand new product: every SKU in the group is new.
  const primaryResult = resolveGroupPrimary(rows);
  if ('error' in primaryResult) return blockGroup(key, rows, 'invalid', primaryResult.error);
  const primary = primaryResult.primary;

  const nameKey = normalizeName(primary.name);
  const existingByName = existingNames.get(nameKey);
  if (existingByName) {
    return blockGroup(
      key,
      rows,
      'duplicate',
      `A product named "${existingByName.variant.productName}" already exists (SKU "${existingByName.sku}"). ` +
        `Use its existing SKU(s) to update it, or give this product a different name.`,
    );
  }
  const firstSeenNameRow = seenNewName.get(nameKey);
  if (firstSeenNameRow !== undefined) {
    return blockGroup(
      key,
      rows,
      'duplicate',
      `Name "${primary.name}" also appears on row ${firstSeenNameRow}. Each new product needs a distinct name.`,
    );
  }
  seenNewName.set(
    nameKey,
    rows.reduce((min, r) => Math.min(min, r.rowNumber), Infinity),
  );

  return rows.map((r) => {
    const inventory = describeInventory(r, null);
    return {
      rowNumber: r.rowNumber,
      action: 'create' as const,
      sku: r.sku,
      name: r.name,
      changes: inventory ? [inventory] : [],
      message: null,
      target: null,
      row: r,
      groupKey: key,
      groupPrimary: primary,
    };
  });
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
  let inventoryChanges = 0;

  const existingNames = buildExistingNameIndex(existing);
  const byRow = new Map<number, PlannedRow>();

  // Invalid rows the contract itself already rejected, first, so the plan
  // lists every row in file order even before this module's own checks run.
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
        groupKey: null,
        groupPrimary: null,
      });
    }
  }

  // Pass 1 — SKU uniqueness is file-wide and independent of any grouping:
  // a SKU repeated inside one file is ambiguous no matter which product_key
  // either copy carries. Rejected rather than letting the last one win.
  const seenSku = new Map<string, number>();
  const liveRows: ParsedRow[] = [];
  for (const row of parsed.rows) {
    if (row.sku !== null) {
      const firstSeen = seenSku.get(row.sku);
      if (firstSeen !== undefined) {
        byRow.set(row.rowNumber, {
          rowNumber: row.rowNumber,
          action: 'conflict',
          sku: row.sku,
          name: row.name,
          changes: [],
          message: `SKU "${row.sku}" also appears on row ${firstSeen}. Each SKU may appear once per file.`,
          target: null,
          row: null,
          groupKey: null,
          groupPrimary: null,
        });
        continue;
      }
      seenSku.set(row.sku, row.rowNumber);
    }
    liveRows.push(row);
  }

  // Pass 2 — partition into plain single-SKU rows (completely unaffected
  // by anything below — exactly today's pre-existing behavior) and
  // variant groups: rows sharing a product_key, or a lone row that set
  // option_name without one (a legitimate one-variant-with-a-known-option
  // product).
  const groupRows = new Map<string, ParsedRow[]>();
  const groupOrder: string[] = [];
  const singletons: ParsedRow[] = [];
  for (const row of liveRows) {
    if (row.productKey === null && row.option1 === null) {
      singletons.push(row);
      continue;
    }
    const key = row.productKey ?? `__solo_${row.rowNumber}`;
    const list = groupRows.get(key);
    if (list) {
      list.push(row);
    } else {
      groupRows.set(key, [row]);
      groupOrder.push(key);
    }
  }

  // Pass 3 — process every unit (singleton row or group) in ascending
  // order of its EARLIEST row number, so "first occurrence wins" duplicate
  // detection (seenNewName) stays deterministic and matches file order
  // regardless of whether a name was first claimed by a plain row or a
  // group.
  type Unit = { firstRow: number; produce: () => PlannedRow[] };
  const seenNewName = new Map<string, number>();
  const units: Unit[] = [
    ...singletons.map((row): Unit => ({
      firstRow: row.rowNumber,
      produce: () => [planSingletonRow(row, existing, existingNames, seenNewName)],
    })),
    ...groupOrder.map((key): Unit => {
      const rows = groupRows.get(key)!;
      return {
        firstRow: rows.reduce((min, r) => Math.min(min, r.rowNumber), Infinity),
        produce: () => planGroup(key.startsWith('__solo_') ? null : key, rows, existing, existingNames, seenNewName),
      };
    }),
  ];
  units.sort((a, b) => a.firstRow - b.firstRow);

  for (const unit of units) {
    for (const plannedRow of unit.produce()) {
      byRow.set(plannedRow.rowNumber, plannedRow);
    }
  }

  const planned: PlannedRow[] = [];
  for (const rowNumber of [...byRow.keys()].sort((a, b) => a - b)) {
    const entry = byRow.get(rowNumber);
    if (!entry) continue;
    planned.push(entry);
    counts[entry.action] += 1;
    if (entry.changes.some((c) => c.field === 'on_hand')) inventoryChanges += 1;
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
