import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import { getCustomerDetail } from '@/lib/customer-queries';
import { getDictionary, getLocale } from '@/lib/i18n';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { ActionForm } from '@/components/ActionForm';
import { AdminPageHeader } from '../../AdminPageHeader';
import { anonymizeCustomerAction } from '../../actions';
import { StatusBadge, toneForStatus } from '../../StatusBadge';
import { formatVnd } from '../../format';
import {
  adminInputClassName,
  adminLabelClassName,
  adminPageClassName,
  adminPanelClassName,
  adminPanelTitleClassName,
  adminSubtleClassName,
  adminButtonSecondaryClassName,
} from '../../styles';

// One customer's name, phone, email and full order history: never cached.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function formatDate(value: Date | null, locale: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US').format(value);
}

function paymentMethodLabel(method: string, dict: Dictionary): string {
  switch (method) {
    case 'cod':
      return dict.payment.cod;
    case 'momo':
      return dict.payment.momo;
    case 'bank_transfer':
      return dict.payment.bankTransfer;
    default:
      return method;
  }
}

/**
 * Customer detail and tenant-admin privacy request handling.
 */
export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { tenantId } = await requireTenantAdmin();
  const { customerId } = await params;
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  const orderStatusLabels: Record<string, string> = {
    ...dict.customerDetail.orderStatuses,
  };
  const paymentStatusLabels: Record<string, string> = {
    ...dict.customerDetail.paymentStatuses,
  };

  // A customer in another tenant and one that does not exist give the
  // same answer, so neither can be probed for.
  const customer = await getCustomerDetail(tenantId, customerId);
  if (!customer) {
    notFound();
  }

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title={customer.anonymizedAt ? dict.customerDetail.anonymizedCustomer : customer.name}
        description={dict.customerDetail.description}
        actions={
          <Link
            href="/tenant-admin/customers"
            className="text-sm text-muted-foreground underline transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            {dict.customerDetail.back}
          </Link>
        }
      />

      <section aria-labelledby="contact" className={adminPanelClassName}>
        <h3 id="contact" className={adminPanelTitleClassName}>
          {dict.customerDetail.contact}
        </h3>
        {customer.anonymizedAt ? (
          <p role="status" className="text-sm text-muted-foreground">
            {dict.customerDetail.anonymizedAt.replace(
              '{date}',
              formatDate(customer.anonymizedAt, locale),
            )}
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <dt className="text-muted-foreground">{dict.customerDetail.phone}</dt>
            <dd className="break-words">{customer.phone}</dd>
            <dt className="text-muted-foreground">{dict.customerDetail.email}</dt>
            <dd className="break-all">{customer.email}</dd>
          </dl>
        )}
        {!customer.anonymizedAt && customer.possibleDuplicatePhone && (
          <p className="text-xs text-amber-700 dark:text-amber-500">
            {dict.customerDetail.duplicatePhoneWarning}
          </p>
        )}
      </section>

      {customer.privacyEvents.length > 0 && (
        <section aria-labelledby="privacy-history" className={adminPanelClassName}>
          <h3 id="privacy-history" className={adminPanelTitleClassName}>
            {dict.customerDetail.privacyAudit}
          </h3>
          <ul className="flex flex-col gap-2 text-sm">
            {customer.privacyEvents.map((event) => (
              <li
                key={`${event.actorId}-${event.completedAt.toISOString()}`}
                className="flex flex-col gap-1 border-t border-border pt-2"
              >
                <span>
                  {dict.customerDetail.requestReceived}{' '}
                  {formatDate(event.requestReceivedAt, locale)}
                </span>
                <span>
                  {dict.customerDetail.completed} {formatDate(event.completedAt, locale)}
                </span>
                <span>
                  {dict.customerDetail.ordersRetained} {event.affectedOrderCount}
                </span>
                <span className="break-all text-xs text-muted-foreground">
                  {dict.customerDetail.adminId} {event.actorId}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!customer.anonymizedAt && (
        <section aria-labelledby="privacy-request" className={adminPanelClassName}>
          <h3 id="privacy-request" className={adminPanelTitleClassName}>
            {dict.customerDetail.anonymizeTitle}
          </h3>
          <p className="text-sm text-muted-foreground">
            {dict.customerDetail.anonymizeInstructions}
          </p>
          <ActionForm
            action={anonymizeCustomerAction}
            submitLabel={dict.customerDetail.anonymizeButton}
            successMessage={dict.customerDetail.anonymizeSuccess}
            pendingLabel={dict.common.working}
            variant="danger"
            className="flex flex-col gap-3"
          >
            <input type="hidden" name="customerId" value={customer.id} />
            <label className={adminLabelClassName}>
              {dict.customerDetail.requestDate}
              <input
                type="date"
                name="requestReceivedAt"
                required
                className={adminInputClassName}
              />
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="confirmPrivacyRequest" required className="mt-1" />
              <span>{dict.customerDetail.identityConfirmation}</span>
            </label>
          </ActionForm>
        </section>
      )}

      <section aria-labelledby="summary" className="flex flex-col gap-3">
        <h3 id="summary" className={adminPanelTitleClassName}>
          {dict.customerDetail.summary}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [
              dict.customerDetail.orders,
              String(customer.orderCount),
              dict.customerDetail.allOrdersHint,
            ],
            [
              dict.customerDetail.orderValue,
              formatVnd(customer.orderValue),
              dict.customerDetail.orderValueHint,
            ],
            [dict.customerDetail.firstOrder, formatDate(customer.firstOrderAt, locale), ''],
            [dict.customerDetail.lastOrder, formatDate(customer.lastOrderAt, locale), ''],
          ].map(([label, value, hint]) => (
            <div key={label} className="flex flex-col gap-1 rounded-2xl bg-surface p-5 shadow-sm">
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
              <span className="money text-xl font-semibold tabular-nums">{value}</span>
              {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{dict.customerDetail.valueDisclaimer}</p>
      </section>

      <section aria-labelledby="history" className="flex flex-col gap-3">
        <h3 id="history" className={adminPanelTitleClassName}>
          {dict.customerDetail.history}
        </h3>

        {customer.orders.length === 0 ? (
          <div className={adminSubtleClassName}>
            <p className={adminPanelTitleClassName}>{dict.customerDetail.noOrders}</p>
            <p className="text-xs text-muted-foreground">{dict.customerDetail.noOrdersHint}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {customer.orders.map((order) => (
              <li key={order.reference} className={adminPanelClassName}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-mono text-xs break-all">{order.reference}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatDate(order.placedAt, locale)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {order.privacyConsentAt && order.privacyNoticeVersion !== null
                        ? dict.customerDetail.privacyConsentRecorded
                            .replace('{date}', formatDate(order.privacyConsentAt, locale))
                            .replace('{version}', String(order.privacyNoticeVersion))
                        : dict.customerDetail.privacyConsentNotRecorded}
                    </span>
                  </div>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="money text-sm font-medium whitespace-nowrap">
                      {formatVnd(order.total)}
                    </span>
                    <StatusBadge
                      status={orderStatusLabels[order.status] ?? order.status}
                      tone={toneForStatus(order.status)}
                    />
                    <StatusBadge
                      status={
                        order.paymentStatus
                          ? (paymentStatusLabels[order.paymentStatus] ?? order.paymentStatus)
                          : dict.customerDetail.paymentNotRecorded
                      }
                      tone={order.paymentStatus ? toneForStatus(order.paymentStatus) : 'neutral'}
                    />
                  </span>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">{dict.customerDetail.paymentMethod}</dt>
                  <dd>{paymentMethodLabel(order.paymentMethod, dict)}</dd>
                  <dt className="text-muted-foreground">{dict.customerDetail.shipping}</dt>
                  <dd>{order.shippingMethodName ?? dict.customerDetail.notRecorded}</dd>
                </dl>

                {order.cancelled && (
                  <p className="text-xs text-muted-foreground">
                    {dict.customerDetail.cancelledNote}
                  </p>
                )}

                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  <Link
                    href={`/tenant-admin/orders?search=${encodeURIComponent(order.reference)}`}
                    aria-label={dict.customerDetail.openOrderLabel.replace(
                      '{reference}',
                      order.reference,
                    )}
                    className={`${adminButtonSecondaryClassName} min-h-11 lg:min-h-9`}
                  >
                    {dict.customerDetail.openOrder}
                  </Link>
                  <Link
                    href={`/tenant-admin/orders/${order.reference}/print?document=order-summary`}
                    aria-label={dict.customerDetail.printOrderLabel.replace(
                      '{reference}',
                      order.reference,
                    )}
                    className={`${adminButtonSecondaryClassName} min-h-11 lg:min-h-9`}
                  >
                    {dict.customerDetail.printOrder}
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
