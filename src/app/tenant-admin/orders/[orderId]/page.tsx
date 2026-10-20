import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import { getOrderDetail } from '@/lib/order-detail';
import { AdminPageHeader } from '../../AdminPageHeader';
import { StatusBadge } from '../../StatusBadge';
import { OrderDetailView, formatOrderDateTime } from '../OrderDetailView';
import { adminPageClassName, adminButtonSecondaryClassName } from '../../styles';

export const dynamic = 'force-dynamic';

/**
 * One order on a page of its own.
 *
 * The orders list now shows the same detail in a panel beside itself,
 * so this page is no longer the only way to read an order. It stays
 * because a panel cannot be linked to, bookmarked or opened in a second
 * tab, and because print and Fulfillment both need somewhere definite
 * to send an operator.
 *
 * The body is OrderDetailView, shared with that panel so the two cannot
 * drift apart.
 */
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

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title="Order"
        description={
          <>
            Placed {formatOrderDateTime(order.placedAt)} ·{' '}
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

      <OrderDetailView order={order} />
    </div>
  );
}
