import Link from 'next/link';
import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import {
  listCustomers,
  CUSTOMER_PAGE_SIZE,
  CUSTOMER_SORTS,
  CUSTOMER_SORT_LABEL,
  DEFAULT_CUSTOMER_SORT,
  isCustomerSort,
} from '@/lib/customer-queries';
import { AdminPageHeader } from '../AdminPageHeader';
import { StatusBadge, toneForStatus } from '../StatusBadge';
import { formatVnd } from '../format';
import { ExportCsvButton } from '../ExportCsvButton';
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

// Renders names, phone numbers and email addresses: never cached.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function formatDate(value: Date | null): string {
  if (!value) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(value.getDate())}/${pad(value.getMonth() + 1)}/${value.getFullYear()}`;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string; sort?: string }>;
}) {
  const { tenantId } = await requireTenantAdmin();
  const params = await searchParams;
  const rawPage = Number(params.page ?? '1');
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;

  // An unknown or malformed sort falls back to the default rather than
  // erroring or widening the query — it never reaches SQL.
  const sort = isCustomerSort(params.sort) ? params.sort : DEFAULT_CUSTOMER_SORT;

  const { rows, totalCount } = await listCustomers(tenantId, {
    search: params.search,
    page,
    sort,
  });

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title="Customers"
        description="Everyone who has ordered from this store, built from their order history. Read-only."
        meta={
          <span className={adminEyebrowClassName}>
            {totalCount} {totalCount === 1 ? 'customer' : 'customers'}
          </span>
        }
      />

      <form
        method="get"
        className={`${adminPanelClassName} sm:flex-row sm:flex-wrap sm:items-end`}
        aria-label="Search customers"
      >
        <label className={adminLabelClassName}>
          Search
          <input
            name="search"
            defaultValue={params.search ?? ''}
            placeholder="Name, phone or email"
            className={`${adminInputClassName} sm:w-80`}
          />
        </label>
        <label className={adminLabelClassName}>
          Sort customers by
          <select name="sort" defaultValue={sort} className={adminInputClassName}>
            {CUSTOMER_SORTS.map((option) => (
              <option key={option} value={option}>
                {CUSTOMER_SORT_LABEL[option]}
              </option>
            ))}
          </select>
        </label>
        {/* Submitting the form drops `page`, so changing the sort or the
            search always lands on the first page — the same behaviour the
            other admin filter forms have. */}
        <button type="submit" className={`${adminButtonSecondaryClassName} min-h-11 lg:min-h-9`}>
          Search customers
        </button>
        {params.search && (
          <Link
            href="/tenant-admin/customers"
            className="pb-2 text-xs font-medium text-muted-foreground underline transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            Clear search
          </Link>
        )}
      </form>

      <p className="text-xs text-muted-foreground">
        Phone search matches both <code>0912…</code> and <code>+84912…</code> forms. Order value
        means items plus shipping for orders that were not cancelled — it is not settled revenue.
        Sorting by last order puts customers who have never ordered at the end, rather than
        pretending they ordered long ago.
      </p>

      {rows.length === 0 ? (
        <div className={adminSubtleClassName}>
          <p className={adminPanelTitleClassName}>
            {params.search ? 'No customer matches that search' : 'No customers yet'}
          </p>
          <p className="text-xs text-muted-foreground">
            {params.search
              ? 'Try a phone number, an email address, or part of a name.'
              : 'A customer appears here once they place their first order.'}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((customer) => (
            <li key={customer.id}>
              <details className={`group ${adminPanelClassName}`}>
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 marker:content-none">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <span className="text-muted-foreground transition-transform group-open:rotate-90">
                      ›
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{customer.name}</span>
                      <span className="text-xs text-muted-foreground">{customer.phone}</span>
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {customer.orderCount} {customer.orderCount === 1 ? 'order' : 'orders'}
                    </span>
                    <span className="money text-sm font-medium whitespace-nowrap">
                      {formatVnd(customer.orderValue)}
                    </span>
                    {customer.latestOrderStatus && (
                      <StatusBadge
                        status={customer.latestOrderStatus}
                        tone={toneForStatus(customer.latestOrderStatus)}
                      />
                    )}
                  </span>
                </summary>

                <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Email</dt>
                    <dd className="break-all">{customer.email}</dd>
                    <dt className="text-muted-foreground">First order</dt>
                    <dd className="tabular-nums">{formatDate(customer.firstOrderAt)}</dd>
                    <dt className="text-muted-foreground">Last order</dt>
                    <dd className="tabular-nums">{formatDate(customer.lastOrderAt)}</dd>
                    <dt className="text-muted-foreground">Cancelled orders</dt>
                    <dd className="tabular-nums">{customer.cancelledCount}</dd>
                    <dt className="text-muted-foreground">Latest payment</dt>
                    <dd>{customer.latestPaymentStatus ?? 'not recorded'}</dd>
                  </dl>

                  {customer.possibleDuplicatePhone && (
                    <p className="text-xs text-amber-700 dark:text-amber-500">
                      Another customer in this store has the same phone number. They are kept
                      separate because each has its own email address — this store does not merge
                      customer records.
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/tenant-admin/customers/${customer.id}`}
                      aria-label={`View order history for ${customer.name}`}
                      className={`${adminButtonSecondaryClassName} min-h-11 lg:min-h-9`}
                    >
                      Order history
                    </Link>
                    <Link
                      href={`/tenant-admin/orders?search=${encodeURIComponent(customer.phone)}`}
                      aria-label={`Open orders for ${customer.name}`}
                      className={`${adminButtonSecondaryClassName} min-h-11 lg:min-h-9`}
                    >
                      Open in orders
                    </Link>
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        basePath="/tenant-admin/customers"
        searchParams={params}
        page={page}
        pageSize={CUSTOMER_PAGE_SIZE}
        totalCount={totalCount}
      />

      <section aria-labelledby="customer-export" className={adminPanelClassName}>
        <h3 id="customer-export" className={adminPanelTitleClassName}>
          Export customers (CSV)
        </h3>
        <p className="text-xs text-muted-foreground">
          One row per customer: name, phone, email, order count, order value, first and last order
          dates, and latest statuses.
        </p>
        <p role="note" className="text-xs text-amber-700 dark:text-amber-500">
          <strong className="font-semibold">This file contains personal data.</strong> Names, phone
          numbers and email addresses leave the app&apos;s access controls as soon as it is
          downloaded. Store it somewhere you would be comfortable storing a customer list.
        </p>
        <div>
          <ExportCsvButton dataset="customers" label="customers" />
        </div>
      </section>
    </div>
  );
}
