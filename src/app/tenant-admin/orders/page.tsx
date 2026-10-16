import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import { ActionForm } from '@/components/ActionForm';
import {
  updateOrderStatusAction,
  markManualPaymentReceivedAction,
  bulkUpdateOrderStatusAction,
} from '../actions';
import { OrderStatusForm } from '../OrderStatusForm';
import { BulkOrderStatusForm } from '../BulkOrderStatusForm';
import { Pagination } from '../Pagination';
import { listOrders, type ListOrdersOptions } from '@/lib/order-queries';
import { formatVnd } from '../format';
import Link from 'next/link';
import { getOrderTimelinesForOrders } from '@/lib/order-events';
import { DOCUMENT_TITLE, PRINT_DOCUMENTS } from '@/lib/order-print';
import { OrderTimeline } from '../OrderTimeline';
import { ExportCsvButton } from '../ExportCsvButton';
import {
  adminPageClassName,
  adminPanelClassName,
  adminPanelTitleClassName,
  adminInputClassName,
  adminButtonSecondaryClassName,
  adminEyebrowClassName,
} from '../styles';
import { AdminPageHeader } from '../AdminPageHeader';
import { StatusBadge, toneForStatus } from '../StatusBadge';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;
const ORDER_STATUSES = ['pending', 'fulfilled', 'cancelled'] as const;

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cod: 'Cash on delivery',
  momo: 'MoMo',
  bank_transfer: 'Bank transfer',
};

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

  const listOptions: ListOrdersOptions = {
    page,
    pageSize: PAGE_SIZE,
    ...(q ? { search: q } : {}),
    ...(status && ORDER_STATUSES.includes(status as (typeof ORDER_STATUSES)[number])
      ? { status: status as (typeof ORDER_STATUSES)[number] }
      : {}),
  };
  // Read-only — see order-queries.ts. Nothing here writes to the database;
  // order creation/inventory reservation logic is untouched by this page.
  const { orders, totalCount } = await listOrders(tenantId, listOptions);

  // Order Audit History: one batched read for every order on this page
  // rather than one per card. Authorization already happened above via
  // requireTenantAdmin(), and this is scoped by that trusted tenantId plus
  // this page's own order ids, so it can only ever return this tenant's
  // events.
  const timelines = await getOrderTimelinesForOrders(
    tenantId,
    orders.map((order) => order.id),
  );

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
        className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-3"
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
          Status
          <select name="status" defaultValue={status} className={adminInputClassName}>
            <option value="">All</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={`${adminButtonSecondaryClassName} py-1.5`}>
          Filter
        </button>
      </form>

      {/* The export sits beside the data it exports rather than in a large
          box above it, but the personal-data warning stays visible rather
          than hidden behind a disclosure: this is the moment the merchant
          decides to take customer data out of the app, and a warning you
          have to open is a warning you will not read. */}
      <div className={adminPanelClassName}>
        <div className="flex flex-col gap-1">
          <h3 className={adminPanelTitleClassName}>Export orders</h3>
          <p className="text-xs text-muted-foreground">
            Every order in this store, not just the current page or filter. Opens in Excel with
            Vietnamese text intact.
          </p>
        </div>
        {/* The warning is a bordered notice, not grey body text: this is
            the moment customer data leaves the app's access controls, and
            it should not be the quietest thing on the screen. */}
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <strong className="font-semibold">Contains customer personal data</strong> — name, email,
          phone and shipping address. A downloaded file is no longer protected by your store login,
          so store and share it carefully, and delete copies you no longer need.
        </p>
        <div>
          <ExportCsvButton dataset="orders" label="orders" />
        </div>
      </div>

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
        <ul className="flex flex-col gap-2">
          {orders.map((order) => (
            <li
              key={order.id}
              className="rounded-lg border border-border bg-surface transition-colors hover:border-foreground/20"
            >
              <div className="flex items-start gap-3 p-3">
                {/* Outside the <summary>, so ticking an order never
                    expands it and expanding never ticks it. */}
                <input
                  type="checkbox"
                  name="orderIds"
                  value={order.id}
                  form="bulk-orders-form"
                  aria-label={`Select order ${order.id}`}
                  className="mt-1 h-4 w-4 shrink-0"
                />

                <details className="min-w-0 flex-1">
                  <summary className="-m-1 cursor-pointer list-none rounded-md p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{order.customer.name}</span>
                          {/* The id is a reference, not the headline:
                              secondary, monospace, and shortened. The full
                              value stays available in the expanded detail
                              and in the checkbox's accessible name. */}
                          <span className="font-mono text-xs text-muted-foreground">
                            {order.id.slice(0, 8)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={order.status} />
                          {order.paymentStatus && (
                            <StatusBadge
                              status={`Payment: ${order.paymentStatus}`}
                              tone={toneForStatus(order.paymentStatus)}
                            />
                          )}
                          <span className="text-xs text-muted-foreground">
                            {PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {order.itemCount} item{order.itemCount === 1 ? '' : 's'}
                          </span>
                        </div>
                      </div>

                      {/* Money and date right-aligned on desktop so totals
                          form a scannable column; stacked left on mobile
                          where a right edge means nothing. */}
                      <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-start sm:gap-0.5">
                        <span className="money text-base font-semibold">
                          {formatVnd(order.total)}
                        </span>
                        <time
                          dateTime={order.createdAt.toISOString()}
                          className="text-xs text-muted-foreground"
                        >
                          {order.createdAt.toLocaleDateString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </time>
                      </div>
                    </div>
                  </summary>

                  <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
                    <p className="font-mono text-xs break-all text-muted-foreground">
                      Order {order.id}
                    </p>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <h4 className={adminEyebrowClassName}>Customer</h4>
                        <p className="mt-1 text-xs">{order.customer.name}</p>
                        <p className="text-xs break-all text-muted-foreground">
                          {order.customer.email}
                        </p>
                        <p className="text-xs text-muted-foreground">{order.customer.phone}</p>
                      </div>
                      <div>
                        <h4 className={adminEyebrowClassName}>Shipping address</h4>
                        <p className="mt-1 text-xs">{order.shippingAddress}</p>
                        <p className="text-xs text-muted-foreground">{order.shippingWard}</p>
                        {/* District is no longer collected (Vietnam's 2025
                          2-tier reform dropped it) — shown only for orders
                          placed before that change. */}
                        {order.shippingDistrict && (
                          <p className="text-xs text-muted-foreground">{order.shippingDistrict}</p>
                        )}
                        <p className="text-xs text-muted-foreground">{order.shippingCity}</p>
                        {order.shippingNote && (
                          <p className="text-xs text-muted-foreground">
                            Note: {order.shippingNote}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="overflow-x-auto border-t border-border pt-3">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="py-1.5 pr-2 font-medium">Item</th>
                            <th className="py-1.5 pr-2 font-medium">Qty</th>
                            <th className="py-1.5 pr-2 text-right font-medium">Unit price</th>
                            <th className="py-1.5 text-right font-medium">Line total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {order.items.map((item) => (
                            <tr key={item.id} className="border-b border-border last:border-0">
                              <td className="py-1.5 pr-2">
                                {item.productName}
                                {item.combinationLabel && (
                                  <span className="text-muted-foreground">
                                    {' '}
                                    — {item.combinationLabel}
                                  </span>
                                )}
                              </td>
                              <td className="py-1.5 pr-2">{item.quantity}</td>
                              <td className="money py-1.5 pr-2 text-right">
                                {item.originalUnitPrice != null && (
                                  <span className="mr-1 text-muted-foreground line-through">
                                    {formatVnd(item.originalUnitPrice)}
                                  </span>
                                )}
                                {formatVnd(item.unitPrice)}
                                {item.discountPercent != null && (
                                  <span className="ml-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-medium text-white">
                                    −{item.discountPercent}%
                                  </span>
                                )}
                              </td>
                              <td className="money py-1.5 text-right">
                                {formatVnd(item.lineTotal)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {/* V1 Configurable Shipping: a breakdown, never a
                        second computation of `total` — subtotal +
                        shippingAmount is the same sum order-queries.ts
                        already returned, and must not double-count. */}
                      <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2 text-xs">
                        <div className="flex items-center justify-between text-muted-foreground">
                          <span>Subtotal</span>
                          <span className="money">{formatVnd(order.subtotal)}</span>
                        </div>
                        <div className="flex items-center justify-between text-muted-foreground">
                          <span>
                            Shipping
                            {order.shippingMethodName ? ` (${order.shippingMethodName})` : ''}
                          </span>
                          <span className="money">
                            {order.shippingAmount === 0 ? 'Free' : formatVnd(order.shippingAmount)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between font-medium">
                          <span>Total</span>
                          <span className="money">{formatVnd(order.total)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-border pt-3">
                      <h4 className={adminEyebrowClassName}>Activity</h4>
                      <OrderTimeline entries={timelines.get(order.id) ?? []} />
                    </div>

                    {/* Printing is read-only, so these are plain links and
                        need no confirmation. They stack on narrow screens
                        rather than squeezing three buttons into one row,
                        and each carries its own scoped accessible name —
                        a column of "Print" would be useless to a screen
                        reader listing them. */}
                    <div className="border-t border-border pt-3">
                      <h4 className={adminEyebrowClassName}>Print</h4>
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        {PRINT_DOCUMENTS.map((documentType) => (
                          <Link
                            key={documentType}
                            href={`/tenant-admin/orders/${order.id}/print?document=${documentType}`}
                            aria-label={`Print ${DOCUMENT_TITLE[documentType].toLowerCase()} for order ${order.id}`}
                            className={`${adminButtonSecondaryClassName} min-h-11 justify-center sm:w-auto lg:min-h-9`}
                          >
                            {DOCUMENT_TITLE[documentType]}
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                </details>
              </div>

              {/* Actions stay OUT of the disclosure: fulfilling an order is
                  the job this page exists for, and burying it behind a
                  toggle would cost a click on every order. */}
              {(order.status === 'pending' ||
                (order.paymentProvider === 'bank_transfer_manual' &&
                  order.paymentStatus === 'pending')) && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
                  {/* Manual bank transfer never gets a webhook — this is the
                    only way its Payment leaves "pending". Never shown for
                    bank_transfer_sepay_va, whose webhook is the sole
                    source of truth. */}
                  {order.paymentProvider === 'bank_transfer_manual' &&
                    order.paymentStatus === 'pending' && (
                      <ActionForm
                        action={markManualPaymentReceivedAction}
                        submitLabel="Mark as paid"
                        successMessage="Payment marked as received."
                        className="inline-flex"
                      >
                        <input type="hidden" name="orderId" value={order.id} />
                      </ActionForm>
                    )}
                  {order.status === 'pending' && (
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                      <OrderStatusForm
                        action={updateOrderStatusAction}
                        orderId={order.id}
                        nextStatus="fulfilled"
                        label="Mark fulfilled"
                      />
                      <OrderStatusForm
                        action={updateOrderStatusAction}
                        orderId={order.id}
                        nextStatus="cancelled"
                        label="Cancel"
                      />
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
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
