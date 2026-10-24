import { platformDb } from '@/lib/db/platform-db';
import type { PaymentRejectionReason } from '@/generated/prisma/client';

/**
 * Platform-level view of rejected webhook evidence.
 *
 * This is the ONLY place rows with a null tenantId are readable. A
 * rejection that resolved to no payment has no trustworthy owner, so it
 * never belongs in a merchant's queue — but a platform operator still
 * needs to see that deliveries are arriving and being refused.
 *
 * It reads through platformDb deliberately, because the rows it exists to
 * show are precisely the ones no tenant scope would return. Every caller
 * must therefore authorize with requirePlatformAdmin() FIRST; there is no
 * tenant filter here to fall back on.
 *
 * The projection is narrower than the table on purpose. payloadDigest,
 * dedupeKey, paymentId and tenantId are never selected — the digest is
 * one-way and harmless, but it is also useless to an operator, and the
 * safest field is the one that never leaves the database.
 */

export type RejectionAttribution = 'attributed' | 'unattributed';

export type PlatformRejectionRow = {
  /** Stable row identity, needed only so the UI can key a list. */
  id: string;
  provider: string;
  reason: PaymentRejectionReason;
  /** Whether a verified tenant exists — never WHICH tenant. */
  attribution: RejectionAttribution;
  /** Whether a payment resolved at rejection time. */
  resolvedPayment: boolean;
  /** The provider's correlation key. Bounded, and already its own id. */
  providerOrderId: string | null;
  expectedAmount: number | null;
  reportedAmount: number | null;
  /** reported − expected, or null when either side is unknown. */
  difference: number | null;
  occurrences: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

export type PlatformRejectionMetrics = {
  total: number;
  attributed: number;
  unattributed: number;
  byProvider: { provider: string; count: number }[];
  byReason: { reason: PaymentRejectionReason; count: number }[];
  /** Rows seen more than once — a provider retrying a refused delivery. */
  highOccurrence: number;
  /** Rows first seen in the last 24 hours. */
  recent: number;
};

export type PlatformRejectionFilters = {
  provider?: string;
  reason?: PaymentRejectionReason;
  attribution?: RejectionAttribution;
  /** Inclusive lower bound on lastSeenAt. */
  since?: Date;
  /** Exclusive upper bound on lastSeenAt. */
  until?: Date;
  /** Exact match on the provider's correlation key only. */
  providerOrderId?: string;
  page?: number;
};

export const PLATFORM_PAGE_SIZE = 25;

function buildWhere(filters: PlatformRejectionFilters) {
  const lastSeenAt =
    filters.since || filters.until
      ? {
          ...(filters.since ? { gte: filters.since } : {}),
          ...(filters.until ? { lt: filters.until } : {}),
        }
      : undefined;

  return {
    ...(filters.provider ? { provider: filters.provider as never } : {}),
    ...(filters.reason ? { reason: filters.reason } : {}),
    ...(filters.attribution === 'unattributed' ? { tenantId: null } : {}),
    ...(filters.attribution === 'attributed' ? { tenantId: { not: null } } : {}),
    // Exact match only. A `contains` search over a provider reference
    // would let an operator probe for references they do not already have.
    ...(filters.providerOrderId ? { providerOrderId: filters.providerOrderId } : {}),
    ...(lastSeenAt ? { lastSeenAt } : {}),
  };
}

/**
 * One page of evidence plus the metrics, in four bounded queries. The
 * ordering puts the rows an operator should look at first: repeated
 * deliveries, then most recent, with id breaking ties so pagination is
 * deterministic.
 */
export async function listPlatformRejections(
  filters: PlatformRejectionFilters = {},
  now: Date = new Date(),
): Promise<{
  rows: PlatformRejectionRow[];
  totalCount: number;
  metrics: PlatformRejectionMetrics;
}> {
  const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
  const where = buildWhere(filters);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [rejections, totalCount, byProvider, byReason, unattributed, highOccurrence, recent] =
    await Promise.all([
      platformDb.paymentRejection.findMany({
        where,
        orderBy: [{ occurrences: 'desc' }, { lastSeenAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * PLATFORM_PAGE_SIZE,
        take: PLATFORM_PAGE_SIZE,
        select: {
          id: true,
          provider: true,
          reason: true,
          providerOrderId: true,
          expectedAmount: true,
          reportedAmount: true,
          occurrences: true,
          firstSeenAt: true,
          lastSeenAt: true,
          // Selected only to derive two booleans below; neither value is
          // ever returned.
          tenantId: true,
          paymentId: true,
        },
      }),
      platformDb.paymentRejection.count({ where }),
      platformDb.paymentRejection.groupBy({ by: ['provider'], _count: { _all: true } }),
      platformDb.paymentRejection.groupBy({ by: ['reason'], _count: { _all: true } }),
      platformDb.paymentRejection.count({ where: { tenantId: null } }),
      platformDb.paymentRejection.count({ where: { occurrences: { gt: 1 } } }),
      platformDb.paymentRejection.count({ where: { firstSeenAt: { gte: dayAgo } } }),
    ]);

  const total = byReason.reduce((sum, group) => sum + group._count._all, 0);

  const rows: PlatformRejectionRow[] = rejections.map((rejection) => ({
    id: rejection.id,
    provider: rejection.provider,
    reason: rejection.reason,
    // The BOOLEAN, never the tenant id itself.
    attribution: rejection.tenantId === null ? 'unattributed' : 'attributed',
    resolvedPayment: rejection.paymentId !== null,
    providerOrderId: rejection.providerOrderId,
    expectedAmount: rejection.expectedAmount,
    reportedAmount: rejection.reportedAmount,
    difference:
      rejection.expectedAmount !== null && rejection.reportedAmount !== null
        ? rejection.reportedAmount - rejection.expectedAmount
        : null,
    occurrences: rejection.occurrences,
    firstSeenAt: rejection.firstSeenAt,
    lastSeenAt: rejection.lastSeenAt,
  }));

  return {
    rows,
    totalCount,
    metrics: {
      total,
      attributed: total - unattributed,
      unattributed,
      byProvider: byProvider.map((group) => ({
        provider: group.provider,
        count: group._count._all,
      })),
      byReason: byReason.map((group) => ({ reason: group.reason, count: group._count._all })),
      highOccurrence,
      recent,
    },
  };
}
