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

function OrderDetails({ order }: { order: CustomerOrderView }) {
  return (
    <div className="mt-4 rounded border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs">Order {order.id}</span>
        <span className="rounded-full border px-2 py-0.5 text-xs capitalize">{order.status}</span>
        <span className="text-xs text-black/60 dark:text-white/60">
          {PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod}
        </span>
        {/* Step 49: lets the customer tell whether they still need to pay
            (or their payment failed) without guessing — null for
            cod/bank_transfer, which never have a Payment record. */}
        {order.paymentStatus && (
          <span
            className={
              order.paymentStatus === "failed"
                ? "rounded-full border px-2 py-0.5 text-xs capitalize text-red-600"
                : "rounded-full border px-2 py-0.5 text-xs capitalize"
            }
          >
            Payment: {order.paymentStatus}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-black/60 dark:text-white/60">
        {order.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
      </p>

      <div className="mt-2 border-t pt-2">
        <h4 className="text-xs font-medium uppercase text-black/60 dark:text-white/60">Shipping address</h4>
        <p className="text-xs">{order.shippingAddress}</p>
        <p className="text-xs text-black/60 dark:text-white/60">
          {order.shippingWard}, {order.shippingDistrict}, {order.shippingCity}
        </p>
        {order.shippingNote && <p className="text-xs text-black/60 dark:text-white/60">Note: {order.shippingNote}</p>}
      </div>

      <table className="mt-3 w-full text-left text-xs">
        <thead>
          <tr className="border-b">
            <th className="py-1 pr-2 font-medium">Item</th>
            <th className="py-1 pr-2 font-medium">Qty</th>
            <th className="py-1 pr-2 font-medium">Unit price</th>
            <th className="py-1 font-medium">Line total</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="py-1 pr-2">
                <div className="flex items-center gap-2">
                  {/* Step 47: same display-only posture as the rest of this
                      row — the product's current image, not a snapshot. */}
                  {item.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra, see ProductList.tsx
                    <img src={item.imageUrl} alt={item.productName} className="h-8 w-8 rounded object-cover" />
                  )}
                  <span>
                    {item.productName}
                    {item.combinationLabel && (
                      <span className="text-black/60 dark:text-white/60"> — {item.combinationLabel}</span>
                    )}
                  </span>
                </div>
              </td>
              <td className="py-1 pr-2">{item.quantity}</td>
              <td className="py-1 pr-2 font-mono">{formatVnd(item.unitPrice)}</td>
              <td className="py-1 font-mono">{formatVnd(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2 flex items-center justify-between border-t pt-2 text-xs">
        <span className="text-black/60 dark:text-white/60">Total</span>
        <span className="font-mono">{formatVnd(order.total)}</span>
      </div>
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
      <form action={formAction} className="flex flex-wrap items-end gap-2 text-sm">
        {fixedOrderId ? (
          <input type="hidden" name="orderId" value={fixedOrderId} />
        ) : (
          <label className="flex flex-col gap-1">
            Order ID
            <input name="orderId" className="rounded border px-2 py-1" />
          </label>
        )}
        <label className="flex flex-col gap-1">
          Email used at checkout
          <input type="email" name="email" className="rounded border px-2 py-1" />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {pending ? "Looking up…" : "View order"}
        </button>
      </form>

      {state && !state.success && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
      {state && state.success && <OrderDetails order={state.data} />}
    </div>
  );
}
