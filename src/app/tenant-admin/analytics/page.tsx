import Link from 'next/link';
import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import {
  getOperationalMetrics,
  type StatusCount,
  type OperationalMetrics,
} from '@/lib/analytics/operational-metrics';
import {
  resolveAnalyticsRange,
  ANALYTICS_TIMEZONE_LABEL,
  MAX_RANGE_DAYS,
  RANGE_ADJUSTMENT_MESSAGE,
} from '@/lib/analytics/date-range';
import { AdminPageHeader } from '../AdminPageHeader';
import { formatVnd } from '../format';
import {
  adminPageClassName,
  adminPanelClassName,
  adminPanelTitleClassName,
  adminSubtleClassName,
  adminHelpTextClassName,
  adminInputClassName,
  adminLabelClassName,
  adminButtonPrimaryClassName,
  adminButtonQuietClassName,
  adminEyebrowClassName,
} from '../styles';

export const dynamic = 'force-dynamic';

/**
 * Operational analytics: the facts this application stores, counted.
 *
 * Every number here is an exact count or sum over stored rows. Nothing
 * is modelled, estimated or attributed. The wording is deliberate
 * throughout — "order value" never becomes revenue, a succeeded payment
 * never becomes settlement, a fulfilled order never becomes a delivery —
 * because the risk of this page is not that a number is wrong but that a
 * correct number is read as a stronger claim than the data supports.
 */

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  succeeded: 'Succeeded',
  failed: 'Failed',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

const REJECTION_REASON_LABEL: Record<string, string> = {
  amount_mismatch: 'Amount mismatch',
  unknown_payment: 'Unknown payment',
  invalid_payload: 'Invalid payload',
};

/** One figure with its own definition attached, never a bare number. */
function Metric({
  label,
  value,
  definition,
}: {
  label: string;
  value: string;
  definition: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-muted p-3">
      <p className={adminEyebrowClassName}>{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{definition}</p>
    </div>
  );
}

/**
 * A breakdown as a real table.
 *
 * Counts carry no colour and no badge: a status here is a bucket, not a
 * state needing attention, and the operational pages are where action
 * belongs. Text alone also means nothing depends on colour perception.
 */
function Breakdown({
  caption,
  rows,
  labels,
  total,
  emptyNote,
}: {
  caption: string;
  rows: StatusCount[];
  labels: Record<string, string>;
  total: number;
  emptyNote: string;
}) {
  if (total === 0) {
    return <p className={adminHelpTextClassName}>{emptyNote}</p>;
  }
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border text-left">
          <th scope="col" className="py-1.5 font-medium">
            Status
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            Count
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row" className="py-1.5 font-normal">
              {labels[row.key] ?? row.key}
            </th>
            <td className="py-1.5 text-right tabular-nums">{row.count}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-border">
          <th scope="row" className="py-1.5 font-medium">
            Total
          </th>
          <td className="py-1.5 text-right font-medium tabular-nums">{total}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function Panel({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={adminPanelClassName}>
      <div className="flex flex-col gap-1">
        <h3 id={id} className={adminPanelTitleClassName}>
          {title}
        </h3>
        <p className="text-xs text-muted-foreground">{note}</p>
      </div>
      {children}
    </section>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  // Authorize BEFORE reading anything. A layout's early return does not
  // stop this page streaming its own payload, so the check belongs here
  // as well — the rule every admin page in this app follows.
  const { tenantId } = await requireTenantAdmin();

  const params = await searchParams;
  const range = resolveAnalyticsRange({ from: params.from, to: params.to });
  const metrics: OperationalMetrics = await getOperationalMetrics(tenantId, range);
  const { snapshot } = metrics;

  const averageOrderValue =
    metrics.orderValueOrderCount > 0
      ? Math.round(metrics.orderValue / metrics.orderValueOrderCount)
      : 0;

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title="Analytics"
        description="Exact counts over the orders, payments, customers and stock this store has already recorded. Every figure is defined on this page."
        meta={
          <span className={adminEyebrowClassName}>
            {range.fromDate} → {range.toDate}
          </span>
        }
      />

      <section aria-labelledby="range" className={adminPanelClassName}>
        <h3 id="range" className={adminPanelTitleClassName}>
          Date range
        </h3>
        {/* A plain GET form: no JavaScript needed, the range lives in the
            URL, and the page is shareable and reloadable. */}
        <form
          method="get"
          aria-label="Filter analytics by date range"
          className="flex flex-wrap items-end gap-3"
        >
          <label className={adminLabelClassName}>
            <span className="font-medium">From</span>
            <input
              type="date"
              name="from"
              defaultValue={range.fromDate}
              className={adminInputClassName}
            />
          </label>
          <label className={adminLabelClassName}>
            <span className="font-medium">To</span>
            <input
              type="date"
              name="to"
              defaultValue={range.toDate}
              className={adminInputClassName}
            />
          </label>
          <button type="submit" className={adminButtonPrimaryClassName}>
            Apply
          </button>
          <Link href="/tenant-admin/analytics" className={adminButtonQuietClassName}>
            Reset
          </Link>
        </form>
        <p className="text-xs text-muted-foreground">
          Both dates are included. Day boundaries use {ANALYTICS_TIMEZONE_LABEL}, which is fixed for
          every store rather than configured per store. A range may cover at most {MAX_RANGE_DAYS}{' '}
          days.
        </p>
        {range.adjustment && (
          // Never silently show a different window from the one asked
          // for. role=status so it is announced without stealing focus.
          <p role="status" className="text-xs font-medium">
            {RANGE_ADJUSTMENT_MESSAGE[range.adjustment]}
          </p>
        )}
      </section>

      <Panel
        id="orders"
        title="Orders in range"
        note="Orders by the date they were placed. Status is this application's own order lifecycle."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Metric
            label="Orders placed"
            value={String(metrics.ordersTotal)}
            definition="Every order created in the range, cancelled ones included."
          />
          <Metric
            label="Order value"
            value={formatVnd(metrics.orderValue)}
            definition="Items plus shipping, excluding cancelled orders. Not revenue — see below."
          />
          <Metric
            label="Average order value"
            value={formatVnd(averageOrderValue)}
            definition={`Order value divided by the ${metrics.orderValueOrderCount} order(s) it covers.`}
          />
        </div>

        <Breakdown
          caption="Orders by status"
          rows={metrics.ordersByStatus}
          labels={ORDER_STATUS_LABEL}
          total={metrics.ordersTotal}
          emptyNote="No orders were placed in this range."
        />

        <div className={adminSubtleClassName}>
          <h4 className={adminPanelTitleClassName}>What order value is</h4>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground">
            <li>Shipping is included, using the amount stored on each order.</li>
            <li>Cancelled orders are excluded. Pending and fulfilled are both included.</li>
            <li>Unpaid orders are included — nothing here depends on payment state.</li>
            <li>Discounts are already reflected: each line stores the price actually charged.</li>
            <li>
              It is recalculated from stored line snapshots on every view, so it never drifts from
              the orders it describes.
            </li>
            <li className="font-medium text-foreground">
              It is not revenue, net sales, cash received or profit. This application never observes
              a bank account, so no figure here can mean money arrived.
            </li>
          </ul>
        </div>

        <p className={adminHelpTextClassName}>
          <Link href="/tenant-admin/orders" className="underline">
            Open Orders
          </Link>{' '}
          to act on any of these, or{' '}
          <Link href="/tenant-admin/fulfillment" className="underline">
            Fulfillment
          </Link>{' '}
          for what needs preparing.
        </p>
      </Panel>

      <Panel
        id="payments"
        title="Payments in range"
        note="Payment records by the date they were opened. A payment's state is separate from its order's state."
      >
        <Breakdown
          caption="Payments by status"
          rows={metrics.paymentsByStatus}
          labels={PAYMENT_STATUS_LABEL}
          total={metrics.paymentsTotal}
          emptyNote="No payments were opened in this range."
        />

        <div className={adminSubtleClassName}>
          <h4 className={adminPanelTitleClassName}>What these statuses mean</h4>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Succeeded</span> means this application
              accepted a provider confirmation and the reported amount matched. It does not prove
              the money reached a bank account — no settlement is ever observed.
            </li>
            <li>
              <span className="font-medium text-foreground">Pending on a COD order is normal</span>,
              not a failure. Cash is settled with the courier, and nothing records whether it was
              collected, so a COD payment stays pending permanently.
            </li>
            <li>Expired and cancelled describe the payment attempt, not the order.</li>
          </ul>
        </div>

        <Breakdown
          caption="Rejected webhook evidence by reason"
          rows={metrics.rejectionsByReason}
          labels={REJECTION_REASON_LABEL}
          total={metrics.rejectionsTotal}
          emptyNote="No rejected provider webhooks were first seen in this range."
        />
        <p className="text-xs text-muted-foreground">
          Distinct rejections first seen in the range, counted once each however many times the
          provider retried. This is evidence that a webhook was refused — it is not reconciliation,
          and nothing here has been recovered or resolved. Rejections that could not be attributed
          to a store are platform-level and never appear here.{' '}
          <Link href="/tenant-admin/payment-operations" className="underline">
            Open Payment operations
          </Link>
          .
        </p>
      </Panel>

      <Panel
        id="customers"
        title="Customers"
        note="Customer identity is one row per email address in this store. Counts only — no scoring, tiers or segments."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="New in range"
            value={String(metrics.customersCreated)}
            definition="Customers first stored in the range."
          />
          <Metric
            label="Total customers"
            value={String(snapshot.customersTotal)}
            definition="As of now, not limited to the range."
          />
          <Metric
            label="With an order"
            value={String(snapshot.customersWithOrders)}
            definition="At least one stored order, as of now."
          />
          <Metric
            label="With two or more orders"
            value={String(snapshot.customersWithRepeatOrders)}
            definition="A count of stored orders, not a loyalty or value judgement."
          />
        </div>
        <p className={adminHelpTextClassName}>
          <Link href="/tenant-admin/customers" className="underline">
            Open Customers
          </Link>
        </p>
      </Panel>

      <Panel
        id="catalog"
        title="Catalog and stock"
        note="Counted as of now. These are current totals, so the date range above does not apply to them."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Metric
            label="Active products"
            value={String(snapshot.activeProducts)}
            definition="Products customers can currently see."
          />
          <Metric
            label="Draft products"
            value={String(snapshot.draftProducts)}
            definition="Not visible on the storefront."
          />
          <Metric
            label="Active variants"
            value={String(snapshot.activeVariants)}
            definition="Sellable units across all active and draft products."
          />
          <Metric
            label="Out of stock"
            value={String(snapshot.variantsOutOfStock)}
            definition="Variants with nothing available (on hand minus reserved is zero or less)."
          />
          <Metric
            label="Low stock"
            value={String(snapshot.variantsLowStock)}
            definition={`Variants with between 1 and ${snapshot.lowStockThreshold} available.`}
          />
          <Metric
            label="Units on hand"
            value={String(snapshot.onHandUnits)}
            definition={`Physically counted stock, of which ${snapshot.reservedUnits} is reserved for placed orders.`}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Available means on hand minus reserved. Reserved stock is held by orders that have been
          placed but not yet fulfilled or cancelled. These are the stock levels this system records;
          they are not a physical audit, and nothing here forecasts or recommends replenishment.
        </p>
        <p className={adminHelpTextClassName}>
          <Link href="/tenant-admin/catalog" className="underline">
            Open Catalog
          </Link>
        </p>
      </Panel>

      <section aria-labelledby="not-measured" className={adminSubtleClassName}>
        <h3 id="not-measured" className={adminPanelTitleClassName}>
          What this page cannot tell you
        </h3>
        <p className="text-xs text-muted-foreground">
          These are not missing screens — the application does not record the underlying facts, so
          no figure could be honest: bank settlement, COD cash collection, delivery or shipment
          progress, carrier fees, returns, refunds, profit, margin, tax, marketing attribution,
          conversion rate, and customer consent. Nothing here is an accounting, VAT or banking
          record.
        </p>
      </section>
    </div>
  );
}
