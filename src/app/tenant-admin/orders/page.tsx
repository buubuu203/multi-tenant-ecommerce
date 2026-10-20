import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import { bulkUpdateOrderStatusAction } from '../actions';
import { BulkOrderStatusForm } from '../BulkOrderStatusForm';
import { Pagination } from '../Pagination';
import { listOrders, countOrdersByStatus, type ListOrdersOptions } from '@/lib/order-queries';
import { getOrderDetail } from '@/lib/order-detail';
import { OrderDetailView, formatOrderDateTime } from './OrderDetailView';
import { formatVnd } from '../format';
import Link from 'next/link';
import {
  resolveAnalyticsRange,
  ANALYTICS_TIMEZONE_LABEL,
  RANGE_ADJUSTMENT_MESSAGE,
} from '@/lib/analytics/date-range';
import { ExportCsvButton } from '../ExportCsvButton';
import {
  adminPageClassName,
  adminInputClassName,
  adminButtonSecondaryClassName,
  adminEyebrowClassName,
} from '../styles';
import { AdminPageHeader } from '../AdminPageHeader';
import { StatusBadge, toneForStatus } from '../StatusBadge';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;
const ORDER_STATUSES = ['pending', 'fulfilled', 'cancelled'] as const;

// Order and payment status now render through the shared StatusBadge, which
// owns the colour mapping for every admin surface — the two local Record
// maps that used to live here were the duplication it was built to remove.

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId } = await requireTenantAdmin();
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q : '';
  const status = typeof params.status === 'string' ? params.status : '';
  const page = Number(params.page) > 0 ? Math.floor(Number(params.page)) : 1;

  // Only filter by date when the merchant actually asked for one — an
  // unfiltered Orders page must keep showing every order. resolve…Range()
  // owns the boundary rules (inclusive days, Asia/Ho_Chi_Minh, half-open,
  // malformed input narrowing rather than widening), so they are defined
  // once and shared with Analytics instead of re-decided here.
  const from = typeof params.from === 'string' ? params.from : '';
  const to = typeof params.to === 'string' ? params.to : '';
  const dateFiltered = Boolean(from || to);
  const range = dateFiltered ? resolveAnalyticsRange({ from, to }) : null;

  const listOptions: ListOrdersOptions = {
    page,
    pageSize: PAGE_SIZE,
    ...(range ? { placedFrom: range.start, placedBefore: range.end } : {}),
    ...(q ? { search: q } : {}),
    ...(status && ORDER_STATUSES.includes(status as (typeof ORDER_STATUSES)[number])
      ? { status: status as (typeof ORDER_STATUSES)[number] }
      : {}),
  };
  // Read-only — see order-queries.ts. Nothing here writes to the database;
  // order creation/inventory reservation logic is untouched by this page.
  // Master-detail: the selected order is part of the URL, so the panel
  // survives a reload, can be linked to, and needs no client state.
  const selectedId = typeof params.selected === 'string' ? params.selected : '';

  const [{ orders, totalCount }, statusCounts, selected] = await Promise.all([
    listOrders(tenantId, listOptions),
    // Deliberately WITHOUT the status filter: a tab must show its own
    // count even while a different tab is selected.
    countOrdersByStatus(tenantId, {
      ...(q ? { search: q } : {}),
      ...(range ? { placedFrom: range.start, placedBefore: range.end } : {}),
    }),
    // Scoped by tenant inside getOrderDetail, so a guessed id from
    // another store resolves to null exactly as an unknown one does.
    selectedId ? getOrderDetail(tenantId, selectedId) : Promise.resolve(null),
  ]);

  /** Keeps the current filters when a row changes the selection. */
  function hrefForOrder(id: string): string {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (status) next.set('status', status);
    if (range) {
      next.set('from', range.fromDate);
      next.set('to', range.toDate);
    }
    if (page > 1) next.set('page', String(page));
    next.set('selected', id);
    return `/tenant-admin/orders?${next.toString()}`;
  }

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title="Orders"
        description="Every order placed in this store. Select orders to update several at once."
        meta={
          <span className={adminEyebrowClassName}>
            {totalCount} {totalCount === 1 ? 'order' : 'orders'}
            {(q || status) && ' matching'}
          </span>
        }
      />

      {/* Search + status filter, plain GET form — no client JS, no state to
        lose on refresh, shareable/bookmarkable URL. Given its own toolbar
        surface so "narrow the list" reads as a distinct step from "act on
        the list" below it. */}
      <form
        className="flex flex-wrap items-end gap-2 rounded-2xl bg-surface p-4 shadow-sm"
        method="get"
        role="search"
        aria-label="Search and filter orders"
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs sm:flex-none">
          Search
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Order id, customer name, or email"
            className={`w-full sm:w-72 ${adminInputClassName}`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Placed from
          <input
            type="date"
            name="from"
            defaultValue={range?.fromDate ?? ''}
            className={adminInputClassName}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Placed to
          <input
            type="date"
            name="to"
            defaultValue={range?.toDate ?? ''}
            className={adminInputClassName}
          />
        </label>
        {/* The tabs own the status; this keeps the selected one when
            the merchant changes a date or the search text. */}
        {status && <input type="hidden" name="status" value={status} />}
        <button type="submit" className={`${adminButtonSecondaryClassName} py-1.5`}>
          Filter
        </button>
        {dateFiltered && (
          <Link href="/tenant-admin/orders" className={`${adminButtonSecondaryClassName} py-1.5`}>
            Clear dates
          </Link>
        )}
      </form>

      {range && (
        <p className="text-xs text-muted-foreground" role="status">
          Showing orders placed {range.fromDate} to {range.toDate} inclusive, by{' '}
          {ANALYTICS_TIMEZONE_LABEL}.
          {range.adjustment ? ` ${RANGE_ADJUSTMENT_MESSAGE[range.adjustment]}` : ''}
        </p>
      )}

      {/* One slim row, not a card. The warning stays VISIBLE rather than
          moving behind a disclosure — this is the moment customer data
          leaves the app's access controls, and a warning you have to
          open is a warning you will not read — but a full panel above
          the list made a secondary action louder than the orders
          themselves. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        <ExportCsvButton dataset="orders" label="orders" />
        <p className="min-w-0 flex-1">
          <strong className="font-semibold">Contains customer personal data</strong> — name, email,
          phone and shipping address. A downloaded file is no longer protected by your store login.
        </p>
      </div>

      {/* Status tabs, each carrying its own count. A dropdown hides
          both the options and the shape of the data behind one closed
          control; tabs put "how many are waiting" on screen without a
          click, which is the question this page is opened to answer.
          Plain links, so each tab is its own URL and the back button
          works. Current tab marked with aria-current, not colour alone. */}
      <nav aria-label="Filter orders by status" className="flex flex-wrap gap-1">
        {[{ value: '', label: 'All', count: statusCounts.reduce((t, r) => t + r.count, 0) }]
          .concat(
            statusCounts.map((row) => ({
              value: row.status,
              label: row.status,
              count: row.count,
            })),
          )
          .map((tab) => {
            const params = new URLSearchParams();
            if (q) params.set('q', q);
            if (range) {
              params.set('from', range.fromDate);
              params.set('to', range.toDate);
            }
            if (tab.value) params.set('status', tab.value);
            const query = params.toString();
            const selected = status === tab.value;
            return (
              <Link
                key={tab.value || 'all'}
                href={`/tenant-admin/orders${query ? `?${query}` : ''}`}
                aria-current={selected ? 'page' : undefined}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium capitalize transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground ${
                  selected
                    ? 'border-transparent bg-foreground text-background'
                    : 'border-border bg-surface hover:border-foreground/30'
                }`}
              >
                {tab.label}
                <span className="tabular-nums opacity-70">{tab.count}</span>
              </Link>
            );
          })}
      </nav>

      <BulkOrderStatusForm action={bulkUpdateOrderStatusAction} />
      {orders.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          {q || status
            ? 'No orders match these filters.'
            : 'No orders yet. Orders placed on your storefront will appear here.'}
        </p>
      ) : (
        /* ONE rendering of each order, not two.
           
           This list previously existed twice: a 790px-wide table that had
           to scroll sideways on any phone, followed by a second full set
           of detail cards repeating the same orders underneath. Merging
           them removes that duplication, removes the horizontal scroll
           (WCAG 1.4.10 Reflow), and gives each order one place to live.
           
           Each row is a <details> disclosure: the summary carries what an
           operator scans for — customer, status, payment, total, date —
           and everything else is one keyboard-reachable toggle away.
           Progressive disclosure rather than hiding: the native element
           handles keyboard and announces expanded state for free. */
        /* Master-detail. The list is a column of compact rows and the
           selected order's detail sits beside it, which is how an
           operator actually works: scan, open, act, scan again. The
           <details> disclosure this replaces could only ever show one
           order's detail by pushing every other row down the page.

           Stacks to one column below lg, where a side panel would leave
           neither half usable. */
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <ul className="flex min-w-0 flex-col gap-2">
            {orders.map((order) => {
              const isSelected = order.id === selectedId;
              return (
                <li key={order.id}>
                  <div
                    className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                      isSelected
                        ? 'border-foreground/40 bg-surface-muted'
                        : 'border-border bg-surface hover:border-foreground/20'
                    }`}
                  >
                    {/* Outside the link, so ticking an order never opens
                        it and opening never ticks it. */}
                    <input
                      type="checkbox"
                      name="orderIds"
                      value={order.id}
                      form="bulk-orders-form"
                      aria-label={`Select order ${order.id}`}
                      className="mt-1 h-4 w-4 shrink-0"
                    />

                    <Link
                      href={hrefForOrder(order.id)}
                      aria-current={isSelected ? 'true' : undefined}
                      className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
                    >
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="min-w-0 truncate font-medium">{order.customer.name}</span>
                        <span className="money text-sm font-semibold whitespace-nowrap">
                          {formatVnd(order.total)}
                        </span>
                      </span>

                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={order.status} />
                        {order.paymentStatus && (
                          <StatusBadge
                            status={`Payment: ${order.paymentStatus}`}
                            tone={toneForStatus(order.paymentStatus)}
                          />
                        )}
                      </span>

                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="font-mono">{order.id.slice(0, 8)}</span>
                        <span aria-hidden="true">·</span>
                        {/* Machine-readable alongside the human form: a
                            date rendered only as text cannot be parsed by
                            assistive tech or copied reliably. */}
                        <time dateTime={order.createdAt.toISOString()}>
                          {formatOrderDateTime(order.createdAt)}
                        </time>
                        <span aria-hidden="true">·</span>
                        <span>
                          {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
                        </span>
                      </span>
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* The panel. Sticky on desktop so it stays in view while the
              list scrolls; plain flow below lg, where it sits under the
              list instead of beside it. */}
          <div className="min-w-0 lg:sticky lg:top-20">
            {selected ? (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={selected.status} />
                    {selected.payment && (
                      <StatusBadge status={`payment: ${selected.payment.status}`} />
                    )}
                  </span>
                  {/* A panel cannot be bookmarked or opened in a second
                      tab, so the full page stays one click away. */}
                  <Link
                    href={`/tenant-admin/orders/${selected.id}`}
                    className={adminButtonSecondaryClassName}
                  >
                    Open full page
                    <span aria-hidden="true"> →</span>
                  </Link>
                </div>
                <OrderDetailView order={selected} />
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                {selectedId
                  ? 'That order is not in this store, or no longer exists.'
                  : 'Select an order to see its details here.'}
              </p>
            )}
          </div>
        </div>
      )}

      <Pagination
        basePath="/tenant-admin/orders"
        searchParams={params}
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={totalCount}
      />
    </div>
  );
}
