"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";

/**
 * The Tenant Admin information architecture.
 *
 * Nine routes is past the point where a horizontal bar works — the
 * consistent guidance is that a top bar suits three to six primary areas
 * and a sidebar is what scales to many sections with real grouping. The
 * groups below are the jobs a merchant actually has, not a flattened list.
 *
 * Two deliberate omissions, because inventing a route would be worse than
 * an imperfect menu:
 *
 *  - There is no Discounts route. Discounts are configured per product
 *    inside the Catalog product editor, so Catalog is where they live.
 *  - /tenant-admin/products/new is an ACTION, not a destination. It is
 *    reached from Catalog's primary button and deliberately kept out of
 *    the sidebar, which lists places rather than verbs.
 *
 * "Checkout" rather than "Operations": all three of its routes configure
 * what a buyer is offered at checkout, which is the merchant's own name
 * for it.
 */
const GROUPS = [
  { label: null, items: [["/tenant-admin", "Overview"]] },
  {
    label: "Commerce",
    items: [
      ["/tenant-admin/orders", "Orders"],
      ["/tenant-admin/customers", "Customers"],
      ["/tenant-admin/fulfillment", "Fulfillment"],
      ["/tenant-admin/catalog", "Catalog"],
    ],
  },
  {
    label: "Storefront",
    items: [
      ["/tenant-admin/branding", "Branding"],
      ["/tenant-admin/banners", "Banners"],
    ],
  },
  {
    label: "Checkout",
    items: [
      ["/tenant-admin/payments", "Payments"],
      ["/tenant-admin/payment-operations", "Payment operations"],
      ["/tenant-admin/bank-transfer", "Bank transfer"],
      ["/tenant-admin/shipping", "Shipping"],
    ],
  },
] as const satisfies readonly {
  label: string | null;
  items: readonly (readonly [string, string])[];
}[];

function isActive(href: string, pathname: string | null): boolean {
  // Overview is the index route, so it must match EXACTLY — every other
  // admin path begins with "/tenant-admin/", so a startsWith check would
  // mark Overview current on all of them.
  if (href === "/tenant-admin") return pathname === href;
  return pathname === href || Boolean(pathname?.startsWith(`${href}/`));
}

/**
 * Primary navigation: a persistent sidebar on desktop, an inline
 * disclosure on small screens.
 *
 * The mobile panel deliberately PUSHES CONTENT DOWN rather than covering
 * the page. That is the whole reason it is a disclosure and not a drawer:
 * a menu that overlays the page behaves as a modal dialog and then owes
 * the user a focus trap, aria-modal, and an inert background — three
 * things that are easy to get subtly wrong and that break keyboard users
 * when they are. A non-overlay disclosure needs none of them, and the
 * button's aria-expanded is enough for assistive technology to describe
 * it. Escape still closes it because that costs nothing.
 *
 * The nav list is rendered ONCE and shown or hidden with CSS, so there is
 * never a second copy of every link sitting in the accessibility tree.
 */
export function AdminNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <nav aria-label="Admin sections" className="flex flex-col gap-2">
      {/* Hidden on desktop, where the sidebar is always visible and a
          toggle would be a control with nothing to do. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex min-h-11 items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground lg:hidden"
      >
        {/* The label states what pressing it DOES, so it is never
            ambiguous which state the control is announcing. */}
        <span>{open ? "Close menu" : "Menu"}</span>
        <span aria-hidden="true" className="text-muted-foreground">
          {open ? "✕" : "☰"}
        </span>
      </button>

      <div
        id={panelId}
        className={`${open ? "flex" : "hidden"} flex-col gap-4 lg:flex`}
      >
        {GROUPS.map((group) => (
          <div key={group.label ?? "root"} className="flex flex-col gap-1">
            {group.label && (
              // A visible group label, also used as the list's accessible
              // name. Not a heading: the layout owns the h1 and each page
              // owns its h2, and injecting nav headings between them would
              // muddle the document outline rather than clarify it.
              <p
                id={`${panelId}-${group.label}`}
                className="px-3 pt-1 text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                {group.label}
              </p>
            )}
            <ul
              aria-labelledby={group.label ? `${panelId}-${group.label}` : undefined}
              className="flex flex-col gap-0.5"
            >
              {group.items.map(([href, label]) => {
                const active = isActive(href, pathname);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      // Closing on the link itself rather than in an effect
                      // keyed on pathname: navigating closes the panel
                      // without a state write during render, and it is
                      // harmless on desktop where the panel is always open.
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-11 items-center gap-2 rounded-md border-l-2 px-3 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground lg:min-h-9 ${
                        active
                          ? // Three signals, not one: a left rule, a filled
                            // surface, and a weight change — plus
                            // aria-current for assistive tech. None of them
                            // is colour alone, so the state survives
                            // greyscale and low vision. A fully inverted
                            // pill was too heavy sitting under grouped
                            // labels; this reads as "you are here" without
                            // dominating the sidebar.
                            "border-foreground bg-surface font-semibold text-foreground"
                          : "border-transparent font-medium text-muted-foreground hover:bg-surface hover:text-foreground"
                      }`}
                    >
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
