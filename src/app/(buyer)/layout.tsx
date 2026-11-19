import type { ReactNode } from "react";
import { getCurrentTenant } from "../_storefront/get-current-tenant";
import { resolveBranding, resolveFooterContact } from "../_storefront/resolve-branding";
import type { ResolvedBranding } from "../_storefront/resolve-branding";
import { SiteFooter } from "../_storefront/SiteFooter";
import { TenantTheme } from "@/components/TenantTheme";
import { getLocale, getDictionary } from "@/lib/i18n";

// Shared shell for every buyer route (/, /products/[id], /orders, see the
// (home) nested group's own loading.tsx doc comment for why home has its
// own Suspense boundary and the others deliberately don't). This is where
// the skin (storefront-glass) + ground classes and the 1344px container
// now live, exactly once, instead of being copy-pasted into every page —
// each page used to carry its own <TenantTheme className="storefront-glass
// ground ..."> wrapper and its own max-w-* container div.
//
// StorefrontHeader is deliberately NOT rendered here: its rightSlot needs
// page-specific data (CartWidget's availabilityByVariant/payment/shipping
// props differ between the home listing and a single PDP, and the plain
// /orders lookup page has no cart controls at all), which a shared layout
// has no clean way to receive per-route. Each page still renders its own
// header — see each page file for why.
const DEFAULT_BRANDING: ResolvedBranding = {
  storeName: "Store",
  logoUrl: null,
  primaryColor: "#3b3b3b",
  secondaryColor: "#8a8a8a",
  designTokens: null,
};

export default async function BuyerLayout({ children }: { children: ReactNode }) {
  const tenant = await getCurrentTenant();
  const branding = tenant ? resolveBranding(tenant, tenant.branding) : DEFAULT_BRANDING;
  const contact = tenant ? resolveFooterContact(tenant.branding) : null;
  const locale = await getLocale();
  const dict = await getDictionary(locale);

  return (
    <TenantTheme branding={branding} className="storefront-glass ground flex flex-1 flex-col">
      {/* Padding lives on this OUTER element; the inner element's
          max-width is the actual content width (1344px), not a box that
          padding then eats into — at 1344 + 2×48 this used to measure
          1248px of real content, not 1344. pb-16 (64px) specifically on
          the bottom: the footer used to sit 27px from the viewport edge
          (the same py-7/28px as the top), which read as cramped against
          a flush-bottom glass card. */}
      <div className="flex flex-1 flex-col px-4 pt-7 pb-16 lg:px-12">
        <div className="mx-auto flex w-full max-w-[1344px] flex-1 flex-col gap-7">
          {children}
          <SiteFooter branding={branding} contact={contact} dict={dict} />
        </div>
      </div>
    </TenantTheme>
  );
}
