import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTenantProduct } from "../../_storefront/get-tenant-products";
import { getCurrentTenant } from "../../_storefront/get-current-tenant";
import { resolveBranding } from "../../_storefront/resolve-branding";
import { StorefrontHeader } from "../../_storefront/StorefrontHeader";
import { ProductRow } from "../../_storefront/ProductList";
import { CartProvider } from "../../_storefront/cart-context";
import { CartWidget } from "../../_storefront/CartWidget";
import { getEnabledPaymentMethods } from "@/lib/payments/payment-service";
import { getEnabledShippingMethods } from "@/lib/shipping-service";

// This page's content depends on the request's hostname (resolved by
// src/proxy.ts into the x-tenant-id header), same as the storefront home
// page — force dynamic rendering for the same tenant-isolation reason.
export const dynamic = "force-dynamic";

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
  const availabilityByVariant = Object.fromEntries(product.variants.map((variant) => [variant.id, variant.available]));
  const headerList = await headers();
  const tenantId = headerList.get("x-tenant-id") ?? "";
  const enabledPaymentMethods = tenantId ? await getEnabledPaymentMethods(tenantId) : [];
  const enabledShippingMethods = tenantId ? await getEnabledShippingMethods(tenantId) : [];
  // Same branded header as the homepage (see StorefrontHeader's doc
  // comment) — previously this page showed no store name/logo at all, so
  // a customer arriving here directly (a shared product link, a search
  // result) had no way to tell which store they were on.
  const tenant = await getCurrentTenant();
  const branding = tenant ? resolveBranding(tenant, tenant.branding) : null;

  return (
    <CartProvider>
      <div className="flex flex-1 flex-col">
        {branding ? (
          <StorefrontHeader
            branding={branding}
            backHref="/"
            rightSlot={
              <>
                <Link
                  href="/orders"
                  className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-muted"
                >
                  My orders
                </Link>
                <CartWidget availabilityByVariant={availabilityByVariant} enabledPaymentMethods={enabledPaymentMethods} enabledShippingMethods={enabledShippingMethods} />
              </>
            }
          />
        ) : (
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-background/80 px-6 py-3 backdrop-blur-sm">
            <Link href="/" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              ← Back to store
            </Link>
            <div className="flex items-center gap-2">
              <Link
                href="/orders"
                className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-muted"
              >
                My orders
              </Link>
              <CartWidget availabilityByVariant={availabilityByVariant} enabledPaymentMethods={enabledPaymentMethods} enabledShippingMethods={enabledShippingMethods} />
            </div>
          </div>
        )}
        <main className="px-6 py-10 sm:py-14">
          <ul className="mx-auto max-w-3xl">
            <ProductRow product={product} linkToDetail={false} />
          </ul>
        </main>
      </div>
    </CartProvider>
  );
}
