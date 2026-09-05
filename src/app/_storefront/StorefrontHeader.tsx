import Link from "next/link";
import type { ReactNode } from "react";
import type { ResolvedBranding } from "./resolve-branding";

// Single sticky header for every storefront page (home + PDP) — previously
// only the homepage rendered this (with branding) while the PDP had its
// own separate, unbranded "Back to store" bar with no logo/store name at
// all, and the homepage's cart controls lived in a SECOND, non-sticky bar
// below this one that scrolled out of view. A customer scrolling down a
// long product list, or arriving directly on a PDP from a shared link,
// could lose track of which store they were on or lose cart access
// entirely. One header, always visible, on every page: branding always
// shown, `rightSlot` for page-specific controls (cart/orders today), and
// an optional `backHref` for the PDP's "back to store" link.
export function StorefrontHeader({
  branding,
  backHref,
  rightSlot,
}: {
  branding: ResolvedBranding;
  backHref?: string;
  rightSlot?: ReactNode;
}) {
  const initial = branding.storeName.trim().charAt(0).toUpperCase() || "?";

  return (
    <header
      className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/80 px-6 py-4 backdrop-blur-sm"
      style={{ borderBottomColor: branding.secondaryColor }}
    >
      {backHref && (
        <Link
          href={backHref}
          className="mr-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Back
        </Link>
      )}
      {branding.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- tenant-supplied URL, not a static asset
        <img
          src={branding.logoUrl}
          alt={`${branding.storeName} logo`}
          className="h-10 w-10 rounded-full object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
          style={{ backgroundColor: branding.primaryColor }}
        >
          {initial}
        </div>
      )}
      <span className="text-lg font-semibold tracking-tight">{branding.storeName}</span>
      {rightSlot && <div className="ml-auto flex items-center gap-2">{rightSlot}</div>}
    </header>
  );
}
