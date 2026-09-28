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
