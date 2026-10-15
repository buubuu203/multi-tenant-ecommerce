import Link from 'next/link';
import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import {
  listPaymentReconciliation,
  RECONCILIATION_CATEGORIES,
  REVIEW_REASON_ACTION,
  REVIEW_REASON_LABEL,
  type ReconciliationCategory,
} from '@/lib/payment-reconciliation';
import { AdminPageHeader } from '../AdminPageHeader';
import { StatusBadge, type BadgeTone } from '../StatusBadge';
import { formatVnd } from '../format';
import {
  adminEyebrowClassName,
  adminPageClassName,
  adminPanelClassName,
  adminPanelTitleClassName,
  adminSubtleClassName,
  adminButtonSecondaryClassName,
  adminInputClassName,
  adminLabelClassName,
} from '../styles';

export const dynamic = 'force-dynamic';

const CATEGORY_LABEL: Record<ReconciliationCategory, string> = {
  awaiting_payment: 'Awaiting payment',
  paid: 'Paid',
  failed: 'Failed',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

const CATEGORY_TONE: Record<ReconciliationCategory, BadgeTone> = {
  awaiting_payment: 'warning',
  paid: 'success',
  failed: 'danger',
  expired: 'neutral',
  cancelled: 'neutral',
};

function isCategory(value: string | undefined): value is ReconciliationCategory {
  return (
    typeof value === 'string' && (RECONCILIATION_CATEGORIES as readonly string[]).includes(value)
  );
}

export default async function PaymentOperationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    provider?: string;
    category?: string;
    search?: string;
    review?: string;
    page?: string;
  }>;
}) {
  const { tenantId } = await requireTenantAdmin();
  const params = await searchParams;

  const category = isCategory(params.category) ? params.category : undefined;
  const needsReview = params.review === '1';
  const page = Number(params.page ?? '1');

  const { rows, totalCount, summary } = await listPaymentReconciliation(tenantId, {
    provider: params.provider || undefined,
    category,
    needsReview,
    search: params.search,
    page: Number.isFinite(page) ? page : 1,
  });

  const exceptions = rows.filter((row) => row.reviewReasons.length > 0);

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title="Payment operations"
        description="Payment state across every method, and the orders where payment and fulfilment disagree. Read-only — this page settles nothing by itself."
      />

      {/* What the stored data can prove, and nothing more. */}
      <section aria-labelledby="kpi" className="flex flex-col gap-3">
        <h3 id="kpi" className={adminPanelTitleClassName}>
          Payments by state
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {RECONCILIATION_CATEGORIES.map((key) => (
            <Link
              key={key}
              href={`/tenant-admin/payment-operations?category=${key}`}
              className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-foreground/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
            >
              <span className="text-xs font-medium text-muted-foreground">
                {CATEGORY_LABEL[key]}
              </span>
              <span className="money text-2xl font-semibold tabular-nums">
                {summary.counts[key]}
              </span>
            </Link>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Paid payments were opened for {formatVnd(summary.paidAmount)} in total. This is the amount
          each payment was created for — the system never observes a bank balance, so it is not a
          statement of money received.
        </p>
      </section>

      <form
        method="get"
        className={`${adminPanelClassName} sm:flex-row sm:flex-wrap sm:items-end`}
        aria-label="Filter payments"
      >
        <label className={adminLabelClassName}>
          Provider
          <select name="provider" defaultValue={params.provider ?? ''} className={adminInputClassName}>
            <option value="">All providers</option>
            <option value="cod">Cash on delivery</option>
            <option value="bank_transfer_manual">Bank transfer (manual)</option>
            <option value="bank_transfer_sepay_va">Bank transfer (SePay)</option>
            <option value="momo">MoMo</option>
          </select>
        </label>
        <label className={adminLabelClassName}>
          State
          <select name="category" defaultValue={category ?? ''} className={adminInputClassName}>
            <option value="">All states</option>
            {RECONCILIATION_CATEGORIES.map((key) => (
              <option key={key} value={key}>
                {CATEGORY_LABEL[key]}
              </option>
            ))}
          </select>
        </label>
        <label className={adminLabelClassName}>
          Search
          <input
            name="search"
            defaultValue={params.search ?? ''}
            placeholder="Order reference, transaction id, phone or email"
            className={`${adminInputClassName} sm:w-72`}
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs">
          <input type="checkbox" name="review" value="1" defaultChecked={needsReview} />
          Needs review only
        </label>
        <button type="submit" className={`${adminButtonSecondaryClassName} min-h-11 lg:min-h-9`}>
          Apply filters
        </button>
      </form>

      <section aria-labelledby="exceptions" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 id="exceptions" className={adminPanelTitleClassName}>
            Needs review
          </h3>
          <p className="text-xs text-muted-foreground">
            Orders where the payment record and the order disagree. Each is a comparison of two
            stored facts — never an assumption about money received.
          </p>
        </div>

        {exceptions.length === 0 ? (
          <div className={adminSubtleClassName}>
            <p className={adminPanelTitleClassName}>Nothing to review on this page</p>
            <p className="text-xs text-muted-foreground">
              No payment here disagrees with its order.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {exceptions.map((row) => (
              <li key={row.orderReference} className={adminPanelClassName}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-mono text-xs break-all">{row.orderReference}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.provider} · opened for {formatVnd(row.expectedAmount)}
                    </span>
                  </div>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge
                      status={CATEGORY_LABEL[row.category]}
                      tone={CATEGORY_TONE[row.category]}
                    />
                    <StatusBadge status={`Order ${row.orderStatus}`} tone="neutral" />
                  </span>
                </div>

                <ul className="flex flex-col gap-2">
                  {row.reviewReasons.map((reason) => (
                    <li key={reason} className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{REVIEW_REASON_LABEL[reason]}</span>
                      <span className="text-xs text-muted-foreground">
                        {REVIEW_REASON_ACTION[reason]}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="border-t border-border pt-3">
                  {/* The only safe action is to go where the existing,
                      audited controls already live. No new mutation. */}
                  <Link
                    href={`/tenant-admin/orders?search=${encodeURIComponent(row.orderReference)}`}
                    aria-label={`Open order ${row.orderReference}`}
                    className={`${adminButtonSecondaryClassName} min-h-11 lg:min-h-9`}
                  >
                    Open order
                  </Link>
                  {row.canConfirmManually && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Manual bank transfer is confirmed on the order itself, where the existing
                      confirmation and audit trail apply.
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="activity" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="activity" className={adminPanelTitleClassName}>
            Payment activity
          </h3>
          <span className={adminEyebrowClassName}>{totalCount} total</span>
        </div>

        {rows.length === 0 ? (
          <div className={adminSubtleClassName}>
            <p className={adminPanelTitleClassName}>No payments match these filters</p>
            <p className="text-xs text-muted-foreground">Clear a filter to see more.</p>
          </div>
        ) : (
          /* A list of disclosures rather than a wide table: five columns
             cannot be read at 375px, and the technical fields matter far
             less often than the reference, state and amount. */
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.orderReference}>
                <details className={`group ${adminPanelClassName}`}>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 marker:content-none">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <span className="text-muted-foreground transition-transform group-open:rotate-90">
                        ›
                      </span>
                      <span className="truncate font-mono text-xs">{row.orderReference}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="money text-sm font-medium whitespace-nowrap">
                        {formatVnd(row.expectedAmount)}
                      </span>
                      <StatusBadge
                        status={CATEGORY_LABEL[row.category]}
                        tone={CATEGORY_TONE[row.category]}
                      />
                    </span>
                  </summary>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-3 text-xs">
                    <dt className="text-muted-foreground">Provider</dt>
                    <dd>{row.provider}</dd>
                    <dt className="text-muted-foreground">Order status</dt>
                    <dd>{row.orderStatus}</dd>
                    <dt className="text-muted-foreground">Opened</dt>
                    <dd className="tabular-nums">{row.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</dd>
                    {row.expiresAt && (
                      <>
                        <dt className="text-muted-foreground">Expires</dt>
                        <dd className="tabular-nums">
                          {row.expiresAt.toISOString().slice(0, 16).replace('T', ' ')}
                        </dd>
                      </>
                    )}
                    {row.providerTransactionId && (
                      <>
                        <dt className="text-muted-foreground">Transaction reference</dt>
                        <dd className="font-mono break-all">{row.providerTransactionId}</dd>
                      </>
                    )}
                  </dl>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Said once, plainly, so nobody reads this page as a bank statement. */}
      <section aria-labelledby="limits" className={adminSubtleClassName}>
        <h3 id="limits" className={adminPanelTitleClassName}>
          What this page cannot tell you
        </h3>
        <p className="text-xs text-muted-foreground">
          Underpayments, overpayments and unmatched bank transfers are not shown, because they are
          never stored: a webhook whose amount does not match, or whose order cannot be found, is
          rejected before anything is written. Duplicate webhook deliveries are likewise discarded
          rather than recorded. This is not an accounting, tax or banking system, and it never
          confirms that money reached your bank account.
        </p>
      </section>
    </div>
  );
}
