# Release readiness

**Status: NOT READY FOR PRODUCTION.**

Two decisive blockers, neither of which a test run can clear:

1. **Two migrations exist only on the local development database.** Preview
   and Production have never been contacted. One of them rewrites a table
   under `ACCESS EXCLUSIVE`.
2. **No authenticated browser QA has ever been run.** Nothing in this
   application has been seen rendered. Every UI claim below rests on
   structural tests over source, not on a rendered page.

All four gates pass — 738 tests, typecheck, lint, build. **That is not
production readiness**, and this document exists so the distinction is not
quietly lost.

Last verified: 2026-10-18, at commit `7d824a2` plus the changes in this
phase. Branch `feat/order-lookup-banners-discounts-admin-routing`.

---

## 1. Implemented surfaces

Every route below was verified to exist in the current tree. "Tests" names
the dedicated suite; most surfaces are additionally covered by the
cross-cutting authorization, privacy and UI suites.

### Admin shell and access

| Surface                 | Route                    | Scope    | Mutations | Tests                                             | Browser QA | Limitations                                      |
| ----------------------- | ------------------------ | -------- | --------- | ------------------------------------------------- | ---------- | ------------------------------------------------ |
| Tenant Admin shell      | `/tenant-admin/*` layout | Tenant   | No        | `admin-ui`, `admin-authorization`                 | NOT RUN    | Sidebar nav; mobile disclosure untested visually |
| Platform Admin          | `/platform-admin`        | Platform | Yes       | `admin-page-authorization`, `admin-authorization` | NOT RUN    | Separate authorization; no tenant data by design |
| Authorize-before-read   | every admin page         | Both     | —         | `admin-page-authorization`                        | n/a        | Enforced per page, not only per layout           |
| User guide (Vietnamese) | `/tenant-admin/help`     | Tenant   | No        | `tenant-admin-help`                               | NOT RUN    | Static; reads no tenant data; `noindex`          |
| Shared `?` help entry   | header in layout         | Tenant   | No        | `tenant-admin-help`                               | NOT RUN    | One entry point; no page adds its own            |

### Commerce

| Surface               | Route                                         | Scope  | Mutations | Tests                                     | Browser QA | Limitations                                               |
| --------------------- | --------------------------------------------- | ------ | --------- | ----------------------------------------- | ---------- | --------------------------------------------------------- |
| Orders list           | `/tenant-admin/orders`                        | Tenant | Yes       | `bulk-order-status`, `order-lookup`       | NOT RUN    | Bulk status change confirms first                         |
| Order audit history   | in orders list                                | Tenant | No        | `order-events`                            | NOT RUN    | Append-only in application code, not at DB level          |
| Order Print Center    | `/tenant-admin/orders/[orderId]/print`        | Tenant | No        | `order-print`                             | NOT RUN    | Browser print only; no PDF engine; no bulk print          |
| Catalog               | `/tenant-admin/catalog`                       | Tenant | Yes       | `product-*`, `discounts`, `image-*`       | NOT RUN    | Discounts are per product, inside the editor              |
| Add product           | `/tenant-admin/products/new`                  | Tenant | Yes       | `product-visibility`                      | NOT RUN    | An action, deliberately not a nav destination             |
| Variants / inventory  | in catalog                                    | Tenant | Yes       | `inventory-availability`                  | NOT RUN    | One default location per tenant; no warehouse UI          |
| Product media / WebP  | in catalog                                    | Tenant | Yes       | `image-webp`, `image-crop`                | NOT RUN    | **Existing images are not retroactively converted**       |
| CSV import / export   | in catalog, `/tenant-admin/exports/[dataset]` | Tenant | Yes       | `csv`, `product-csv-preview`, `exports`   | NOT RUN    | All-or-nothing apply; legacy rows without SKU unupdatable |
| Customers             | `/tenant-admin/customers`                     | Tenant | No        | `customer-operations`, `customer-sorting` | NOT RUN    | No edit, delete or merge                                  |
| Customer detail       | `/tenant-admin/customers/[customerId]`        | Tenant | No        | `customer-operations`                     | NOT RUN    | Identity is `(tenantId, email)`                           |
| Fulfillment Workspace | `/tenant-admin/fulfillment`                   | Tenant | No        | `fulfillment-queue`                       | NOT RUN    | **Internal queue only — not a shipment system**           |

### Payments and shipping

| Surface                 | Route / script                       | Scope    | Mutations | Tests                          | Browser QA | Limitations                                      |
| ----------------------- | ------------------------------------ | -------- | --------- | ------------------------------ | ---------- | ------------------------------------------------ |
| Payments configuration  | `/tenant-admin/payments`             | Tenant   | Yes       | `admin-ui`                     | NOT RUN    | Switching provider replaces stored configuration |
| Bank transfer           | `/tenant-admin/bank-transfer`        | Tenant   | Yes       | `admin-ui`                     | NOT RUN    | Instructional text only; never reconciled        |
| Shipping methods        | `/tenant-admin/shipping`             | Tenant   | Yes       | `admin-ui`                     | NOT RUN    | Flat rate; merchant-authored; no carrier         |
| Payment Operations      | `/tenant-admin/payment-operations`   | Tenant   | Yes       | `payment-reconciliation`       | NOT RUN    | Not accounting, not bank reconciliation          |
| MoMo webhook            | `/api/momo/webhook`                  | Public   | Yes       | `payment-rejection`            | n/a        | Signature verified; tenant resolved from payment |
| SePay webhook           | `/api/webhooks/sepay`                | Public   | Yes       | `payment-rejection`            | n/a        | HMAC-SHA256 + timestamp, `timingSafeEqual`       |
| Rejection evidence      | in payment operations                | Tenant   | No        | `payment-rejection`            | NOT RUN    | Evidence only — **not reconciliation**           |
| Platform rejection page | `/platform-admin/payment-rejections` | Platform | No        | `payment-rejection-operations` | NOT RUN    | Includes unattributed rows; exact-match search   |
| Rejection retention     | `npm run release:prune:rejections`   | Platform | Yes       | `payment-rejection-operations` | n/a        | **Manual. Dry run unless `--apply`**             |

### Analytics and release operations

| Surface                 | Route / script                                                         | Scope  | Mutations | Tests                                       | Browser QA | Limitations                                   |
| ----------------------- | ---------------------------------------------------------------------- | ------ | --------- | ------------------------------------------- | ---------- | --------------------------------------------- |
| Operational analytics   | `/tenant-admin/analytics`                                              | Tenant | No        | `analytics-metrics`, `analytics-date-range` | NOT RUN    | Read-only; no time series; 366-day cap        |
| Whole-release preflight | `npm run release:preflight`                                            | Target | No        | `release-tooling`                           | n/a        | Read-only; refuses without an explicit target |
| OrderEvent preflight    | `npm run release:preflight:order-events`                               | Target | No        | `release-tooling`                           | n/a        | Read-only                                     |
| OrderEvent verification | `npm run release:verify:order-events`                                  | Target | No        | `release-tooling`                           | n/a        | Post-migration only                           |
| Migration runbook       | `prisma/migrations/20261014160000_add_order_event_sequence/RUNBOOK.md` | —      | —         | `release-invariants`                        | n/a        | Covers the OrderEvent migration specifically  |

---

## 2. Migration status

23 migrations exist. 21 are already deployed everywhere. **Two are local
only**, and both are release blockers.

| Migration                                 | Local   | Preview     | Production  | Risk                                             |
| ----------------------------------------- | ------- | ----------- | ----------- | ------------------------------------------------ |
| `20261014160000_add_order_event_sequence` | Applied | **Not run** | **Not run** | **Full table rewrite under `ACCESS EXCLUSIVE`**  |
| `20261016120000_add_payment_rejections`   | Applied | **Not run** | **Not run** | Additive only — one enum, one table, two indexes |

Local status, verified this phase: `npx prisma migrate status` reports
`23 migrations found` and `Database schema is up to date!`.

### The OrderEvent sequence migration is the dangerous one

```sql
ALTER TABLE "order_events" ADD COLUMN "sequence" SERIAL;
```

`SERIAL` carries a `nextval(...)` default, which PostgreSQL classifies as
**volatile**. A constant default would be a metadata-only change; a
volatile one forces a **full table rewrite**, holding `ACCESS EXCLUSIVE`
on `order_events` for the whole statement. That lock blocks everything,
including plain `SELECT`.

This was measured rather than assumed — `pg_class.relfilenode` changes on
`ADD COLUMN ... SERIAL` and does not change on a plain nullable integer,
and the locks were observed in `pg_locks`. The evidence is in the runbook.

**Whether this is safe depends on the row count of `order_events` in the
target environment, which is a measurement, not a guess.** The preflight
exists to take it. The runbook's decision table turns that number into a
choice between:

- **Option A** — run the committed migration inside a maintenance window.
  Simple, and correct for a small table.
- **Option B** — reproduce the end state online (nullable column, sequence,
  default, batched backfill, `SET NOT NULL`, `CREATE INDEX CONCURRENTLY`),
  then record the migration as applied without executing it. **Option B is
  not universally safe**: it has prerequisites and trade-offs, it is more
  steps to get wrong, and `CREATE INDEX CONCURRENTLY` can leave an invalid
  index if interrupted. The runbook preserves both the prerequisites and
  the recovery path; do not treat it as the default.

### The PaymentRejection migration is additive

One enum, one table, two indexes, wrapped in a transaction. No existing
table, column, constraint or row is touched, and no backfill is required.
**Rejections that occurred before this migration were never recorded and
cannot be recovered** — stated rather than fabricated.

### Rollback

Limited, and the runbook says so plainly. Dropping the column and index is
mechanically possible, but `CREATE INDEX CONCURRENTLY` is not
transactional, and an interrupted run leaves an invalid index that must be
dropped explicitly. Plan forward recovery, not rollback.

---

## 3. QA status

### Gates, all run in this phase on 2026-10-18

| Gate            | Command            | Result                    |
| --------------- | ------------------ | ------------------------- |
| Automated tests | `npm test`         | **738 passed, 0 failed**  |
| Typecheck       | `npx tsc --noEmit` | **0 errors**              |
| Lint            | `npm run lint`     | **0 problems**            |
| Build           | `npm run build`    | **Compiled successfully** |

The suite runs serially (`--test-concurrency=1`) because the
database-backed tests share one local database.

### Area matrix

| Area                      | Automated tests  | Typecheck | Lint | Build | Browser QA                                   | Environment QA                         |
| ------------------------- | ---------------- | --------- | ---- | ----- | -------------------------------------------- | -------------------------------------- |
| Authorization             | Yes              | Yes       | Yes  | Yes   | NOT RUN                                      | Local only                             |
| Tenant isolation          | Yes              | Yes       | Yes  | Yes   | n/a                                          | Local only                             |
| Platform isolation        | Yes              | Yes       | Yes  | Yes   | NOT RUN                                      | Local only                             |
| Payment / webhook privacy | Yes              | Yes       | Yes  | Yes   | n/a                                          | **Providers not reverified**           |
| Customer operations       | Yes              | Yes       | Yes  | Yes   | NOT RUN                                      | Local only                             |
| Fulfillment               | Yes              | Yes       | Yes  | Yes   | NOT RUN                                      | Local only                             |
| Order print               | Yes              | Yes       | Yes  | Yes   | **NOT RUN — no print preview ever rendered** | Local only                             |
| Catalog CSV               | Yes              | Yes       | Yes  | Yes   | NOT RUN                                      | Local only                             |
| Media / WebP conversion   | Yes              | Yes       | Yes  | Yes   | NOT RUN                                      | Local only                             |
| Payment operations        | Yes              | Yes       | Yes  | Yes   | NOT RUN                                      | Local only                             |
| Rejection retention       | Yes              | Yes       | Yes  | Yes   | n/a                                          | **Never run on a remote target**       |
| Analytics                 | Yes              | Yes       | Yes  | Yes   | NOT RUN                                      | Local only                             |
| User guide                | Yes              | Yes       | Yes  | Yes   | NOT RUN                                      | Local only                             |
| Release tooling           | Yes              | Yes       | Yes  | Yes   | n/a                                          | **Never run on Preview or Production** |
| Migrations                | Yes (invariants) | Yes       | Yes  | Yes   | n/a                                          | **Local only — blocker**               |

### Browser QA

```text
Browser QA: NOT RUN
```

No authenticated browser session is available, and obtaining credentials
was out of bounds. **Nothing in this application has been seen rendered.**
The structural tests check headings, landmarks, accessible names, wrapping
classes and the absence of horizontal-overflow patterns in source — they
cannot confirm appearance.

Unverified, specifically:

- the `?` help icon rendering and its placement in the header
- the Tenant Admin help page layout
- every page at 375px
- every page at 414px
- the analytics page, including its date inputs
- customer sorting controls
- the fulfillment workspace
- payment operations
- **print preview for all three documents** (the one surface whose entire
  purpose is visual output)
- CSV upload interaction and the preview/confirm step
- confirmation-dialog Cancel behaviour at runtime
- image upload and cropping

Cancel behaviour has only ever been **structurally** verified. It has never
been exercised at runtime.

---

## 4. Unsupported capabilities

Not missing screens — the application does not store the underlying facts,
so no UI could be honest. Each was audited in its own phase.

| Capability                         | Status          | Audit                       |
| ---------------------------------- | --------------- | --------------------------- |
| Refunds                            | **Unsupported** | `returns-and-refunds.md`    |
| Returns                            | **Unsupported** | `returns-and-refunds.md`    |
| Customer notifications             | **Unsupported** | `notifications.md`          |
| Carrier integration                | **Unsupported** | `carrier-readiness.md`      |
| Shipment / tracking                | **Unsupported** | `carrier-readiness.md`      |
| Delivery confirmation              | **Unsupported** | `carrier-readiness.md`      |
| COD collection evidence            | **Unsupported** | `carrier-readiness.md`      |
| Payment settlement                 | **Unsupported** | `payment-reconciliation.md` |
| Accounting / VAT / e-invoice       | **Unsupported** | `order-print-documents.md`  |
| Customer CRM / segmentation        | **Unsupported** | `customer-operations.md`    |
| Automated retention scheduler      | **Unsupported** | pruning is manual           |
| Marketing attribution / conversion | **Unsupported** | `operational-analytics.md`  |

Three distinctions the codebase holds and tests enforce:

- **A fulfilled order is not a delivered parcel.** `fulfilled` consumes
  reserved stock. It says nothing about a courier.
- **A succeeded payment is not settled money.** It means provider
  confirmation was accepted and the amount matched; no bank account is
  ever observed.
- **A pending COD payment is normal, permanently.** Cash is settled with
  the courier and nothing records the outcome.

**No legal, financial, tax, banking, logistics or privacy compliance is
claimed.**

---

## 5. Operational limitations

- **Analytics date semantics** — half-open `[start, end)`, both input dates
  inclusive as days, boundaries fixed at Asia/Ho_Chi_Minh (UTC+7). There is
  no tenant timezone setting and none is implied.
- **Analytics point-in-time figures** — catalog, stock and total customer
  counts are current values, not range-scoped. There is no historical stock
  snapshot, so "what was in stock last month" is unanswerable.
- **Analytics range cap** — 366 days. No multi-year comparison.
- **No analytics time series** — one number per range, no per-day breakdown
  and no chart.
- **Customer export cap** — 5000 rows, and the file contains personal data.
- **Rejection retention** — bounded, and pruning is **manual**. There is no
  scheduler, no cron and no job runner anywhere in this project.
- **Print layout** — browser print only. No PDF engine, no bulk print, and
  the layout has never been visually verified.
- **CSV import** — all-or-nothing within one transaction; legacy products
  without a SKU cannot be updated.
- **WebP conversion** — applies at upload time. Existing images are not
  retroactively converted. SVG store logos are preserved as SVG.
- **Overview KPI query shape** — `getTenantKpis()` loads every order in its
  30-day window with its items and sums them in JavaScript, and loads every
  inventory row for the tenant with no bound. Correct, but the first place
  a large tenant would feel strain. The analytics module deliberately does
  not copy the pattern.
- **Order audit history is application-level append-only.** No row-level
  security, no revoked `DELETE` grant, no immutability trigger. Anyone with
  direct database credentials can still alter rows. It is an operational
  timeline, not tamper-proof evidence.

---

## 6. Security and privacy — verified protections

Each is covered by a current test.

- **Authorize before read.** Every admin page calls
  `requireTenantAdmin()`/`requirePlatformAdmin()` itself. A layout's early
  return does not stop a child page streaming its own payload, which is why
  the check is per page rather than only per layout.
- **Tenant isolation.** Enforced by composite foreign keys on
  `(id, tenantId)` at the database level, plus explicit tenant predicates.
  Tested with a deliberately larger tenant B so a leak would be visible.
- **Platform/tenant separation.** Distinct authorization helpers; no
  tenant page links to Platform Admin.
- **Not-found is indistinguishable from not-yours.** A cross-tenant order
  id returns exactly what an unknown id returns.
- **No raw provider metadata, webhook payload, signature, API key, payload
  digest or dedupe key reaches any UI projection.**
- **Webhook signatures verified before persistence** — HMAC-SHA256 over
  `timestamp.body` with `timingSafeEqual`, and rejection reasons are never
  disclosed to the caller.
- **Unattributed rejections stay platform-only.** A webhook that resolves
  to no payment has no trustworthy tenant, so it is never shown in a
  tenant's queue rather than guessed into one.
- **Bounded exports** with CSV formula-injection guarding on text cells
  (numeric cells deliberately not guarded).
- **Exact-match platform rejection search**, so the page cannot be used to
  enumerate.
- **Retention pruning is dry-run by default**, deletes in bounded batches,
  and requires `--apply`.
- **Release checks are read-only**, server-enforced by
  `BEGIN TRANSACTION READ ONLY`, always rolled back, with a statement
  timeout.
- **Release checks never fall back to `DATABASE_URL`.** They require
  `RELEASE_CHECK_DATABASE_URL` and exit 2 without it, so "checking
  production" can never silently check your development database.
- **Only host, port and database name are ever printed** from a connection
  string. No credentials.
- **The help route is behind admin authorization**, reads no tenant data,
  and is `noindex`.

### Unresolved

- No penetration test, no dependency CVE audit, and no load test has been
  performed.
- Rate limiting exists only on the order-lookup actions, and is in-memory
  per instance — it does not survive a restart or coordinate across
  instances.
- Provider dashboard and webhook URL configuration have not been
  reverified against Preview or Production.

---

## 7. Environment and data integrity

Verified this phase by local inspection only:

- **Preview: never contacted.** No connection attempted in any phase.
- **Production: never contacted.**
- **No remote migration run.** `RELEASE_CHECK_DATABASE_URL` was never set.
- **No external provider call** — no MoMo, no SePay.
- **No carrier contacted** (none is integrated).
- **No notification sent** (no transport exists).
- **No refund or return operation** (none is implementable).
- **QA data unchanged** — orders `362fd3ec=fulfilled fbd2ca8e=fulfilled
60e869c9=pending`; inventory `{25,0} {23,1} {40,0} {40,0}`; 1 order
  event; 2 tenants; 4 products; 3 customers.
- **Test tenants cleaned up** — only `shop-a` and `shop-b` remain. Suites
  that provision tenants delete them in `after()`.
- **No prohibited file touched.** `/Users/dang.chau/Downloads/quiz_54users.json`
  was never read, imported or committed. No credential, browser profile or
  session store was accessed.
