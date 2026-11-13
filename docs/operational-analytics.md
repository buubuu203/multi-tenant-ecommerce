# Operational analytics

**Outcome B: a small read-only analytics surface at
`/tenant-admin/analytics`.** No migration, no dependency, no mutation,
no external analytics provider, no tracking pixel, no cookie, no
attribution.

Every figure is an exact count or sum over rows this application already
stores. Nothing is modelled, estimated, attributed or projected. The
risk this page carries is not that a number is wrong — it is that a
correct number is read as a stronger claim than the data supports, so
the wording is part of the feature rather than decoration around it.

Audited before building: `prisma/schema.prisma`, `tenant-kpis.ts`,
`customer-queries.ts`, `payment-reconciliation.ts`,
`payments/rejection-operations.ts`, `fulfillment-queue.ts`,
`order-queries.ts`, `inventory-availability.ts`, all three exports, the
Tenant Admin overview and payment-operations pages, `AdminNav.tsx`, the
shared admin components and the `db/tenant-db.ts` scoping extension.

## Capability matrix

| Metric                       | Source                                                | Exact definition                                          | Tenant-safe? | Bounded query? | Safe to display?                            |
| ---------------------------- | ----------------------------------------------------- | --------------------------------------------------------- | ------------ | -------------- | ------------------------------------------- |
| Orders by status             | `Order.status`                                        | Orders created in range, grouped by lifecycle status      | Yes          | Yes (groupBy)  | **Yes**                                     |
| Orders placed                | `Order`                                               | All orders created in range, cancelled included           | Yes          | Yes            | **Yes**                                     |
| Order value                  | `OrderItem.price × quantity` + `Order.shippingAmount` | Non-cancelled orders in range                             | Yes          | Yes (SQL SUM)  | **Yes**, labelled not-revenue               |
| Average order value          | derived                                               | Order value ÷ the orders it covers                        | Yes          | Yes            | **Yes**, with its denominator shown         |
| Payments by status           | `Payment.status`                                      | Payments opened in range, grouped                         | Yes          | Yes (groupBy)  | **Yes**                                     |
| Rejections by reason         | `PaymentRejection.reason`                             | Distinct tenant-attributed rejections first seen in range | Yes          | Yes (groupBy)  | **Yes**, labelled not-reconciliation        |
| Customers created            | `Customer.createdAt`                                  | Customer rows first stored in range                       | Yes          | Yes            | **Yes**                                     |
| Customers total              | `Customer`                                            | All customer rows, as of now                              | Yes          | Yes            | **Yes**, labelled point-in-time             |
| Customers with an order      | `Order.customerId`                                    | Distinct customers with ≥1 stored order                   | Yes          | Yes (grouped)  | **Yes**                                     |
| Customers with ≥2 orders     | `Order.customerId`                                    | Distinct customers with ≥2 stored orders                  | Yes          | Yes (grouped)  | **Yes**, as a count not a segment           |
| Active / draft products      | `Product.status`                                      | Current counts                                            | Yes          | Yes            | **Yes**                                     |
| Active variants              | `ProductVariant.status`                               | Current count                                             | Yes          | Yes            | **Yes**                                     |
| Out of stock variants        | `Inventory`                                           | `onHand - reserved <= 0`                                  | Yes          | Yes (FILTER)   | **Yes**                                     |
| Low stock variants           | `Inventory`                                           | `0 < onHand - reserved <= 5`                              | Yes          | Yes (FILTER)   | **Yes**, threshold shown                    |
| Units on hand / reserved     | `Inventory`                                           | `SUM(onHand)`, `SUM(reserved)`                            | Yes          | Yes (SUM)      | **Yes**                                     |
| Settled revenue              | none                                                  | —                                                         | —            | —              | **No** — no bank account is observed        |
| COD cash collected           | none                                                  | —                                                         | —            | —              | **No** — never recorded                     |
| Delivery / shipment progress | none                                                  | —                                                         | —            | —              | **No** — see `carrier-readiness.md`         |
| Carrier fees                 | none                                                  | —                                                         | —            | —              | **No** — only the customer charge is stored |
| Profit / margin              | none                                                  | —                                                         | —            | —              | **No** — no cost is stored anywhere         |
| Returns / refunds            | none                                                  | —                                                         | —            | —              | **No** — see `returns-and-refunds.md`       |
| Conversion rate              | none                                                  | —                                                         | —            | —              | **No** — no session or checkout funnel data |
| Marketing attribution        | none                                                  | —                                                         | —            | —              | **No** — nothing records a source           |
| Customer consent             | none                                                  | —                                                         | —            | —              | **No** — see `notifications.md`             |

## Order value, defined exactly

This reuses the definition `tenant-kpis.ts` and `customer-queries.ts`
already share, rather than introducing a third.

- **Shipping is included**, from `Order.shippingAmount`.
- **Cancelled orders are excluded.** Pending and fulfilled are both
  included.
- **Unpaid orders are included.** Nothing in this figure depends on
  payment state.
- **Discounts are already reflected.** `OrderItem.price` is the final
  unit price actually charged.
- **It is recalculated** from stored line snapshots on each view, not
  cached, so it cannot drift from the orders it describes. The snapshots
  themselves are immutable, so a later catalog price change does not
  alter a historical figure.
- **It is not revenue, net sales, cash received, or profit.** This
  application never observes a bank account, so no figure here can mean
  money arrived.

## Payment metrics, defined exactly

- **Succeeded** means this application's own validation accepted a
  provider confirmation and the reported amount matched the amount the
  payment was opened for. **It does not prove bank settlement.**
- **Pending on a COD order is normal, not a failure.** Cash is settled
  with the courier and nothing records the outcome, so a COD payment
  stays pending permanently. Treating pending as a problem would
  misreport every COD order.
- **Expired and cancelled describe the payment attempt**, not the order.
  Order status is a separate axis.
- **Rejections are evidence, not reconciliation.** A row means a webhook
  was refused. Nothing has been recovered, resolved or reconciled.
- **Rejections are counted once each**, however many times a provider
  retried: a rejection row is upserted, with repeat deliveries
  incrementing `occurrences` and moving `lastSeenAt` rather than adding
  a row. The range filter uses `firstSeenAt`, which is indexed together
  with `tenantId`.
- **Unattributed rejections never appear.** A rejection whose tenant
  could not be resolved from the provider's correlation key carries a
  null `tenantId` and is platform-level evidence only. Attributing it to
  whoever happens to be looking would be a guess.

## Inventory metrics, defined exactly

- **Available = on hand − reserved.** Reserved stock is held by orders
  that are placed but not yet fulfilled or cancelled.
- **Out of stock** is `available <= 0`, which includes a variant with
  physical stock that is entirely reserved.
- **Low stock** is `0 < available <= 5`. The threshold is
  `LOW_STOCK_THRESHOLD`, a fixed product decision shared with the
  storefront and the overview page — not tenant-configurable, and the
  boundary is inclusive.
- These are the levels this system records. They are **not a physical
  audit**, and nothing here measures shrinkage, sell-through, or
  recommends replenishment.

## Date and timezone semantics

| Question           | Answer                                                                    |
| ------------------ | ------------------------------------------------------------------------- |
| Accepted format    | `YYYY-MM-DD`, strictly. Anything else is rejected.                        |
| Interval           | Half-open: `[startInclusive, endExclusive)`.                              |
| Endpoints          | Both dates name INCLUSIVE days; `end` is the start of the day after `to`. |
| Timezone           | **Asia/Ho_Chi_Minh (UTC+7)**, fixed for every store.                      |
| Default            | The last 30 days, ending today.                                           |
| Maximum            | 366 days.                                                                 |
| Invalid input      | Falls back to the default window. **Never broadens the query.**           |
| Over-long range    | Clamped by moving the START forward, keeping the requested end.           |
| Reversed range     | Swapped, and the adjustment is shown to the merchant.                     |
| No filter supplied | The default window, with the adjustment noted.                            |

**Why a fixed timezone, and why this one.** Every `createdAt` column in
this schema is `timestamp without time zone`, and Prisma writes UTC
instants into it. The Postgres session timezone happens to be
Asia/Ho_Chi_Minh, but that is irrelevant for such a column — no
conversion is applied — so depending on it would be depending on an
accident. Nothing in the analytics queries uses `CURRENT_DATE`, `NOW()`
or `date_trunc`; boundaries are computed in TypeScript as explicit UTC
instants and passed as bound parameters, which makes results independent
of whatever session or server timezone the query runs under.

_Which_ timezone the merchant means is a separate question. A merchant
asking for "1–7 October" means those dates where they are standing, and
this application is unambiguously built for Vietnam. Interpreting their
input as UTC would misfile every order placed between midnight and 07:00
local into the previous day. So boundaries are Asia/Ho_Chi_Minh.

**This is a fixed product decision, not a tenant setting.** There is no
timezone column, no admin control and no migration behind it — exactly
like `LOW_STOCK_THRESHOLD`. The application does not pretend each tenant
has a configured timezone, because none does. A fixed numeric offset is
only safe because Vietnam has observed no daylight saving since 1975 and
is UTC+7 year-round; for a DST zone this arithmetic would be wrong twice
a year.

**Any adjustment is shown.** A merchant is never silently given a
different window from the one they asked for: the page states when a
range was defaulted, swapped or clamped.

## Query shape and boundedness

Every figure is an aggregate. **Nothing loads a tenant's rows to count
them in JavaScript**, which is the one pattern that would make this page
degrade as a tenant grows.

- One `Promise.all` of eleven aggregates; the count is fixed and does not
  scale with orders, products, customers or the width of the range.
- Three raw queries, for the aggregates Prisma's API cannot express: a
  line total is `price × quantity`; customer order-counts need a grouped
  subquery; inventory needs `COUNT(*) FILTER`. Each returns a bounded
  result — one row, four numbers, or one row per distinct order-count.
- No `findMany` anywhere in the module, asserted by test.
- No N+1: there is no per-row follow-up query.
- Every raw query binds `tenantId` as `$1` and interpolates nothing;
  asserted by test.

### A note on an existing surface

`getTenantKpis()`, behind the Overview page, does the opposite: it loads
every order in its 30-day window with its items and sums them in
JavaScript, and loads **every inventory row for the tenant** with no
bound at all. That predates this phase and is unchanged here — altering
it was out of scope — but it is the one place a large tenant would feel
first, and the analytics module deliberately does not copy the pattern.

## Tenant isolation and privacy

- `requireTenantAdmin()` is called by the page itself, before any read. A
  layout's early return does not stop a child page streaming its own
  payload, so the check belongs on the page — the rule the rest of this
  codebase follows.
- **Every query states `tenantId` explicitly, and the module deliberately
  does not use `getScopedDb()`.** That is not a departure from the
  convention; it is what the convention requires here.
  `scopeArgsForOperation()` has no `groupBy` case, so a groupBy falls
  through its `default` and is returned **unchanged** — the extension's
  own comment says "aggregate/groupBy are not covered yet". Most figures
  on this page are groupBys, and `payment`, `customer`,
  `paymentRejection` and `order` are not in its allowlist at all.
  Relying on the extension here would mean relying on a mechanism that
  does not apply to the operations being used, while reading as though
  it did.
- Tenant isolation is tested with a deliberately **larger** tenant B:
  four orders of a hundred units each, against tenant A's three small
  ones. A's figures are unchanged by B's existence.
- An unknown tenant id returns zeroes, not an error and not another
  tenant's data.
- **No internal id reaches the UI projection** — no tenant, customer,
  order, variant or location id. The projection is counts and sums only,
  asserted by test.
- No provider metadata, no webhook payload, no payload digest and no
  dedupe key.
- No cross-tenant link, and no Platform Admin link; asserted by test.
- The page is `force-dynamic`, so no tenant's figures can be served from
  a shared cache.

## Known limitations

- **Catalog, stock and total customer counts are point-in-time**, not
  range-scoped, and the page says so beside them. There is no historical
  snapshot of stock, so "what was in stock last month" is unanswerable.
- **No time series.** Every figure is one number for the whole range;
  there is no per-day breakdown and no chart. Adding one is possible
  with the same aggregates grouped by day, but it was not built here
  because a trend line invites comparison across ranges that the
  point-in-time figures cannot support.
- **No export.** Existing exports are unchanged.
- **366-day maximum**, so multi-year comparisons are not available.
- **Order value is recalculated on each view.** For a very large range on
  a very large tenant this is a scan; it is bounded by the range, not by
  all history.

## What this page cannot tell you

Not missing screens — the application does not record the underlying
facts, so no figure could be honest: bank settlement, COD cash
collection, delivery or shipment progress, carrier fees, returns,
refunds, profit, margin, tax, marketing attribution, conversion rate,
and customer consent.

**Nothing here is an accounting, VAT, tax or banking record.**
