import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import {
  DOCUMENT_TITLE,
  getOrderForPrint,
  isPrintDocument,
  type PrintDocument,
  type PrintableOrder,
} from '@/lib/order-print';
import { OrderSummaryDocument } from './OrderSummaryDocument';
import { PackingSlipDocument } from './PackingSlipDocument';
import { ShippingNoteDocument } from './ShippingNoteDocument';
import { PrintButton } from './PrintButton';

// Never cached: this page renders one customer's name, phone and address.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * The Order Print Center.
 *
 * Authorization first, exactly like every other admin route: a layout's
 * gate does not stop a child segment streaming its own payload, so this
 * page calls requireTenantAdmin() itself before it reads anything.
 *
 * Read-only throughout. Opening or printing a document writes nothing and
 * records no order event — viewing a document is not something that
 * happened to the order.
 */
export default async function OrderPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ document?: string }>;
}) {
  const { tenantId } = await requireTenantAdmin();
  const { orderId } = await params;
  const { document } = await searchParams;

  // An unknown document type is a 404, not a default render: silently
  // showing some other document would be worse than saying no.
  if (!isPrintDocument(document)) {
    notFound();
  }

  // Scoped read. Another tenant's order id and a nonexistent one give the
  // same answer, so neither can be probed for.
  const order = await getOrderForPrint(tenantId, orderId);
  if (!order) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Screen-only controls. print:hidden keeps them out of the page a
          merchant hands to a courier. */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href="/tenant-admin/orders"
          className="text-sm text-muted-foreground underline transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        >
          Back to orders
        </Link>
        <PrintButton documentTitle={DOCUMENT_TITLE[document]} />
      </div>

      <DocumentFor document={document} order={order} />
    </div>
  );
}

function DocumentFor({ document, order }: { document: PrintDocument; order: PrintableOrder }) {
  switch (document) {
    case 'order-summary':
      return <OrderSummaryDocument order={order} />;
    case 'packing-slip':
      return <PackingSlipDocument order={order} />;
    case 'shipping-note':
      return <ShippingNoteDocument order={order} />;
  }
}
