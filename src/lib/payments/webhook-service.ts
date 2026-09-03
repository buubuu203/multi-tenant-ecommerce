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
 * Steps, in order:
 *   1. provider.handleWebhook() — verifies signature/timestamp BEFORE
 *      ever parsing the payload for business use (each provider adapter
 *      owns this ordering internally).
 *   2. Find the Payment by providerOrderId. Unknown -> reject, no read
 *      or write beyond the lookup itself.
 *   3. Insert PaymentEvent keyed on (provider, providerEventId) — the
 *      unique constraint is the FIRST, DB-enforced dedupe layer. A
 *      genuine duplicate webhook hits a unique-violation here and this
 *      function treats it as an already-processed success (no
 *      reprocessing, no error surfaced to the provider — providers retry
 *      on anything other than a clean success response).
 *   4. V1 exact-payment policy: if the provider reported "succeeded" but
 *      the verified amount doesn't match Payment.amount, this is
 *      downgraded to a rejection — a wrong-amount transfer must NEVER
 *      transition Payment to succeeded, partial or otherwise (partial
 *      payment support is explicitly out of scope for V1).
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
    // this exact webhook delivery was already recorded — a legitimate
    // duplicate/retry, not an error. Report success so the provider
    // stops retrying, without touching Payment.status again.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { accepted: true };
    }
    throw e;
  }

  // Amount is only meaningful for a would-be SUCCESS — an outbound/failed
  // transfer being additionally the "wrong" amount is not a distinct
  // failure mode worth rejecting the webhook over, it's just still a
  // failed payment. Only a succeeded-but-wrong-amount transfer is
  // downgraded and explicitly reported back as a rejection (never
  // silently recorded as a quiet "failed" — the caller should know this
  // specific payment needs manual attention).
  const finalStatus = result.newStatus;
  if (finalStatus === "succeeded" && result.verifiedAmount !== payment.amount) {
    return { accepted: false, reason: "amount_mismatch" };
  }

  await prisma.payment.updateMany({
    where: { id: payment.id, status: "pending" },
    data: {
      status: finalStatus,
      providerTransactionId: result.providerEventId,
    },
  });

  return { accepted: true };
}
