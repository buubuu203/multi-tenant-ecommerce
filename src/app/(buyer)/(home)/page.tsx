import Link from 'next/link';
import { getCurrentTenant } from '../../_storefront/get-current-tenant';
import { getTenantProducts } from '../../_storefront/get-tenant-products';
import { resolveBranding, resolveFooterContact } from '../../_storefront/resolve-branding';
import { getRequestOrigin } from '@/lib/seo/request-origin';
import { buildStoreJsonLd } from '@/lib/seo/store-seo';
import { StorefrontHeader } from '../../_storefront/StorefrontHeader';
import { StorefrontHero } from '../../_storefront/StorefrontHero';
import { BannerCarousel } from '../../_storefront/BannerCarousel';
import { getActiveBanners } from '../../_storefront/get-active-banners';
import { ProductList } from '../../_storefront/ProductList';
import { PlatformMessage } from '../../_storefront/PlatformMessage';
import { CartProvider } from '../../_storefront/cart-context';
import { CartWidget } from '../../_storefront/CartWidget';
import { getEnabledPaymentMethods } from '@/lib/payments/payment-service';
import { getEnabledShippingMethods } from '@/lib/shipping-service';
import { getCurrentPrivacyNotice } from '@/lib/privacy-mutations';
import { getLocale, getDictionary } from '@/lib/i18n';
import { Icon } from '../../_storefront/Icon';
import { TrustStrip } from '../../_storefront/TrustStrip';

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
  const [products, enabledPaymentMethods, enabledShippingMethods, privacyNotice, banners, origin] =
    await Promise.all([
      comingSoon ? Promise.resolve([]) : getTenantProducts(),
      getEnabledPaymentMethods(tenant.id),
      getEnabledShippingMethods(tenant.id),
      getCurrentPrivacyNotice(tenant.id),
      comingSoon ? Promise.resolve([]) : getActiveBanners(),
      getRequestOrigin(),
    ]);
  // Organization JSON-LD for search engines, home page only (Google's own
  // guidance for site-level Organization markup). Omitted when the origin
  // can't be resolved — same guard sitemap.ts/robots.ts use, since an
  // absolute url is required and there is no tenant-safe fallback host.
  const contact = resolveFooterContact(tenant.branding);
  const storeJsonLd = origin
    ? buildStoreJsonLd({
        storeName: branding.storeName,
        tagline: contact.tagline,
        origin,
        logoUrl: branding.logoUrl,
        socialUrls: [contact.facebookUrl, contact.tiktokUrl, contact.zaloUrl, contact.instagramUrl],
      })
    : null;
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
  const weightGramsByVariant = Object.fromEntries(
    products.flatMap((product) =>
      product.variants.map((variant) => [variant.id, product.weightGrams]),
    ),
  );
  // Storefront Carousel/Banner (V1): tenant-curated banners replace the
  // generic StorefrontHero when at least one exists — a "coming soon"
  // store never shows banners regardless (it has nothing to promote yet).
  return (
    <CartProvider>
      {storeJsonLd && (
        <script
          type="application/ld+json"
          // JSON.stringify never emits unescaped '<', so a stray "</script>"
          // inside a merchant-supplied tagline/name can't break out of this
          // tag — the one XSS-relevant risk with inline JSON-LD.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(storeJsonLd).replace(/</g, '\\u003c'),
          }}
        />
      )}
      <StorefrontHeader
        branding={branding}
        searchPlaceholder={dict.products.searchPlaceholder}
        rightSlot={
          <>
            <Link href="/orders" className="btn-ghost">
              <Icon name="box" size={18} />
              {dict.common.myOrders}
            </Link>
            <CartWidget
              branding={branding}
              availabilityByVariant={availabilityByVariant}
              weightGramsByVariant={weightGramsByVariant}
              enabledPaymentMethods={enabledPaymentMethods}
              enabledShippingMethods={enabledShippingMethods}
              privacyNoticeVersionId={privacyNotice?.id ?? null}
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
      {!comingSoon && <ProductList products={products} />}
      {!comingSoon && products.length > 0 && <TrustStrip />}
    </CartProvider>
  );
}
