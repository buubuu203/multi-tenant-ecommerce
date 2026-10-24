# Returns and refunds — capability audit

**Outcome A: discovery and documentation only. Returns and refunds are
not supported, and no refund or return feature was added.**

This application cannot represent a refund. Not "does not yet expose one
in the UI" — there is no field, no state, no provider operation and no
audit vocabulary that could record one. Adding a button would have
created false financial records.

Audited: `prisma/schema.prisma`, `Payment`, `PaymentEvent`, `Order`,
`OrderItem`, `Inventory`, `payment-service.ts`, `webhook-service.ts`, all
four provider adapters, `provider.ts`, `order-mutations.ts`,
`inventory-mutations.ts`, `order-events.ts`, `payment-reconciliation.ts`,
`tenant-admin/actions.ts`, and the migration history.

## Capability matrix

| Capability                   | Existing field/service       | Exact semantics? | Tenant-safe? | Auditable? | Safe now? | Reason                                                                                                                                                                                   |
| ---------------------------- | ---------------------------- | ---------------- | ------------ | ---------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full refund request          | none                         | No               | —            | No         | **No**    | No model. Needs a migration.                                                                                                                                                             |
| Partial refund request       | none                         | No               | —            | No         | **No**    | No amount ledger; nothing defines a partial amount against the order total.                                                                                                              |
| Refund provider submission   | `PaymentProvider`            | No               | —            | No         | **No**    | The interface has `createPayment`, `handleWebhook`, `cancelPayment`. **No refund operation on any adapter.**                                                                             |
| Provider refund confirmation | `webhook-service`            | No               | Yes          | Yes        | **No**    | The pipeline knows four outcomes, none a refund. A refund webhook would be rejected as `invalid_payload`.                                                                                |
| Refund failure               | none                         | No               | —            | No         | **No**    | Nothing to fail; no refund is ever submitted.                                                                                                                                            |
| Return request               | none                         | No               | —            | No         | **No**    | No model, no state, no reason field.                                                                                                                                                     |
| Return approval / rejection  | none                         | No               | —            | No         | **No**    | No state machine exists to approve against.                                                                                                                                              |
| Returned quantity            | none                         | No               | —            | No         | **No**    | `OrderItem` stores ordered quantity only.                                                                                                                                                |
| Inventory restoration        | `adjustInventoryOnHandInTx`  | Partly           | Yes          | Partly     | **No**    | A merchant can manually adjust stock, but nothing links an adjustment to a returned order, and `inventory_released` means a freed reservation, not goods coming back.                    |
| COD refund                   | none                         | No               | —            | No         | **No**    | There is no record the cash was ever collected (below).                                                                                                                                  |
| Bank transfer refund         | `TenantPaymentMethod.config` | No               | Yes          | —          | **No**    | The stored account is **the store's**, for receiving. No customer bank destination is stored anywhere.                                                                                   |
| MoMo refund                  | `momo-provider`              | No               | —            | No         | **No**    | No refund method on the adapter.                                                                                                                                                         |
| SePay refund                 | `sepay-va-provider`          | No               | —            | No         | **No**    | Same.                                                                                                                                                                                    |
| Refund audit trail           | `OrderEventType`             | No               | Yes          | No         | **No**    | Four values: `order_created`, `order_status_changed`, `payment_status_changed`, `inventory_released`. None can express requested / approved / rejected / submitted / succeeded / failed. |
| Customer notification        | `Customer`                   | No               | Yes          | No         | **No**    | Name, email and phone exist. No consent field, no template, no provider, no delivery state. See Phase 4.                                                                                 |

## What the existing semantics actually are

1. **Payment statuses:** `pending`, `succeeded`, `failed`, `expired`,
   `cancelled`. No refunded state.
2. **No status can stand in for a refund.** `cancelled` means a payment
   was cancelled before completing, not that money came back.
3. **`Payment.amount` is a snapshot of the order total at initiation.**
   Not a running balance and not a settled amount. There is nothing to
   decrement.
4. **`PaymentEvent` records webhook deliveries this system ACCEPTED.**
   Writing a refund into it would change what the model means and would
   collide with its `(provider, providerEventId)` idempotency contract.
5. **`providerMetadata` holds whatever the provider sent at creation.**
   It contains no refund evidence, is raw provider data, and is never
   exposed to the UI — relying on it would be unsafe on both counts.
6. **No provider has a refund API binding.** `cancelPayment` cancels a
   _pending_ payment at the provider; it never returns captured money.
7. **Webhook validation has no refund event type.** A refund callback
   would fail payload validation and be rejected.
8. **Order cancellation does not touch `Payment`.** It releases the
   inventory _reservation_ and records `inventory_released`. Verified by
   test: the payment row is byte-identical afterwards.
9. **Inventory is guarded and adjustable, not append-only.** Adjustments
   are allowed but cannot drop `onHand` below what is reserved. Nothing
   ties an adjustment to a return.
10. **Order events cannot record a refund request** without a new enum
    value, which is a migration.
11. **Audit cannot distinguish** requested / approved / rejected /
    submitted / succeeded / failed. It has four unrelated values.
12. **COD has no evidence of collection.** The payment row stays
    `pending` forever; there is no `collectedAt` or equivalent. A
    fulfilled COD order proves only that someone marked it fulfilled.
13. **No customer bank destination is stored.** The bank details in
    payment configuration are the store's own, for receiving money.
14. **No consent data exists.** Contact fields exist; permission to use
    them does not.

## Why not Outcome B or C

**Outcome C (real refunds) is impossible.** There is no provider refund
adapter, no refund webhook handling, no durable provider refund id, and
no amount ledger. The provider names in the enum describe payment
collection only.

**Outcome B (an internal return-request record) was rejected
deliberately**, not for difficulty. It would need a new model and a new
`OrderEventType` value — a third migration, on top of two that are
already release blockers — to deliver a request log that cannot restore
inventory, cannot move money, cannot reach a provider and cannot notify
anyone. The brief's own rule applies: do not create a migration to make a
UI look complete. When returns are built properly, that record should be
designed together with the refund path it feeds, not bolted on first.

Today a merchant refunds a customer through their bank or provider
console and records it in their own books. The payment operations page
already says exactly that, and that wording is deliberate.

## Prerequisites for real returns and refunds

In dependency order:

1. **A refund record**: tenant id, order id, payment id, amount with
   explicit meaning, state, reason, actor, timestamps, and provider
   fields left null until provider evidence exists. Append-only.
2. **A return record** if goods physically come back: returned quantity
   per order item, condition, and an explicit link to any inventory
   adjustment made as a result.
3. **New audit event types** for each transition, so requested, approved,
   rejected, submitted, succeeded and failed are distinguishable.
4. **A refund operation on the provider boundary**, with a durable
   provider refund id, amount validation against the original payment,
   idempotency, and failure handling.
5. **Refund webhook handling**, including the same amount gate and
   duplicate-delivery protection the payment path already has.
6. **An eligibility rule** stated explicitly — what is refundable, how
   much, and for how long — rather than inferred from a status.
7. **A customer refund destination** for bank transfer, which the system
   does not collect today and which is sensitive data.
8. **Notification infrastructure and consent** before telling a customer
   anything. That is Phase 4.

Until 1–5 exist, any refund UI would be recording a claim rather than a
fact.

## What this audit changed

Nothing functional. No mutation, no route, no migration, no dependency.
Money cannot move, inventory cannot change, no provider is called, and no
customer is notified — none of those paths exist to invoke.

Fifteen tests now pin this position, including the four inferences that
are easiest to make wrongly: cancellation is not a refund, a released
reservation is not restocked goods, fulfilment is not settlement, and COD
is not collected cash.
