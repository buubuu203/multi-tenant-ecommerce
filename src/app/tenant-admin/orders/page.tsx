import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { ActionForm } from "@/components/ActionForm";
import {
  updateOrderStatusAction,
  markManualPaymentReceivedAction,
  bulkUpdateOrderStatusAction,
} from "../actions";
import { OrderStatusForm } from "../OrderStatusForm";
import { BulkOrderStatusForm } from "../BulkOrderStatusForm";
import { Pagination } from "../Pagination";
import { listOrders, type ListOrdersOptions } from "@/lib/order-queries";
import { formatVnd } from "../format";
import { adminSectionClassName, adminInputClassName } from "../styles";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const ORDER_STATUSES = ["pending", "fulfilled", "cancelled"] as const;

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cod: "Cash on delivery",
  momo: "MoMo",
  bank_transfer: "Bank transfer",
};

// Color-coded so the order lifecycle (pending -> fulfilled/cancelled) and
// the separate payment lifecycle (pending -> succeeded/failed) are each
// legible at a glance, not just distinguishable by reading the label text.
// Two independent axes — see schema.prisma's Payment doc comment — so
// deliberately two separate lookups rather than one combined status.
const ORDER_STATUS_BADGE: Record<string, string> = {
  pending:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400",
  fulfilled:
    "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-400",
  cancelled: "border-border bg-surface-muted text-muted-foreground",
};

const PAYMENT_STATUS_BADGE: Record<string, string> = {
  pending:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400",
  succeeded:
    "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-400",
  failed:
    "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400",
};

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId } = await requireTenantAdmin();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const status = typeof params.status === "string" ? params.status : "";
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

  return (
    <section className={adminSectionClassName}>
      <h2 className="text-lg font-medium tracking-tight">Orders</h2>

      {/* Phase 2: search + status filter, plain GET form — no client JS,
        no state to lose on refresh, shareable/bookmarkable URL. */}
      <form className="flex flex-wrap items-end gap-2" method="get">
        <label className="flex flex-col gap-1 text-xs">
          Search
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Order id, customer name, or email"
            className={`w-64 ${adminInputClassName}`}
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
        <button
          type="submit"
          className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-muted"
        >
          Filter
        </button>
      </form>

      <BulkOrderStatusForm action={bulkUpdateOrderStatusAction} />

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[790px] text-left text-sm">
          <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium"></th>
              <th className="px-3 py-2 font-medium">Order</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Payment</th>
              <th className="px-3 py-2 font-medium">Total</th>
              <th className="px-3 py-2 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    name="orderIds"
                    value={order.id}
                    form="bulk-orders-form"
                    aria-label={`Select order ${order.id}`}
                  />
                </td>
                <td className="px-3 py-2 font-mono text-xs">{order.id}</td>
                <td className="px-3 py-2">
                  <div>{order.customer.name}</div>
                  <div className="text-xs text-muted-foreground">{order.customer.email}</div>
                </td>
                <td className="px-3 py-2 capitalize">{order.status}</td>
                <td className="px-3 py-2">
                  {PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod}
                </td>
                <td className="px-3 py-2 font-mono">{formatVnd(order.total)}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {order.createdAt.toLocaleDateString("en-US")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        basePath="/tenant-admin/orders"
        searchParams={params}
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={totalCount}
      />
      <h3 className="text-sm font-medium text-muted-foreground">Order details and actions</h3>
      <div className="flex flex-col gap-3">
        {orders.map((order) => (
          <div key={order.id} className="rounded-lg border border-border bg-surface p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">Order {order.id}</span>
              <span
                className={`rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${ORDER_STATUS_BADGE[order.status] ?? "border-border"}`}
              >
                {order.status}
              </span>
              <span className="text-xs text-muted-foreground">
                {PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod}
              </span>
              {/* Step 49: business-level payment state — null for
                cod/bank_transfer (no Payment row exists for those, see
                order-queries.ts). Independent of order.status; never
                merged into that badge — two separate lifecycles, two
                separate color-coded badges. */}
              {order.paymentStatus && (
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${PAYMENT_STATUS_BADGE[order.paymentStatus] ?? "border-border"}`}
                >
                  Payment: {order.paymentStatus}
                </span>
              )}
              {/* Manual bank transfer never gets a webhook — this is the
                only way its Payment ever leaves "pending". Never shown
                for bank_transfer_sepay_va: SePay's own webhook is the
                sole source of truth for that provider. */}
              {order.paymentProvider === "bank_transfer_manual" &&
                order.paymentStatus === "pending" && (
                  <ActionForm
                    action={markManualPaymentReceivedAction}
                    submitLabel="Mark as paid"
                    className="inline-flex"
                  >
                    <input type="hidden" name="orderId" value={order.id} />
                  </ActionForm>
                )}
              <span className="text-xs text-muted-foreground">
                {order.itemCount} item{order.itemCount === 1 ? "" : "s"}
              </span>
              <span className="font-mono text-xs">{formatVnd(order.total)}</span>
              {order.status === "pending" && (
                <div className="ml-auto flex items-center gap-1">
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
            <p className="mt-1 text-xs text-muted-foreground">
              {order.createdAt.toLocaleString("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>

            <div className="mt-3 border-t border-border pt-3">
              <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Customer
              </h4>
              <p className="mt-1 text-xs">{order.customer.name}</p>
              <p className="text-xs text-muted-foreground">{order.customer.email}</p>
              <p className="text-xs text-muted-foreground">{order.customer.phone}</p>
            </div>

            <div className="mt-3 border-t border-border pt-3">
              <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Shipping address
              </h4>
              <p className="mt-1 text-xs">{order.shippingAddress}</p>
              <p className="text-xs text-muted-foreground">{order.shippingWard}</p>
              {/* District is no longer collected (Vietnam's 2025 2-tier
                reform dropped it) — shown only for orders placed before
                that change, which still have a real value. */}
              {order.shippingDistrict && (
                <p className="text-xs text-muted-foreground">{order.shippingDistrict}</p>
              )}
              <p className="text-xs text-muted-foreground">{order.shippingCity}</p>
              {order.shippingNote && (
                <p className="text-xs text-muted-foreground">Note: {order.shippingNote}</p>
              )}
            </div>

            <div className="mt-3 overflow-x-auto border-t border-border pt-3">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="py-1.5 pr-2 font-medium">Item</th>
                    <th className="py-1.5 pr-2 font-medium">Qty</th>
                    <th className="py-1.5 pr-2 font-medium">Unit price</th>
                    <th className="py-1.5 font-medium">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      <td className="py-1.5 pr-2">
                        {item.productName}
                        {item.combinationLabel && (
                          <span className="text-muted-foreground"> — {item.combinationLabel}</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-2">{item.quantity}</td>
                      <td className="py-1.5 pr-2 font-mono">
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
                      <td className="py-1.5 font-mono">{formatVnd(item.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* V1 Configurable Shipping: breakdown, never a second
                computation of `total` — subtotal + shippingAmount is the
                exact same sum order-queries.ts already returned as
                `total` above; showing it broken out here must not
                double-count it. */}
              <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2 text-xs">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="font-mono">{formatVnd(order.subtotal)}</span>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>
                    Shipping{order.shippingMethodName ? ` (${order.shippingMethodName})` : ""}
                  </span>
                  <span className="font-mono">
                    {order.shippingAmount === 0 ? "Free" : formatVnd(order.shippingAmount)}
                  </span>
                </div>
                <div className="flex items-center justify-between font-medium">
                  <span>Total</span>
                  <span className="font-mono">{formatVnd(order.total)}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
        {orders.length === 0 && <p className="text-sm text-muted-foreground">No orders yet.</p>}
      </div>
    </section>
  );
}
