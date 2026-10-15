# Payment operations and reconciliation

`/tenant-admin/payment-operations` — a read-only view of payment state and
the orders where payment and fulfilment disagree.

**This is not an accounting, tax or banking system.** It never contacts a
bank, never calls a payment provider, and never confirms that money
reached your account. It reports what is stored.

## Payment states

Five, each mapping directly to a stored `Payment.status`:

| Category         | Stored status | Meaning                                           |
| ---------------- | ------------- | ------------------------------------------------- |
| Awaiting payment | `pending`     | Opened, not yet settled by the provider           |
| Paid             | `succeeded`   | The provider confirmed it, and the amount matched |
| Failed           | `failed`      | The provider rejected it, or the attempt errored  |
| Expired          | `expired`     | The provider's window closed                      |
| Cancelled        | `cancelled`   | The payment was cancelled                         |

An unrecognised status is mapped to **nothing** rather than guessed into a
bucket.

## What this page cannot tell you

Four things a reconciliation view would normally show are **absent**, and
the reason is the same in each case: the data is never stored.

| Not shown              | Why                                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Underpayment**       | `webhook-service.ts` compares the reported amount with `Payment.amount` **before** recording anything and rejects a mismatch. Nothing is persisted — no event, no status change, no marker. |
| **Overpayment**        | Same path, same rejection.                                                                                                                                                                  |
| **Unmatched transfer** | A webhook whose payment cannot be found is rejected the same way. There is no "unmatched transactions" table.                                                                               |
| **Duplicate webhook**  | `(provider, providerEventId)` is unique. A repeat delivery is reported back as accepted and discarded, so a duplicate is a non-event rather than an exception.                              |
| **Processing**         | Not a value in `PaymentStatus`.                                                                                                                                                             |

Showing a count of zero for any of these would be a lie, so they are not
offered. Surfacing them would require retaining rejected webhooks — a
change to the webhook contract, not to this page.

## Needs review

Every rule compares **two stored facts**. None infers anything about money
received.

| Reason                     | Rule                                                    | Recommended action                                                   |
| -------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| Payment window has passed  | `pending` and `expiresAt` is in the past                | Check with the provider, then confirm or cancel the order            |
| Paid for a cancelled order | `succeeded` and order `cancelled`                       | Refund outside this system and record it in your books               |
| Fulfilled without payment  | Order `fulfilled`, payment not `succeeded`, **not COD** | Confirm payment on the order, or follow up                           |
| COD awaiting confirmation  | Order `fulfilled`, provider `cod`                       | Confirm the courier remitted the cash — this system cannot verify it |

COD is deliberately separated. A fulfilled COD order whose payment row is
still `pending` is **normal**: cash settles with the courier and is never
recorded here. Treating it as a bank-settlement failure would make the
queue useless.

## Amount matching

The only amount stored per payment is `Payment.amount` — what the payment
was **opened for**, snapshotted at initiation. The page labels the paid
total that way for the same reason.

Amount matching does happen, but in the webhook path, not here: a
`succeeded` transition requires the provider's reported amount to equal
`Payment.amount` exactly. A `Paid` row therefore means the amounts
matched. It does **not** mean the money is in your bank account.

## Providers

COD, manual bank transfer, SePay virtual account and MoMo — all four
appear, filtered by `Payment.provider`. No provider was added, and no
provider contract or webhook endpoint was changed.

## Actions

**This page adds no mutation.** The only action is a link to the order.

Manual bank transfer is confirmed on the order itself, where the existing
guarded, idempotent, audited action already lives. Duplicating it here
would mean a second code path to the same transition. There is no
"acknowledge exception" or "mark for review" action, because no model
stores that state; adding one would need a migration.

## Privacy

Tenant-scoped throughout: `requireTenantAdmin()` before any read, every
query filtered by tenant. Searching another tenant's order reference
returns nothing.

Never present in the projection: `rawPayload` (the provider/webhook
payload), signatures, tokens, `providerOrderId`, `tenantId`, or any
internal id. `providerTransactionId` **is** shown — it is already a plain
column surfaced on the order.

## Limits

- 25 rows per page, hard-capped at 100. Ordered by `(createdAt desc, id
desc)` so pagination is deterministic when timestamps tie.
- The **needs-review count is computed over the current page**, not the
  whole dataset, because the rules join payment and order state. A tenant
  with many payments should filter before relying on that number.
- **No CSV export.** The existing export pattern is sound, but the useful
  columns here would be the ones that do not exist — received amount,
  difference, unmatched transactions. Exporting state counts a merchant
  can already see on screen adds little, and exporting the rest would mean
  exporting fields the system does not have.
- No refunds, partial refunds, settlement, payouts or fee accounting.

## Future work

Underpayment, overpayment and unmatched-transfer detection all need the
same prerequisite: persisting rejected webhook deliveries with their
reported amount, so there is something to reconcile against. That is a
change to the webhook contract and deserves its own design — including
how long such records are kept, given they contain provider payloads.
