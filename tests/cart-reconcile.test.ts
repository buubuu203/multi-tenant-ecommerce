import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reconcileCartPrices,
  PRICE_CHANGE_NOTICE,
  type CurrentPrice,
} from "../src/lib/cart-reconcile";

// A cart line as cart-context.tsx stores it, with the extra fields this
// module must preserve untouched while it rewrites prices.
type TestLine = {
  productVariantId: string;
  productId: string;
  productName: string;
  variantLabel: string;
  price: number;
  originalPrice?: number;
  discountPercent?: number;
  quantity: number;
  imageUrl?: string;
};

function line(overrides: Partial<TestLine> = {}): TestLine {
  return { ...baseLine(), ...overrides };
}
function baseLine(): TestLine {
  return {
    productVariantId: "variant-1",
    productId: "product-1",
    productName: "Sunrise Tote Bag",
    variantLabel: "",
    price: 250_000,
    quantity: 2,
    imageUrl: "https://example.test/tote.jpg",
  };
}

function serverPrice(overrides: Partial<CurrentPrice> = {}): CurrentPrice {
  return {
    productVariantId: "variant-1",
    price: 250_000,
    originalPrice: null,
    discountPercent: null,
    ...overrides,
  };
}

test("unchanged prices report no change and preserve object identity", () => {
  const items = [line()];
  const result = reconcileCartPrices(items, [serverPrice()]);

  assert.equal(result.changed, false);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.unavailable, []);
  // Same object back, so React re-renders nothing for an unchanged line.
  assert.equal(result.items[0], items[0]);
});

test("a price increase is reported and written into the cart", () => {
  const result = reconcileCartPrices([line()], [serverPrice({ price: 300_000 })]);

  assert.equal(result.changed, true);
  assert.deepEqual(result.changes, [
    { productVariantId: "variant-1", previousPrice: 250_000, currentPrice: 300_000 },
  ]);
  assert.equal(result.items[0].price, 300_000);
  // Everything that is not a price survives reconciliation untouched.
  assert.equal(result.items[0].quantity, 2);
  assert.equal(result.items[0].productName, "Sunrise Tote Bag");
});

test("a price decrease is reported too — the customer still reviews it", () => {
  const result = reconcileCartPrices([line()], [serverPrice({ price: 200_000 })]);

  assert.equal(result.changed, true);
  assert.equal(result.changes[0].currentPrice, 200_000);
  assert.equal(result.items[0].price, 200_000);
});

test("a discount activating since the item was added lowers the line and sets its metadata", () => {
  const result = reconcileCartPrices(
    [line()],
    [serverPrice({ price: 200_000, originalPrice: 250_000, discountPercent: 20 })],
  );

  assert.equal(result.changed, true);
  assert.equal(result.items[0].price, 200_000);
  assert.equal(result.items[0].originalPrice, 250_000);
  assert.equal(result.items[0].discountPercent, 20);
});

test("a discount that expired since the item was added restores the full price and clears its metadata", () => {
  // The exact stale-cart case found in QA: added at 200.000 while a 20%
  // discount ran, submitted after it ended.
  const stale = line({ price: 200_000, originalPrice: 250_000, discountPercent: 20 });
  const result = reconcileCartPrices([stale], [serverPrice({ price: 250_000 })]);

  assert.equal(result.changed, true);
  assert.deepEqual(result.changes, [
    { productVariantId: "variant-1", previousPrice: 200_000, currentPrice: 250_000 },
  ]);
  assert.equal(result.items[0].price, 250_000);
  assert.equal(result.items[0].originalPrice, undefined);
  assert.equal(result.items[0].discountPercent, undefined);
});

test("a tampered localStorage price is overwritten by the server's and never trusted", () => {
  const tampered = line({ price: 1 });
  const result = reconcileCartPrices([tampered], [serverPrice({ price: 250_000 })]);

  assert.equal(result.changed, true);
  assert.equal(result.items[0].price, 250_000);
  assert.equal(result.changes[0].previousPrice, 1);
});

test("a tampered discount on an undiscounted product is stripped even at an unchanged price", () => {
  // Price matches the server, so there is nothing to interrupt the
  // customer over, but the fabricated "was 900.000, 72% off" badge must
  // not survive into the cart's display.
  const tampered = line({ price: 250_000, originalPrice: 900_000, discountPercent: 72 });
  const result = reconcileCartPrices([tampered], [serverPrice({ price: 250_000 })]);

  assert.equal(result.changed, false);
  assert.equal(result.items[0].originalPrice, undefined);
  assert.equal(result.items[0].discountPercent, undefined);
});

test("a line the server declines to price is listed as unavailable, not silently repriced", () => {
  const result = reconcileCartPrices([line({ productVariantId: "archived-variant" })], []);

  assert.deepEqual(result.unavailable, ["archived-variant"]);
  // Not a price change: createOrder() is what rejects an unsellable line.
  assert.equal(result.changed, false);
  assert.equal(result.items[0].price, 250_000);
});

test("only the moved lines are rewritten in a mixed cart", () => {
  const unchanged = line({ productVariantId: "variant-1" });
  const moved = line({ productVariantId: "variant-2", price: 100_000 });
  const result = reconcileCartPrices(
    [unchanged, moved],
    [serverPrice(), serverPrice({ productVariantId: "variant-2", price: 120_000 })],
  );

  assert.equal(result.changed, true);
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].productVariantId, "variant-2");
  assert.equal(result.items[0], unchanged);
  assert.equal(result.items[1].price, 120_000);
});

test("an empty cart reconciles to no change", () => {
  const result = reconcileCartPrices([], []);
  assert.equal(result.changed, false);
  assert.deepEqual(result.items, []);
});

test("the customer-facing notice is the approved wording", () => {
  assert.equal(PRICE_CHANGE_NOTICE, "Some prices changed. Please review your cart before checkout.");
});
