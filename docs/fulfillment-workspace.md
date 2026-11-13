# Fulfillment workspace

`/tenant-admin/fulfillment` — which orders need attention before they can
be prepared.

**This is an internal operational queue, not a shipment or carrier
system.** There is no shipment model, no carrier integration and no
tracking column in this schema. Nothing here reports pickup, transit,
delivery, failed delivery, returns, refunds, COD collection or payment
settlement.

## Categories

Derived by one pure classifier from stored columns only.

| Category             | Rule                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| **Cancelled**        | `Order.status = cancelled`. Wins over every blocker.                                             |
| **Fulfilled**        | `Order.status = fulfilled`, used as-is. **Not** renamed to shipped or delivered.                 |
| **Needs review**     | An explicit blocker: no shipping method recorded, or payment `failed` / `expired` / `cancelled`. |
| **Awaiting payment** | A prepaid method whose payment has not succeeded.                                                |
| **Ready to prepare** | Pending, a shipping method recorded, and either paid or COD.                                     |

All blockers on an order are reported, not just the first.

### COD

A COD payment row stays `pending` by design — cash settles with the
courier and this system never records that. **A pending COD payment is
therefore not a payment blocker**, and such an order is ready to prepare.
Treating it otherwise would park every COD order in the wrong bucket.

An order being _fulfilled_ does **not** prove COD cash was collected.

## Inventory is deliberately not a blocker

`createOrder()` reserves stock inside the order's own transaction, so an
existing order's units are **already held**. Re-checking availability
would either repeat the guarantee the reservation already gives or —
worse — report a shortage for stock reserved for this very order.

It is omitted because it would mislead, not because it would cost.

## Ordering and pagination

Ordering is the orders page's own `(createdAt desc, id desc)`. Sorting
blockers to the top would mean re-expressing the classifier as a SQL
`CASE`, and two copies of that rule would eventually disagree — the
category filter does that job instead.

25 rows per page. An unknown category falls back to "all" rather than
erroring or widening the query.

## Counts

Summary counts cover the **whole tenant**, not the page. One grouped
query returns the distinct state combinations — order status × payment
method × payment status × whether a shipping method exists — and the
_same_ classifier is applied to each. One definition of a category rather
than a second copy expressed as SQL predicates that could drift, and the
row count is bounded by the enums however many orders exist.

## What is shown, and what is not

Destination is **district and city only**. The street address belongs on
the packing slip, not in a list read at a glance. No provider metadata,
webhook payload or internal id is projected.

## Actions

**There are none.** The page performs no write of any kind. Its only
actions are links that already exist: the order itself, its packing slip
and its shipping note.

No mark-as-shipped, assign-carrier, add-tracking, cancel, refund or
edit-address action exists, and none was added — the schema has no field
any of them would write.

## Limitations

- No carrier integration, tracking number, label generation or delivery
  estimate.
- No proof of pickup, delivery, return, refund, COD collection or
  settlement.
- No priority ordering — use the category filter instead.
- No export.
- Orders placed before configurable shipping have no shipping method
  recorded and will appear under **Needs review** for that reason.

## Future carrier work

A real shipment view would need a shipment model with its own states, a
carrier integration per provider, and a tracking identifier — each a
schema change with its own design, including what happens when a carrier
and the order disagree. None of that is approximated here.
