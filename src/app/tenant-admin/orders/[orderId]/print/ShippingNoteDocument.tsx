import { formatVnd } from '../../../format';
import type { PrintableOrder } from '@/lib/order-print';
import { DocumentHeader, RecipientBlock, documentSheetClassName } from './DocumentChrome';

/**
 * Shipping note — what a merchant hands to a courier.
 *
 * Deliberately NOT a carrier label: no barcode, no tracking number, no
 * carrier name, no shipping status. The schema has no tracking field and
 * no carrier integration exists, so inventing any of those would be
 * printing a number that means nothing.
 *
 * The COD amount appears only when the order's own payment method is cod.
 * For anything else there is nothing to collect on delivery, and printing
 * an amount would invite a courier to collect twice.
 */
export function ShippingNoteDocument({ order }: { order: PrintableOrder }) {
  return (
    <article className={documentSheetClassName} aria-label="Shipping note">
      <DocumentHeader order={order} documentTitle="Shipping note" />

      <div className="grid gap-5 sm:grid-cols-2">
        <RecipientBlock order={order} />
        <section aria-labelledby="handoff" className="flex flex-col gap-1">
          <h2 id="handoff" className="text-xs font-semibold tracking-wide uppercase">
            Handoff
          </h2>
          <p>
            <span className="text-muted-foreground">Shipping method: </span>
            <span className="font-medium">{order.shipping.methodName ?? 'not recorded'}</span>
          </p>
          <p>
            <span className="text-muted-foreground">Payment: </span>
            <span className="font-medium">
              {order.paymentMethod}
              {order.paymentStatus ? ` — ${order.paymentStatus}` : ''}
            </span>
          </p>
          <p>
            <span className="text-muted-foreground">Packages: </span>
            <span className="font-medium tabular-nums">{order.totalUnits} item(s)</span>
          </p>
        </section>
      </div>

      {/* The one number a courier acts on, so it gets its own block. */}
      <section
        aria-labelledby="cod"
        className="order-print-totals flex items-baseline justify-between gap-4 border-2 border-foreground p-3"
      >
        <h2 id="cod" className="text-sm font-semibold">
          Collect on delivery
        </h2>
        <p className="text-lg font-bold tabular-nums">
          {order.codAmount === null ? (
            <span className="text-sm font-semibold">Nothing to collect — already paid</span>
          ) : (
            `${formatVnd(order.codAmount)} ${order.totals.currency}`
          )}
        </p>
      </section>

      <section aria-labelledby="contents" className="flex flex-col gap-1">
        <h2 id="contents" className="text-xs font-semibold tracking-wide uppercase">
          Contents
        </h2>
        <ul className="flex flex-col gap-0.5 text-xs">
          {order.items.map((item, index) => (
            <li key={index} className="break-words">
              <span className="tabular-nums">{item.quantity}×</span> {item.productName}
              {item.combinationLabel ? ` (${item.combinationLabel})` : ''}
            </li>
          ))}
        </ul>
      </section>

      <p className="border-t border-border pt-3 text-xs text-muted-foreground">
        This is a merchant shipping note, not an official carrier label. No tracking number is
        issued by this store.
      </p>
    </article>
  );
}
