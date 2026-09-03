import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { PaymentProviderType } from "@/generated/prisma/client";
import { getProvider } from "./payment-service";

export type WebhookProcessResult =
  | { accepted: true }
  | { accepted: false; reason: "invalid_signature" | "invalid_payload" | "unknown_payment" | "amount_mismatch" };

/**
 * Shared webhook pipeline for any provider whose PaymentProvider
 * implementation does real signature verification (SePay, MoMo).
 *
 * Tenant resolution model (per the approved correction): a webhook has NO
 * browser/storefront tenant context at all. Tenant identity comes
 * EXCLUSIVELY from the Payment row found via the provider's own
 * correlation key (providerOrderId) — never from a query param, request
 * body field, or any client-supplied value. This function never reads a
 * `tenantId` off the incoming request.
 *
 * Steps, in order (per the approved correction — PaymentEvent represents
 * an event this system has ACCEPTED, not merely received; nothing gets
 * recorded until every validation step has passed):
 *   1. provider.handleWebhook() — verifies signature/timestamp BEFORE
 *      ever parsing the payload for business use, and rejects anything
 *      that isn't a real inbound-payment-relevant event (e.g. SePay's
 *      outbound-transfer case) — each provider adapter owns this.
 *   2. Find the Payment by providerOrderId. Unknown -> reject, no read
 *      or write beyond the lookup itself.
 *   3. If the provider reported "succeeded", the verified amount MUST
 *      equal Payment.amount, checked HERE — before anything is recorded.
 *      A mismatch is rejected outright: no PaymentEvent, Payment stays
 *      untouched. This is deliberate: recording the event here would let
 *      a RETRY of the same wrong-amount webhook be mistaken for an
 *      already-processed duplicate and get a false success response —
 *      a retry of a genuinely wrong-amount transfer must be rejected
 *      every single time, not just the first. Partial payments (SePay/
 *      BIDV can support them) are explicitly OUT OF SCOPE for V1 — a
 *      partial-amount transfer must never transition Payment to
 *      succeeded.
 *   4. ONLY NOW — past every validation — insert PaymentEvent keyed on
 *      (provider, providerEventId). The unique constraint is the FIRST,
 *      DB-enforced dedupe layer, but it can only ever fire for an event
 *      that was ACCEPTED once already; a genuine duplicate of a validly
 *      processed webhook hits the unique violation and is treated as an
 *      already-processed success (no reprocessing, no error surfaced —
 *      providers retry on anything other than a clean success response).
 *   5. Atomic guarded UPDATE ... WHERE status = 'pending' — the SECOND,
 *      independent dedupe layer (same proven pattern as the original
 *      Step 48 MoMo implementation). A payment already in a terminal
 *      state matches zero rows and is a no-op.
 *   6. Order.status is NEVER read or written here.
 */
export async function processProviderWebhook(
  providerType: PaymentProviderType,
  rawBody: string,
  headers: Headers,
): Promise<WebhookProcessResult> {
  const provider = getProvider(providerType);
  const result = await provider.handleWebhook(rawBody, headers);

  if (!result.success) {
    return { accepted: false, reason: result.error === "Invalid signature." ? "invalid_signature" : "invalid_payload" };
  }

  const payment = await prisma.payment.findUnique({ where: { providerOrderId: result.providerOrderId } });
  if (!payment) {
    return { accepted: false, reason: "unknown_payment" };
  }

  // Gate BEFORE recording anything — see doc comment step 3 above. A
  // provider-reported "failed" (e.g. MoMo's own resultCode != 0 — a real,
  // definitive outcome from the provider itself, not an ambiguous case
  // like SePay's outbound transfer, which the provider already rejected
  // earlier) proceeds straight through; only a would-be "succeeded" is
  // amount-gated here.
  if (result.newStatus === "succeeded" && result.verifiedAmount !== payment.amount) {
    return { accepted: false, reason: "amount_mismatch" };
  }

  try {
    await prisma.paymentEvent.create({
      data: {
        paymentId: payment.id,
        provider: providerType,
        providerEventId: result.providerEventId,
        rawPayload: result.rawPayload as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    // Unique constraint violation on (provider, providerEventId) means
    // this exact, ALREADY-VALID webhook delivery was already recorded —
    // a legitimate duplicate/retry, not an error. Report success so the
    // provider stops retrying, without touching Payment.status again.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { accepted: true };
    }
    throw e;
  }

  await prisma.payment.updateMany({
    where: { id: payment.id, status: "pending" },
    data: {
      status: result.newStatus,
      providerTransactionId: result.providerEventId,
    },
  });

  return { accepted: true };
}
