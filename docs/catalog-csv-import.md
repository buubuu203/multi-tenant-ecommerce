# Catalog CSV import contract

What the product CSV importer does, as implemented. Written from the code.

Source: `product-csv-contract.ts` (parse + validate), `product-csv-plan.ts`
(classify), `product-csv-apply.ts` (resolve + apply), `product-csv-preview.ts`
(view model), and `previewProductsImportAction` / `importProductsAction`.

## Two formats

### V1 — simple, unchanged, create-only

```csv
name,price,status
Sunrise Tote Bag,250000,active
```

Exactly `name,price` or `name,price,status`, **positional**. Carries no
identifier, so every row creates. Files that worked before still work.

### V2 — extended, keyed on SKU

Columns are **named and order-independent**. Using any column outside V1's
two shapes selects this format.

| Column           | Required                | Type                              | Create                | Update                                       |
| ---------------- | ----------------------- | --------------------------------- | --------------------- | -------------------------------------------- |
| `sku`            | **Yes**                 | text, unique per tenant           | Sets the variant SKU  | **The matching key**                         |
| `name`           | **Yes**                 | text, trimmed                     | `Product.name`        | Overwrites                                   |
| `price`          | **Yes**                 | whole VND, digits only            | Variant price         | Overwrites                                   |
| `status`         | No                      | `draft` \| `active`               | Default `draft`       | Overwrites                                   |
| `description`    | No                      | text                              | `Product.description` | Overwrites **only if the column is present** |
| `on_hand`        | No                      | whole number                      | Initial stock         | Changes stock per `inventory_mode`           |
| `inventory_mode` | Required with `on_hand` | `set_on_hand` \| `adjust_on_hand` | —                     | —                                            |

```csv
sku,name,price,status,on_hand,inventory_mode
TOTE-01,Sunrise Tote Bag,250000,active,24,set_on_hand
MUG-02,Ghế gỗ óc chó,120000,draft,-3,adjust_on_hand
```

Omitting `description` leaves existing text alone. Import never blanks a
field it does not carry.

## Matching and idempotency

**`sku` is the only matching key.** It is the only stable, tenant-scoped,
user-facing identifier in the schema — `ProductVariant @@unique([tenantId,
sku])`. `Product` has no slug or external key, only a UUID.

**Name is never an update key.** Names are neither unique nor stable.

| Situation                        | Result                               |
| -------------------------------- | ------------------------------------ |
| SKU not in this tenant           | `create`                             |
| SKU exists, some field differs   | `update`                             |
| SKU exists, nothing differs      | `unchanged`                          |
| Same SKU twice in one file       | `conflict` — blocks the import       |
| Row fails validation             | `invalid` — blocks the import        |
| SKU exists in **another** tenant | Invisible. Treated as `create` here. |
| V1 row (no SKU)                  | Always `create`                      |

Products created by V1 have a NULL SKU. PostgreSQL permits many NULLs
under a unique constraint, so those rows match nothing and can only ever
be added to — give a product a SKU in the editor to make it updatable.

**Re-importing the same file is a no-op.** Every row classifies as
`unchanged` and the import is refused rather than duplicating anything.

## Atomicity

**The whole import is one transaction** (`$transaction`, 120s timeout).
Product, variant and inventory writes commit together or none of them do.
A failure mid-file leaves nothing behind.

This changed. The previous importer created one product per row with no
transaction, so a failure left earlier rows imported. V1 files now get the
same all-or-nothing treatment — the format is untouched, the failure
behaviour is strictly safer.

**Invalid and conflicting rows block the entire import.** Nothing is
skipped silently. Fix the file and preview again.

Rollback is automatic and total. There is no partial-import state to undo.

## Inventory

Mode is explicit and never inferred:

- `set_on_hand` — absolute. The importer computes the delta from current stock.
- `adjust_on_hand` — a delta. Negative allowed; `0` is an error.

Both go through the existing `adjustInventoryOnHandInTx`, so the guard
that refuses to take `onHand` below what orders have reserved, or below
zero, applies unchanged. A violation fails the whole import.

**Reserved stock cannot be imported** — it belongs to orders. A
`reserved` / `stock_reserved` column is rejected with that reason.

Only the tenant's **default location** is used. A `location` column is
rejected.

## Not supported

Rejected with a specific reason, not silently ignored:

| Column                                                   | Why                                                                                                                                                                                                      |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image`, `image_url`, `media`                            | No safe remote-ingestion architecture exists. Building a URL downloader would be an SSRF surface. Upload images in the product editor, where the existing WebP pipeline and tenant-scoped storage apply. |
| `discount`, `discount_percent`                           | Would require inventing discount semantics the schema does not settle. Set discounts in the product editor.                                                                                              |
| `option`, `option_name`, `option_value`, `variant_label` | `combinationKey` is trigger-maintained and option linkage spans four tables. A subsystem, not a column. One product, one variant per row.                                                                |
| `reserved`, `stock_reserved`                             | Managed by orders.                                                                                                                                                                                       |
| `location`                                               | Only the default location is supported.                                                                                                                                                                  |

Multi-variant products therefore cannot be built by import. Create the
options in the editor; import can still update each variant's price and
stock by SKU.

## Limits

| Limit            | Value           |
| ---------------- | --------------- |
| File size        | 1 MB            |
| Data rows        | 500             |
| Any single field | 2000 characters |
| Transaction      | 120 seconds     |

Rows are 1-indexed including the header, so the first data row is row 2.

## Parsing and normalization

RFC4180-style: quoted fields, embedded commas and newlines, `""` escapes,
CRLF or LF, blank lines dropped. A UTF-8 BOM is stripped. Invalid UTF-8 is
rejected outright.

Normalization is minimal and deliberate:

- `name`, `sku`, `price`, `status` are trimmed.
- Empty `status` becomes `draft`.
- Empty `description` becomes null.
- Nothing else is altered. `=SUM(A1:A9)` is stored verbatim as a name —
  **formula escaping is an EXPORT concern** (`csv.ts`) protecting a
  spreadsheet that opens our output; it has no role on import, where no
  value reaches a formula evaluator.

## Preview and confirmation

Two steps. Preview is **read-only**: it parses, resolves existing SKUs
through the tenant-scoped client, and classifies. It holds no database
client in its pure modules and writes nothing — tested by snapshotting row
counts around it.

Confirmation **re-uploads the file** and re-plans from the text. No
preview object, count or classification is carried back as authority. A
sha256 of the previewed bytes travels with the confirmation purely so the
server can reject a file swapped in between. No CSV is stored anywhere.

Preview shows at most 50 rows with a truncation notice; the counts always
cover the whole file.

## Import result

Request-scoped only: created, updated, unchanged, inventory changes, and
the file hash. **There is no durable import history** — no import-session
table, no audit row, no way to look up a past import. Adding one would
need a migration, which this feature does not require. If operations need
an audit trail of who imported what and when, that is a separate change.

## Authorization

Both actions call `requireTenantAdmin()` before reading the file, and
`tenantId` comes only from that call — never from the form or the file.
No column can name a tenant, and existing records are resolved through
`getScopedDb(tenantId)`, so a CSV cannot read or write another tenant's
data.

## Known gaps

- No durable import history (above).
- No multi-variant / option import (above).
- No discount or media import (above).
- A preview can go stale if the catalog changes between preview and
  confirm. The import re-plans from scratch, so the _outcome_ is always
  correct; only the numbers the merchant was shown can be out of date.
- `set_on_hand` on a brand-new variant sets initial stock directly;
  `adjust_on_hand` on a new variant starts from 0.
