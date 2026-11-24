import { MAX_BYTES, MAX_ROWS, parseCsv } from './product-csv';
import { MAX_PRODUCT_WEIGHT_GRAMS } from './product-weight';

/**
 * The product CSV contract: two formats, one parser, one set of rules.
 *
 * V1 (minimal): positional `name,price,weight_grams` with optional status.
 * Legacy V1 headers still parse, but cannot create a product until a weight
 * is supplied. V1 is create-only because it carries no stable identifier.
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
 *
 * `weight_grams` is required to create a product and optional for SKU-based
 * updates, where omission leaves the existing weight unchanged. `category`
 * (V2 only) is matched by NAME, not id — a CSV has no way to
 * carry a tenant's internal category uuid, and name is the only handle a
 * merchant has. A name that doesn't exist yet for this tenant is created
 * on the fly (applyProductCsv, inside the same transaction as the import);
 * this is deliberately looser than the manual product editor, where
 * categoryId must already exist. An empty cell behaves exactly like an
 * omitted description cell: "leave whatever this product already has
 * alone," never "clear it" — there is no way to blank a category via CSV.
 */

export const MAX_FIELD_LENGTH = 2000;

export type InventoryMode = 'set_on_hand' | 'adjust_on_hand';

/** One variant axis on a row, e.g. { name: "Color", value: "Red" }. */
export type RowOption = { name: string; value: string };

/** A validated row, before it is compared against the database. */
export type ParsedRow = {
  rowNumber: number;
  sku: string | null;
  name: string;
  price: number;
  weightGrams: number | null;
  status: 'draft' | 'active';
  description: string | null;
  category: string | null;
  onHand: number | null;
  inventoryMode: InventoryMode | null;
  /**
   * Groups rows into one product (buildImportPlan does the grouping and
   * cross-row validation — this contract only parses one row at a time).
   * Null means this row is its own single-row product, exactly like a
   * file that never uses this column at all.
   */
  productKey: string | null;
  option1: RowOption | null;
  option2: RowOption | null;
};

export type RowError = { rowNumber: number; message: string };

export type ParsedCsv = {
  format: 'v1-minimal' | 'v2-extended';
  rows: ParsedRow[];
  errors: RowError[];
  totalRows: number;
};

export type ParseFailure = { error: string };

const V1_WITH_STATUS = ['name', 'price', 'weight_grams', 'status'];
const V1_WITHOUT_STATUS = ['name', 'price', 'weight_grams'];
const LEGACY_V1_WITH_STATUS = ['name', 'price', 'status'];
const LEGACY_V1_WITHOUT_STATUS = ['name', 'price'];

/** Every column V2 understands. Anything else is rejected, never ignored. */
const V2_COLUMNS = [
  'sku',
  'name',
  'price',
  'weight_grams',
  'status',
  'description',
  'category',
  'on_hand',
  'inventory_mode',
  // Multi-variant products (Shopee/TikTok-style bulk import): rows sharing
  // the same product_key become ONE product with one ProductVariant per
  // row. option_name/option_value is the first variant axis (e.g.
  // "Color"/"Red"); option2_name/option2_value is an optional second axis
  // (e.g. "Size"/"L") — matching Shopee's own two-axis limit. See
  // buildImportPlan's grouping logic and docs/catalog-csv-import.md.
  'product_key',
  'option_name',
  'option_value',
  'option2_name',
  'option2_value',
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
  // "option" and "variant_label" remain unsupported column NAMES — the
  // real, supported columns are option_name/option_value (+ an optional
  // option2_name/option2_value), see V2_COLUMNS above.
  option: 'Use option_name and option_value (and optionally option2_name/option2_value) instead.',
  variant_label: 'Variant options cannot be imported from CSV. Use option_name and option_value instead.',
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

  // V1 first, preserving the historical positional format while allowing
  // new files to carry the required weight for newly created products.
  const v1WithStatus = matchesPositional(header, V1_WITH_STATUS);
  const v1WithoutStatus = matchesPositional(header, V1_WITHOUT_STATUS);
  if (v1WithStatus || v1WithoutStatus) {
    return parseV1(dataRows, v1WithStatus, true);
  }
  const legacyV1WithStatus = matchesPositional(header, LEGACY_V1_WITH_STATUS);
  const legacyV1WithoutStatus = matchesPositional(header, LEGACY_V1_WITHOUT_STATUS);
  if (legacyV1WithStatus || legacyV1WithoutStatus) {
    return parseV1(dataRows, legacyV1WithStatus, false);
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

function parseV1(dataRows: string[][], hasStatus: boolean, hasWeight: boolean): ParsedCsv {
  const expectedColumns = 2 + Number(hasWeight) + Number(hasStatus);
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
    const name = cols[0];
    const price = cols[1];
    const weightRaw = hasWeight ? cols[2] : '';
    const statusRaw = hasStatus ? cols[hasWeight ? 3 : 2] : '';
    if (
      pushFieldLengthErrors(
        rowNumber,
        { name, price, ...(hasWeight ? { weight_grams: weightRaw } : {}) },
        errors,
      )
    ) return;

    const core = validateCore(rowNumber, name, price, hasStatus ? statusRaw : '', errors);
    if (!core) return;
    const weightGrams = hasWeight ? parseInteger(weightRaw.trim()) : null;
    if (
      hasWeight &&
      (weightGrams === null || weightGrams <= 0 || weightGrams > MAX_PRODUCT_WEIGHT_GRAMS)
    ) {
      errors.push({
        rowNumber,
        message: 'weight_grams must be a positive whole number of grams within the supported range.',
      });
      return;
    }

    rows.push({
      rowNumber,
      sku: null, // V1 carries no identifier, so every row can only create.
      ...core,
      weightGrams,
      description: null,
      category: null,
      onHand: null,
      inventoryMode: null,
      productKey: null,
      option1: null,
      option2: null,
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
        `Unrecognized column "${unknown}". Use the simple format "name,price,weight_grams" ` +
        `or "name,price,weight_grams,status", ` +
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
    const weightColumnPresent = header.includes('weight_grams');
    const weightRaw = at(cols, 'weight_grams').trim();
    const statusRaw = at(cols, 'status');
    const description = at(cols, 'description');
    const category = at(cols, 'category');
    const onHandRaw = at(cols, 'on_hand').trim();
    const modeRaw = at(cols, 'inventory_mode').trim();
    const productKey = at(cols, 'product_key').trim();
    const option1NameRaw = at(cols, 'option_name').trim();
    const option1ValueRaw = at(cols, 'option_value').trim();
    const option2NameRaw = at(cols, 'option2_name').trim();
    const option2ValueRaw = at(cols, 'option2_value').trim();

    if (
      pushFieldLengthErrors(
        rowNumber,
        {
          sku,
          name,
          price: priceRaw,
          ...(weightColumnPresent ? { weight_grams: weightRaw } : {}),
          description,
          category,
          product_key: productKey,
          option_name: option1NameRaw,
          option_value: option1ValueRaw,
          option2_name: option2NameRaw,
          option2_value: option2ValueRaw,
        },
        errors,
      )
    ) {
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
    const weightGrams = weightColumnPresent ? parseInteger(weightRaw) : null;
    if (
      weightColumnPresent &&
      (weightGrams === null || weightGrams <= 0 || weightGrams > MAX_PRODUCT_WEIGHT_GRAMS)
    ) {
      errors.push({
        rowNumber,
        message: 'weight_grams must be a positive whole number of grams within the supported range.',
      });
      return;
    }

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

    // option_name/option_value must be given together, same for the
    // second axis; option2 requires option1 (an unnamed first axis makes
    // "second axis" meaningless). Cross-row consistency (every row in a
    // product_key group using the same axis names, no duplicate
    // combinations) is buildImportPlan's job, not this per-row parser's.
    if ((option1NameRaw === '') !== (option1ValueRaw === '')) {
      errors.push({
        rowNumber,
        message: 'option_name and option_value must be given together, or both left blank.',
      });
      return;
    }
    if ((option2NameRaw === '') !== (option2ValueRaw === '')) {
      errors.push({
        rowNumber,
        message: 'option2_name and option2_value must be given together, or both left blank.',
      });
      return;
    }
    if (option1NameRaw === '' && option2NameRaw !== '') {
      errors.push({
        rowNumber,
        message: 'option2_name requires option_name to be set on the same row.',
      });
      return;
    }
    const option1: RowOption | null = option1NameRaw ? { name: option1NameRaw, value: option1ValueRaw } : null;
    const option2: RowOption | null = option2NameRaw ? { name: option2NameRaw, value: option2ValueRaw } : null;

    rows.push({
      rowNumber,
      sku,
      ...core,
      weightGrams,
      description: description.trim() === '' ? null : description,
      category: category.trim() === '' ? null : category.trim(),
      onHand,
      inventoryMode,
      productKey: productKey === '' ? null : productKey,
      option1,
      option2,
    });
  });

  return { format: 'v2-extended', rows, errors, totalRows: dataRows.length };
}
