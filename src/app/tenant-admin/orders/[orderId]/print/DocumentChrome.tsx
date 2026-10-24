import type { PrintableOrder } from '@/lib/order-print';
import { formatAddress } from '@/lib/order-print';

/**
 * The parts every document shares: the store identity block, the order
 * reference, and the recipient. Kept in one place so three documents
 * cannot drift apart in how they present the same facts.
 */

/** Dates are rendered on the server to one fixed, unambiguous format. */
export function formatPlacedAt(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function DocumentHeader({
  order,
  documentTitle,
}: {
  order: PrintableOrder;
  documentTitle: string;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-foreground pb-3">
      <div className="flex min-w-0 items-center gap-3">
        {/* A logo is decorative here: the store NAME is always printed
            beside it, so a failed or missing image costs nothing. */}
        {order.store.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra, see ProductList.tsx
          <img
            src={order.store.logoUrl}
            alt=""
            className="h-10 w-auto max-w-[8rem] object-contain"
          />
        )}
        <div className="flex min-w-0 flex-col">
          <span className="text-base font-semibold break-words">{order.store.name}</span>
          <span className="text-xs text-muted-foreground">{documentTitle}</span>
        </div>
      </div>
      <dl className="text-right text-xs">
        <dt className="text-muted-foreground">Order reference</dt>
        <dd className="font-mono text-sm font-medium break-all">{order.reference}</dd>
        <dt className="mt-1 text-muted-foreground">Placed</dt>
        <dd className="tabular-nums">{formatPlacedAt(order.placedAt)}</dd>
      </dl>
    </header>
  );
}

export function RecipientBlock({ order }: { order: PrintableOrder }) {
  return (
    <section aria-labelledby="recipient" className="flex flex-col gap-1">
      <h2 id="recipient" className="text-xs font-semibold tracking-wide uppercase">
        Deliver to
      </h2>
      <p className="font-medium break-words">{order.customer.name}</p>
      <p className="break-words">{order.customer.phone}</p>
      <p className="break-words">{formatAddress(order.shipping)}</p>
      {order.shipping.note && (
        <p className="break-words">
          <span className="font-medium">Note: </span>
          {order.shipping.note}
        </p>
      )}
    </section>
  );
}

/** The sheet a document is printed on. */
export const documentSheetClassName =
  'order-print-sheet mx-auto flex w-full max-w-[21cm] flex-col gap-5 rounded-lg border border-border bg-surface p-6 text-sm text-foreground print:max-w-none print:rounded-none print:border-0 print:p-0';
