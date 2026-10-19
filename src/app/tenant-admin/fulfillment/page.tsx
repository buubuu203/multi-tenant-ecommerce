import Link from 'next/link';
import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import {
  listFulfillmentQueue,
  FULFILLMENT_CATEGORIES,
  FULFILLMENT_PAGE_SIZE,
  CATEGORY_LABEL,
  BLOCKER_LABEL,
  BLOCKER_ACTION,
  isFulfillmentCategory,
  type FulfillmentCategory,
} from '@/lib/fulfillment-queue';
import { AdminPageHeader } from '../AdminPageHeader';
import { StatusBadge, toneForStatus, type BadgeTone } from '../StatusBadge';
import { formatVnd } from '../format';
import { Pagination } from '../Pagination';
import {
  adminPageClassName,
  adminPanelClassName,
  adminPanelTitleClassName,
  adminSubtleClassName,
  adminInputClassName,
  adminLabelClassName,
  adminButtonSecondaryClassName,
  adminEyebrowClassName,
} from '../styles';

// Customer names, phones and destinations: never cached.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CATEGORY_TONE: Record<FulfillmentCategory, BadgeTone> = {
  ready_to_fulfill: 'success',
  needs_payment: 'warning',
  needs_review: 'danger',
  fulfilled: 'info',
  cancelled: 'neutral',
};

function formatDate(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(value.getDate())}/${pad(value.getMonth() + 1)}/${value.getFullYear()}`;
}

export default async function FulfillmentPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; search?: string; page?: string }>;
}) {
  const { tenantId } = await requireTenantAdmin();
  const params = await searchParams;

  const rawPage = Number(params.page ?? '1');
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  // An unknown category falls back to "all" rather than erroring or
  // widening anything.
  const category = isFulfillmentCategory(params.category) ? params.category : undefined;

  const { rows, totalCount, summary } = await listFulfillmentQueue(tenantId, {
    category,
    search: params.search,
    page,
  });

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title="Fulfillment"
        description="Which orders need attention before they can be prepared. Read-only — nothing here changes an order."
        meta={<span className={adminEyebrowClassName}>{totalCount} orders</span>}
      />

      <section aria-labelledby="queue-summary" className="flex flex-col gap-3">
        <h3 id="queue-summary" className={adminPanelTitleClassName}>
          Across all orders
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {FULFILLMENT_CATEGORIES.map((key) => (
            <Link
              key={key}
              href={`/tenant-admin/fulfillment?category=${key}`}
              aria-label={`Show ${CATEGORY_LABEL[key].toLowerCase()} orders`}
              className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-foreground/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
            >
              <span className="text-xs font-medium text-muted-foreground">
                {CATEGORY_LABEL[key]}
              </span>
              <span className="money text-2xl font-semibold tabular-nums">{summary[key]}</span>
            </Link>
          ))}
        </div>
      </section>

      <form
        method="get"
        className={`${adminPanelClassName} sm:flex-row sm:flex-wrap sm:items-end`}
        aria-label="Filter the fulfillment queue"
      >
        <label className={adminLabelClassName}>
          Category
          <select name="category" defaultValue={category ?? ''} className={adminInputClassName}>
            <option value="">All orders</option>
            {FULFILLMENT_CATEGORIES.map((key) => (
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
            placeholder="Order reference, customer name or phone"
            className={`${adminInputClassName} sm:w-72`}
          />
        </label>
        <button type="submit" className={`${adminButtonSecondaryClassName} min-h-11 lg:min-h-9`}>
          Apply filters
        </button>
      </form>

      {rows.length === 0 ? (
        <div className={adminSubtleClassName}>
          <p className={adminPanelTitleClassName}>Nothing in this view</p>
          <p className="text-xs text-muted-foreground">
            {category || params.search
              ? 'No order on this page matches. Clear a filter to see more.'
              : 'Orders appear here as soon as customers place them.'}
          </p>
        </div>
      ) : (
        /* Disclosures: reference, category and total stay visible at
           375px, with destination and the rest revealed on open. */
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.reference}>
              <details className={`group ${adminPanelClassName}`}>
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 marker:content-none">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <span className="text-muted-foreground transition-transform group-open:rotate-90">
                      ›
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-mono text-xs">{row.reference}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(row.placedAt)} · {row.customerName}
                      </span>
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="money text-sm font-medium whitespace-nowrap">
                      {formatVnd(row.total)}
                    </span>
                    <StatusBadge
                      status={CATEGORY_LABEL[row.category]}
                      tone={CATEGORY_TONE[row.category]}
                    />
                  </span>
                </summary>

                <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
                  {row.blockers.length > 0 && (
                    <ul className="flex flex-col gap-2">
                      {row.blockers.map((blocker) => (
                        <li key={blocker} className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">{BLOCKER_LABEL[blocker]}</span>
                          <span className="text-xs text-muted-foreground">
                            {BLOCKER_ACTION[blocker]}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Order status</dt>
                    <dd>
                      <StatusBadge status={row.orderStatus} tone={toneForStatus(row.orderStatus)} />
                    </dd>
                    <dt className="text-muted-foreground">Payment</dt>
                    <dd>
                      {row.paymentMethod}
                      {row.paymentStatus ? ` — ${row.paymentStatus}` : ' — not recorded'}
                    </dd>
                    <dt className="text-muted-foreground">Shipping method</dt>
                    <dd>{row.shippingMethodName ?? 'not recorded'}</dd>
                    <dt className="text-muted-foreground">Destination</dt>
                    <dd className="break-words">{row.destination || '—'}</dd>
                    <dt className="text-muted-foreground">Phone</dt>
                    <dd className="break-words">{row.customerPhone}</dd>
                  </dl>

                  <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                    {/* Straight to the order. This used to send the
                        operator to the orders LIST filtered by reference,
                        so acting on a flagged order meant finding it
                        again on another page. */}
                    <Link
                      href={`/tenant-admin/orders/${row.reference}`}
                      aria-label={`Open order ${row.reference}`}
                      className={`${adminButtonSecondaryClassName} min-h-11 lg:min-h-9`}
                    >
                      Open order
                    </Link>
                    <Link
                      href={`/tenant-admin/orders/${row.reference}/print?document=packing-slip`}
                      aria-label={`Print packing slip for order ${row.reference}`}
                      className={`${adminButtonSecondaryClassName} min-h-11 lg:min-h-9`}
                    >
                      Print packing slip
                    </Link>
                    <Link
                      href={`/tenant-admin/orders/${row.reference}/print?document=shipping-note`}
                      aria-label={`Print shipping note for order ${row.reference}`}
                      className={`${adminButtonSecondaryClassName} min-h-11 lg:min-h-9`}
                    >
                      Print shipping note
                    </Link>
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        basePath="/tenant-admin/fulfillment"
        searchParams={params}
        page={page}
        pageSize={FULFILLMENT_PAGE_SIZE}
        totalCount={totalCount}
      />

      <section aria-labelledby="scope" className={adminSubtleClassName}>
        <h3 id="scope" className={adminPanelTitleClassName}>
          What this page is not
        </h3>
        <p className="text-xs text-muted-foreground">
          This is an internal queue, not a shipment or carrier system. There is no carrier
          integration and no tracking number, so nothing here reports pickup, transit, delivery, a
          failed delivery, a return, a refund, COD collection or payment settlement.
          &ldquo;Fulfilled&rdquo; means exactly what it means on the order — it is not
          &ldquo;shipped&rdquo; or &ldquo;delivered&rdquo;. Stock is already reserved when an order
          is placed, so inventory is not shown as a blocker.
        </p>
      </section>
    </div>
  );
}
