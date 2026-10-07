// Cart Price Reconciliation: the cart's stored line prices are a
// display-only snapshot taken when an item was added (see
// cart-context.tsx), kept in localStorage and therefore both stale-able
// and tamper-able. createOrder() has always re-read the authoritative
// price server-side before charging, so a stale snapshot could never
// change what a customer PAID — but it could change what they SAW while
// agreeing to pay, which is the gap this module closes.
//
// The flow is: just before the customer submits checkout, ask the server
// for the current price of every line (getCurrentCartPrices() in
// checkout-actions.ts, which runs the same applyDiscount() that
// order-mutations.ts charges with), hand both lists to
// reconcileCartPrices() below, and if anything moved, write the server's
// numbers back into the cart and make the customer look again before
// re-submitting.
//
// Nothing here makes the client authoritative: the server prices flow
// IN, the cart's own numbers are only ever overwritten by them, and
// createOrder() still re-reads and snapshots price itself at charge
// time regardless of what this reconciliation concluded. Deliberately
// DOM-free and framework-free so the rules below are unit-testable,
// the same pattern as product-sort.ts and image-crop.ts.

/** Exact wording shown to the customer when a price moved. */
export const PRICE_CHANGE_NOTICE =
  "Some prices changed. Please review your cart before checkout.";

/**
 * The subset of a cart line this module reads and rewrites. CartItem
 * satisfies it structurally; the generic below preserves whatever other
 * fields (quantity, productName, imageUrl, …) the caller's line carries.
 */
export type PricedLine = {
  productVariantId: string;
  price: number;
  originalPrice?: number;
  discountPercent?: number;
};

/**
 * One line's current server-computed price. `originalPrice` /
 * `discountPercent` are non-null only while a discount is actually
 * active right now — the same convention as TenantProductVariant.
 */
export type CurrentPrice = {
  productVariantId: string;
  price: number;
  originalPrice: number | null;
  discountPercent: number | null;
};

export type PriceChange = {
  productVariantId: string;
  previousPrice: number;
  currentPrice: number;
};

export type Reconciliation<T extends PricedLine> = {
  /**
   * True when at least one line's price moved — the signal to block the
   * submit, show PRICE_CHANGE_NOTICE, and let the customer re-confirm.
   * Discount metadata shifting without the price moving is not a change
   * worth interrupting anyone over, so it does not set this.
   */
  changed: boolean;
  /** The cart lines with server prices applied. Same order as the input. */
  items: T[];
  changes: PriceChange[];
  /**
   * Lines the server declined to price — archived, deleted, or belonging
   * to another tenant. Reported rather than acted on here: createOrder()
   * already rejects these with its own customer-facing message, and
   * changing that is out of this module's scope.
   */
  unavailable: string[];
};

/**
 * Compares the cart's stored prices against the server's current ones
 * and returns the cart rewritten to the server's numbers.
 *
 * A line the server did not price keeps its stored values untouched and
 * is listed in `unavailable` instead; a line whose price is unchanged is
 * returned as the very same object, so React sees no needless change.
 */
export function reconcileCartPrices<T extends PricedLine>(
  items: T[],
  current: CurrentPrice[],
): Reconciliation<T> {
  const byVariantId = new Map(current.map((c) => [c.productVariantId, c]));
  const changes: PriceChange[] = [];
  const unavailable: string[] = [];

  const reconciled = items.map((item) => {
    const server = byVariantId.get(item.productVariantId);
    if (!server) {
      unavailable.push(item.productVariantId);
      return item;
    }

    // Normalize both sides to null before comparing: the cart stores
    // "no discount" as an absent optional, the server as an explicit
    // null, and `undefined !== null` would otherwise report a change on
    // every discount-free line.
    const storedOriginal = item.originalPrice ?? null;
    const storedPercent = item.discountPercent ?? null;
    const priceMoved = item.price !== server.price;
    const metadataMoved =
      storedOriginal !== server.originalPrice || storedPercent !== server.discountPercent;

    if (!priceMoved && !metadataMoved) {
      return item;
    }

    if (priceMoved) {
      changes.push({
        productVariantId: item.productVariantId,
        previousPrice: item.price,
        currentPrice: server.price,
      });
    }

    return {
      ...item,
      price: server.price,
      originalPrice: server.originalPrice ?? undefined,
      discountPercent: server.discountPercent ?? undefined,
    };
  });

  return { changed: changes.length > 0, items: reconciled, changes, unavailable };
}
