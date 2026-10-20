import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import { getOrderDetail } from '@/lib/order-detail';
import { actorLabel, eventTypeLabel, type OrderEventType } from '@/lib/order-events';
import { markManualPaymentReceivedAction, updateOrderStatusAction } from '../../actions';
import { ActionForm } from '@/components/ActionForm';
import { OrderStatusForm } from '../../OrderStatusForm';
import { AdminPageHeader } from '../../AdminPageHeader';
import { StatusBadge } from '../../StatusBadge';
import { formatVnd } from '../../format';
import {
  adminPageClassName,
  adminPanelClassName,
  adminPanelTitleClassName,
  adminSubtleClassName,
  adminHelpTextClassName,
  adminButtonSecondaryClassName,
  adminEyebrowClassName,
} from '../../styles';

export const dynamic = 'force-dynamic';

/**
 * One order, on a page of its own.
 *
 * Previously an order could only be inspected by expanding a row in the
 * list, and Fulfillment "opened" an order by sending you to the list
 * filtered by its reference — so acting on a flagged order meant finding
 * it again. This is the destination both of those were missing.
 *
 * Every line item links to its product, which is the other half of the
 * same problem: the list could tell you what was ordered but not take
 * you to it.
 */

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(value);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <dt className="shrink-0 text-muted-foreground sm:w-40">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{children}</dd>
    </div>
  );
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  // Authorize before reading. A layout's early return does not stop this
  // page streaming its own payload.
  const { tenantId } = await requireTenantAdmin();
  const { orderId } = await params;

  const order = await getOrderDetail(tenantId, orderId);
  // A cross-tenant id is indistinguishable from an unknown one: both 404.
  if (!order) notFound();

  const canTransition = order.status === 'pending';
  const canConfirmTransfer =
    order.payment?.provider === 'bank_transfer_manual' && order.payment.status === 'pending';

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title="Order"
        description={
          <>
            Placed {formatDateTime(order.placedAt)} ·{' '}
            <span className="font-mono text-xs break-all">{order.id}</span>
          </>
        }
        meta={
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={order.status} />
            {order.payment && <StatusBadge status={`payment: ${order.payment.status}`} />}
          </span>
        }
        actions={
          <>
            <Link href="/tenant-admin/orders" className={adminButtonSecondaryClassName}>
              ← All orders
            </Link>
            <Link
              href={`/tenant-admin/orders/${order.id}/print?document=packing-slip`}
              className={adminButtonSecondaryClassName}
            >
              Print
            </Link>
          </>
        }
      />

      {(canTransition || canConfirmTransfer) && (
        <section aria-labelledby="actions" className={adminPanelClassName}>
          <h3 id="actions" className={adminPanelTitleClassName}>
            Actions
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {canConfirmTransfer && (
              <ActionForm
                action={markManualPaymentReceivedAction}
                submitLabel="Mark as paid"
                successMessage="Payment marked as received."
                className="inline-flex"
              >
                <input type="hidden" name="orderId" value={order.id} />
              </ActionForm>
            )}
            {canTransition && (
              <>
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
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Fulfilling an order consumes its reserved stock. It does not mean the order was shipped
            or delivered, and it does not confirm that any money was received.
          </p>
        </section>
      )}

      {/* Who and where, in ONE card. They were two, which left the
          customer column half empty while the address column wrapped a
          street onto three lines. They are also one question in
          practice: who is this going to, and to what address. */}
      <section aria-labelledby="recipient" className={adminPanelClassName}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 id="recipient" className={adminPanelTitleClassName}>
            Recipient
          </h3>
          <Link
            href={`/tenant-admin/customers/${order.customer.id}`}
            className={`${adminHelpTextClassName} underline`}
          >
            View this customer&apos;s history
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-0.5 text-sm">
            <p className="font-medium break-words">{order.customer.name}</p>
            <p className="break-all text-muted-foreground">{order.customer.email}</p>
            <p className="text-muted-foreground">{order.customer.phone}</p>
          </div>

          {/* An address is one block of text, not five labelled rows.
              Labelling each line made a street address read as a form
              and pushed it into three wrapped lines inside a narrow
              column. */}
          <address className="flex min-w-0 flex-col gap-0.5 text-sm not-italic">
            <span className="break-words">{order.shipping.address}</span>
            <span className="break-words text-muted-foreground">
              {[order.shipping.ward, order.shipping.district].filter(Boolean).join(', ')}
            </span>
            <span className="break-words text-muted-foreground">{order.shipping.city}</span>
          </address>
        </div>

        {/* Shipping method and its cost together. The method used to sit
            here and the fee in the totals table, so neither place
            answered "how is it going and what did that cost". */}
        <dl className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3 text-sm">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Shipping</dt>
            <dd className="font-medium">
              {order.shipping.methodName ?? 'not recorded'} · {formatVnd(order.shipping.amount)}
            </dd>
          </div>
        </dl>

        {order.shipping.note && (
          <p className="rounded-md bg-surface-muted p-3 text-sm break-words">
            <span className="text-muted-foreground">Customer note: </span>
            {order.shipping.note}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          A snapshot taken at checkout. It is what the customer typed, never validated against an
          address service, and it never changes after the order is placed.
        </p>
      </section>

      <section aria-labelledby="items" className={adminPanelClassName}>
        <h3 id="items" className={adminPanelTitleClassName}>
          Items
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Items in this order</caption>
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="py-1.5 font-medium">
                  Product
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Qty
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Unit price
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Line total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {order.items.map((line, index) => (
                <tr key={index}>
                  <th scope="row" className="py-2 pr-3 font-normal">
                    {/* The link the list never had: straight to the product. */}
                    <Link
                      href={`/tenant-admin/catalog?product=${line.productId}`}
                      className="font-medium break-words underline"
                    >
                      {line.productName}
                    </Link>
                    {line.combinationLabel && (
                      <span className="block text-xs text-muted-foreground">
                        {line.combinationLabel}
                      </span>
                    )}
                    {line.sku && (
                      <span className="block font-mono text-xs text-muted-foreground">
                        {line.sku}
                      </span>
                    )}
                  </th>
                  <td className="py-2 text-right tabular-nums">{line.quantity}</td>
                  <td className="py-2 text-right tabular-nums">{formatVnd(line.unitPrice)}</td>
                  <td className="py-2 text-right tabular-nums">{formatVnd(line.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border">
              <tr>
                <th scope="row" colSpan={3} className="py-1.5 text-right font-normal">
                  Subtotal
                </th>
                <td className="py-1.5 text-right tabular-nums">
                  {formatVnd(order.totals.subtotal)}
                </td>
              </tr>
              <tr>
                <th scope="row" colSpan={3} className="py-1.5 text-right font-normal">
                  Shipping
                </th>
                <td className="py-1.5 text-right tabular-nums">
                  {formatVnd(order.totals.shipping)}
                </td>
              </tr>
              <tr>
                <th scope="row" colSpan={3} className="py-1.5 text-right font-semibold">
                  Total
                </th>
                <td className="py-1.5 text-right font-semibold tabular-nums">
                  {formatVnd(order.totals.total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Prices are snapshots taken when the order was placed, with any discount already applied. A
          later catalog price change never alters this order.
        </p>
      </section>

      <section aria-labelledby="payment" className={adminPanelClassName}>
        <h3 id="payment" className={adminPanelTitleClassName}>
          Payment
        </h3>
        {order.payment ? (
          <dl className="flex flex-col gap-2 text-sm">
            <Row label="Method">{order.paymentMethod}</Row>
            {/* Status and the order total are already in the header and
                the totals table. Repeating them here filled the card
                with things the reader had just passed. What is left is
                what only this card can say. */}
            {order.payment.amount !== order.totals.total && (
              // Shown ONLY when it disagrees with the order total, which
              // is a real discrepancy worth surfacing rather than a
              // second copy of a number already on the page.
              <Row label="Amount charged">
                {formatVnd(order.payment.amount)}{' '}
                <span className="font-normal text-amber-700 dark:text-amber-500">
                  — differs from the order total of {formatVnd(order.totals.total)}
                </span>
              </Row>
            )}
            {order.payment.expiresAt && (
              <Row label="Expires">{formatDateTime(order.payment.expiresAt)}</Row>
            )}
            {order.payment.failureReason && <Row label="Reason">{order.payment.failureReason}</Row>}
          </dl>
        ) : (
          <p className={adminHelpTextClassName}>
            No payment record. This order predates the current payment model.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {order.paymentMethod === 'cod'
            ? 'A cash-on-delivery payment stays pending permanently: cash is settled with the courier and this system never learns the outcome.'
            : 'A succeeded payment means this application accepted a provider confirmation and the amount matched. It does not prove the money reached a bank account.'}
        </p>
      </section>

      <section aria-labelledby="timeline" className={adminPanelClassName}>
        <h3 id="timeline" className={adminPanelTitleClassName}>
          History
        </h3>
        {order.timeline.length === 0 ? (
          <p className={adminHelpTextClassName}>No recorded activity for this order.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {order.timeline.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-0.5 border-l-2 border-border pl-3">
                <p className={adminEyebrowClassName}>
                  {eventTypeLabel(entry.type as OrderEventType)}
                </p>
                <p className="text-sm break-words">{entry.summary}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(entry.createdAt)} · {actorLabel(entry.actorType)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="scope" className={adminSubtleClassName}>
        <h3 id="scope" className={adminPanelTitleClassName}>
          What this page does not show
        </h3>
        <p className="text-xs text-muted-foreground">
          There is no carrier, tracking number, delivery confirmation, return or refund in this
          system, so none appears here. &ldquo;Fulfilled&rdquo; is an internal stock movement, not a
          shipment.
        </p>
      </section>
    </div>
  );
}
