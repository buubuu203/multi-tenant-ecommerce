import { createProduct } from "./product-mutations";

const MAX_ROWS = 500;
const MAX_BYTES = 1024 * 1024; // 1 MB

const EXPECTED_HEADERS_WITH_STATUS = ["name", "price", "status"];
const EXPECTED_HEADERS_WITHOUT_STATUS = ["name", "price"];

export type ImportSummary = {
  totalRows: number;
  imported: number;
  failed: number;
  failures: { row: number; reason: string }[];
};

/**
 * Minimal RFC4180-style CSV parser: handles quoted fields (including
 * embedded commas, embedded newlines, and escaped "" quotes), not a naive
 * split(","). Normalizes CRLF/LF line endings.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-blank lines (a single empty field), which are common as
  // trailing/stray blank lines and not meaningful data rows.
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

function validateHeader(header: string[]): { hasStatus: boolean } | { error: string } {
  const normalized = header.map((h) => h.trim());
  if (normalized.length === EXPECTED_HEADERS_WITH_STATUS.length) {
    const matches = normalized.every((h, idx) => h === EXPECTED_HEADERS_WITH_STATUS[idx]);
    if (matches) return { hasStatus: true };
  }
  if (normalized.length === EXPECTED_HEADERS_WITHOUT_STATUS.length) {
    const matches = normalized.every((h, idx) => h === EXPECTED_HEADERS_WITHOUT_STATUS[idx]);
    if (matches) return { hasStatus: false };
  }
  return {
    error: `Unrecognized header. Expected exactly "name,price" or "name,price,status", got "${normalized.join(",")}".`,
  };
}

/**
 * Imports products from CSV text for the calling tenant. tenantId must be
 * the trusted value from requireTenantAdmin() — never accepted from the
 * file or form input. Each valid row is created independently via the
 * existing createProduct() (same validation, same getScopedDb(tenantId)
 * write path as manual single-product creation) — no new validation rules,
 * no transaction wrapping the whole file (deliberate, per the 4C-incident
 * lesson: no new atomicity mechanism to get wrong).
 */
export async function importProductsFromCsv(
  tenantId: string,
  csvText: string,
): Promise<{ success: true; data: ImportSummary } | { success: false; error: string }> {
  if (Buffer.byteLength(csvText, "utf8") > MAX_BYTES) {
    return { success: false, error: "File is too large. Maximum size is 1 MB." };
  }

  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return { success: false, error: "File is empty." };
  }

  const headerResult = validateHeader(rows[0]);
  if ("error" in headerResult) {
    return { success: false, error: headerResult.error };
  }
  const { hasStatus } = headerResult;

  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_ROWS) {
    return { success: false, error: `File has ${dataRows.length} data rows; maximum is ${MAX_ROWS}.` };
  }
  if (dataRows.length === 0) {
    return { success: false, error: "File has no data rows." };
  }

  const expectedColumns = hasStatus ? 3 : 2;
  const failures: { row: number; reason: string }[] = [];
  let imported = 0;

  for (let idx = 0; idx < dataRows.length; idx++) {
    const rowNumber = idx + 2; // +1 for header, +1 for 1-indexed rows
    const cols = dataRows[idx];

    if (cols.length !== expectedColumns) {
      failures.push({ row: rowNumber, reason: `Expected ${expectedColumns} columns, got ${cols.length}.` });
      continue;
    }

    const [name, price, statusRaw] = cols;
    const status = hasStatus ? statusRaw.trim() : "";

    const result = await createProduct(tenantId, {
      name,
      price,
      status: status === "" ? "draft" : status,
    });

    if (result.success) {
      imported += 1;
    } else {
      failures.push({ row: rowNumber, reason: result.error });
    }
  }

  return {
    success: true,
    data: {
      totalRows: dataRows.length,
      imported,
      failed: failures.length,
      failures,
    },
  };
}
