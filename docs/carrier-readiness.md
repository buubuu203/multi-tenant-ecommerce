# Carrier and shipment — capability audit

**Outcome A: discovery and documentation only. Shipment tracking and
carrier integration are not supported, and no shipment model, route,
migration or provider call was added.**

This application can record **where an order should go**, **which
shipping method the merchant offered**, and **what was charged for it**.
It cannot record that a parcel exists, that a carrier accepted it, where
it is, or that anyone received it. Those are not missing screens — there
is no field, no state, no adapter and no event type that could hold any
of them.

Audited: `prisma/schema.prisma` (all models and enums), `Order`,
`OrderItem`, `TenantShippingMethod`, `Payment`, `PaymentEvent`,
`PaymentRejection`, `OrderEvent`, `order-mutations.ts`,
`inventory-mutations.ts`, `fulfillment-queue.ts`, `order-print.ts`, the
three print documents, `shipping-mutations.ts`, `payments/provider.ts`
and all four adapters, `webhook-service.ts`, both webhook routes, all
three exports, `package.json`, every `process.env` reference, and the
migration history.

## Capability matrix

| Capability                  | Existing source                            | Exact semantics?  | Durable?        | Tenant-safe? | Safe now?  | Reason                                                                                                                          |
| --------------------------- | ------------------------------------------ | ----------------- | --------------- | ------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Shipping method selection   | `TenantShippingMethod`, chosen at checkout | Yes               | Yes             | Yes          | **Yes**    | A merchant-authored flat-rate list. It is the merchant's own offer, not any carrier's acceptance.                               |
| Shipping price snapshot     | `Order.shippingAmount`                     | Yes               | Yes             | Yes          | **Yes**    | Copied once at order creation, never re-read from the method. It is what the customer was charged, not a carrier's fee.         |
| Shipping destination        | `Order.shippingAddress/Ward/District/City` | Yes, as free text | Yes             | Yes          | **Yes**    | A snapshot of what the customer typed. Never validated, geocoded, or normalised against any address authority.                  |
| Shipment record             | none                                       | No                | No              | —            | **No**     | No model. A shipment cannot be distinguished from the order it would belong to.                                                 |
| Carrier assignment          | none                                       | No                | No              | —            | **No**     | No carrier identity exists anywhere. `shippingMethodName` is merchant free text, not a carrier key.                             |
| Tracking number             | none                                       | No                | No              | —            | **No**     | No column. Nothing issues, stores or validates one.                                                                             |
| Carrier API request         | none                                       | No                | No              | —            | **No**     | No carrier SDK, no HTTP client for logistics, no endpoint, no credentials.                                                      |
| Carrier acceptance          | none                                       | No                | No              | —            | **No**     | Nothing is ever submitted, so nothing can be accepted.                                                                          |
| Pickup confirmation         | none                                       | No                | No              | —            | **No**     | No state, no timestamp, no event type.                                                                                          |
| In-transit state            | none                                       | No                | No              | —            | **No**     | `OrderStatus` is `pending`/`fulfilled`/`cancelled`. None means in transit.                                                      |
| Delivered state             | none                                       | No                | No              | —            | **No**     | **Nothing in this system can prove delivery.** `fulfilled` is an internal stock movement (below).                               |
| Delivery failure            | none                                       | No                | No              | —            | **No**     | No failure state, no reason field, no retry concept.                                                                            |
| Return-to-sender state      | none                                       | No                | No              | —            | **No**     | No state. Also distinct from a customer return request, which is equally unsupported — see `returns-and-refunds.md`.            |
| Delivery webhook            | none                                       | No                | No              | —            | **No**     | Two webhook routes exist; both are payment-only (`/api/momo/webhook`, `/api/webhooks/sepay`). Neither accepts a shipment event. |
| Shipping label generation   | none                                       | No                | No              | —            | **No**     | No label format, no barcode, no PDF engine. The shipping note is a browser print and says so.                                   |
| COD amount sent to carrier  | `order-print.ts` `codAmount`               | Yes, as an amount | Yes, as a print | Yes          | **Partly** | The amount to collect is computed and printed for a human courier. It is **never transmitted** to any carrier system.           |
| COD collection confirmation | none                                       | No                | No              | —            | **No**     | **Nothing records that cash was collected.** COD payments stay `pending` forever by design.                                     |
| Carrier fee reconciliation  | none                                       | No                | No              | —            | **No**     | Only the customer-facing charge is stored. No cost side exists, so no margin can be computed.                                   |
| Shipment audit history      | `OrderEvent`                               | No                | Yes             | Yes          | **No**     | Four event types, none about shipping. The table is sound infrastructure, but its vocabulary cannot express a shipment.         |

## Distinctions this audit refuses to collapse

Each of these is a pair the codebase keeps separate, and a carrier
feature would be tempted to merge:

1. **A merchant's shipping method choice is not carrier acceptance.**
   `shippingMethodName` is a string the merchant typed — `"Standard"`,
   `"Express"`, `"Local Pickup"`. It is not a carrier key, is not
   validated against anything, and no carrier has agreed to anything.
2. **Fulfilled is not shipped.** See the next section.
3. **A shipping note is not a waybill.** It is a browser-printed sheet
   carrying no barcode, no tracking number and no carrier name, and it
   says so in its own footer.
4. **A shipping address is not a validated delivery address.** Plain
   text, as typed, never checked for deliverability.
5. **A shipping amount is not a carrier fee.** `Order.shippingAmount` is
   revenue collected from the customer. What a carrier would charge is
   not stored and is frequently different.
6. **COD payment intent is not COD cash collection.** `paymentMethod =
cod` records what the customer chose. No part of this system learns
   whether money changed hands.
7. **An order status is not a shipment status.** One order could become
   several parcels; the schema has no way to say so.
8. **A carrier API request is not a pickup**, **a pickup is not a
   delivery**, and **a delivery is not customer receipt.** None of the
   three is representable, so the distinction is preserved by having
   none of them rather than by careful wording.
9. **A return-to-sender event is not a customer return request.** The
   first is the carrier failing to deliver; the second is the customer
   choosing to send goods back. Neither exists.

## What the current fulfillment semantics actually are

Traced through `order-mutations.ts`, `fulfillment-queue.ts` and
`inventory-mutations.ts`:

1. **`fulfilled` is an internal order status, and nothing more.** The
   only valid transitions are `pending → fulfilled` and `pending →
cancelled`, both terminal, enforced in application code by a guarded
   `updateMany ... WHERE status = 'pending'`.
2. **What `fulfilled` actually does is consume reserved stock.**
   `consumeReservedInventoryInTx()` runs for every order item in the
   same transaction. That is a warehouse movement — goods left the
   shelf. It says nothing about a courier.
3. **No code treats `fulfilled` as delivered.** Verified by search: every
   occurrence of `shipped`, `delivered`, `in transit` or `tracking` in
   application source is either a Tailwind `tracking-*` class or a
   sentence explicitly denying the capability.
4. **No code treats `fulfilled` as payment settlement.** `Order.status`
   and `Payment.status` are separate axes by design, and fulfilling an
   order writes nothing to `Payment`.
5. **COD stays `pending` after fulfillment, permanently.**
   `classifyOrder()` deliberately does not treat a pending COD payment as
   a blocker, because cash is settled with the courier and this system
   never learns the outcome. There is no later step that marks it paid.
6. **The shipping method is a snapshot.** `shippingAmount` and
   `shippingMethodName` are copied at creation and never re-read, so
   renaming, repricing or deleting a method cannot alter a placed order.
7. **The shipping address never changes after order creation.** The only
   `UPDATE` ever issued against `orders` sets `status`. No code path
   writes any shipping column after the insert.
8. **Inventory is reserved at checkout, consumed on fulfillment, and
   released on cancellation.** Restoration of returned goods is not
   modelled — `inventory_released` means a freed reservation, not goods
   coming back.
9. **No print document carries official carrier information.** Verified
   per document below.
10. **Shipping notes contain no tracking number or carrier name.**
    `Order.shippingNote` is customer-entered delivery guidance (for
    example, a gate code). It is not a carrier reference, and nothing
    parses it as one.
11. **No audit event records carrier activity.** `OrderEventType` has
    four values: `order_created`, `order_status_changed`,
    `payment_status_changed`, `inventory_released`.
12. **No webhook can update delivery state.** Both routes resolve a
    `Payment` by the provider's correlation key and can only move a
    payment status. A shipment payload would fail validation.
13. **The existing provider abstraction cannot support carrier
    operations.** `PaymentProvider` is `createPayment`, `handleWebhook`,
    `cancelPayment` — modelled around collecting money from one customer
    for one order. A carrier needs booking, cancellation after handoff,
    label retrieval, rate quoting and status polling. Reusing this
    interface would misrepresent both.
14. **Shipping methods are tenant-configured.** `TenantShippingMethod`
    is per-tenant, with at most one default enforced by a partial unique
    index.
15. **Carrier credentials could safely be tenant-specific, and this is
    the one place existing precedent is genuinely useful.**
    `TenantPaymentMethod.config` already stores per-tenant,
    non-secret provider configuration while real API secrets stay in
    platform-level environment variables. **That split is the problem,
    not the solution**, for carriers: Vietnamese carrier accounts are
    held by the individual merchant, so the secret itself is per-tenant.
    No mechanism in this repository stores a per-tenant secret, and
    inventing one is a prerequisite, not a detail.

## Provider and configuration discovery

Searched the whole repository. **None of the following exists:**

| Looked for                     | Found                                                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Carrier SDK                    | **None.** Dependencies are Clerk, Prisma, Next, React, pg, sharp, marked, the MD editor, `@vercel/blob`, heic2any.                                                                |
| HTTP client for logistics      | **None.** The only outbound HTTP in the repo is MoMo and SePay.                                                                                                                   |
| Carrier environment variable   | **None.** Every `process.env` reference: `DATABASE_URL`, `MOMO_*` (×5), `SEPAY_*` (×3), `NODE_ENV`, `PREVIEW_DEFAULT_TENANT_SLUG`, `VERCEL_ENV`.                                  |
| Carrier API key                | **None.**                                                                                                                                                                         |
| Carrier account settings       | **None.** No model, no admin surface.                                                                                                                                             |
| Webhook signature verification | **Exists, for payments only** — HMAC-SHA256 over `timestamp.body` with `timingSafeEqual`, in `sepay-va-provider.ts`. A good pattern to copy; it verifies nothing about shipments. |
| Delivery event parser          | **None.**                                                                                                                                                                         |
| Retry queue / job runner       | **None.** No cron, no worker, no scheduler dependency.                                                                                                                            |
| Rate-limit handling            | In-memory rate limiting exists on the order-lookup Server Actions only. **No provider-side backoff or retry budget.**                                                             |
| Idempotency keys               | **Exist, for payments only** — `PaymentEvent.(provider, providerEventId)` unique, plus a guarded status update. Again a pattern to copy, not a shipment capability.               |
| Carrier error mapping          | **None.**                                                                                                                                                                         |
| Label generation               | **None.** No PDF engine of any kind.                                                                                                                                              |
| COD reconciliation             | **None.**                                                                                                                                                                         |

No carrier can be selected from `shippingMethodName`. It is free text
chosen by the merchant and routinely says things like `"Standard"` —
which names no carrier at all.

## Why Outcome B was rejected

Outcome B would add pure shipment status types, carrier adapter
interfaces and request/response mappings with no persistence. It was
considered and rejected: the brief itself names the decisions that must
not be locked in silently, and **every one of them is unresolved here**.

- **One carrier vs many.** A tenant may well use several. Whether a
  carrier is chosen per order, per method, or per destination is
  undecided, and the adapter's shape differs in each case.
- **Platform-wide vs tenant-specific credentials.** As above, the
  existing payment precedent points the wrong way for carriers. An
  interface written now would encode the wrong scope.
- **COD representation.** Whether the carrier is told the amount, whether
  it reports collection, and how that reconciles against a `Payment` row
  that is currently `pending` forever — all open.
- **Label format.** PDF, ZPL or a carrier-hosted URL changes the storage
  model and whether a blob is needed at all.
- **Webhook contract.** Each Vietnamese carrier has its own payload,
  signature scheme and state vocabulary. A union type written without one
  real contract in hand would be a guess.
- **Shipment split and partial fulfillment.** Whether one order can
  become several shipments determines the entire relational shape —
  including whether `OrderItem` needs a fulfilled-quantity column.
- **Cancellation timing.** What a merchant may do after handoff is both
  a product decision and a per-carrier constraint.

An interface is a commitment. Writing seven guesses into one, with no
caller and no implementation, would make them harder to revisit than
leaving them written down here as open questions. **The useful output of
this phase is the required domain model, not code.**

## Required future domain model

Documented, deliberately **not** added to the database. No migration was
written.

### Shipment

| Field                                                                                                          | Why                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenantId`                                                                                                     | Denormalised, with a composite FK to `(orderId, tenantId)` — this repo's existing tenant-safety pattern.                                       |
| `orderId`                                                                                                      | **Many shipments per order must be possible from day one.** Retrofitting a split later is a data migration.                                    |
| `id`                                                                                                           | Internal identity, distinct from anything the carrier issues.                                                                                  |
| `carrierKey`                                                                                                   | A closed enum of integrated carriers. **Never** `shippingMethodName`.                                                                          |
| `trackingNumber`                                                                                               | Nullable until the carrier issues one. Null is the normal early state, not an error.                                                           |
| `state`                                                                                                        | The lifecycle below.                                                                                                                           |
| `createdAt`, `submittedAt`, `acceptedAt`, `pickedUpAt`, `inTransitAt`, `deliveredAt`, `failedAt`, `returnedAt` | Separate nullable timestamps, not one mutable column. Each is evidence that a specific thing happened; a single `updatedAt` loses the history. |
| `failureReason`                                                                                                | Merchant-safe text, never a raw provider error dump — the existing `Payment.failureReason` convention.                                         |
| `providerShipmentId`                                                                                           | The carrier's own identifier, the correlation key for inbound webhooks.                                                                        |
| `providerEventId`                                                                                              | On the event table, not here — see ingestion.                                                                                                  |
| `codAmount`                                                                                                    | What the carrier was **asked** to collect. Distinct from whether it did.                                                                       |
| `shippingFee`                                                                                                  | What the carrier **charges the merchant**. Distinct from `Order.shippingAmount`.                                                               |
| `labelReference`                                                                                               | A blob key or carrier URL, plus its format. Never the label bytes inline.                                                                      |
| Audit fields                                                                                                   | Actor and timestamp on every transition, following `OrderEvent`'s actor model.                                                                 |

### Shipment items

`orderItemId` with a composite tenant-safe FK; a product/variant snapshot
following the existing `OrderItem.price` convention so later catalog
edits cannot rewrite history; `quantity`; `fulfilledQuantity`; and
`returnedQuantity` only if and when returns are actually supported.
**`OrderItem` has no fulfilled-quantity column today**, so partial
fulfillment needs a change there as well as a new table.

### Provider configuration

Scope must be decided before anything is written — the evidence above
suggests per-tenant, which this repository currently has no safe place
for. Requires: carrier account identity; environment (sandbox vs
production) as an explicit column, never inferred from `NODE_ENV`;
`enabled`; a webhook secret; a rotation story; and an audit trail of
configuration changes. **Secrets must never reach a Server Component
prop or any merchant-visible projection** — the posture
`TenantPaymentMethod` already takes, where Tenant Admin sees only
"configured" or "not configured".

### Event ingestion

Signed webhook, verified **before** anything is persisted, reusing the
HMAC + `timingSafeEqual` pattern already proven in `sepay-va-provider.ts`.
A `providerEventId` unique per carrier for deduplication, mirroring
`PaymentEvent`. A raw payload retained under a stated retention policy
with pruning, as `PaymentRejection` already does. A safe projection for
merchants that excludes the raw payload. An invalid signature rejected
without persistence and without telling the caller why. An unknown
shipment recorded at platform level with a null tenant, never guessed
into a tenant — the `PaymentRejection` precedent. **Explicit event
ordering**, because carrier events arrive out of order routinely; a
monotonic sequence plus a carrier-supplied timestamp, with
`OrderEvent.sequence` as the model. Replays must be idempotent.

### State semantics

Definitions for a future model. **The current application supports none
of these.**

```text
draft            a shipment composed locally; nothing sent
ready            complete enough to submit; still nothing sent
submitted        a request was sent to the carrier; outcome unknown
accepted         the carrier acknowledged and (usually) issued a tracking number
picked_up        the carrier reports possession of the parcel
in_transit       the carrier reports movement; no receipt yet
delivered        the carrier reports handover to the recipient
delivery_failed  an attempt failed; may be retried by the carrier
returned         the parcel came back to the merchant
cancelled        cancelled before handoff, or accepted as cancelled by the carrier
```

Two rules that must survive implementation: **`delivered` may only ever
be written from a verified carrier event**, never by a merchant action
or an internal inference; and **`submitted` is not `accepted`** — the
gap between them is exactly where timeouts and ambiguous failures live.

### Unresolved product decisions

Split shipments; partial fulfillment; partial delivery; whether an
address may be edited after creation (today it is immutable, and that is
a feature); cancellation after handoff; COD collection and its
reconciliation against `Payment`; carrier fee reconciliation; returns;
label reprint and whether a reprint is a new label; multiple carriers per
tenant; multiple shipments per order.

## Security and privacy requirements for future carrier work

- Authorize before every read and write. A layout's early return does not
  stop a child page streaming, so each page calls
  `requireTenantAdmin()`/`requirePlatformAdmin()` itself — the rule the
  rest of this codebase already follows.
- Carrier configuration is tenant-scoped and read only after
  authorization.
- **No cross-tenant tracking lookup.** A tracking number from another
  tenant must be indistinguishable from one that does not exist — the
  posture `getOrderTimeline()` already takes.
- No provider secret in any UI, prop, or serialized payload.
- No raw carrier payload in a merchant-facing projection.
- Signature verified before persistence, not after.
- Stable provider-event deduplication.
- Idempotent state transitions, so a replayed event is a no-op.
- Redacted logs and merchant-safe error messages.
- **No public tracking route unless explicitly designed.** A public
  endpoint keyed on a tracking number is an enumeration surface and needs
  its own threat model.

## Release implications

**None.** No schema change, no migration, no dependency, no route, no
environment variable. This phase is documentation and tests only, so
there is nothing to deploy and nothing to roll back. The existing
runbook (`prisma/migrations/20261014160000_add_order_event_sequence/RUNBOOK.md`)
is unchanged, because this phase adds no migration.

The two local-only migrations identified in the release-readiness phase
(`20261014160000_add_order_event_sequence`,
`20261016120000_add_payment_rejections`) remain the outstanding release
blockers, unaffected by this phase.
