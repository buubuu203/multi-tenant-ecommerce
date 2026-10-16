# Notifications — capability audit

**Outcome A: discovery and documentation only. Notifications are not
supported, and no notification feature, boundary or route was added.**

This application cannot send a message, queue one, or prove that one
arrived. There is no provider, no transport dependency, no scheduler, no
template, no consent record and no delivery evidence. The word "Zalo"
appears in the codebase twice, both times in a comment about merchants
pasting product links into chat apps.

Audited: `prisma/schema.prisma`, `Customer`, `Order`, `Payment`,
`PaymentEvent`, `OrderEvent`, every `process.env` reference in `src` and
`scripts`, `package.json` dependencies, all Server Actions, the webhook
pipeline, every admin route, and the Tenant Admin guide.

## Capability matrix

| Capability                    | Existing source  | Exact semantics? | Durable? | Tenant-safe? | Safe now? | Reason                                                                                                                             |
| ----------------------------- | ---------------- | ---------------- | -------- | ------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Email address                 | `Customer.email` | Yes              | Yes      | Yes          | n/a       | Exists as **contact and identity** — it is the customer's unique key per tenant. Not permission.                                   |
| Phone number                  | `Customer.phone` | Yes              | Yes      | Yes          | n/a       | Contact only. Stored in two formats; normalised for search.                                                                        |
| Zalo identifier               | none             | —                | —        | —            | **No**    | No field, no provider, no concept.                                                                                                 |
| Marketing consent             | none             | No               | No       | —            | **No**    | **No consent field anywhere.** Having an address is not permission to use it.                                                      |
| Transactional legal basis     | none             | No               | No       | —            | **No**    | Not represented, and not something this audit can assert. Needs legal review.                                                      |
| Notification template         | none             | No               | No       | —            | **No**    | No template, no versioning, no rendering.                                                                                          |
| Provider configuration        | none             | No               | No       | —            | **No**    | Env vars are `DATABASE_URL`, MoMo and SePay (both payment), `NODE_ENV`, `PREVIEW_DEFAULT_TENANT_SLUG`, `VERCEL_ENV`. Nothing else. |
| Queue / job runner            | none             | No               | No       | —            | **No**    | No queue, cron, worker or scheduler dependency. Next.js request lifecycle only.                                                    |
| Retry state                   | none             | No               | No       | —            | **No**    | Nothing to retry.                                                                                                                  |
| Provider message ID           | none             | No               | No       | —            | **No**    | No column.                                                                                                                         |
| Provider _accepted_ state     | none             | No               | No       | —            | **No**    | No provider to accept anything.                                                                                                    |
| **Delivered** state           | none             | No               | No       | —            | **No**    | No delivery evidence of any kind. This is the state most often faked; it must never be added without a provider delivery callback. |
| Failed state                  | none             | No               | No       | —            | **No**    | No attempt can fail because none is made.                                                                                          |
| Unsubscribe / preference      | none             | No               | No       | —            | **No**    | No preference model, no unsubscribe path.                                                                                          |
| Notification audit trail      | `OrderEvent`     | No               | Yes      | Yes          | **No**    | Durable and tenant-safe, but its four event types describe orders, payments and inventory. None describes a message.               |
| Customer notification history | none             | No               | No       | —            | **No**    | No history exists; none may be displayed.                                                                                          |

## The distinctions this audit protects

- **Contact details are not consent.** An email address is how a customer
  is identified and how an order is looked up. It is not permission to
  message them.
- **A request to a provider is not acceptance.** An HTTP 2xx means the
  provider received the request.
- **Acceptance is not delivery.** A provider accepting a message says
  nothing about it arriving.
- **Delivery is not reading.** Neither is knowable here.
- **Transactional is not marketing.** They differ in legal basis, and
  nothing in this system distinguishes them.
- **A template is not a sent message.**
- **An in-memory attempt is not history.**

## Trigger events — what is actually reliable

`OrderEvent` is a genuinely good foundation and is worth describing
precisely, because a future notification system should be built on it.

Every event is written by `recordOrderEventInTx()` **inside the same
transaction** as the change it records, so an event exists if and only if
the change committed. Each row is tenant-scoped, carries a stable `id`,
and since the sequence migration has a monotonic ordering key — which
would serve as a natural idempotency key for an outbox.

| Event                                  | Occurs in                                       | Proves                                            | Safe future trigger?                                                                                   |
| -------------------------------------- | ----------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `order_created`                        | `createOrder()`                                 | An order was placed                               | **Yes** — "we received your order"                                                                     |
| `payment_status_changed` → `succeeded` | webhook pipeline, `markManualPaymentReceived()` | The provider confirmed **and the amount matched** | **Yes**, for "payment confirmed". **Not** for "money is in the merchant's account".                    |
| `order_status_changed` → `fulfilled`   | `updateOrderStatus()`                           | A merchant marked the order fulfilled             | **Only** as "your order is being prepared / has been handed over". **Never** "shipped" or "delivered". |
| `order_status_changed` → `cancelled`   | `updateOrderStatus()`                           | The order was cancelled                           | Yes — but it does **not** mean money was returned.                                                     |
| `inventory_released`                   | `updateOrderStatus()`                           | A stock reservation was freed                     | Internal only; meaningless to a customer.                                                              |

**Events that do not exist, so cannot trigger anything:** shipment
created, shipment dispatched, **delivered**, failed delivery, return
requested, return received, refund requested, refund completed, COD cash
collected.

There is **no delivery evidence** anywhere in this system — not for
parcels and not for messages.

## Why not Outcome B or C

**Outcome C** is not close. It needs a provider boundary, secure
configuration, a durable outbox, idempotency keys, a retry model,
template versioning, a provider message id and a delivery webhook. None
of the eight exists.

**Outcome B — a provider-neutral boundary — was rejected deliberately.**
Typed event names and empty interfaces would be dead code today, and
worse than dead: a boundary designed now would have to guess the answers
to questions this audit shows are open. Which channel is the default in
this market. Whether transactional messages need a recorded basis
separate from marketing. Whether configuration is per tenant or
platform-wide, given that MoMo is already platform-wide and bank transfer
is per tenant. What an idempotency key is derived from. Encoding those
guesses as interfaces makes them harder to revisit, not easier, and the
brief's own test applies: a boundary must not be added only for
appearance.

The existing `OrderEvent` stream is already the right seam. When a
provider is chosen, the outbox should be designed against it and against
a real consent model — not against an interface invented beforehand.

## Prerequisites for a real notification system

In dependency order:

1. **A consent and preference model**, with legal review of what basis
   each message type relies on. This comes first because it determines
   whether anything may be sent at all.
2. **A chosen provider per channel**, with configuration scoped
   explicitly as per-tenant or platform-wide, and secrets handled the way
   the payment providers' already are.
3. **A durable outbox**: tenant id, event id, channel, recipient
   reference, template key and version, status, provider message id,
   timestamps, failure category, retry count, and an idempotency key
   derived from the triggering event.
4. **Explicit states** — `queued`, `attempted`, `accepted`, `delivered`,
   `failed`, `cancelled` — with each one written only on real evidence,
   and `delivered` written **only** from a provider delivery callback.
5. **A delivery webhook** with signature verification and
   duplicate-delivery handling, reusing the discipline the payment
   webhook pipeline already has.
6. **A retry policy with a dead-letter outcome**, which needs a job
   runner this project does not have.
7. **Template rendering and versioning**, so a message can be reproduced
   as it was sent.
8. **Tenant-scoped admin surfaces** for history and preferences,
   authorizing before reads and exposing no provider payloads.

Until 1–4 exist, any notification UI would be reporting intent as fact.

## What this audit changed

Nothing functional. No provider was called, no message could be sent, no
customer was contacted, and no schema, route, mutation or dependency was
added. Sixteen tests now hold this position, including that no transport
or scheduler dependency can be installed unnoticed, that no environment
variable configures a provider, and that the word "delivered" is never
used about a message.

This is not a notification system, a CRM, or a consent-management
platform, and no claim is made about legal or privacy compliance.
