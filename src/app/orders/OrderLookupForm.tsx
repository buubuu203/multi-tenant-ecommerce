"use client";

import { useActionState } from "react";
import { lookupOrderAction } from "./actions";
import type { CustomerOrderView } from "@/lib/order-queries";

function formatVnd(price: number): string {
  return `${price.toLocaleString("vi-VN")} ₫`;
}

// Mirrors tenant-admin/page.tsx's own PAYMENT_METHOD_LABELS convention —
// small, local, duplicated rather than shared, matching how this codebase
// already treats formatVnd/payment-label maps as per-file conveniences
// (see CartWidget.tsx) rather than a shared utils module.
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cod: "Cash on delivery",
  momo: "MoMo",
  bank_transfer: "Bank transfer",
};

// Mirrors tenant-admin/page.tsx's ORDER_STATUS_BADGE/PAYMENT_STATUS_BADGE —
// same color coding so a customer and the merchant read the same order's
// lifecycle the same way, duplicated per this codebase's established
// per-file convention rather than a shared constants module.
const ORDER_STATUS_BADGE: Record<string, string> = {
  pending: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400",
  fulfilled: "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-400",
  cancelled: "border-border bg-surface-muted text-muted-foreground",
};

const PAYMENT_STATUS_BADGE: Record<string, string> = {
  pending: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400",
  succeeded: "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-400",
  failed: "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400",
};

function OrderDetails({ order }: { order: CustomerOrderView }) {
  return (
    <div className="mt-4 rounded-lg border border-border bg-surface p-4 text-sm">
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
        {/* Step 49: lets the customer tell whether they still need to pay
            (or their payment failed) without guessing — null for
            cod/bank_transfer, which never have a Payment record. */}
        {order.paymentStatus && (
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${PAYMENT_STATUS_BADGE[order.paymentStatus] ?? "border-border"}`}
          >
            Payment: {order.paymentStatus}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {order.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
      </p>

      <div className="mt-3 border-t border-border pt-3">
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Shipping address</h4>
        <p className="mt-1 text-xs">{order.shippingAddress}</p>
        <p className="text-xs text-muted-foreground">
          {order.shippingWard}, {order.shippingDistrict}, {order.shippingCity}
        </p>
        {order.shippingNote && <p className="text-xs text-muted-foreground">Note: {order.shippingNote}</p>}
      </div>

      <table className="mt-3 w-full text-left text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className="py-1.5 pr-2 font-medium">Item</th>
            <th className="py-1.5 pr-2 font-medium">Qty</th>
            <th className="py-1.5 pr-2 font-medium">Unit price</th>
            <th className="py-1.5 font-medium">Line total</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              <td className="py-1.5 pr-2">
                <div className="flex items-center gap-2">
                  {/* Step 47: same display-only posture as the rest of this
                      row — the product's current image, not a snapshot. */}
                  {item.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra, see ProductList.tsx
                    <img src={item.imageUrl} alt={item.productName} className="h-8 w-8 rounded-md object-cover" />
                  )}
                  <span>
                    {item.productName}
                    {item.combinationLabel && (
                      <span className="text-muted-foreground"> — {item.combinationLabel}</span>
                    )}
                  </span>
                </div>
              </td>
              <td className="py-1.5 pr-2">{item.quantity}</td>
              <td className="py-1.5 pr-2 font-mono">{formatVnd(item.unitPrice)}</td>
              <td className="py-1.5 font-mono">{formatVnd(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2 flex items-center justify-between border-t border-border pt-3 text-xs">
        <span className="text-muted-foreground">Total</span>
        <span className="font-mono">{formatVnd(order.total)}</span>
      </div>

      {/* Same plain merchant-entered instructions as the checkout success
          panel (CartWidget.tsx) — a customer returning to check on this
          order later still sees how to pay, not just at checkout time. */}
      {order.paymentMethod === "bank_transfer" && order.bankTransferInfo && (
        <div className="mt-3 rounded-md border border-border bg-surface-muted p-3 text-xs">
          <p className="font-medium">Transfer to:</p>
          <p className="mt-1">{order.bankTransferInfo.bankName}</p>
          <p className="font-mono">{order.bankTransferInfo.bankAccountNumber}</p>
          <p>{order.bankTransferInfo.bankAccountHolder}</p>
          <p className="mt-2 text-muted-foreground">Please include your order ID as the transfer note.</p>
        </div>
      )}
    </div>
  );
}

// Used both by /orders/[orderId] (orderId pre-filled from the URL — only
// email is asked for) and /orders (both fields entered by the customer).
// Not reusing the shared ActionForm here for the same reason
// ImportProductsForm.tsx doesn't: a successful lookup must render
// structured order data, not just an inline error string — same
// established precedent as that component and OrderStatusForm.tsx.
export function OrderLookupForm({ fixedOrderId }: { fixedOrderId?: string }) {
  const [state, formAction, pending] = useActionState(lookupOrderAction, null);

  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-end gap-3 text-sm">
        {fixedOrderId ? (
          <input type="hidden" name="orderId" value={fixedOrderId} />
        ) : (
          <label className="flex flex-col gap-1">
            Order ID
            <input
              name="orderId"
              className="rounded-md border border-border bg-background px-2.5 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
            />
          </label>
        )}
        <label className="flex flex-col gap-1">
          Email used at checkout
          <input
            type="email"
            name="email"
            className="rounded-md border border-border bg-background px-2.5 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-foreground px-4 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Looking up…" : "View order"}
        </button>
      </form>

      {state && !state.success && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
      {state && state.success && <OrderDetails order={state.data} />}
    </div>
  );
}
