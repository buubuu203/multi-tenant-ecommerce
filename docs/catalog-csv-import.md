# Catalog CSV import contract

What the product CSV importer does, as implemented. Written from the code.

Source: `product-csv-contract.ts` (parse + validate), `product-csv-plan.ts`
(classify), `product-csv-apply.ts` (resolve + apply), `product-csv-preview.ts`
(view model), and `previewProductsImportAction` / `importProductsAction`.

## Two formats

### V1 — simple, create-only

```csv
name,price,weight_grams,status
Sunrise Tote Bag,250000,350,active
```

Columns are positional. Legacy `name,price` and `name,price,status`
headers still parse for compatibility, but rows without a weight are
blocked from creation until `weight_grams` is supplied.

### V2 — extended, keyed on SKU

Columns are **named and order-independent**. Using any column outside V1's
two shapes selects this format.

| Column           | Required                | Type                              | Create                | Update                                       |
| ---------------- | ----------------------- | --------------------------------- | --------------------- | -------------------------------------------- |
| `sku`            | **Yes**                 | text, unique per tenant           | Sets the variant SKU  | **The matching key**                         |
| `name`           | **Yes**                 | text, trimmed                     | `Product.name`        | Overwrites                                   |
| `price`          | **Yes**                 | whole VND, digits only            | Variant price         | Overwrites                                   |
| `weight_grams`   | Create only              | positive whole grams              | `Product.weightGrams` | Overwrites when present                      |
| `status`         | No                      | `draft` \| `active`               | Default `draft`       | Overwrites                                   |
| `description`    | No                      | text                              | `Product.description` | Overwrites **only if the column is present** |
| `category`       | No                      | category name                     | `Product.categoryId`  | Matched by name; omitted/blank leaves intact |
| `on_hand`        | No                      | whole number                      | Initial stock         | Changes stock per `inventory_mode`           |
| `inventory_mode` | Required with `on_hand` | `set_on_hand` \| `adjust_on_hand` | —                     | —                                            |

```csv
sku,name,price,weight_grams,status,on_hand,inventory_mode
TOTE-01,Sunrise Tote Bag,250000,350,active,24,set_on_hand
MUG-02,Ghế gỗ óc chó,120000,220,draft,-3,adjust_on_hand
```

For an existing SKU, omitting `weight_grams` leaves its current weight
unchanged. A new SKU must include a positive whole-number weight in grams.
Omitting `description` leaves existing text alone. Import never blanks a
field it does not carry.

### V2 multi-variant — one product, several SKUs (Shopee/TikTok-style)

Four more optional V2 columns let several rows become ONE product with one
real, option-bearing `ProductVariant` per row — the same thing
`/tenant-admin/catalog`'s "Assign option → Generate variants" does by
hand, driven from a bulk file instead.

| Column          | Required                         | Meaning                                                  |
| --------------- | --------------------------------- | --------------------------------------------------------- |
| `product_key`   | No                                 | Rows sharing this value become one product. Any text you choose — it is scoped to this one file, never stored. |
| `option_name`   | Required if `option_value` is set  | The first variant axis, e.g. `Color`. Shared tenant-wide, same as options created in the catalog page. |
| `option_value`  | Required if `option_name` is set   | e.g. `Red`.                                                |
| `option2_name`  | Optional, requires `option_name`   | A second axis, e.g. `Size` (Shopee's own two-axis limit).  |
| `option2_value` | Required if `option2_name` is set  | e.g. `M`.                                                  |

```csv
sku,name,price,weight_grams,status,product_key,option_name,option_value,option2_name,option2_value,on_hand,inventory_mode
SHIRT-RED-S,Basic Tee,150000,200,active,TEE-1,Color,Red,Size,S,40,set_on_hand
SHIRT-RED-M,Basic Tee,150000,200,active,TEE-1,Color,Red,Size,M,35,set_on_hand
SHIRT-BLUE-S,Basic Tee,160000,200,active,TEE-1,Color,Blue,Size,S,20,set_on_hand
```

Every row still carries its own `sku`, `price`, `on_hand` and
`inventory_mode` — those are variant-level, exactly like today. `name`,
`weight_grams`, `status`, `description` and `category` are product-level:
every row sharing a `product_key` must agree on them (give the same value,
or leave it blank on all but one row); a disagreement is `invalid` and
blocks the whole import, the same posture as everywhere else in this
contract.

A lone row (no `product_key`, or a `product_key` nobody else uses) with
`option_name` set is also valid — a real one-variant product that already
declares an option, same as a merchant who picked "Color" in the catalog
page before having a second color in stock yet.

**What this does NOT do: add a new variant to an already-existing
product.** `product_key` only groups rows within the SAME file into a
BRAND NEW product. If some of a group's SKUs already exist and others
don't, the existing ones update normally but the new ones are rejected as
`duplicate` — CSV import cannot attach a new SKU to a product it didn't
just create in this same file. Add a new variant to an existing product
in `/tenant-admin/catalog` instead.

## Matching and idempotency

**`sku` is the only matching key.** It is the only stable, tenant-scoped,
user-facing identifier in the schema — `ProductVariant @@unique([tenantId,
sku])`. `Product` has no slug or external key, only a UUID.

**Name is never an update key.** Names are neither unique nor stable — a
row is never matched to an existing product by name, only by `sku`.

**Name IS checked before a create, to catch an accidental duplicate
product.** A row with no SKU match is about to create a brand-new
product; if its name (trimmed, case-insensitive) already belongs to an
existing product in this tenant, or to an earlier row in the same file
that is itself about to create, the row is rejected as `duplicate` rather
than silently creating a second product under that name. This is a
safety net, not a rename detector: an `update` row (matched by `sku`)
changing its own name is never flagged, no matter what name it picks.

| Situation                                           | Result                                |
| ---------------------------------------------------- | ------------------------------------- |
| SKU not in this tenant                               | `create`                              |
| SKU exists, some field differs                       | `update`                              |
| SKU exists, nothing differs                          | `unchanged`                           |
| Same SKU twice in one file                           | `conflict` — blocks the import        |
| New row's name matches an existing product           | `duplicate` — blocks the import       |
| Two new rows in one file share a name                | `duplicate` on the later row           |
| Row fails validation                                 | `invalid` — blocks the import         |
| SKU exists in **another** tenant                     | Invisible. Treated as `create` here.  |
| V1 row (no SKU)                                      | Always `create` (name-duplicate check applies the same way) |

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

**Invalid, conflicting and duplicate rows block the entire import.**
Nothing is skipped silently. Fix the file and preview again.

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

- `name`, `sku`, `price`, `weight_grams`, `status` are trimmed.
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
