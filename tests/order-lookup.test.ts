// DB-backed tests — run against LOCAL dev Postgres only (loads
// .env.local's DATABASE_URL; no Preview/Production credential is ever
// read or required). Each test creates its own throwaway tenant/customer/
// order fixtures with a random UUID suffix and cleans up in `after()`, so
// runs are deterministic and independent of pre-existing local data.
// Env loading happens in tests/env-setup.ts, preloaded via the npm test
// script's `--import` flag — see that file's comment for why it can't
// happen here (ESM module-evaluation ordering).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { getOrderForCustomerByPhone, getOrdersForCustomerNameAndPhone } from "../src/lib/order-queries";

let tenantA: { id: string };
let tenantB: { id: string };
let orderA: { id: string };

before(async () => {
  const suffix = randomUUID().slice(0, 8);
  tenantA = await prisma.tenant.create({
    data: { slug: `test-lookup-a-${suffix}`, name: "Test Lookup Tenant A", status: "active" },
  });
  tenantB = await prisma.tenant.create({
    data: { slug: `test-lookup-b-${suffix}`, name: "Test Lookup Tenant B", status: "active" },
  });

  const location = await prisma.location.create({
    data: { tenantId: tenantA.id, name: "Main", isDefault: true },
  });
  const product = await prisma.product.create({
    data: { tenantId: tenantA.id, name: "Test Product", status: "active" },
  });
  const variant = await prisma.productVariant.create({
    data: { tenantId: tenantA.id, productId: product.id, price: 100_000, sku: `SKU-${suffix}`, combinationKey: "" },
  });
  await prisma.inventory.create({
    data: { tenantId: tenantA.id, productVariantId: variant.id, locationId: location.id, onHand: 10 },
  });
  const customer = await prisma.customer.create({
    data: { tenantId: tenantA.id, name: "Nguyen Van A", email: `a-${suffix}@example.com`, phone: "0912345678" },
  });
  orderA = await prisma.order.create({
    data: {
      tenantId: tenantA.id,
      customerId: customer.id,
      status: "pending",
      paymentMethod: "cod",
      shippingAddress: "123 Test St",
      shippingWard: "Test Ward",
      shippingDistrict: "Test District",
      shippingCity: "Test City",
    },
  });
  await prisma.orderItem.create({
    data: { tenantId: tenantA.id, orderId: orderA.id, productVariantId: variant.id, quantity: 1, price: 100_000 },
  });
});

after(async () => {
  await prisma.orderItem.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
  await prisma.order.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
  await prisma.inventory.deleteMany({ where: { tenantId: tenantA.id } });
  await prisma.productVariant.deleteMany({ where: { tenantId: tenantA.id } });
  await prisma.product.deleteMany({ where: { tenantId: tenantA.id } });
  await prisma.location.deleteMany({ where: { tenantId: tenantA.id } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

test("order lookup: order id + correct phone succeeds", async () => {
  const result = await getOrderForCustomerByPhone(tenantA.id, orderA.id, "0912345678");
  assert.ok(result);
  assert.equal(result!.id, orderA.id);
});

test("order lookup: order id + WRONG phone returns null (never leaks the order)", async () => {
  const result = await getOrderForCustomerByPhone(tenantA.id, orderA.id, "0999999999");
  assert.equal(result, null);
});

test("order lookup: the equivalent +84 phone format resolves the same order", async () => {
  const result = await getOrderForCustomerByPhone(tenantA.id, orderA.id, "+84912345678");
  assert.ok(result);
  assert.equal(result!.id, orderA.id);
});

test("order lookup: an invalid phone format returns null, not an error", async () => {
  const result = await getOrderForCustomerByPhone(tenantA.id, orderA.id, "not-a-phone");
  assert.equal(result, null);
});

test("order lookup: tenant isolation — the order is invisible via tenant B's scope", async () => {
  const result = await getOrderForCustomerByPhone(tenantB.id, orderA.id, "0912345678");
  assert.equal(result, null);
});

test("order history: name + phone together finds the order", async () => {
  const results = await getOrdersForCustomerNameAndPhone(tenantA.id, "Nguyen Van A", "0912345678");
  assert.equal(results.length, 1);
  assert.equal(results[0].id, orderA.id);
});

test("order history: name is matched case-insensitively", async () => {
  const results = await getOrdersForCustomerNameAndPhone(tenantA.id, "nguyen van a", "0912345678");
  assert.equal(results.length, 1);
});

test("order history: correct name but WRONG phone finds nothing (name alone is never enough)", async () => {
  const results = await getOrdersForCustomerNameAndPhone(tenantA.id, "Nguyen Van A", "0999999999");
  assert.equal(results.length, 0);
});

test("order history: correct phone but WRONG name finds nothing (phone alone is never enough)", async () => {
  const results = await getOrdersForCustomerNameAndPhone(tenantA.id, "Someone Else", "0912345678");
  assert.equal(results.length, 0);
});

test("order history: tenant isolation — invisible via tenant B's scope even with correct name+phone", async () => {
  const results = await getOrdersForCustomerNameAndPhone(tenantB.id, "Nguyen Van A", "0912345678");
  assert.equal(results.length, 0);
});
