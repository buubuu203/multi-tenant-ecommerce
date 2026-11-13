import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { PaymentProviderType, PaymentRejectionReason } from '@/generated/prisma/client';

/**
 * Recording evidence of a webhook delivery that was REJECTED.
 *
 * This module only ever writes. It never decides whether a webhook is
 * accepted — webhook-service.ts already made that call, and recording
 * evidence must not be able to change it.
 *
 * Three rules it exists to enforce:
 *
 *  1. An unauthenticated request writes nothing. A failed signature check
 *     never reaches here, so nobody who cannot sign a request can insert
 *     rows into this table.
 *  2. A tenant is recorded only when a Payment really resolved. Otherwise
 *     tenantId stays null and the row is platform-level, invisible to
 *     every tenant queue. Ownership is never guessed from a name, an
 *     amount or a reference.
 *  3. No raw payload is stored. Only a SHA-256 digest, which is one-way
 *     and used solely to recognise a repeat delivery when the provider
 *     supplies no stable event id.
 */

/** One-way. Never rendered, never reversed — only compared. */
export function payloadDigest(rawBody: string): string {
  return createHash('sha256').update(rawBody, 'utf8').digest('hex');
}

/**
 * The deduplication key.
 *
 * The provider's own stable event id when it gives one. Otherwise the
 * payload digest, which is stable for a byte-identical retry — the
 * documented fallback. Never a random per-request id, which would make
 * every retry a new row.
 */
export function dedupeKeyFor(providerEventId: string | null, digest: string): string {
  const trimmed = providerEventId?.trim();
  return trimmed && trimmed !== '' ? `event:${trimmed}` : `digest:${digest}`;
}

export type RejectionEvidence = {
  provider: PaymentProviderType;
  reason: PaymentRejectionReason;
  rawBody: string;
  providerEventId?: string | null;
  providerOrderId?: string | null;
  /** Supplied ONLY when a Payment actually resolved. */
  tenantId?: string | null;
  paymentId?: string | null;
  orderId?: string | null;
  expectedAmount?: number | null;
  reportedAmount?: number | null;
};

/** Amounts are integers in the same VND convention as Payment.amount. */
function boundedAmount(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

/**
 * Upserts one rejection row. A repeat of the same rejected delivery bumps
 * `occurrences` and `lastSeenAt` instead of inserting, so a provider
 * retrying indefinitely cannot grow the table without bound.
 *
 * Best-effort by design: evidence must never break the webhook response a
 * provider depends on. A failure here is logged and swallowed, because
 * the rejection itself has already been decided and returned correctly.
 */
export async function recordPaymentRejection(evidence: RejectionEvidence): Promise<void> {
  const digest = payloadDigest(evidence.rawBody);
  const dedupeKey = dedupeKeyFor(evidence.providerEventId ?? null, digest);

  try {
    await prisma.paymentRejection.upsert({
      where: { provider_dedupeKey: { provider: evidence.provider, dedupeKey } },
      create: {
        provider: evidence.provider,
        dedupeKey,
        reason: evidence.reason,
        // Null unless a Payment really resolved — see rule 2 above.
        tenantId: evidence.tenantId ?? null,
        paymentId: evidence.paymentId ?? null,
        orderId: evidence.orderId ?? null,
        providerOrderId: evidence.providerOrderId ?? null,
        expectedAmount: boundedAmount(evidence.expectedAmount),
        reportedAmount: boundedAmount(evidence.reportedAmount),
        payloadDigest: digest,
      },
      update: {
        occurrences: { increment: 1 },
        lastSeenAt: new Date(),
      },
    });
  } catch (error) {
    // Never surfaces to the provider: the webhook's own outcome stands.
    console.error('recordPaymentRejection failed:', error);
  }
}
