// Shared Tailwind class strings for Tenant Admin's plain HTML form
// controls (page.tsx is a Server Component, so these can't live as
// styled sub-components the way CartWidget's inputClassName does on the
// storefront side — same token-based approach, just exported as strings).
export const adminInputClassName =
  "rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20";

export const adminLabelClassName = "flex flex-col gap-1 text-sm";

export const adminSectionClassName = "flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:p-6";

export const adminCardClassName = "flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-3 text-sm";
