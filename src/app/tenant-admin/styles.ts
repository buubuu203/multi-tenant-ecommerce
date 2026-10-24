// Shared Tailwind class strings for Tenant Admin's plain HTML form
// controls (page.tsx is a Server Component, so these can't live as
// styled sub-components the way CartWidget's inputClassName does on the
// storefront side — same token-based approach, just exported as strings).
export const adminInputClassName =
  "rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20";

export const adminLabelClassName = "flex flex-col gap-1 text-sm";

export const adminSectionClassName = "flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:p-6";

export const adminCardClassName = "flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-3 text-sm";

// Larger, more spacious variants used by the Catalog page's inline
// product edit form (a form central enough to daily merchant use that
// the compact admin* styling above reads as cramped for it). Deliberately
// separate constants rather than resizing the shared ones, so every other
// Tenant Admin form keeps its existing compact styling.
export const productInputClassName =
  "rounded-lg border border-border bg-background px-3.5 py-2.5 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20";

export const productLabelClassName = "flex flex-col gap-1.5 text-sm font-medium";

export const productFieldGroupClassName = "flex flex-col gap-5";

// One visually distinct heading per logical group (Basic info / Description /
// Media / Status) inside the Catalog page's product edit form — a plain
// heading with generous spacing beneath, no border/background of its own
// (the surrounding card already provides that).
export const productSectionHeadingClassName =
  "text-sm font-semibold tracking-wide text-muted-foreground uppercase";

// ---------------------------------------------------------------------------
// Shared admin primitives.
//
// These exist because the same handful of decisions — how wide a page is,
// how a card looks, how a button signals its weight — were previously
// re-typed per page, so they drifted. Defining them once is what makes the
// surface feel like one product rather than eight screens built on
// different days. Every value is expressed in existing design tokens, so a
// tenant's branding still drives the palette.
// ---------------------------------------------------------------------------

/**
 * The single content column width for every admin page. One value, so the
 * header, the nav and the page body line up instead of each choosing.
 */
export const adminContainerClassName = "mx-auto w-full max-w-5xl px-4 sm:px-6";

/**
 * Button hierarchy. Three weights, deliberately not more: a page that
 * offers five equally-loud buttons has told the operator nothing about
 * which one to press.
 *
 * All three share the same height, radius and focus treatment, so they sit
 * on one baseline and the difference reads as emphasis rather than as
 * unrelated controls.
 */
const buttonBase =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

/** The one action a page most wants you to take. At most one per header. */
export const adminButtonPrimaryClassName = `${buttonBase} bg-foreground text-background hover:opacity-90 focus-visible:outline-foreground`;

/** Everything else that is safe to press. */
export const adminButtonSecondaryClassName = `${buttonBase} border border-border bg-surface text-foreground hover:bg-surface-muted focus-visible:outline-foreground`;

/**
 * Irreversible actions. Visually distinct from secondary so a destructive
 * control is never one glance away from a harmless one — and it carries a
 * red focus ring too, so the distinction survives keyboard navigation.
 */
export const adminButtonDangerClassName = `${buttonBase} border border-red-300 bg-surface text-red-700 hover:bg-red-50 focus-visible:outline-red-600 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950`;

/** A quieter control for inline/table use where a full button would shout. */
export const adminButtonQuietClassName =
  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

/** Helper/description text under a heading or beside a field. */
export const adminHelpTextClassName = "text-sm text-muted-foreground";

/** The small uppercase label above a group of related fields or facts. */
export const adminEyebrowClassName =
  "text-xs font-medium tracking-wide text-muted-foreground uppercase";

// ---------------------------------------------------------------------------
// Surface hierarchy.
//
// Three levels, and only three: the page canvas (set on .admin-chrome in
// globals.css), a content PANEL that holds one logical group, and a SUBTLE
// block for secondary material nested inside a panel. More levels than that
// stop reading as hierarchy and start reading as noise.
//
// The rule these replace: adminSectionClassName was wrapping whole PAGES in
// one card, so a page was a single slab with everything inside it and no
// grouping was visible. A panel should hold one group of related things, not
// a whole screen.
// ---------------------------------------------------------------------------

/** The page's own column. No border, no background — the canvas shows through. */
export const adminPageClassName = "flex flex-col gap-6";

/** One logical group of content. The default container for a section. */
export const adminPanelClassName =
  "flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:p-5";

/** A panel that holds a divided list, so rows can own their own padding. */
export const adminPanelFlushClassName =
  "overflow-hidden rounded-lg border border-border bg-surface";

/**
 * Rows inside a flush panel, separated by hairlines rather than each being
 * its own card — the shape settings pages want, and what stops a list of
 * methods reading as a stack of unrelated forms.
 */
export const adminDividedListClassName = "divide-y divide-border";

/** Secondary material nested inside a panel. */
export const adminSubtleClassName =
  "flex flex-col gap-2 rounded-md border border-border bg-surface-muted p-3";

/** A panel's own title row. */
export const adminPanelTitleClassName = "text-sm font-semibold tracking-tight";

/** One consistent control height, so inputs and buttons share a baseline. */
export const adminControlHeightClassName = "min-h-9";

/** Marks a required field, as text rather than an unexplained asterisk. */
export const adminRequiredClassName = "text-xs font-normal text-muted-foreground";
