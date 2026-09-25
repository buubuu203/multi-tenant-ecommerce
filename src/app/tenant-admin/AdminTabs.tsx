"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  ["/tenant-admin/branding", "Branding"],
  ["/tenant-admin/banners", "Banners"],
  ["/tenant-admin/payments", "Payments"],
  ["/tenant-admin/bank-transfer", "Bank transfer"],
  ["/tenant-admin/shipping", "Shipping"],
  ["/tenant-admin/catalog", "Catalog"],
  ["/tenant-admin/orders", "Orders"],
] as const;

// Phase 1 of the admin route split: real navigation, not an in-page
// anchor. Each tab is its own route (see the sibling directories under
// tenant-admin/) with its own data fetch — switching tabs now means
// "load only this section," not "everything already loaded, just
// scrolled into view."
export function AdminTabs() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-10 -mx-6 flex gap-1 overflow-x-auto border-b border-border bg-background/95 px-6 py-2 backdrop-blur-sm sm:-mx-0 sm:rounded-lg sm:border sm:px-2">
      {tabs.map(([href, label]) => {
        const active = pathname === href || pathname?.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground ${
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
