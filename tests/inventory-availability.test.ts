import { test } from "node:test";
import assert from "node:assert/strict";
import { LOW_STOCK_THRESHOLD, isLowStock } from "../src/lib/inventory-availability";

// The threshold is a fixed product decision, not tenant-configurable, and
// it previously existed twice -- once in ProductList.tsx for the
// storefront's "Only N left" hint and once in tenant-kpis.ts for the
// admin's Low stock card. These lock the single shared definition so the
// storefront and the dashboard cannot drift apart again.

test("the low-stock threshold is 5", () => {
  // Asserted as a literal on purpose: changing it is a deliberate product
  // decision, so it should require changing this test too.
  assert.equal(LOW_STOCK_THRESHOLD, 5);
});

test("the boundary is inclusive — exactly 5 available is low stock", () => {
  // Both call sites used `<= threshold` before sharing this helper; an
  // off-by-one here would silently change what merchants and shoppers see.
  assert.equal(isLowStock(6), false);
  assert.equal(isLowStock(5), true);
  assert.equal(isLowStock(4), true);
});

test("zero and negative availability count as low stock", () => {
  // available is onHand - reserved, which can legitimately reach 0, and
  // must never be reported as healthy stock.
  assert.equal(isLowStock(0), true);
  assert.equal(isLowStock(-1), true);
});

test("plentiful stock is not low", () => {
  assert.equal(isLowStock(25), false);
  assert.equal(isLowStock(LOW_STOCK_THRESHOLD + 1), false);
});
