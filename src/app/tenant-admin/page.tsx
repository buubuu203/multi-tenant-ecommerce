import Link from 'next/link';
import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import { getTenantKpis } from '@/lib/tenant-kpis';
import { LOW_STOCK_THRESHOLD } from '@/lib/inventory-availability';
import { formatVnd } from './format';
import {
  adminPageClassName,
  adminPanelClassName,
  adminPanelTitleClassName,
  adminButtonSecondaryClassName,
  adminInputClassName,
} from './styles';
import { AdminPageHeader } from './AdminPageHeader';
import { TrendChart } from './TrendChart';
import { getDailyOrderTrend } from '@/lib/analytics/order-trend';
import { resolvePeriod, PERIODS, PERIOD_LABEL } from '@/lib/analytics/periods';
import { ANALYTICS_TIMEZONE_LABEL, RANGE_ADJUSTMENT_MESSAGE } from '@/lib/analytics/date-range';

export const dynamic = 'force-dynamic';

// Phase 1 of the admin route split left this route as a bare redirect to
// Branding, because every section had become its own route and there was
// nothing for the index itself to show. It now earns its place: a
// read-only overview of the numbers a merchant opens the admin to check.
//
// requireTenantAdmin() is called here independently — the layout's own
// call is necessary but never sufficient on its own, the same rule every
// other admin route and Server Action in this codebase follows.
export default async function TenantAdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const { tenantId } = await requireTenantAdmin();
  const params = await searchParams;

  // One window drives the tiles, the status breakdown AND the chart, so
  // the three can never describe different periods. An unrecognised
  // period falls back to the default rather than erroring or widening.
  const { period, range } = resolvePeriod(params);
  const [kpis, trend] = await Promise.all([
    getTenantKpis(tenantId, range),
    getDailyOrderTrend(tenantId, range),
  ]);

  // `needsAttention` drives a text note, never colour alone — a merchant
  // scanning this row should be able to tell which number wants action
  // from a greyscale screenshot.
  const cards: {
    label: string;
    value: string;
    hint: string;
    href: string;
    needsAttention?: boolean;
  }[] = [
    {
      label: 'Pending orders',
      value: String(kpis.pendingOrders),
      hint: 'Awaiting fulfilment',
      href: '/tenant-admin/orders?status=pending',
      needsAttention: kpis.pendingOrders > 0,
    },
    {
      label: `Orders (${kpis.windowDays}d)`,
      value: String(kpis.ordersInWindow),
      hint: 'Placed in the last 30 days',
      href: '/tenant-admin/orders',
    },
    {
      // "Order value", not "Revenue": this figure counts every order that
      // has not been cancelled, which includes pending ones nobody has
      // paid for yet. Calling that revenue would tell a merchant they had
      // earned money they may never collect.
      label: `Order value (${kpis.windowDays}d)`,
      value: formatVnd(kpis.revenueInWindow),
      hint: 'Items + shipping, including unpaid orders',
      href: '/tenant-admin/orders',
    },
    {
      label: 'Active products',
      value: String(kpis.activeProducts),
      hint: 'Visible on the storefront',
      href: '/tenant-admin/catalog',
    },
    {
      label: 'Low stock',
      value: String(kpis.lowStockVariants),
      hint: `Variants with ${LOW_STOCK_THRESHOLD} or fewer available`,
      href: '/tenant-admin/catalog',
      needsAttention: kpis.lowStockVariants > 0,
    },
  ];

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title="Overview"
        description="A read-only snapshot of this store. Nothing on this page changes any data."
      />

      {/* One filter for the whole page. A plain GET form: the window
          lives in the URL, so a merchant can bookmark or share "last
          month" and reload without losing it, and it needs no
          JavaScript. */}
      <section aria-labelledby="period-heading" className={adminPanelClassName}>
        <h3 id="period-heading" className={adminPanelTitleClassName}>
          Period
        </h3>
        <form
          method="get"
          aria-label="Filter the overview by period"
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1 text-xs">
            Preset
            <select name="period" defaultValue={period} className={adminInputClassName}>
              {PERIODS.map((option) => (
                <option key={option} value={option}>
                  {PERIOD_LABEL[option]}
                </option>
              ))}
            </select>
          </label>
          {/* Supplying either date switches the preset to "Tự chọn"
              automatically, so the two controls cannot contradict. */}
          <label className="flex flex-col gap-1 text-xs">
            From
            <input
              type="date"
              name="from"
              defaultValue={period === 'custom' ? range.fromDate : ''}
              className={adminInputClassName}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            To
            <input
              type="date"
              name="to"
              defaultValue={period === 'custom' ? range.toDate : ''}
              className={adminInputClassName}
            />
          </label>
          <button type="submit" className={`${adminButtonSecondaryClassName} py-1.5`}>
            Apply
          </button>
          {(period !== 'last_30_days' || params.from || params.to) && (
            <Link href="/tenant-admin" className={`${adminButtonSecondaryClassName} py-1.5`}>
              Reset
            </Link>
          )}
        </form>
        <p className="text-xs text-muted-foreground">
          {range.fromDate} to {range.toDate} inclusive ({range.days} days), by{' '}
          {ANALYTICS_TIMEZONE_LABEL}.
          {range.adjustment ? ` ${RANGE_ADJUSTMENT_MESSAGE[range.adjustment]}` : ''}
        </p>
      </section>

      {/* KPIs sit directly on the page canvas as their own cards rather
          than inside an outer page card — a card within a card reads as
          one slab, which is what flattened this screen. */}
      <section aria-labelledby="kpi-heading" className="flex flex-col gap-3">
        <h3 id="kpi-heading" className={adminPanelTitleClassName}>
          This store at a glance
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card, index) => (
            <Link
              key={card.label}
              href={card.href}
              // The tint is decoration, not information: it is assigned by
              // position in the row, carries no status meaning, and every
              // card still states its own label and value as text.
              style={{ backgroundColor: `var(--pastel-${(index % 5) + 1})` }}
              className={`group flex flex-col gap-1 rounded-lg border p-4 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground ${
                card.needsAttention
                  ? 'border-amber-400 dark:border-amber-700'
                  : 'border-border hover:border-foreground/20'
              }`}
            >
              <span className="text-xs font-medium text-muted-foreground">{card.label}</span>
              {/* One number treatment across the row: same size, same
                  weight, tabular figures, so five cards read as one set
                  rather than five unrelated readouts. */}
              <span className="money text-2xl font-semibold tabular-nums">{card.value}</span>
              <span className="text-xs text-muted-foreground">{card.hint}</span>
              {card.needsAttention && (
                // Text, not just a border colour — the attention state has
                // to survive greyscale.
                <span className="text-xs font-medium text-amber-700 dark:text-amber-500">
                  Needs attention
                </span>
              )}
            </Link>
          ))}
        </div>
      </section>

      {/* The headline order count, broken out. A merchant seeing "4
          orders" cannot tell whether that is four sales or three sales
          and a cancellation, and the difference is what the order-value
          figure already acts on. */}
      <section aria-labelledby="status-heading" className={adminPanelClassName}>
        <h3 id="status-heading" className={adminPanelTitleClassName}>
          Orders by status
        </h3>
        <dl className="grid grid-cols-3 gap-3">
          {kpis.ordersByStatus.map((row) => (
            <div key={row.status} className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground capitalize">{row.status}</dt>
              <dd className="text-xl font-semibold tabular-nums">{row.count}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          Cancelled orders are counted here but excluded from order value, which is why the two
          figures can move apart.
        </p>
      </section>

      <section aria-labelledby="trend-heading" className={adminPanelClassName}>
        <h3 id="trend-heading" className="sr-only">
          Order trend
        </h3>
        <TrendChart
          series={trend}
          title={PERIOD_LABEL[period]}
          caption={`Orders placed and order value per day, ${range.fromDate} to ${range.toDate}, by ${ANALYTICS_TIMEZONE_LABEL}. Order value excludes cancelled orders and includes orders nobody has paid for — it is not revenue.`}
        />
      </section>

      {/* Quick actions: the four things a merchant most often arrives
          wanting to do. Links to routes that already exist — no new
          destinations invented. */}
      <section aria-labelledby="quick-actions-heading" className={adminPanelClassName}>
        <div className="flex flex-col gap-1">
          <h3 id="quick-actions-heading" className={adminPanelTitleClassName}>
            Quick actions
          </h3>
          <p className="text-xs text-muted-foreground">The tasks merchants reach for most often.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/tenant-admin/orders" className={adminButtonSecondaryClassName}>
            View orders
          </Link>
          <Link href="/tenant-admin/products/new" className={adminButtonSecondaryClassName}>
            Add a product
          </Link>
          <Link href="/tenant-admin/shipping" className={adminButtonSecondaryClassName}>
            Configure shipping
          </Link>
          <Link href="/tenant-admin/payments" className={adminButtonSecondaryClassName}>
            Manage payments
          </Link>
        </div>
      </section>
    </div>
  );
}
