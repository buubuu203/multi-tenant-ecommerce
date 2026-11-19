import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import type { ResolvedBranding } from "./resolve-branding";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { SearchBox } from "./SearchBox";
import { ThemeToggle } from "./ThemeToggle";
import { Icon } from "./Icon";

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
  backLabel = "Back",
  rightSlot,
  searchPlaceholder,
}: {
  branding: ResolvedBranding;
  backHref?: string;
  backLabel?: string;
  rightSlot?: ReactNode;
  // Required, not defaulted — every caller already has a dictionary in
  // hand server-side (this is itself a Server Component, so it can't
  // call useDictionary() the way a client component would), and a
  // hardcoded Vietnamese fallback here would silently break the English
  // locale the moment a caller forgot to pass it.
  searchPlaceholder: string;
}) {
  const initial = branding.storeName.trim().charAt(0).toUpperCase() || "?";

  return (
    <header
      className="glass sticky top-3 z-20 flex flex-wrap items-center gap-3"
      style={{ borderRadius: "var(--radius-pill)", padding: "10px 14px 10px 18px" }}
    >
      {backHref && (
        <Link
          href={backHref}
          className="btn-ghost"
          style={{ minHeight: "40px", padding: "8px 16px" }}
        >
          <Icon name="chevron" size={16} style={{ transform: "rotate(180deg)" }} />
          {backLabel}
        </Link>
      )}
      <Link href="/" className="flex min-w-0 flex-none items-center gap-3">
        {branding.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- tenant-supplied URL, not a static asset
          <img
            src={branding.logoUrl}
            alt={`${branding.storeName} logo`}
            className="h-10 w-10 flex-none rounded-2xl object-cover"
            style={{ boxShadow: "var(--badge-shadow)" }}
          />
        ) : (
          <div
            aria-hidden
            className="flex h-10 w-10 flex-none items-center justify-center rounded-2xl text-sm font-bold text-white"
            style={{ backgroundColor: "var(--accent)", boxShadow: "var(--badge-shadow)" }}
          >
            {initial}
          </div>
        )}
        <span className="truncate text-[19px] font-semibold">{branding.storeName}</span>
      </Link>
      <Suspense fallback={<div className="flex-1" />}>
        <SearchBox placeholder={searchPlaceholder} />
      </Suspense>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <LocaleSwitcher />
        {rightSlot}
      </div>
    </header>
  );
}
