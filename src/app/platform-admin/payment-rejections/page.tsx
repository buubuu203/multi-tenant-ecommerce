import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePlatformAdmin, NotAuthenticatedError } from '@/lib/auth/require-platform-admin';
import { AdminDenied } from '@/components/AdminDenied';
import {
  listPlatformRejections,
  type PlatformRejectionFilters,
  type RejectionAttribution,
} from '@/lib/payments/rejection-operations';
import { formatVnd } from '../../tenant-admin/format';
import { StatusBadge } from '../../tenant-admin/StatusBadge';
import {
  adminInputClassName,
  adminLabelClassName,
  adminPanelClassName,
  adminPanelTitleClassName,
  adminSubtleClassName,
  adminButtonSecondaryClassName,
  adminEyebrowClassName,
} from '../../tenant-admin/styles';

// Evidence about live payment traffic: never cached.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const REASON_LABEL: Record<string, string> = {
  amount_mismatch: 'Reported amount mismatch',
  unknown_payment: 'No payment resolved',
  invalid_payload: 'Unreadable payload',
};

const REASONS = ['amount_mismatch', 'unknown_payment', 'invalid_payload'] as const;

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Platform-only view of rejected webhook evidence.
 *
 * This exists because unattributed rows — a delivery that resolved to no
 * payment — have no tenant and must never appear in a merchant's queue.
 * A platform operator still needs to see that such deliveries arrive.
 *
 * Authorization happens before any read, the same rule the Platform Admin
 * index already follows: a layout gate does not stop this segment
 * streaming its own payload.
 */
export default async function PaymentRejectionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    provider?: string;
    reason?: string;
    attribution?: string;
    since?: string;
    until?: string;
    ref?: string;
    page?: string;
  }>;
}) {
  try {
    await requirePlatformAdmin();
  } catch (e) {
    if (e instanceof NotAuthenticatedError) {
      redirect('/sign-in');
    }
    return <AdminDenied surface="Platform Admin" />;
  }

  const params = await searchParams;
  const page = Number(params.page ?? '1');
  const attribution: RejectionAttribution | undefined =
    params.attribution === 'attributed' || params.attribution === 'unattributed'
      ? params.attribution
      : undefined;

  const filters: PlatformRejectionFilters = {
    provider: params.provider || undefined,
    reason: REASONS.includes(params.reason as (typeof REASONS)[number])
      ? (params.reason as (typeof REASONS)[number])
      : undefined,
    attribution,
    since: parseDate(params.since),
    until: parseDate(params.until),
    providerOrderId: params.ref?.trim() || undefined,
    page: Number.isFinite(page) ? page : 1,
  };

  const { rows, totalCount, metrics } = await listPlatformRejections(filters);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 border-b border-border pb-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Payment exception evidence</h2>
          <p className="text-sm text-muted-foreground">
            Webhook deliveries this platform refused. Evidence only — nothing here was applied to
            any order, and no payment was settled.
          </p>
        </div>
        <Link
          href="/platform-admin"
          className="w-fit text-sm text-muted-foreground underline transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        >
          Back to Platform Admin
        </Link>
      </div>

      <section aria-labelledby="metrics" className="flex flex-col gap-3">
        <h3 id="metrics" className={adminPanelTitleClassName}>
          Rejected deliveries
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Total', metrics.total, 'All recorded rejections'],
            ['Unattributed', metrics.unattributed, 'No tenant could be determined'],
            ['Repeated', metrics.highOccurrence, 'Seen more than once'],
            ['Last 24 hours', metrics.recent, 'First seen recently'],
          ].map(([label, value, hint]) => (
            <div
              key={String(label)}
              className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4"
            >
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
              <span className="money text-2xl font-semibold tabular-nums">{value}</span>
              <span className="text-xs text-muted-foreground">{hint}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {metrics.byReason.map((group) => (
            <span key={group.reason} className="rounded-md border border-border px-2 py-1">
              {REASON_LABEL[group.reason] ?? group.reason}: {group.count}
            </span>
          ))}
          {metrics.byProvider.map((group) => (
            <span key={group.provider} className="rounded-md border border-border px-2 py-1">
              {group.provider}: {group.count}
            </span>
          ))}
        </div>
      </section>

      <form
        method="get"
        className={`${adminPanelClassName} sm:flex-row sm:flex-wrap sm:items-end`}
        aria-label="Filter rejected deliveries"
      >
        <label className={adminLabelClassName}>
          Provider
          <select
            name="provider"
            defaultValue={params.provider ?? ''}
            className={adminInputClassName}
          >
            <option value="">All providers</option>
            <option value="cod">cod</option>
            <option value="bank_transfer_manual">bank_transfer_manual</option>
            <option value="bank_transfer_sepay_va">bank_transfer_sepay_va</option>
            <option value="momo">momo</option>
          </select>
        </label>
        <label className={adminLabelClassName}>
          Reason
          <select name="reason" defaultValue={params.reason ?? ''} className={adminInputClassName}>
            <option value="">All reasons</option>
            {REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {REASON_LABEL[reason]}
              </option>
            ))}
          </select>
        </label>
        <label className={adminLabelClassName}>
          Attribution
          <select
            name="attribution"
            defaultValue={params.attribution ?? ''}
            className={adminInputClassName}
          >
            <option value="">Any</option>
            <option value="unattributed">Unattributed only</option>
            <option value="attributed">Attributed only</option>
          </select>
        </label>
        <label className={adminLabelClassName}>
          Seen from
          <input
            type="date"
            name="since"
            defaultValue={params.since ?? ''}
            className={adminInputClassName}
          />
        </label>
        <label className={adminLabelClassName}>
          Seen before
          <input
            type="date"
            name="until"
            defaultValue={params.until ?? ''}
            className={adminInputClassName}
          />
        </label>
        <label className={adminLabelClassName}>
          Provider reference
          <input
            name="ref"
            defaultValue={params.ref ?? ''}
            placeholder="Exact match only"
            className={adminInputClassName}
          />
        </label>
        <button type="submit" className={`${adminButtonSecondaryClassName} min-h-11 lg:min-h-9`}>
          Apply filters
        </button>
      </form>

      <section aria-labelledby="evidence" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="evidence" className={adminPanelTitleClassName}>
            Evidence
          </h3>
          <span className={adminEyebrowClassName}>{totalCount} matching</span>
        </div>

        {rows.length === 0 ? (
          <div className={adminSubtleClassName}>
            <p className={adminPanelTitleClassName}>No rejected deliveries match</p>
            <p className="text-xs text-muted-foreground">Clear a filter to see more.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.id}>
                <details className={`group ${adminPanelClassName}`}>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 marker:content-none">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <span className="text-muted-foreground transition-transform group-open:rotate-90">
                        ›
                      </span>
                      <span className="truncate text-xs font-medium">{row.provider}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {row.difference !== null && (
                        <span className="money text-sm font-medium whitespace-nowrap">
                          {row.difference > 0 ? '+' : ''}
                          {formatVnd(row.difference)}
                        </span>
                      )}
                      <StatusBadge
                        status={REASON_LABEL[row.reason] ?? row.reason}
                        tone={row.reason === 'amount_mismatch' ? 'warning' : 'neutral'}
                      />
                      <StatusBadge
                        status={row.attribution === 'unattributed' ? 'No tenant' : 'Tenant known'}
                        tone={row.attribution === 'unattributed' ? 'danger' : 'info'}
                      />
                      <span className="text-xs text-muted-foreground tabular-nums">
                        ×{row.occurrences}
                      </span>
                    </span>
                  </summary>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-3 text-xs">
                    <dt className="text-muted-foreground">Payment resolved</dt>
                    <dd>{row.resolvedPayment ? 'yes' : 'no'}</dd>
                    <dt className="text-muted-foreground">Expected</dt>
                    <dd className="tabular-nums">
                      {row.expectedAmount === null ? 'unknown' : formatVnd(row.expectedAmount)}
                    </dd>
                    <dt className="text-muted-foreground">Reported</dt>
                    <dd className="tabular-nums">
                      {row.reportedAmount === null ? 'unknown' : formatVnd(row.reportedAmount)}
                    </dd>
                    {row.providerOrderId && (
                      <>
                        <dt className="text-muted-foreground">Provider reference</dt>
                        <dd className="font-mono break-all">{row.providerOrderId}</dd>
                      </>
                    )}
                    <dt className="text-muted-foreground">First seen</dt>
                    <dd className="tabular-nums">
                      {row.firstSeenAt.toISOString().slice(0, 16).replace('T', ' ')}
                    </dd>
                    <dt className="text-muted-foreground">Last seen</dt>
                    <dd className="tabular-nums">
                      {row.lastSeenAt.toISOString().slice(0, 16).replace('T', ' ')}
                    </dd>
                  </dl>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="scope" className={adminSubtleClassName}>
        <h3 id="scope" className={adminPanelTitleClassName}>
          Scope of this page
        </h3>
        <p className="text-xs text-muted-foreground">
          No raw payload, signature, token or payload digest is stored or shown — only the bounded
          fields above. An unattributed row is never shown to a merchant, because attributing it
          would be a guess. Nothing here is settlement, accounting or tax reconciliation, and no
          payment provider is contacted by this page.
        </p>
      </section>
    </div>
  );
}
