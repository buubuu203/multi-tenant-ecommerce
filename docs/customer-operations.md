# Customer Operations

`/tenant-admin/customers` — who has ordered from this store, derived
entirely from existing order data.

**This is not a CRM.** There is no messaging, no segmentation, no loyalty,
no consent management and no customer login. It is a read-only view of
orders, grouped by the person who placed them.

## Identity

`Customer` is unique on **`(tenantId, email)`**. A repeat buyer using the
same email address reuses one row; a different email creates a new one.

That means **two customer records can share a phone number** while
differing by email. When they do, both are shown, both are flagged, and
**neither is merged**. Merging would rewrite order history and is out of
scope for v1 — there is no merge, edit or delete action anywhere in this
feature.

The duplicate flag is deterministic: exact phone equality within the
tenant, after the same normalisation search uses. It is a notice, not an
inference.

There is no separate guest-customer concept — a checkout creates or
reuses a `Customer` row keyed on the email given.

## Search

| Field | Behaviour                                                                                                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phone | Matches **both stored forms**. `0912…` and `+84912…` find the same person, via `normalizedPhoneVariants` — the same helper order lookup uses. Stored values are never rewritten. |
| Name  | `contains`, case-insensitive. Vietnamese diacritics are matched literally.                                                                                                       |
| Email | `contains`, case-insensitive.                                                                                                                                                    |

Nothing is fuzzy. There is no phonetic or approximate matching.

## Metric definitions

Defined once in `customer-queries.ts` and reused by the list, the detail
page and the CSV export, so the three cannot disagree.

| Metric                    | Definition                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Order count**           | **Every** order the customer placed, **cancelled included**. It answers "how often has this person ordered", and a cancellation is part of that. |
| **Cancelled orders**      | Of those, how many were cancelled. Shown so the value exclusion below is explicable.                                                             |
| **Order value**           | Items + shipping, for orders **not cancelled**. Same rule `getTenantKpis()` already applies to its order-value figure.                           |
| **First / last order**    | Min and max order date. `null` when the customer has no orders — never a placeholder date.                                                       |
| **Latest order status**   | The status of the most recent order.                                                                                                             |
| **Latest payment status** | That order's payment status, or "not recorded" for orders predating the payment row.                                                             |

**Order value is not revenue.** It includes orders nobody has paid for,
and this system never observes a payment settling in a bank account. The
UI says so on both the list and the detail page.

Shipping **is** included. Cancelled orders are **excluded** from value but
**included** in count.

## Not derivable, and therefore absent

None of the following exists in the schema, so none is shown — not even
as a zero:

delivery confirmation · returns · refunds · COD settlement · marketing
consent · verified phone · repeat-customer or VIP tiers · lifetime value
in any sense beyond the order-value definition above.

A fulfilled order does **not** prove COD cash was collected. The system
has no record of that, and does not pretend otherwise.

## Privacy

Every read calls `requireTenantAdmin()` first and goes through
tenant-scoped access. A customer in another tenant and one that does not
exist return **the same** not-found, so existence cannot be probed, and
searching another tenant's phone or email returns nothing.

Both pages are `force-dynamic` with `revalidate = 0`: they render names,
phone numbers and email addresses and are never cached.

Absent from every projection: `tenantId`, `customerId`,
`productVariantId`, `providerMetadata`, `providerOrderId`,
`providerTransactionId` and any webhook payload.

**There is no retention or deletion policy here.** Customer rows live as
long as their orders do. This document makes no privacy-compliance claim.

## CSV export

Registered as the `customers` dataset alongside `products` and `orders`,
behind the same allowlist and the same authorization.

Columns: `customer_name`, `phone`, `email`, `orders`, `cancelled_orders`,
`order_value_vnd`, `first_order_at`, `last_order_at`,
`latest_order_status`, `latest_payment_status`,
`possible_duplicate_phone`.

Reuses the existing serializer end to end — UTF-8 BOM so Excel reads
Vietnamese correctly, RFC4180 escaping, formula-injection protection, and
a sanitised filename. Deterministically ordered and **bounded at 5000
rows**, so one request cannot pull an unlimited export.

**It contains personal data.** The UI warns before download: names, phone
numbers and email addresses leave the app's access controls the moment
the file is saved.

## Limitations

- **No sorting by last-order date.** The list is ordered newest-customer
  first. Sorting by order recency would need an aggregate across every
  customer before paging; v1 keeps the query bounded instead.
- **No merge, edit or delete**, by design.
- **No sorting or filtering by order value or count.**
- Export is capped at 5000 customers.
- Customers with no orders appear in the list, because a `Customer` row
  can exist without one.
