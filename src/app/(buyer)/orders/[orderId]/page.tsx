import { OrderLookupForm } from '../OrderLookupForm';
import Link from 'next/link';
import { getCurrentTenant } from '../../../_storefront/get-current-tenant';
import { resolveBranding } from '../../../_storefront/resolve-branding';
import { StorefrontHeader } from '../../../_storefront/StorefrontHeader';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { getLocale, getDictionary } from '@/lib/i18n';

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
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orderId } = await params;
  const { email } = await searchParams;
  const prefillEmail = typeof email === "string" ? email : undefined;
  const tenant = await getCurrentTenant();
  const branding = tenant ? resolveBranding(tenant, tenant.branding) : null;
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  return (
    <>
      {branding && (
        <StorefrontHeader
          branding={branding}
          backHref="/"
          backLabel={dict.common.back}
          searchPlaceholder={dict.products.searchPlaceholder}
          rightSlot={
            <>
              <LocaleSwitcher />
              <Link href="/orders" className="btn-ghost">
                {dict.orders.trackAnotherOrder}
              </Link>
            </>
          }
        />
      )}
      <main className="flex w-full flex-1 flex-col items-center justify-center py-6">
        <div
          className="glass w-full max-w-2xl p-5 sm:p-8"
          style={{ borderRadius: 'var(--radius-card)' }}
        >
          <div className="flex flex-col gap-2">
            <span className="eyebrow">{dict.orders.orderAccess}</span>
            <h1 className="display-section" style={{ fontSize: 'clamp(24px, 4vw, 32px)', margin: 0 }}>
              {dict.orders.viewYourOrder}
            </h1>
            <p className="text-sm leading-6" style={{ color: 'var(--ink-2)' }}>
              {dict.orders.viewOrderDescription}
            </p>
            <p
              className="mt-1 truncate px-3 py-2 font-mono text-xs"
              style={{ borderRadius: 'var(--radius-field)', background: 'var(--field-fill)', color: 'var(--ink-2)' }}
              title={orderId}
            >
              {dict.orders.order} {orderId}
            </p>
          </div>
          <div className="mt-7 pt-6" style={{ borderTop: '1px solid var(--divider)' }}>
            <OrderLookupForm fixedOrderId={orderId} defaultEmail={prefillEmail} />
          </div>
        </div>
      </main>
    </>
  );
}
