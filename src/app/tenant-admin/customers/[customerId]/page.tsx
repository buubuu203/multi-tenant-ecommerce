import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import { getCustomerDetail } from '@/lib/customer-queries';
import { AdminPageHeader } from '../../AdminPageHeader';
import { StatusBadge, toneForStatus } from '../../StatusBadge';
import { formatVnd } from '../../format';
import {
  adminPageClassName,
  adminPanelClassName,
  adminPanelTitleClassName,
  adminSubtleClassName,
  adminButtonSecondaryClassName,
} from '../../styles';

// One customer's name, phone, email and full order history: never cached.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function formatDate(value: Date | null): string {
  if (!value) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(value.getDate())}/${pad(value.getMonth() + 1)}/${value.getFullYear()}`;
}

/**
 * Customer detail — read-only.
 *
 * No edit, delete, merge or message action. The schema has no field any
 * of those would write, and merging would rewrite order history, so they
 * are out of scope for v1 rather than approximated.
 */
export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { tenantId } = await requireTenantAdmin();
  const { customerId } = await params;

  // A customer in another tenant and one that does not exist give the
  // same answer, so neither can be probed for.
  const customer = await getCustomerDetail(tenantId, customerId);
  if (!customer) {
    notFound();
  }

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title={customer.name}
        description="Order history for one customer. Read-only — nothing here edits the customer."
        actions={
          <Link
            href="/tenant-admin/customers"
            className="text-sm text-muted-foreground underline transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            Back to customers
          </Link>
        }
      />

      <section aria-labelledby="contact" className={adminPanelClassName}>
        <h3 id="contact" className={adminPanelTitleClassName}>
          Contact
        </h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-muted-foreground">Phone</dt>
          <dd className="break-words">{customer.phone}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd className="break-all">{customer.email}</dd>
        </dl>
        {customer.possibleDuplicatePhone && (
          <p className="text-xs text-amber-700 dark:text-amber-500">
            Another customer in this store has the same phone number. Records are identified by
            email and are never merged.
          </p>
        )}
      </section>

      <section aria-labelledby="summary" className="flex flex-col gap-3">
        <h3 id="summary" className={adminPanelTitleClassName}>
          Summary
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Orders', String(customer.orderCount), 'All orders, cancelled included'],
            [
              'Order value',
              formatVnd(customer.orderValue),
              'Items + shipping, excluding cancelled',
            ],
            ['First order', formatDate(customer.firstOrderAt), ''],
            ['Last order', formatDate(customer.lastOrderAt), ''],
          ].map(([label, value, hint]) => (
            <div
              key={label}
              className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4"
            >
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
              <span className="money text-xl font-semibold tabular-nums">{value}</span>
              {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Order value is not settled revenue: it includes orders nobody has paid for yet, and this
          store never observes a payment reaching a bank account.
        </p>
      </section>

      <section aria-labelledby="history" className="flex flex-col gap-3">
        <h3 id="history" className={adminPanelTitleClassName}>
          Order history
        </h3>

        {customer.orders.length === 0 ? (
          <div className={adminSubtleClassName}>
            <p className={adminPanelTitleClassName}>No orders</p>
            <p className="text-xs text-muted-foreground">
              This customer record exists but has no orders in this store.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {customer.orders.map((order) => (
              <li key={order.reference} className={adminPanelClassName}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-mono text-xs break-all">{order.reference}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatDate(order.placedAt)}
                    </span>
                  </div>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="money text-sm font-medium whitespace-nowrap">
                      {formatVnd(order.total)}
                    </span>
                    <StatusBadge status={order.status} tone={toneForStatus(order.status)} />
                    <StatusBadge
                      status={order.paymentStatus ?? 'payment not recorded'}
                      tone={order.paymentStatus ? toneForStatus(order.paymentStatus) : 'neutral'}
                    />
                  </span>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Payment method</dt>
                  <dd>{order.paymentMethod}</dd>
                  <dt className="text-muted-foreground">Shipping</dt>
                  <dd>{order.shippingMethodName ?? 'not recorded'}</dd>
                </dl>

                {order.cancelled && (
                  <p className="text-xs text-muted-foreground">
                    Cancelled — excluded from this customer&apos;s order value.
                  </p>
                )}

                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  <Link
                    href={`/tenant-admin/orders?search=${encodeURIComponent(order.reference)}`}
                    aria-label={`Open order ${order.reference}`}
                    className={`${adminButtonSecondaryClassName} min-h-11 lg:min-h-9`}
                  >
                    Open order
                  </Link>
                  <Link
                    href={`/tenant-admin/orders/${order.reference}/print?document=order-summary`}
                    aria-label={`Print order summary for order ${order.reference}`}
                    className={`${adminButtonSecondaryClassName} min-h-11 lg:min-h-9`}
                  >
                    Print order summary
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
