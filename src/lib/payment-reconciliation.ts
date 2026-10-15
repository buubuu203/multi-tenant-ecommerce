import { getScopedDb } from './db/tenant-db';

/**
 * Read-only reconciliation view over payments that already exist.
 *
 * It derives nothing it cannot prove. Everything below comes from stored
 * columns — Payment.status, Payment.expiresAt, Payment.provider and the
 * order's own status — never from a provider payload and never from a
 * fresh API call.
 *
 * WHAT CANNOT BE DERIVED, and is therefore absent rather than guessed.
 * This is not a gap in the UI; it is a property of how webhooks are
 * handled, and the reason is worth stating once:
 *
 *   webhook-service.ts validates a reported amount against Payment.amount
 *   BEFORE recording anything, and rejects a mismatch outright. It also
 *   rejects a webhook whose payment it cannot find. In both cases NOTHING
 *   IS PERSISTED — no PaymentEvent, no status change, no marker row.
 *
 *   So an underpayment, an overpayment and an unmatched bank transfer
 *   leave no trace in this database at all. They are not hard to query;
 *   there is nothing to query. Showing a count of zero would be a lie,
 *   so those categories do not exist here.
 *
 *   Duplicate deliveries are likewise swallowed: (provider,
 *   providerEventId) is unique, and a repeat is reported back as accepted
 *   without writing a second row. A duplicate is correctly a non-event,
 *   not an exception to review.
 *
 *   "Processing" is not a stored state either — PaymentStatus has no such
 *   value — so it is not displayed as one.
 */

/** Categories every one of which maps to stored data. */
export const RECONCILIATION_CATEGORIES = [
  'awaiting_payment',
  'paid',
  'failed',
  'expired',
  'cancelled',
] as const;
export type ReconciliationCategory = (typeof RECONCILIATION_CATEGORIES)[number];

/**
 * Why a payment wants a human. Each rule compares two stored facts; none
 * infers anything about money that was or was not received.
 */
export type ReviewReason =
  /** Provider window elapsed while the row is still pending. */
  | 'pending_past_expiry'
  /** The order was cancelled but its payment succeeded. */
  | 'paid_for_cancelled_order'
  /** Shipped while the payment never succeeded, and it is not COD. */
  | 'fulfilled_without_payment'
  /** COD order fulfilled: cash is collected offline and never recorded. */
  | 'cod_awaiting_confirmation';

export const REVIEW_REASON_LABEL: Record<ReviewReason, string> = {
  pending_past_expiry: 'Payment window has passed while still pending',
  paid_for_cancelled_order: 'Payment succeeded but the order was cancelled',
  fulfilled_without_payment: 'Order fulfilled while payment has not succeeded',
  cod_awaiting_confirmation: 'Cash on delivery — collection is not recorded in the system',
};

/** What a merchant should actually do. No action is taken automatically. */
export const REVIEW_REASON_ACTION: Record<ReviewReason, string> = {
  pending_past_expiry:
    'Check with the provider whether the transfer arrived, then confirm or cancel the order.',
  paid_for_cancelled_order:
    'Refund the customer outside this system, then record it in your books.',
  fulfilled_without_payment: 'Confirm payment on the order, or follow up with the customer.',
  cod_awaiting_confirmation: 'Confirm the courier remitted the cash. This system cannot verify it.',
};

export type PaymentRow = {
  /** The order reference — already customer-facing. */
  orderReference: string;
  provider: string;
  paymentMethod: string;
  category: ReconciliationCategory;
  /** The amount the payment was opened for. Never a "received" amount. */
  expectedAmount: number;
  orderStatus: string;
  createdAt: Date;
  expiresAt: Date | null;
  /**
   * The provider's own transaction id, already stored as a plain column
   * and shown on the order. Never a signature, token or payload.
   */
  providerTransactionId: string | null;
  reviewReasons: ReviewReason[];
  /** Only bank_transfer_manual has an existing confirm action. */
  canConfirmManually: boolean;
};

export type ReconciliationSummary = {
  counts: Record<ReconciliationCategory, number>;
  needsReview: number;
  /**
   * Summed Payment.amount for succeeded rows. Labelled as "opened for",
   * not "received": the system never observes a bank balance.
   */
  paidAmount: number;
};

/** Derives the category from stored status alone. */
export function categoryFor(status: string): ReconciliationCategory | null {
  switch (status) {
    case 'pending':
      return 'awaiting_payment';
    case 'succeeded':
      return 'paid';
    case 'failed':
      return 'failed';
    case 'expired':
      return 'expired';
    case 'cancelled':
      return 'cancelled';
    default:
      // An unrecognised status is never guessed into a category.
      return null;
  }
}

/** Cross-checks between a payment and its order. Pure and testable. */
export function reviewReasonsFor(input: {
  status: string;
  provider: string;
  orderStatus: string;
  expiresAt: Date | null;
  now: Date;
}): ReviewReason[] {
  const reasons: ReviewReason[] = [];

  if (
    input.status === 'pending' &&
    input.expiresAt !== null &&
    input.expiresAt.getTime() < input.now.getTime()
  ) {
    reasons.push('pending_past_expiry');
  }

  if (input.status === 'succeeded' && input.orderStatus === 'cancelled') {
    reasons.push('paid_for_cancelled_order');
  }

  // COD is settled in cash with the courier and the row stays pending by
  // design, so it is never "fulfilled without payment" — it gets its own,
  // honestly-worded reason instead.
  if (input.orderStatus === 'fulfilled' && input.status !== 'succeeded') {
    reasons.push(
      input.provider === 'cod' ? 'cod_awaiting_confirmation' : 'fulfilled_without_payment',
    );
  }

  return reasons;
}

export type ReconciliationFilters = {
  provider?: string;
  category?: ReconciliationCategory;
  needsReview?: boolean;
  search?: string;
  page?: number;
};

export const PAGE_SIZE = 25;
/** Hard ceiling so a large tenant cannot load an unbounded page. */
export const MAX_PAGE_SIZE = 100;

/**
 * One tenant-scoped query plus one projection. No raw payload, no
 * secrets, no internal ids beyond the order reference.
 */
export async function listPaymentReconciliation(
  tenantId: string,
  filters: ReconciliationFilters = {},
  now: Date = new Date(),
): Promise<{ rows: PaymentRow[]; totalCount: number; summary: ReconciliationSummary }> {
  const db = getScopedDb(tenantId);
  const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
  const take = Math.min(PAGE_SIZE, MAX_PAGE_SIZE);
  const search = filters.search?.trim();

  const statusForCategory: Record<ReconciliationCategory, string> = {
    awaiting_payment: 'pending',
    paid: 'succeeded',
    failed: 'failed',
    expired: 'expired',
    cancelled: 'cancelled',
  };

  const where = {
    tenantId,
    ...(filters.provider ? { provider: filters.provider as never } : {}),
    ...(filters.category ? { status: statusForCategory[filters.category] as never } : {}),
    ...(search
      ? {
          OR: [
            { orderId: { contains: search, mode: 'insensitive' as const } },
            { providerTransactionId: { contains: search, mode: 'insensitive' as const } },
            { order: { customer: { phone: { contains: search } } } },
            { order: { customer: { email: { contains: search, mode: 'insensitive' as const } } } },
          ],
        }
      : {}),
  };

  // One query for the page, one for the count, one grouped query for the
  // summary — no per-row follow-up, so no N+1.
  const [payments, totalCount, grouped] = await Promise.all([
    db.payment.findMany({
      where,
      // Deterministic: createdAt can tie, so id breaks it.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * take,
      take,
      select: {
        orderId: true,
        provider: true,
        status: true,
        amount: true,
        expiresAt: true,
        createdAt: true,
        providerTransactionId: true,
        order: { select: { status: true, paymentMethod: true } },
      },
    }),
    db.payment.count({ where }),
    db.payment.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ]);

  const counts: Record<ReconciliationCategory, number> = {
    awaiting_payment: 0,
    paid: 0,
    failed: 0,
    expired: 0,
    cancelled: 0,
  };
  let paidAmount = 0;
  for (const group of grouped) {
    const category = categoryFor(group.status);
    if (!category) continue;
    counts[category] += group._count._all;
    if (category === 'paid') paidAmount += group._sum.amount ?? 0;
  }

  const rows: PaymentRow[] = payments
    .map((payment): PaymentRow | null => {
      const category = categoryFor(payment.status);
      if (!category) return null;
      const reviewReasons = reviewReasonsFor({
        status: payment.status,
        provider: payment.provider,
        orderStatus: payment.order.status,
        expiresAt: payment.expiresAt,
        now,
      });
      return {
        orderReference: payment.orderId,
        provider: payment.provider,
        paymentMethod: payment.order.paymentMethod,
        category,
        expectedAmount: payment.amount,
        orderStatus: payment.order.status,
        createdAt: payment.createdAt,
        expiresAt: payment.expiresAt,
        providerTransactionId: payment.providerTransactionId,
        reviewReasons,
        canConfirmManually:
          payment.provider === 'bank_transfer_manual' && payment.status === 'pending',
      };
    })
    .filter((row): row is PaymentRow => row !== null)
    .filter((row) => (filters.needsReview ? row.reviewReasons.length > 0 : true));

  // Counting rows needing review requires the cross-check, so it is done
  // over the same bounded page set the merchant is looking at.
  const needsReview = rows.filter((row) => row.reviewReasons.length > 0).length;

  return { rows, totalCount, summary: { counts, needsReview, paidAmount } };
}

// ---------------------------------------------------------------------
// Rejected-delivery exceptions.
//
// These exist only because payment_rejections now persists evidence that
// was previously discarded. Every category below is read off stored
// columns — expectedAmount and reportedAmount captured at rejection time
// — and none is inferred.
//
// Only rejections with a VERIFIED tenant are ever returned here. A
// rejection that resolved to no payment has a null tenantId and stays
// platform-level: it is real evidence, but it belongs to nobody, and
// showing it to a merchant would mean guessing.
// ---------------------------------------------------------------------

export const EXCEPTION_CATEGORIES = ['underpaid', 'overpaid', 'invalid', 'duplicate'] as const;
export type ExceptionCategory = (typeof EXCEPTION_CATEGORIES)[number];

export const EXCEPTION_LABEL: Record<ExceptionCategory, string> = {
  underpaid: 'Underpaid',
  overpaid: 'Overpaid',
  invalid: 'Rejected as invalid',
  duplicate: 'Repeated rejection',
};

export const EXCEPTION_ACTION: Record<ExceptionCategory, string> = {
  underpaid:
    'The customer sent less than the order total. Ask for the difference, or cancel the order.',
  overpaid:
    'The customer sent more than the order total. Refund the difference outside this system.',
  invalid: 'The provider sent something this store could not read. Nothing was applied.',
  duplicate: 'The same rejected delivery arrived more than once. It was rejected every time.',
};

/**
 * Classifies one stored rejection.
 *
 * Returns null when the facts needed are absent — an amount mismatch
 * whose amounts were not parseable is NOT guessed into underpaid.
 */
export function exceptionCategoryFor(rejection: {
  reason: string;
  expectedAmount: number | null;
  reportedAmount: number | null;
  occurrences: number;
}): ExceptionCategory | null {
  if (rejection.reason === 'invalid_payload') return 'invalid';

  if (rejection.reason === 'amount_mismatch') {
    const { expectedAmount, reportedAmount } = rejection;
    if (expectedAmount === null || reportedAmount === null) return null;
    if (reportedAmount < expectedAmount) return 'underpaid';
    if (reportedAmount > expectedAmount) return 'overpaid';
    // Equal amounts cannot be a mismatch; treat as unclassifiable rather
    // than inventing a category for an impossible row.
    return null;
  }

  // unknown_payment is never tenant-visible, so it never reaches here.
  return null;
}

export type PaymentExceptionRow = {
  provider: string;
  category: ExceptionCategory;
  /** Null when the rejection resolved no order. */
  orderReference: string | null;
  expectedAmount: number | null;
  reportedAmount: number | null;
  /** reported − expected. Null when either side is unknown. */
  difference: number | null;
  occurrences: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

export type ExceptionFilters = {
  provider?: string;
  category?: ExceptionCategory;
  search?: string;
  page?: number;
};

/**
 * Tenant-visible rejection evidence.
 *
 * The `tenantId: tenantId` filter is doing real work: rows with a null
 * tenantId — every unmatched delivery — are excluded by it, which is the
 * mechanism that keeps platform-level evidence out of merchant queues.
 */
export async function listPaymentExceptions(
  tenantId: string,
  filters: ExceptionFilters = {},
): Promise<{ rows: PaymentExceptionRow[]; totalCount: number }> {
  const db = getScopedDb(tenantId);
  const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
  const take = Math.min(PAGE_SIZE, MAX_PAGE_SIZE);
  const search = filters.search?.trim();

  const where = {
    tenantId,
    ...(filters.provider ? { provider: filters.provider as never } : {}),
    ...(search
      ? {
          OR: [
            { orderId: { contains: search, mode: 'insensitive' as const } },
            { providerOrderId: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [rejections, totalCount] = await Promise.all([
    db.paymentRejection.findMany({
      where,
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * take,
      take,
      select: {
        provider: true,
        reason: true,
        orderId: true,
        expectedAmount: true,
        reportedAmount: true,
        occurrences: true,
        firstSeenAt: true,
        lastSeenAt: true,
        // payloadDigest, dedupeKey, paymentId and tenantId are NOT
        // selected: nothing that is not shown should leave the database.
      },
    }),
    db.paymentRejection.count({ where }),
  ]);

  const rows = rejections
    .map((rejection): PaymentExceptionRow | null => {
      const category = exceptionCategoryFor(rejection);
      if (!category) return null;
      const difference =
        rejection.expectedAmount !== null && rejection.reportedAmount !== null
          ? rejection.reportedAmount - rejection.expectedAmount
          : null;
      return {
        provider: rejection.provider,
        category,
        orderReference: rejection.orderId,
        expectedAmount: rejection.expectedAmount,
        reportedAmount: rejection.reportedAmount,
        difference,
        occurrences: rejection.occurrences,
        firstSeenAt: rejection.firstSeenAt,
        lastSeenAt: rejection.lastSeenAt,
      };
    })
    .filter((row): row is PaymentExceptionRow => row !== null)
    .filter((row) => (filters.category ? row.category === filters.category : true));

  return { rows, totalCount };
}

/**
 * How many payments in the WHOLE tenant dataset need review, not just the
 * current page.
 *
 * The review rules join payment state with order state, so this cannot be
 * a single groupBy. It is instead three narrow counts, each expressing one
 * rule directly in SQL — bounded, index-friendly, and no per-row work.
 */
export async function countPaymentsNeedingReview(
  tenantId: string,
  now: Date = new Date(),
): Promise<number> {
  const db = getScopedDb(tenantId);

  const [pendingPastExpiry, paidForCancelled, fulfilledWithoutPayment] = await Promise.all([
    db.payment.count({
      where: { tenantId, status: 'pending', expiresAt: { not: null, lt: now } },
    }),
    db.payment.count({
      where: { tenantId, status: 'succeeded', order: { status: 'cancelled' } },
    }),
    // Covers both the COD and the non-COD wording; they are one rule with
    // two labels, so they are one count here.
    db.payment.count({
      where: { tenantId, status: { not: 'succeeded' }, order: { status: 'fulfilled' } },
    }),
  ]);

  // A payment can trip more than one rule — pending past expiry on a
  // fulfilled order, for instance. Counting rows, not reasons, means
  // taking the union, which needs one more narrow count to subtract.
  const bothPendingExpiredAndFulfilled = await db.payment.count({
    where: {
      tenantId,
      status: 'pending',
      expiresAt: { not: null, lt: now },
      order: { status: 'fulfilled' },
    },
  });

  return (
    pendingPastExpiry + paidForCancelled + fulfilledWithoutPayment - bothPendingExpiredAndFulfilled
  );
}
