import type { PrintableOrder } from '@/lib/order-print';
import { DocumentHeader, RecipientBlock, documentSheetClassName } from './DocumentChrome';

/**
 * Packing slip — for whoever picks and packs the box.
 *
 * Prices are omitted entirely rather than de-emphasised: the person
 * packing does not need them, and a slip that travels inside a parcel is
 * one more place money can be read by the wrong eyes. The order summary
 * is the document that carries prices.
 */
export function PackingSlipDocument({ order }: { order: PrintableOrder }) {
  return (
    <article className={documentSheetClassName} aria-label="Packing slip">
      <DocumentHeader order={order} documentTitle="Packing slip" />

      <div className="grid gap-5 sm:grid-cols-2">
        <RecipientBlock order={order} />
        <section aria-labelledby="pack-meta" className="flex flex-col gap-1">
          <h2 id="pack-meta" className="text-xs font-semibold tracking-wide uppercase">
            Packing
          </h2>
          <p>
            <span className="text-muted-foreground">Items to pack: </span>
            <span className="font-medium tabular-nums">{order.totalUnits}</span>
          </p>
          <p>
            <span className="text-muted-foreground">Distinct lines: </span>
            <span className="font-medium tabular-nums">{order.items.length}</span>
          </p>
          {order.shipping.methodName && (
            <p>
              <span className="text-muted-foreground">Shipping: </span>
              <span className="font-medium">{order.shipping.methodName}</span>
            </p>
          )}
        </section>
      </div>

      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-foreground">
            <th scope="col" className="py-1.5 pr-2 font-semibold">Item</th>
            <th scope="col" className="py-1.5 pr-2 font-semibold">SKU</th>
            <th scope="col" className="py-1.5 text-right font-semibold">Qty</th>
            <th scope="col" className="w-16 py-1.5 text-right font-semibold">Packed</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item, index) => (
            <tr key={index} className="order-print-row border-b border-border">
              <td className="py-2 pr-2 align-top break-words">
                <span className="font-medium">{item.productName}</span>
                {item.combinationLabel && (
                  <span className="block text-muted-foreground">{item.combinationLabel}</span>
                )}
              </td>
              <td className="py-2 pr-2 align-top font-mono break-all">{item.sku ?? '—'}</td>
              <td className="py-2 text-right align-top text-sm font-semibold tabular-nums">
                {item.quantity}
              </td>
              {/* A box to tick on paper — the whole point of a packing slip. */}
              <td className="py-2 text-right align-top">
                <span className="inline-block h-4 w-4 border border-foreground" aria-hidden="true" />
                <span className="sr-only">Packed checkbox</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="border-t border-border pt-3 text-xs text-muted-foreground">
        Packing slip — no prices shown. This is not a tax invoice.
      </p>
    </article>
  );
}
