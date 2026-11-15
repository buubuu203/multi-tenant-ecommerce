import Link from 'next/link';
import { getCurrentTenant } from '../_storefront/get-current-tenant';
import { getTenantProducts } from '../_storefront/get-tenant-products';
import { resolveBranding } from '../_storefront/resolve-branding';
import { StorefrontHeader } from '../_storefront/StorefrontHeader';
import { StorefrontHero } from '../_storefront/StorefrontHero';
import { BannerCarousel } from '../_storefront/BannerCarousel';
import { getActiveBanners } from '../_storefront/get-active-banners';
import { ProductList } from '../_storefront/ProductList';
import { PlatformMessage } from '../_storefront/PlatformMessage';
import { CartProvider } from '../_storefront/cart-context';
import { CartWidget } from '../_storefront/CartWidget';
import { getEnabledPaymentMethods } from '@/lib/payments/payment-service';
import { getEnabledShippingMethods } from '@/lib/shipping-service';
import { TenantTheme } from '@/components/TenantTheme';
import { getLocale, getDictionary } from '@/lib/i18n';

// This page's content depends on the request's hostname (resolved by
// src/proxy.ts into the x-tenant-id header). Force dynamic rendering so
// Next.js never caches or statically serves one tenant's rendered page to
// another tenant's requests.
export const dynamic = 'force-dynamic';

export default async function StorefrontHomePage() {
  const tenant = await getCurrentTenant();
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  if (!tenant) {
    return (
      <PlatformMessage title={dict.storefront.storeNotFound} body={dict.storefront.storeNotFoundBody} />
    );
  }

  if (tenant.status === 'suspended') {
    return (
      <PlatformMessage
        title={dict.storefront.storeSuspended}
        body={dict.storefront.storeSuspendedBody}
      />
    );
  }

  if (tenant.status === 'archived') {
    return <PlatformMessage title={dict.storefront.storeArchived} body={dict.storefront.storeArchivedBody} />;
  }

  const branding = resolveBranding(tenant, tenant.branding);
  const comingSoon = tenant.status === 'pending';
  const products = comingSoon ? [] : await getTenantProducts();
  // Step 39: CartWidget's quantity controls need each variant's current
  // availability to cap increments (see CartWidget.tsx) — it has no other
  // access to product data, so this flat id -> available map is passed
  // down alongside it, built once here from the same `products` ProductList
  // already receives (no extra fetch).
  const availabilityByVariant = Object.fromEntries(
    products.flatMap((product) =>
      product.variants.map((variant) => [variant.id, variant.available]),
    ),
  );
  const enabledPaymentMethods = await getEnabledPaymentMethods(tenant.id);
  const enabledShippingMethods = await getEnabledShippingMethods(tenant.id);
  // Storefront Carousel/Banner (V1): tenant-curated banners replace the
  // generic StorefrontHero when at least one exists — a "coming soon"
  // store never shows banners regardless (it has nothing to promote yet).
  const banners = comingSoon ? [] : await getActiveBanners();

  return (
    <TenantTheme branding={branding} className="flex flex-1 flex-col">
      <CartProvider>
        <div className="flex flex-1 flex-col">
          <StorefrontHeader
            branding={branding}
            rightSlot={
              <>
                <Link
                  href="/orders"
                  className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-muted"
                >
                  {dict.common.myOrders}
                </Link>
                <CartWidget
                  availabilityByVariant={availabilityByVariant}
                  enabledPaymentMethods={enabledPaymentMethods}
                  enabledShippingMethods={enabledShippingMethods}
                />
              </>
            }
          />
          {banners.length > 0 ? (
            <BannerCarousel banners={banners} />
          ) : (
            <StorefrontHero
              branding={branding}
              comingSoon={comingSoon}
              dict={dict}
              // The hero is the whole page only when there is no
              // catalogue under it; ProductList renders nothing for an
              // empty product list.
              fillViewport={comingSoon || products.length === 0}
            />
          )}
          {!comingSoon && (
            <div className="mx-auto w-full max-w-6xl">
              <ProductList products={products} />
            </div>
          )}
        </div>
      </CartProvider>
    </TenantTheme>
  );
}
