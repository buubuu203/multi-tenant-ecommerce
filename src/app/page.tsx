import { getCurrentTenant } from "./_storefront/get-current-tenant";
import { getTenantProducts } from "./_storefront/get-tenant-products";
import { resolveBranding } from "./_storefront/resolve-branding";
import { StorefrontHeader } from "./_storefront/StorefrontHeader";
import { StorefrontHero } from "./_storefront/StorefrontHero";
import { ProductList } from "./_storefront/ProductList";
import { PlatformMessage } from "./_storefront/PlatformMessage";

// This page's content depends on the request's hostname (resolved by
// src/proxy.ts into the x-tenant-id header). Force dynamic rendering so
// Next.js never caches or statically serves one tenant's rendered page to
// another tenant's requests.
export const dynamic = "force-dynamic";

export default async function StorefrontHomePage() {
  const tenant = await getCurrentTenant();

  if (!tenant) {
    // Proxy already rewrites unresolved hostnames to /store-not-found; this
    // is a defensive fallback in case the page is ever reached without a
    // resolved tenant context.
    return (
      <PlatformMessage
        title="Store not found"
        body="We couldn't find a store at this address."
      />
    );
  }

  if (tenant.status === "suspended") {
    return (
      <PlatformMessage
        title="Store temporarily unavailable"
        body="This store is temporarily unavailable. Please check back later."
      />
    );
  }

  if (tenant.status === "archived") {
    return (
      <PlatformMessage
        title="Store unavailable"
        body="This store is no longer available."
      />
    );
  }

  const branding = resolveBranding(tenant, tenant.branding);
  const comingSoon = tenant.status === "pending";
  const products = comingSoon ? [] : await getTenantProducts();

  return (
    <div className="flex flex-1 flex-col">
      <StorefrontHeader branding={branding} />
      <StorefrontHero branding={branding} comingSoon={comingSoon} />
      {!comingSoon && <ProductList products={products} />}
    </div>
  );
}
