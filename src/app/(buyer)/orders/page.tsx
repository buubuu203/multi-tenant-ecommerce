import { OrderLookupForm } from './OrderLookupForm';
import { getCurrentTenant } from '../../_storefront/get-current-tenant';
import { resolveBranding } from '../../_storefront/resolve-branding';
import { StorefrontHeader } from '../../_storefront/StorefrontHeader';
import { getLocale, getDictionary } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

export default async function TrackOrderPage() {
  const tenant = await getCurrentTenant();
  const branding = tenant ? resolveBranding(tenant, tenant.branding) : null;
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  return (
    <>
      {/* Previously this page had no header at all — a customer landing
          here directly (bookmarked link, shared order URL) had no way
          back to the store or to confirm which store they were even
          looking up an order for. Falls back to the layout's own
          DEFAULT_BRANDING when there's no tenant, same as every other
          buyer route. */}
      {branding && (
        <StorefrontHeader
          branding={branding}
          backHref="/"
          backLabel={dict.common.back}
          searchPlaceholder={dict.products.searchPlaceholder}
        />
      )}
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 py-6">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">{dict.orders.orderAccess}</span>
          <h1 className="display-section" style={{ fontSize: 'clamp(26px, 4vw, 36px)', margin: 0 }}>
            {dict.orders.trackYourOrder}
          </h1>
          <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
            {dict.orders.trackDescription}
          </p>
        </div>
        <div className="glass p-5 sm:p-7" style={{ borderRadius: 'var(--radius-card)' }}>
          <OrderLookupForm />
        </div>
      </main>
    </>
  );
}
