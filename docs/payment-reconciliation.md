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

## Rejected webhook deliveries

A webhook this store refused is now **recorded as evidence** in
`payment_rejections`. Before, it was discarded: `webhook-service.ts`
validates the reported amount and resolves the payment _before_
persisting anything, so an underpayment or an overpayment left no trace
at all. That is why these categories were previously impossible — not
difficult, impossible.

**Nothing about the rejection itself changed.** A mismatched amount is
still refused, still writes no `PaymentEvent`, and still leaves `Payment`
untouched. An underpayment has never marked anything paid and still does
not.

### Tenant attribution

A webhook carries no storefront context. The only trustworthy source of
tenant identity is the `Payment` row found via the provider's own
correlation key, so each rejection point is treated differently:

| Rejection         | Recorded? | Tenant       | Visible to the merchant                                           |
| ----------------- | --------- | ------------ | ----------------------------------------------------------------- |
| Invalid signature | **No**    | —            | Never. An unauthenticated request must not be able to write rows. |
| Invalid payload   | Yes       | **null**     | No — nothing identifies an owner                                  |
| Unknown payment   | Yes       | **null**     | **No** — platform-level only                                      |
| Amount mismatch   | Yes       | **verified** | Yes                                                               |

`tenantId` is nullable for exactly this reason. Ownership is never
inferred from a customer name, an amount or a reference. The tenant
query filters on `tenantId`, and that filter is what keeps null-tenant
rows out of every merchant's queue.

### Exception categories

| Category    | Rule                                                                   |
| ----------- | ---------------------------------------------------------------------- |
| `underpaid` | reported amount < expected amount                                      |
| `overpaid`  | reported amount > expected amount                                      |
| `invalid`   | signature passed, body could not be parsed                             |
| `duplicate` | shown as an occurrence count on the row it repeats, not a separate row |

A category is **never guessed**. An amount mismatch whose amounts were
not parseable classifies as nothing rather than as underpaid.

### Still unsupported

| Not shown              | Why                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Unmatched transfer** | Recorded, but with no tenant. Showing it to a merchant would mean guessing who it belongs to. Platform-level only. |
| **Processing**         | Not a value in `PaymentStatus`.                                                                                    |

### Deduplication

One row per `(provider, dedupeKey)`. The key is the provider's own stable
event id where it supplies one, otherwise the SHA-256 payload digest,
which is stable for a byte-identical retry. **Never a random
per-request id.** A repeat bumps `occurrences` and `lastSeenAt` in place,
so a provider retrying indefinitely cannot grow the table.

Where a provider supplies no stable id and varies the body between
retries, the digest differs and the deliveries are **not** deduplicated.
That is the documented limit of the fallback.

### Redaction and retention

**No raw payload is stored.** `payloadDigest` is a SHA-256 of the body:
one-way, never rendered, used only to recognise a repeat. No signature,
token or API key is persisted, and the UI projection does not even select
`payloadDigest`, `dedupeKey`, `paymentId` or `tenantId`.

**There is no retention policy and no automatic pruning.** Rows are kept
indefinitely. They contain no payload, so the exposure is bounded to
amounts, a provider reference and timestamps — but an operator wanting a
retention window must add one.

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
- The **needs-review count covers the whole tenant dataset**, not the page.
  It is four narrow SQL counts — one per rule, plus one subtracting the
  overlap where a payment trips two rules at once — so it never iterates
  rows and never double-counts. The list below it paginates independently.
- **No CSV export.** The existing export pattern is sound, but the useful
  columns here would be the ones that do not exist — received amount,
  difference, unmatched transactions. Exporting state counts a merchant
  can already see on screen adds little, and exporting the rest would mean
  exporting fields the system does not have.
- No refunds, partial refunds, settlement, payouts or fee accounting.

## Migration and deployment

`20261016120000_add_payment_rejections` is additive: one enum, one table,
two indexes. Nothing existing is altered and no backfill is possible —
rejections before this migration were never recorded and cannot be
recovered.

It has been applied to the **local development database only**, with
`migrate deploy` after confirming no drift. **It is a release blocker for
every other environment.** Never use `prisma migrate dev` against a
deployed database: it can reset it.

Rolling the application back is safe without touching the database — the
previous code simply never reads the table.

## Future work

- **Unmatched transfers** are recorded but unattributable. Making them
  useful needs a platform-level operator view, not a tenant one.
- **Retention.** Rows accumulate indefinitely today.
- **Partial payments** remain out of scope: a short transfer is refused,
  not applied against the balance.
- Refunds, settlement, payouts and fee accounting are all absent.
