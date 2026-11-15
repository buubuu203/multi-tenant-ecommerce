import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDiscount, isDiscountActive } from "../src/lib/discounts";

test("isDiscountActive: null discount is never active", () => {
  assert.equal(isDiscountActive(null), false);
});

test("isDiscountActive: disabled discount is never active regardless of dates", () => {
  assert.equal(isDiscountActive({ discountType: "percentage", discountValue: 10, enabled: false, startsAt: null, endsAt: null }), false);
});

test("isDiscountActive: enabled with no dates is always active", () => {
  assert.equal(isDiscountActive({ discountType: "percentage", discountValue: 10, enabled: true, startsAt: null, endsAt: null }), true);
});

test("isDiscountActive: before startsAt is not active", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const startsAt = new Date("2026-07-01T00:00:00Z");
  assert.equal(isDiscountActive({ discountType: "percentage", discountValue: 10, enabled: true, startsAt, endsAt: null }, now), false);
});

test("isDiscountActive: after endsAt is not active (expired)", () => {
  const now = new Date("2026-08-01T00:00:00Z");
  const endsAt = new Date("2026-07-01T00:00:00Z");
  assert.equal(isDiscountActive({ discountType: "percentage", discountValue: 10, enabled: true, startsAt: null, endsAt }, now), false);
});

test("isDiscountActive: within [startsAt, endsAt] is active", () => {
  const now = new Date("2026-06-15T00:00:00Z");
  const startsAt = new Date("2026-06-01T00:00:00Z");
  const endsAt = new Date("2026-07-01T00:00:00Z");
  assert.equal(isDiscountActive({ discountType: "percentage", discountValue: 10, enabled: true, startsAt, endsAt }, now), true);
});

test("applyDiscount: no discount returns the original price unchanged", () => {
  const result = applyDiscount(100_000, null);
  assert.deepEqual(result, { finalPrice: 100_000, originalPrice: 100_000, discountPercent: null, discountAmount: 0 });
});

test("applyDiscount: expired discount returns the original price unchanged", () => {
  const now = new Date("2026-08-01T00:00:00Z");
  const endsAt = new Date("2026-07-01T00:00:00Z");
  const result = applyDiscount(100_000, { discountType: "percentage", discountValue: 50, enabled: true, startsAt: null, endsAt }, now);
  assert.deepEqual(result, { finalPrice: 100_000, originalPrice: 100_000, discountPercent: null, discountAmount: 0 });
});

test("applyDiscount: 20% off rounds to the nearest whole unit", () => {
  const result = applyDiscount(99_999, { discountType: "percentage", discountValue: 20, enabled: true, startsAt: null, endsAt: null });
  assert.deepEqual(result, { finalPrice: 79_999, originalPrice: 99_999, discountPercent: 20, discountAmount: 20_000 });
});

test("applyDiscount: 100% off never goes negative, clamps to 0", () => {
  const result = applyDiscount(50_000, { discountType: "percentage", discountValue: 100, enabled: true, startsAt: null, endsAt: null });
  assert.equal(result.finalPrice, 0);
  assert.equal(result.discountPercent, 100);
});

test("applyDiscount: fixed_amount discount subtracts from price", () => {
  const result = applyDiscount(100_000, { discountType: "fixed_amount", discountValue: 30_000, enabled: true, startsAt: null, endsAt: null });
  assert.deepEqual(result, { finalPrice: 70_000, originalPrice: 100_000, discountPercent: null, discountAmount: 30_000 });
});

test("applyDiscount: fixed_amount caps at unit price (never negative)", () => {
  const result = applyDiscount(20_000, { discountType: "fixed_amount", discountValue: 50_000, enabled: true, startsAt: null, endsAt: null });
  assert.equal(result.finalPrice, 0);
  assert.equal(result.discountAmount, 20_000);
});
