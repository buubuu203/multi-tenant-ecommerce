import { MAX_BYTES, MAX_ROWS, parseCsv } from './product-csv';

/**
 * The product CSV contract: two formats, one parser, one set of rules.
 *
 * V1 (minimal, unchanged): exactly `name,price` or `name,price,status`,
 * positional. Create-only, because it carries no stable identifier — this
 * is the historical format and it behaves exactly as it always has.
 *
 * V2 (extended): NAMED columns, order-independent, keyed on `sku`. A row
 * whose SKU already exists in this tenant updates that variant and its
 * product; a row whose SKU is new creates. This is what makes a repeated
 * import idempotent rather than duplicating the catalog.
 *
 * Why `sku` and nothing else: it is the only stable, tenant-scoped,
 * user-facing identifier the schema actually has
 * (ProductVariant @@unique([tenantId, sku])). Product has no slug and no
 * external key — only a UUID — so there is nothing else to match on.
 * Matching by NAME is deliberately not an update key: names are not
 * unique, not stable, and merchants rename things.
 */

export const MAX_FIELD_LENGTH = 2000;

export type InventoryMode = 'set_on_hand' | 'adjust_on_hand';

/** A validated row, before it is compared against the database. */
export type ParsedRow = {
  rowNumber: number;
  sku: string | null;
  name: string;
  price: number;
  status: 'draft' | 'active';
  description: string | null;
  onHand: number | null;
  inventoryMode: InventoryMode | null;
};

export type RowError = { rowNumber: number; message: string };

export type ParsedCsv = {
  format: 'v1-minimal' | 'v2-extended';
  rows: ParsedRow[];
  errors: RowError[];
  totalRows: number;
};

export type ParseFailure = { error: string };

const V1_WITH_STATUS = ['name', 'price', 'status'];
const V1_WITHOUT_STATUS = ['name', 'price'];

/** Every column V2 understands. Anything else is rejected, never ignored. */
const V2_COLUMNS = [
  'sku',
  'name',
  'price',
  'status',
  'description',
  'on_hand',
  'inventory_mode',
] as const;

const V2_REQUIRED = ['sku', 'name', 'price'] as const;

/**
 * Columns a merchant might reasonably expect, which this importer does NOT
 * support. Named explicitly so the error says "not supported" rather than
 * the generic "unknown column", which reads like a typo.
 */
const KNOWN_UNSUPPORTED: Record<string, string> = {
  image: 'Media cannot be imported from CSV. Upload images in the product editor.',
  image_url: 'Media cannot be imported from CSV. Upload images in the product editor.',
  images: 'Media cannot be imported from CSV. Upload images in the product editor.',
  media: 'Media cannot be imported from CSV. Upload images in the product editor.',
  discount: 'Discounts cannot be imported from CSV. Set them in the product editor.',
  discount_percent: 'Discounts cannot be imported from CSV. Set them in the product editor.',
  option: 'Variant options cannot be imported from CSV. Create them in the product editor.',
  option_name: 'Variant options cannot be imported from CSV. Create them in the product editor.',
  option_value: 'Variant options cannot be imported from CSV. Create them in the product editor.',
  variant_label: 'Variant options cannot be imported from CSV. Create them in the product editor.',
  reserved: 'Reserved stock is managed by orders and can never be imported.',
  stock_reserved: 'Reserved stock is managed by orders and can never be imported.',
  location: 'Only the default location is supported by import.',
};

/** Strips a UTF-8 BOM, which spreadsheet exports routinely prepend. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function matchesPositional(header: string[], expected: readonly string[]): boolean {
  return header.length === expected.length && header.every((column, i) => column === expected[i]);
}

function parseInteger(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Parses and validates the whole file. Pure: no database, no mutation.
 * Row-level problems become `errors`; file-level problems fail outright,
 * because a bad header makes every row meaningless.
 */
export function parseProductCsv(rawText: string): ParsedCsv | ParseFailure {
  const text = stripBom(rawText);

  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
    return { error: 'File is too large. Maximum size is 1 MB.' };
  }
  // A lone replacement character means the bytes were not valid UTF-8.
  if (text.includes('�')) {
    return { error: 'File is not valid UTF-8. Re-save it as UTF-8 and try again.' };
  }

  const grid = parseCsv(text);
  if (grid.length === 0) return { error: 'File is empty.' };

  const header = grid[0].map((column) => column.trim());
  const dataRows = grid.slice(1);

  if (dataRows.length > MAX_ROWS) {
    return { error: `File has ${dataRows.length} data rows; maximum is ${MAX_ROWS}.` };
  }
  if (dataRows.length === 0) return { error: 'File has no data rows.' };

  // V1 first, so the historical format keeps its exact behaviour.
  if (matchesPositional(header, V1_WITH_STATUS) || matchesPositional(header, V1_WITHOUT_STATUS)) {
    return parseV1(dataRows, header.length === 3);
  }

  return parseV2(header, dataRows);
}

function pushFieldLengthErrors(
  rowNumber: number,
  values: Record<string, string>,
  errors: RowError[],
): boolean {
  for (const [column, value] of Object.entries(values)) {
    if (value.length > MAX_FIELD_LENGTH) {
      errors.push({
        rowNumber,
        message: `Column "${column}" is ${value.length} characters; the maximum is ${MAX_FIELD_LENGTH}.`,
      });
      return true;
    }
  }
  return false;
}

function validateCore(
  rowNumber: number,
  name: string,
  priceRaw: string,
  statusRaw: string,
  errors: RowError[],
): { name: string; price: number; status: 'draft' | 'active' } | null {
  const trimmedName = name.trim();
  if (!trimmedName) {
    errors.push({ rowNumber, message: 'Name is required.' });
    return null;
  }

  const price = parseInteger(priceRaw);
  if (price === null || price < 0) {
    errors.push({
      rowNumber,
      message: 'Price must be a non-negative whole number of VND (no decimals).',
    });
    return null;
  }

  const status = statusRaw.trim() === '' ? 'draft' : statusRaw.trim();
  if (status !== 'draft' && status !== 'active') {
    errors.push({ rowNumber, message: 'Status must be draft or active.' });
    return null;
  }

  return { name: trimmedName, price, status };
}

function parseV1(dataRows: string[][], hasStatus: boolean): ParsedCsv {
  const expectedColumns = hasStatus ? 3 : 2;
  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];

  dataRows.forEach((cols, index) => {
    const rowNumber = index + 2;
    if (cols.length !== expectedColumns) {
      errors.push({
        rowNumber,
        message: `Expected ${expectedColumns} columns, got ${cols.length}.`,
      });
      return;
    }
    const [name, price, statusRaw = ''] = cols;
    if (pushFieldLengthErrors(rowNumber, { name, price }, errors)) return;

    const core = validateCore(rowNumber, name, price, hasStatus ? statusRaw : '', errors);
    if (!core) return;

    rows.push({
      rowNumber,
      sku: null, // V1 carries no identifier, so every row can only create.
      ...core,
      description: null,
      onHand: null,
      inventoryMode: null,
    });
  });

  return { format: 'v1-minimal', rows, errors, totalRows: dataRows.length };
}

function parseV2(header: string[], dataRows: string[][]): ParsedCsv | ParseFailure {
  const seen = new Set<string>();
  for (const column of header) {
    if (seen.has(column)) {
      return { error: `Duplicate column "${column}". Each column may appear only once.` };
    }
    seen.add(column);
  }

  const unsupported = header.find((column) => KNOWN_UNSUPPORTED[column]);
  if (unsupported) {
    return { error: `Column "${unsupported}" is not supported. ${KNOWN_UNSUPPORTED[unsupported]}` };
  }

  const unknown = header.find((column) => !(V2_COLUMNS as readonly string[]).includes(column));
  if (unknown) {
    return {
      error:
        `Unrecognized column "${unknown}". Use the simple format "name,price" or "name,price,status", ` +
        `or the extended format with any of: ${V2_COLUMNS.join(', ')}.`,
    };
  }

  const missing = V2_REQUIRED.filter((column) => !seen.has(column));
  if (missing.length > 0) {
    return {
      error: `The extended format requires ${V2_REQUIRED.join(', ')}. Missing: ${missing.join(', ')}.`,
    };
  }

  const indexOf = (column: string): number => header.indexOf(column);
  const at = (cols: string[], column: string): string => {
    const i = indexOf(column);
    return i === -1 ? '' : (cols[i] ?? '');
  };

  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];

  dataRows.forEach((cols, index) => {
    const rowNumber = index + 2;
    if (cols.length !== header.length) {
      errors.push({
        rowNumber,
        message: `Expected ${header.length} columns, got ${cols.length}.`,
      });
      return;
    }

    const sku = at(cols, 'sku').trim();
    const name = at(cols, 'name');
    const priceRaw = at(cols, 'price');
    const statusRaw = at(cols, 'status');
    const description = at(cols, 'description');
    const onHandRaw = at(cols, 'on_hand').trim();
    const modeRaw = at(cols, 'inventory_mode').trim();

    if (pushFieldLengthErrors(rowNumber, { sku, name, price: priceRaw, description }, errors)) {
      return;
    }

    if (!sku) {
      errors.push({
        rowNumber,
        message:
          'sku is required in the extended format — it is how a row is matched to a product.',
      });
      return;
    }
    if (/[\u0000-\u001f]/.test(sku)) {
      errors.push({ rowNumber, message: 'sku contains control characters.' });
      return;
    }

    const core = validateCore(rowNumber, name, priceRaw, statusRaw, errors);
    if (!core) return;

    let onHand: number | null = null;
    let inventoryMode: InventoryMode | null = null;

    if (onHandRaw !== '') {
      const parsed = parseInteger(onHandRaw);
      if (parsed === null) {
        errors.push({ rowNumber, message: 'on_hand must be a whole number.' });
        return;
      }
      if (modeRaw === '') {
        errors.push({
          rowNumber,
          message:
            'inventory_mode is required when on_hand is given. Use set_on_hand (an absolute value) or adjust_on_hand (a delta).',
        });
        return;
      }
      if (modeRaw !== 'set_on_hand' && modeRaw !== 'adjust_on_hand') {
        errors.push({
          rowNumber,
          message: 'inventory_mode must be set_on_hand or adjust_on_hand.',
        });
        return;
      }
      if (modeRaw === 'set_on_hand' && parsed < 0) {
        errors.push({
          rowNumber,
          message: 'on_hand cannot be negative when setting an absolute value.',
        });
        return;
      }
      if (modeRaw === 'adjust_on_hand' && parsed === 0) {
        errors.push({
          rowNumber,
          message: 'An adjustment of 0 does nothing. Leave on_hand blank instead.',
        });
        return;
      }
      onHand = parsed;
      inventoryMode = modeRaw;
    } else if (modeRaw !== '') {
      errors.push({ rowNumber, message: 'inventory_mode was given without on_hand.' });
      return;
    }

    rows.push({
      rowNumber,
      sku,
      ...core,
      description: description.trim() === '' ? null : description,
      onHand,
      inventoryMode,
    });
  });

  return { format: 'v2-extended', rows, errors, totalRows: dataRows.length };
}
