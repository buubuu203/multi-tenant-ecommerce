import { OrderLookupForm } from '../OrderLookupForm';
import Link from 'next/link';
import { getCurrentTenant } from '../../_storefront/get-current-tenant';
import { resolveBranding } from '../../_storefront/resolve-branding';
import { StorefrontHeader } from '../../_storefront/StorefrontHeader';
import { TenantTheme } from '@/components/TenantTheme';

// The bookmarkable order-confirmation link a customer is given right
// after checkout (see CartWidget.tsx's success state). The order ID alone
// in the URL is NOT sufficient to view the order — this page still
// requires the checkout email, submitted via OrderLookupForm's POST
// action, never appended to this URL. See order-queries.ts's
// getOrderForCustomer() for why Order ID + email together are the entire
// access-control mechanism (there are no customer accounts).
export const dynamic = 'force-dynamic';

export default async function OrderConfirmationPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const tenant = await getCurrentTenant();
  const branding = tenant ? resolveBranding(tenant, tenant.branding) : null;

  const content = (
    <div className="flex min-h-full flex-1 flex-col">
      {branding && (
        <StorefrontHeader
          branding={branding}
          backHref="/"
          rightSlot={
            <Link
              href="/orders"
              className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-muted"
            >
              Track another order
            </Link>
          }
        />
      )}
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-10 sm:px-6 sm:py-16">
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-8">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
              Order access
            </p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">View your order</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              Enter the email used at checkout to securely view the status and payment details for
              this order.
            </p>
            <p
              className="mt-1 truncate rounded-md bg-surface-muted px-3 py-2 font-mono text-xs text-muted-foreground"
              title={orderId}
            >
              Order {orderId}
            </p>
          </div>
          <div className="mt-7 border-t border-border pt-6">
            <OrderLookupForm fixedOrderId={orderId} />
          </div>
        </div>
      </main>
    </div>
  );
  return branding ? <TenantTheme branding={branding}>{content}</TenantTheme> : content;
}
