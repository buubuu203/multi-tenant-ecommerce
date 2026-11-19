import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTenantProduct, getTenantProducts } from '../../../_storefront/get-tenant-products';
import { getCurrentTenant } from '../../../_storefront/get-current-tenant';
import { resolveBranding } from '../../../_storefront/resolve-branding';
import { StorefrontHeader } from '../../../_storefront/StorefrontHeader';
import { ProductRow } from '../../../_storefront/ProductList';
import { CartProvider } from '../../../_storefront/cart-context';
import { CartWidget } from '../../../_storefront/CartWidget';
import { getEnabledPaymentMethods } from '@/lib/payments/payment-service';
import { getEnabledShippingMethods } from '@/lib/shipping-service';
import { getCurrentPrivacyNotice } from '@/lib/privacy-mutations';
import type { ResolvedBranding } from '../../../_storefront/resolve-branding';
import type { Metadata } from 'next';
import { getLocale, getDictionary } from '@/lib/i18n';
import { getRequestOrigin } from '@/lib/seo/request-origin';
import { Icon } from '../../../_storefront/Icon';
import {
  buildMetaDescription,
  buildProductJsonLd,
  buildSocialImageUrl,
  toAbsoluteUrl,
  type ProductSeoInput,
} from '@/lib/seo/product-seo';

// This page's content depends on the request's hostname (resolved by
// src/proxy.ts into the x-tenant-id header), same as the storefront home
// page — force dynamic rendering for the same tenant-isolation reason.
export const dynamic = 'force-dynamic';

/**
 * Gathers everything the page's metadata and JSON-LD need, from the same
 * tenant-scoped reads the page itself uses. Returns null when the product
 * isn't visible to this tenant, so neither consumer can describe a product
 * the page would 404 on.
 */
async function resolveProductSeo(productId: string): Promise<ProductSeoInput | null> {
  const [product, tenant, origin] = await Promise.all([
    getTenantProduct(productId),
    getCurrentTenant(),
    getRequestOrigin(),
  ]);
  if (!product || !tenant || !origin) {
    return null;
  }
  const branding = resolveBranding(tenant, tenant.branding);
  return {
    productName: product.name,
    storeName: branding.storeName,
    descriptionExcerpt: product.descriptionExcerpt,
    origin,
    productPath: `/products/${product.id}`,
    // Only images: a video URL is not a preview card or a listing image.
    imageUrls: product.media.filter((m) => m.type === 'image').map((m) => m.url),
    logoUrl: branding.logoUrl,
    // Already-discounted effective prices, the same numbers shown on the
    // page — so a preview can never advertise a price the store won't honour.
    prices: product.variants.map((v) => v.price),
    anyInStock: product.variants.some((v) => v.available > 0),
  };
}

/**
 * Per-product title, description and social preview card. Without this the
 * page inherited the root layout's store-level metadata, so every product
 * URL on every tenant shared as just the store name with no product, price
 * or image — on a market where links are distributed through Zalo, Facebook
 * and TikTok, that preview card is the whole first impression.
 *
 * Absolute URLs come from getRequestOrigin(), i.e. the same host header the
 * tenant was resolved from, so the canonical URL and the tenant context
 * cannot disagree and one tenant's page can never advertise another's host.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ productId: string }>;
}): Promise<Metadata> {
  const { productId } = await params;
  const seo = await resolveProductSeo(productId);
  // Fall through to the root layout's store-level metadata rather than
  // inventing anything for a product this request cannot see.
  if (!seo) {
    return {};
  }

  const title = `${seo.productName} — ${seo.storeName}`;
  const description = buildMetaDescription(seo);
  const url = toAbsoluteUrl(seo.origin, seo.productPath);
  const image = buildSocialImageUrl(seo);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: seo.storeName,
      locale: 'vi_VN',
      type: 'website',
      ...(image ? { images: [{ url: image, alt: seo.productName }] } : {}),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

// Used when getCurrentTenant() finds no tenant at all (unknown hostname) —
// shared between TenantTheme's own branding prop and CartWidget's, so the
// drawer's accent vars and the page's fall back to the exact same neutral
// values rather than two separately-maintained copies drifting apart.
const DEFAULT_BRANDING: ResolvedBranding = {
  storeName: 'Store',
  logoUrl: null,
  primaryColor: '#3b3b3b',
  secondaryColor: '#8a8a8a',
  designTokens: null,
};

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const product = await getTenantProduct(productId);

  // getTenantProduct() returns null uniformly for "doesn't exist", "wrong
  // tenant", and "draft" — notFound() renders src/app/products/not-found.tsx,
  // a real HTTP 404, without ever revealing which case occurred.
  if (!product) {
    notFound();
  }

  // Same "flat id -> available map, built once from already-fetched data"
  // pattern as src/app/page.tsx — CartWidget has no other access to
  // inventory data.
  const availabilityByVariant = Object.fromEntries(
    product.variants.map((variant) => [variant.id, variant.available]),
  );

  // Phase 4 (storefront discovery): "you might also like" — this store has
  // no category/tagging data (schema-free by design for this MVP), so
  // "related" honestly means "other active products from the same store,"
  // not a similarity match. Reuses the same getTenantProducts() the
  // homepage already calls — no new query — filtered to exclude the
  // current product and capped at 4 so the rail never dwarfs the product
  // itself.
  const relatedProducts = (await getTenantProducts())
    .filter((p) => p.id !== product.id)
    .slice(0, 4);
  const headerList = await headers();
  const tenantId = headerList.get('x-tenant-id') ?? '';
  const enabledPaymentMethods = tenantId ? await getEnabledPaymentMethods(tenantId) : [];
  const enabledShippingMethods = tenantId ? await getEnabledShippingMethods(tenantId) : [];
  const privacyNotice = tenantId ? await getCurrentPrivacyNotice(tenantId) : null;
  // Same branded header as the homepage (see StorefrontHeader's doc
  // comment) — previously this page showed no store name/logo at all, so
  // a customer arriving here directly (a shared product link, a search
  // result) had no way to tell which store they were on.
  const tenant = await getCurrentTenant();
  const branding = tenant ? resolveBranding(tenant, tenant.branding) : DEFAULT_BRANDING;
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  // Reuses resolveProductSeo()'s tenant-scoped reads; React dedupes the
  // identical fetches this and generateMetadata() both perform within one
  // request, so this costs no extra queries.
  const seo = await resolveProductSeo(productId);
  const jsonLd = seo ? buildProductJsonLd(seo) : null;

  return (
    <CartProvider>
      {/* schema.org Product markup. Next.js's own guidance is to render
          JSON-LD as a script tag in the component; JSON.stringify of a
          server-built object cannot inject markup, and every value here
          comes from this tenant's own already-sanitized product data.
          Null when the product has no price — see buildProductJsonLd. */}
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
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
              enabledPaymentMethods={enabledPaymentMethods}
              enabledShippingMethods={enabledShippingMethods}
              privacyNoticeVersionId={privacyNotice?.id ?? null}
            />
          </>
        }
      />
      {/* Board 6: breadcrumb is its own row below the header, not a
          header back-button — the header's backHref/backLabel are gone
          from this page entirely (the breadcrumb's own "Quay lại" covers
          that job, and showing the same action twice is noise). */}
      <div className="flex items-center gap-2 text-sm">
        <Link href="/" className="btn-ghost" style={{ minHeight: '36px', padding: '6px 12px' }}>
          <Icon name="chevron" size={14} style={{ transform: 'rotate(180deg)' }} />
          {dict.common.back}
        </Link>
        <span style={{ color: 'var(--ink-2)' }}>
          <Link href="/" className="hover:underline">{dict.common.home}</Link>
          {product.category && <> › {product.category}</>} › {product.name}
        </span>
      </div>
      <main className="flex flex-col gap-10">
        <ul>
          <ProductRow product={product} linkToDetail={false} />
        </ul>

        {relatedProducts.length > 0 && (
          <section className="flex flex-col gap-5 border-t pt-8" style={{ borderColor: 'var(--divider)' }}>
            <div className="flex flex-col gap-1">
              <span className="eyebrow">{dict.products.keepBrowsing}</span>
              <h2 className="title-card" style={{ fontSize: '26px', margin: 0 }}>
                {dict.products.youMightAlsoLike}
              </h2>
            </div>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-5">
              {relatedProducts.map((related) => (
                <ProductRow key={related.id} product={related} />
              ))}
            </ul>
          </section>
        )}
      </main>
    </CartProvider>
  );
}
