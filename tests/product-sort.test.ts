import { test } from "node:test";
import assert from "node:assert/strict";
import { startingPrice, compareByStartingPrice } from "../src/lib/product-sort";
import type { TenantProduct } from "../src/app/_storefront/get-tenant-products";

// Only the fields the sort actually reads; cast keeps the fixtures honest
// about that rather than inventing a full TenantProduct shape.
function product(name: string, prices: number[]): TenantProduct {
  return { name, variants: prices.map((price) => ({ price })) } as unknown as TenantProduct;
}

test("startingPrice: returns the lowest variant price", () => {
  assert.equal(startingPrice(product("a", [90_000, 50_000, 70_000])), 50_000);
});

test("startingPrice: a single-variant product uses that price", () => {
  assert.equal(startingPrice(product("a", [12_345])), 12_345);
});

test("startingPrice: a product with NO sellable variant has no price (null, never Infinity)", () => {
  // Reachable in production: getTenantProducts() lists every active
  // product with no "must have a variant" filter, and separately drops
  // archived variants.
  assert.equal(startingPrice(product("a", [])), null);
});

test("sort low→high orders by starting price", () => {
  const sorted = [product("mid", [500]), product("cheap", [100]), product("dear", [900])]
    .sort((a, b) => compareByStartingPrice(a, b, 1))
    .map((p) => p.name);
  assert.deepEqual(sorted, ["cheap", "mid", "dear"]);
});

test("sort high→low orders by starting price", () => {
  const sorted = [product("mid", [500]), product("cheap", [100]), product("dear", [900])]
    .sort((a, b) => compareByStartingPrice(a, b, -1))
    .map((p) => p.name);
  assert.deepEqual(sorted, ["dear", "mid", "cheap"]);
});

test("regression: a priceless product never heads the high→low grid", () => {
  // The bug this guards: startingPrice() used to return Infinity for a
  // product with no variants, so (Infinity - 500) * -1 = -Infinity put a
  // product with no price at all ABOVE the most expensive real product.
  const sorted = [product("priceless", []), product("cheap", [100]), product("dear", [900])]
    .sort((a, b) => compareByStartingPrice(a, b, -1))
    .map((p) => p.name);
  assert.deepEqual(sorted, ["dear", "cheap", "priceless"]);
});

test("priceless products sort last in low→high too", () => {
  const sorted = [product("priceless", []), product("dear", [900]), product("cheap", [100])]
    .sort((a, b) => compareByStartingPrice(a, b, 1))
    .map((p) => p.name);
  assert.deepEqual(sorted, ["cheap", "dear", "priceless"]);
});

test("two priceless products compare equal (comparator never returns NaN)", () => {
  const result = compareByStartingPrice(product("a", []), product("b", []), -1);
  assert.equal(result, 0);
  assert.ok(!Number.isNaN(result));
});
