import type { TenantProduct } from "@/app/_storefront/get-tenant-products";

// Storefront price sorting. Extracted out of ProductList.tsx (a "use
// client" component) purely so it is testable without a DOM — same
// reasoning as src/lib/image-crop.ts.

/**
 * The "starting from" price: the lowest non-archived variant price, which
 * is the same number the card and PDP already show for a variant-bearing
 * product before any option is chosen.
 *
 * Returns null when a product has NO sellable variant. That is a real
 * state, not a defensive hypothetical: getTenantProducts() selects every
 * `status: "active"` product with no "must have a variant" filter, and
 * separately drops archived variants — so a product created before its
 * variants are generated, or one whose variants have all been archived,
 * legitimately arrives here with an empty `variants` array. Returning
 * null (rather than Infinity) keeps "has no price" distinguishable from
 * "is expensive".
 */
export function startingPrice(product: TenantProduct): number | null {
  if (product.variants.length === 0) {
    return null;
  }
  return product.variants.reduce(
    (min, variant) => Math.min(min, variant.price),
    Number.POSITIVE_INFINITY,
  );
}

/**
 * Comparator for the storefront's price sort. `direction` is 1 for
 * low→high and -1 for high→low.
 *
 * Priceless products (no sellable variant) sort LAST in BOTH directions.
 * Sorting them by their "price" is what caused the bug this replaces:
 * Infinity made them sort last under low→high but FIRST under high→low,
 * so a product with no price at all headed the "Price: High to Low"
 * grid, above the genuinely most expensive items.
 */
export function compareByStartingPrice(
  a: TenantProduct,
  b: TenantProduct,
  direction: 1 | -1,
): number {
  const priceA = startingPrice(a);
  const priceB = startingPrice(b);

  if (priceA === null && priceB === null) return 0;
  if (priceA === null) return 1;
  if (priceB === null) return -1;

  return (priceA - priceB) * direction;
}
