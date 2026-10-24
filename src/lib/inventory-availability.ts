// The low-stock rule, in one place.
//
// It previously existed twice — a local const in ProductList.tsx for the
// storefront's "only N left" hint, and an exported one in tenant-kpis.ts
// for the admin's Low stock card — so the storefront and the dashboard
// could silently disagree about what "low" means.
//
// This module deliberately has NO imports, and that is the reason it is a
// module of its own rather than living in tenant-kpis.ts: ProductList.tsx
// is a Client Component, while tenant-kpis.ts imports prisma and
// getScopedDb. Importing the constant from there would pull the Prisma
// client into the browser bundle. A dependency-free module can be shared
// across the client/server boundary safely, and nothing can import a
// cycle back into it.
//
// The threshold is a fixed product decision, not tenant-configurable:
// there is no schema field, no admin control and no migration behind it.
// Changing it is a code change, on purpose.

/** A variant with this many or fewer available is surfaced as "low stock". */
export const LOW_STOCK_THRESHOLD = 5;

/**
 * Whether an available count (onHand - reserved) counts as low stock.
 *
 * Boundary: inclusive, so exactly LOW_STOCK_THRESHOLD available IS low —
 * the behavior both call sites already had via `<=`.
 */
export function isLowStock(available: number): boolean {
  return available <= LOW_STOCK_THRESHOLD;
}
