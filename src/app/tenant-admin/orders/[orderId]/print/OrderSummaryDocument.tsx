import { formatVnd } from '../../../format';
import type { PrintableOrder } from '@/lib/order-print';
import { DocumentHeader, RecipientBlock, documentSheetClassName } from './DocumentChrome';

/**
 * Order summary — an operational sales document.
 *
 * Explicitly NOT a VAT or electronic tax invoice, and it says so on the
 * page so a merchant cannot hand it to a customer believing otherwise.
 */
export function OrderSummaryDocument({ order }: { order: PrintableOrder }) {
  return (
    <article className={documentSheetClassName} aria-label="Order summary">
      <DocumentHeader order={order} documentTitle="Order summary" />

      <div className="grid gap-5 sm:grid-cols-2">
        <RecipientBlock order={order} />
        <section aria-labelledby="order-state" className="flex flex-col gap-1">
          <h2 id="order-state" className="text-xs font-semibold tracking-wide uppercase">
            Order
          </h2>
          {/* Words, not colour: this prints in monochrome. */}
          <p>
            <span className="text-muted-foreground">Status: </span>
            <span className="font-medium">{order.status}</span>
          </p>
          <p>
            <span className="text-muted-foreground">Payment method: </span>
            <span className="font-medium">{order.paymentMethod}</span>
          </p>
          <p>
            <span className="text-muted-foreground">Payment status: </span>
            <span className="font-medium">{order.paymentStatus ?? 'not recorded'}</span>
          </p>
          {order.shipping.methodName && (
            <p>
              <span className="text-muted-foreground">Shipping: </span>
              <span className="font-medium">{order.shipping.methodName}</span>
            </p>
          )}
          {order.customer.email && (
            <p className="break-all">
              <span className="text-muted-foreground">Email: </span>
              {order.customer.email}
            </p>
          )}
        </section>
      </div>

      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-foreground">
            <th scope="col" className="py-1.5 pr-2 font-semibold">Item</th>
            <th scope="col" className="py-1.5 pr-2 font-semibold">SKU</th>
            <th scope="col" className="py-1.5 pr-2 text-right font-semibold">Qty</th>
            <th scope="col" className="py-1.5 pr-2 text-right font-semibold">Unit price</th>
            <th scope="col" className="py-1.5 text-right font-semibold">Line total</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item, index) => (
            <tr key={index} className="order-print-row border-b border-border">
              <td className="py-1.5 pr-2 align-top break-words">
                <span className="font-medium">{item.productName}</span>
                {item.combinationLabel && (
                  <span className="block text-muted-foreground">{item.combinationLabel}</span>
                )}
              </td>
              <td className="py-1.5 pr-2 align-top font-mono break-all">{item.sku ?? '—'}</td>
              <td className="py-1.5 pr-2 text-right align-top tabular-nums">{item.quantity}</td>
              <td className="py-1.5 pr-2 text-right align-top tabular-nums">
                {formatVnd(item.unitPrice)}
              </td>
              <td className="py-1.5 text-right align-top tabular-nums">
                {formatVnd(item.lineTotal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals stay together across a page break. */}
      <section aria-labelledby="totals" className="order-print-totals ml-auto w-full sm:w-72">
        <h2 id="totals" className="sr-only">
          Totals
        </h2>
        <dl className="flex flex-col gap-1 text-xs">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="tabular-nums">{formatVnd(order.totals.subtotal)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Shipping</dt>
            <dd className="tabular-nums">{formatVnd(order.totals.shipping)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-foreground pt-1 text-sm font-semibold">
            <dt>Total ({order.totals.currency})</dt>
            <dd className="tabular-nums">{formatVnd(order.totals.total)}</dd>
          </div>
        </dl>
      </section>

      <p className="border-t border-border pt-3 text-xs text-muted-foreground">
        This document is not an electronic VAT invoice.
      </p>
    </article>
  );
}
