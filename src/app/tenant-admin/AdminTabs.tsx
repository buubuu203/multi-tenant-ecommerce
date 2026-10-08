"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The eight admin routes, grouped by the job they serve rather than listed
 * flat.
 *
 * Research on admin navigation is consistent that primary navigation
 * should cap around five to seven items, and that more than that is an
 * information-architecture problem rather than a styling one. There are
 * eight routes here and all must stay reachable, so instead of hiding any,
 * they are clustered into four jobs an operator actually has: check the
 * shop, sell, present the storefront, and configure checkout. The clusters
 * are separated visually, so the eye lands on a group of two or three
 * rather than scanning eight equal words.
 */
const GROUPS: readonly (readonly (readonly [string, string])[])[] = [
  [["/tenant-admin", "Overview"]],
  [
    ["/tenant-admin/orders", "Orders"],
    ["/tenant-admin/catalog", "Catalog"],
  ],
  [
    ["/tenant-admin/branding", "Branding"],
    ["/tenant-admin/banners", "Banners"],
  ],
  [
    ["/tenant-admin/payments", "Payments"],
    ["/tenant-admin/bank-transfer", "Bank transfer"],
    ["/tenant-admin/shipping", "Shipping"],
  ],
] as const;

/**
 * Navigation WRAPS rather than scrolling horizontally.
 *
 * This replaces an overflow-x-auto strip, and the choice is deliberate.
 * WCAG 1.4.10 (Reflow) asks that content not require scrolling in two
 * directions; a horizontal scroller also hides destinations off-screen
 * with no affordance, which is exactly the "no hover-only information"
 * problem on a touch device where there is no hover at all.
 *
 * A <select> or a disclosure menu would have been the alternatives. Both
 * were rejected: a select turns navigation into a form control and loses
 * aria-current, and a menu adds focus management and an expanded/collapsed
 * state for only eight links. Wrapping keeps every destination visible,
 * keeps real links, needs no JavaScript to open, and costs two rows on a
 * 375px screen.
 *
 * Rendered as a list, so assistive technology announces how many
 * destinations there are and which one is current.
 */
export function AdminTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin sections">
      <ul className="flex flex-wrap items-center gap-1">
        {GROUPS.map((group, groupIndex) => (
          <li key={group[0][0]} className="contents">
            <ul className="contents">
              {group.map(([href, label]) => {
                // Overview is the index route, so it must match EXACTLY — a
                // startsWith check would light it up on every sub-route,
                // since every other path begins with "/tenant-admin/".
                const active =
                  href === "/tenant-admin"
                    ? pathname === href
                    : pathname === href || pathname?.startsWith(`${href}/`);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={`inline-flex min-h-9 items-center rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground ${
                        active
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                      }`}
                    >
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {/* A hairline between clusters. aria-hidden because the grouping
                is a visual aid; the list itself carries the structure. */}
            {groupIndex < GROUPS.length - 1 && (
              <li aria-hidden="true" className="mx-1 hidden h-5 w-px bg-border sm:block" />
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
