# Catalog CSV import contract

What the product CSV importer actually does, as implemented. Written from
the code, not from intent — several things here are likely to surprise.

Source: `src/lib/product-csv.ts`, `src/lib/product-csv-preview.ts`,
`importProductsAction` / `previewProductsImportAction` in
`src/app/tenant-admin/actions.ts`.

## The headline facts

1. **Import only ever CREATES.** Every data row calls `createProduct()`.
   Nothing is looked up, matched or updated.
2. **There is therefore no matching key.** Importing the same file twice
   creates two sets of products.
3. **It is not atomic.** Rows are created one at a time with no wrapping
   transaction. A failure partway through leaves earlier rows imported.
   This is deliberate — see the comment in `importProductsFromCsv`.
4. **The header must match exactly and positionally.** Column order is
   fixed; unknown, renamed, reordered, extra or duplicated columns reject
   the whole file.

## Columns

| Column   | Required | Type                   | Example         | Create behavior                                                                                                                                       | Update behavior                  |
| -------- | -------- | ---------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `name`   | Yes      | text, trimmed          | `Ghế gỗ óc chó` | Becomes `Product.name`. Blank after trimming → row fails with "Name is required."                                                                     | **None.** No update path exists. |
| `price`  | Yes      | whole VND, digits only | `1500000`       | Becomes the price of the product's single variant. Must match `^\d+$` and be a non-negative safe integer; `12.5`, `1,500`, `abc`, negatives all fail. | **None.**                        |
| `status` | No       | `draft` \| `active`    | `active`        | Becomes `Product.status`. Omitted column or empty value → `draft`. Any other value fails with "Status must be draft or active."                       | **None.**                        |

Accepted headers, exactly: `name,price` or `name,price,status`.

Not importable at all: SKU, inventory, discounts, media, variants, options,
description. Products arrive with one variant, no media, and whatever
inventory `createProduct()` provisions by default.

## Limits

| Limit       | Value | Error                                      |
| ----------- | ----- | ------------------------------------------ |
| File size   | 1 MB  | `File is too large. Maximum size is 1 MB.` |
| Data rows   | 500   | `File has N data rows; maximum is 500.`    |
| Empty file  | —     | `File is empty.`                           |
| Header only | —     | `File has no data rows.`                   |

Row numbers in errors are 1-indexed and count the header, so the first data
row is row 2.

## Parsing and normalization

RFC4180-style parser: quoted fields, embedded commas and newlines, and `""`
escapes are handled; CRLF and LF both work. Fully blank lines are dropped.

Normalization is limited and documented so nothing is silently rewritten:

- `name` is trimmed. Interior whitespace, punctuation and diacritics are
  preserved exactly — `Ghế gỗ óc chó` round-trips unchanged.
- `price` is trimmed before the digits-only check.
- `status` is trimmed; empty becomes `draft`.
- Nothing else is altered. A value like `=SUM(A1:A9)` is stored verbatim as
  a product name. **Formula escaping is an EXPORT concern** (`src/lib/csv.ts`)
  — it protects a spreadsheet opening our output, and has no role on import,
  where the value never reaches a formula evaluator.

## Preview

`previewProductsImportAction` validates and classifies without writing.

| Class       | Meaning                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create`    | Valid, and no name collision. Will create a product.                                                                                                    |
| `conflict`  | Valid, but the name matches an existing product or an earlier row in the same file. **Still creates** a separate product — it does not update or merge. |
| `invalid`   | Rejected. Not imported, and never silently skipped.                                                                                                     |
| `update`    | Always 0. The importer has no update path.                                                                                                              |
| `unchanged` | Always 0, for the same reason.                                                                                                                          |

Conflict matching is trim plus case folding. Nothing fuzzy, and it only
warns — it never changes what gets written.

The preview reuses `parseCsv`, `validateHeader` and `validateProductInput`
from the import path rather than copying the rules, so the two cannot
drift. It holds no database client; the action reads the tenant's own
product names through `getScopedDb(tenantId)` and passes them in, so a
conflict can never be raised against another tenant's catalog.

The UI renders at most 50 rows and says so; the counts always describe the
whole file.

## Confirmation

The preview object lives in the browser and is **not** authority — not its
counts, not its classifications. Confirming re-uploads the same file and
runs the unchanged import, which re-reads and re-validates every row.

A sha256 of the previewed bytes travels with the confirmation purely as an
integrity check: if the file changed in between, the import is refused with
"This file has changed since it was previewed." The field is optional, so
callers that omit it behave exactly as before.

No uploaded CSV is stored anywhere, temporarily or otherwise.

## Authorization

Both actions call `requireTenantAdmin()` before touching the file, and
`tenantId` comes only from that call — never from the form or the file.
There is no column by which a row could name a tenant, so a CSV cannot
reach another tenant's data.

## Known gaps

- No update/upsert path. Correcting an imported product means editing it in
  the catalog; re-importing duplicates it.
- No dry-run on the server beyond the preview, which is advisory.
- Partial import cannot be rolled back from the UI.
- Conflict detection compares names only, because name is the only
  identifying column the format carries.
