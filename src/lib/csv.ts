// Dependency-free CSV serialization, the counterpart to the RFC4180-style
// parser already in product-csv.ts. Pure and DOM-free so the escaping
// rules — which are the whole risk surface here — are unit-testable.

/** RFC4180 line ending. Excel on Windows needs CRLF to split rows reliably. */
const CRLF = "\r\n";

/**
 * UTF-8 byte order mark.
 *
 * Required, not optional, for this product: Excel on Windows still guesses
 * a legacy regional codepage for a BOM-less .csv, which turns every
 * Vietnamese diacritic into mojibake ("Túi" -> "TÃºi"). The BOM makes it
 * read the file as UTF-8. Harmless elsewhere — modern tools skip it.
 */
export const UTF8_BOM = "﻿";

/**
 * Cells whose first character makes a spreadsheet treat the value as a
 * formula rather than text. A product name like "=SUM(A1:A9)" or a note
 * starting with "+" would otherwise execute on open, which is the CSV
 * injection problem (OWASP calls it Formula Injection).
 */
const FORMULA_TRIGGERS = ["=", "+", "-", "@"];

/**
 * Control characters a spreadsheet may interpret as cell/row separators
 * even inside a quoted field. Prefixing is not enough for these.
 */
const RISKY_CONTROL = ["\t", "\r"];

/**
 * Escapes one cell.
 *
 * Two separate concerns, deliberately both applied:
 *
 *  1. CSV correctness — a field containing a comma, a quote, or a newline
 *     is wrapped in double quotes with internal quotes doubled, which is
 *     what the parser in product-csv.ts already expects on the way in.
 *
 *  2. Formula injection — a leading =, +, - or @ is neutralised by
 *     prefixing a single quote. The cell is then also quoted, so the
 *     prefix cannot itself be mistaken for data structure. The value is
 *     preserved for a human reader; it is not stripped or rejected,
 *     because a product legitimately named "-20% sale" must still export.
 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  let text = String(value);

  // Guard before quoting, so the decision is made on the real first
  // character rather than on a quote we added.
  const firstChar = text.charAt(0);
  const needsFormulaGuard =
    FORMULA_TRIGGERS.includes(firstChar) || RISKY_CONTROL.includes(firstChar);
  if (needsFormulaGuard) {
    text = `'${text}`;
  }

  const needsQuoting =
    needsFormulaGuard ||
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r");

  if (!needsQuoting) {
    return text;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * A full CSV document: BOM, header row, then data rows in the order given.
 *
 * Column order is the caller's array order and is never derived from
 * object key iteration, so it is stable across runs and across rows with
 * differing shapes.
 */
export function toCsv(headers: readonly string[], rows: readonly (string | number | null | undefined)[][]): string {
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(","));
  }
  // Trailing CRLF: a final newline is conventional and some parsers need
  // it to treat the last row as complete.
  return UTF8_BOM + lines.join(CRLF) + CRLF;
}

/**
 * A fixed, deterministic timestamp format for exported dates.
 *
 * ISO-8601 in UTC with seconds and no milliseconds. Deliberately NOT a
 * locale format: an export is machine-read as often as it is eyeballed,
 * and toLocaleString() would make the output depend on the server's
 * locale and timezone, so the same data could export differently on two
 * machines.
 */
export function formatCsvTimestamp(value: Date | null | undefined): string {
  if (!value) {
    return "";
  }
  return `${value.toISOString().slice(0, 19)}Z`;
}

/**
 * Whole-VND amounts as plain digits — no thousands separator, no currency
 * symbol, no .money formatting. A spreadsheet must be able to sum the
 * column, which "250.000 ₫" prevents.
 */
export function formatCsvAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "";
  }
  return String(Math.round(value));
}

/**
 * A safe download filename.
 *
 * Built entirely server-side from a fixed dataset label plus a timestamp.
 * `context` is sanitised down to [a-z0-9-] and truncated, so even if a
 * caller ever passes something user-influenced it cannot inject a path
 * separator, a quote, a CRLF into the Content-Disposition header, or a
 * leading dot. Never contains an id, a secret, or a hostname.
 */
export function csvFilename(dataset: string, context?: string | null): string {
  const safeDataset = dataset.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const stamp = new Date().toISOString().slice(0, 10);
  const safeContext = (context ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return safeContext
    ? `${safeDataset}-${safeContext}-${stamp}.csv`
    : `${safeDataset}-${stamp}.csv`;
}
