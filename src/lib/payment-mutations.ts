import { randomUUID } from "crypto";
import { getScopedDb } from "./db/tenant-db";
import { prisma } from "./prisma";
import { initiateMomoPayment, verifyMomoIpnSignature, type MomoIpnPayload } from "./momo";
import type { ActionResult } from "./action-result";

// Step 48: Payment is NOT in getScopedDb()'s auto-scoped model list (same
// documented gap as Order/Customer — see order-mutations.ts) — every
// query here uses an explicit tenantId, same manual-scoping convention.

export type InitiatePaymentResult =
  | { initiated: true; payUrl: string }
  | { initiated: false; error: string };

/**
 * Creates the Payment row for a MoMo order and starts the MoMo payment.
 * Called AFTER createOrder() has already succeeded — the Order and its
 * inventory reservation already exist and are NEVER rolled back by
 * anything in this function, per the approved pay-after design. If MoMo
 * initiation fails (not configured, network error, MoMo rejects the
 * request), a Payment row is still created with status "failed" — so the
 * Order/Payment relationship always exists once an order reaches this
 * point, and the customer/merchant have a consistent record of "payment
 * did not start," not a silently missing payment.
 *
 * tenantId must be the trusted value already used to create the order —
 * never accepted from the browser.
 */
export async function initiatePaymentForOrder(
  tenantId: string,
  orderId: string,
  amount: number,
  orderInfo: string,
): Promise<InitiatePaymentResult> {
  const result = await initiateMomoPayment({ orderId, amount, orderInfo });

  if (!result.success) {
    // Fresh, unguessable reference even for the failed-to-initiate case —
    // required by the unique providerOrderId column, and harmless since
    // MoMo was never actually told about it.
    const fallbackProviderOrderId = `${orderId}-failed-${randomUUID()}`;
    await prisma.payment.create({
      data: {
        tenantId,
        orderId,
        status: "failed",
        providerOrderId: fallbackProviderOrderId,
        amount,
      },
    });
    return { initiated: false, error: result.error };
  }

  await prisma.payment.create({
    data: {
      tenantId,
      orderId,
      status: "pending",
      providerOrderId: result.providerOrderId,
      amount,
    },
  });

  return { initiated: true, payUrl: result.payUrl };
}

/**
 * Processes a MoMo IPN (webhook) callback. This is the ONLY place Payment
 * status ever changes after creation.
 *
 * Steps, in order:
 *   1. Verify the signature — an invalid signature is rejected outright,
 *      no database read/write of any kind.
 *   2. Find the Payment by providerOrderId (the orderId MoMo echoes back)
 *      — NOT scoped by a caller-supplied tenantId (there is none; this is
 *      a public webhook endpoint reached directly by MoMo, not through
 *      any tenant hostname). The Payment row itself carries the correct
 *      tenantId, resolved from the payload's own correlation key — this
 *      is the correct pattern for a payment-provider callback, not a
 *      tenant-isolation gap (no cross-tenant data is ever read or
 *      written; the lookup key is a per-attempt-unique reference, not a
 *      guessable id).
 *   3. Guarded atomic UPDATE: only transitions status FROM "pending" TO
 *      "succeeded"/"failed" (WHERE status = 'pending'). A duplicate or
 *      replayed webhook for an already-terminal Payment matches zero rows
 *      and does nothing further — this IS the idempotency guarantee, the
 *      same atomic-guarded-UPDATE philosophy used throughout this
 *      project's inventory mutations, applied here to a different field.
 *   4. Order.status is NEVER read or written here — payment success does
 *      not fulfill the order, payment failure does not cancel it or
 *      release inventory, per the approved MVP boundary.
 */
export async function handleMomoWebhook(payload: MomoIpnPayload): Promise<ActionResult<{ processed: boolean }>> {
  if (!verifyMomoIpnSignature(payload)) {
    return { success: false, error: "Invalid signature." };
  }

  const payment = await prisma.payment.findUnique({ where: { providerOrderId: payload.orderId } });
  if (!payment) {
    return { success: false, error: "Unknown payment." };
  }

  const resultCode = Number(payload.resultCode);
  const nextStatus = resultCode === 0 ? "succeeded" : "failed";

  const updated = await prisma.payment.updateMany({
    where: { id: payment.id, status: "pending" },
    data: { status: nextStatus, providerTransactionId: String(payload.transId) },
  });

  // updated.count === 0 means this Payment was already succeeded/failed
  // (a duplicate/replayed webhook) — not an error, just a no-op. Report
  // success either way so MoMo does not keep retrying.
  return { success: true, data: { processed: updated.count > 0 } };
}

/** Read-only helper for tests/verification — tenant-scoped. */
export async function getPaymentForOrder(tenantId: string, orderId: string) {
  const db = getScopedDb(tenantId);
  return db.payment.findFirst({ where: { orderId, tenantId } });
}
