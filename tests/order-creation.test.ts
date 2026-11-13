// Integration tests for the single most safety-critical path in the app:
// createOrder(). Everything below exercises the REAL transaction against
// the local dev Postgres — not mocks — because the properties that matter
// here (server-authoritative pricing, discount snapshotting, inventory
// reservation, tenant isolation) are all emergent from how that
// transaction actually runs, not from any one pure function.
//
// LOCAL dev Postgres only. See tests/README.md.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { createOrder } from "../src/lib/order-mutations";

const UNIT_PRICE = 100_000;
const SHIPPING_AMOUNT = 20_000;

let tenantA: { id: string };
let tenantB: { id: string };
let variantA: { id: string };
let variantB: { id: string };
let productA: { id: string };
let shippingMethodA: { id: string };
let shippingMethodB: { id: string };
let locationA: { id: string };

const customer = { name: "Nguyen Van A", email: "", phone: "0912345678" };
const shipping = { address: "123 Test St", ward: "Ward", district: "District", city: "City" };

async function provisionTenant(label: string, suffix: string) {
  const tenant = await prisma.tenant.create({
    data: { slug: `test-order-${label}-${suffix}`, name: `Order Tenant ${label}`, status: "active" },
  });
  const location = await prisma.location.create({
    data: { tenantId: tenant.id, name: "Main", isDefault: true },
  });
  const product = await prisma.product.create({
    data: { tenantId: tenant.id, name: `Product ${label}`, status: "active" },
  });
  const variant = await prisma.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      price: UNIT_PRICE,
      sku: `SKU-${label}-${suffix}`,
      combinationKey: "",
    },
  });
  await prisma.inventory.create({
    data: { tenantId: tenant.id, productVariantId: variant.id, locationId: location.id, onHand: 10 },
  });
  const shippingMethod = await prisma.tenantShippingMethod.create({
    data: { tenantId: tenant.id, name: "Standard", amount: SHIPPING_AMOUNT, enabled: true, isDefault: true },
  });
  await prisma.tenantPaymentMethod.create({
    data: { tenantId: tenant.id, method: "cod", provider: "cod", enabled: true },
  });
  return { tenant, location, product, variant, shippingMethod };
}

before(async () => {
  const suffix = randomUUID().slice(0, 8);
  const a = await provisionTenant("a", suffix);
  const b = await provisionTenant("b", suffix);
  tenantA = a.tenant;
  tenantB = b.tenant;
  variantA = a.variant;
  variantB = b.variant;
  productA = a.product;
  shippingMethodA = a.shippingMethod;
  shippingMethodB = b.shippingMethod;
  locationA = a.location;
  customer.email = `order-${suffix}@example.com`;
});

after(async () => {
  const tenantIds = [tenantA.id, tenantB.id];
  await prisma.orderItem.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.order.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.discount.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.inventory.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.productVariant.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.product.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.location.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenantShippingMethod.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenantPaymentMethod.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

test("pricing: charges the server-side variant price, not anything client-supplied", async () => {
  const result = await createOrder(
    tenantA.id,
    [{ productVariantId: variantA.id, quantity: 2 }],
    "cod",
    customer,
    shipping,
    shippingMethodA.id,
  );
  assert.equal(result.success, true);
  if (!result.success) return;

  const items = await prisma.orderItem.findMany({ where: { orderId: result.data.orderId } });
  assert.equal(items.length, 1);
  assert.equal(items[0].price, UNIT_PRICE);
  assert.equal(items[0].quantity, 2);
  // No discount configured yet, so the snapshot columns stay null.
  assert.equal(items[0].originalUnitPrice, null);
  assert.equal(items[0].discountPercent, null);
});

test("shipping: snapshots the server-resolved amount, never a client-supplied one", async () => {
  const result = await createOrder(
    tenantA.id,
    [{ productVariantId: variantA.id, quantity: 1 }],
    "cod",
    customer,
    shipping,
    shippingMethodA.id,
  );
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.shippingAmount, SHIPPING_AMOUNT);

  const order = await prisma.order.findUnique({ where: { id: result.data.orderId } });
  assert.equal(order?.shippingAmount, SHIPPING_AMOUNT);
  assert.equal(order?.shippingMethodName, "Standard");
});

test("inventory: a successful order reserves stock", async () => {
  const before = await prisma.inventory.findFirst({
    where: { tenantId: tenantA.id, productVariantId: variantA.id },
  });
  const result = await createOrder(
    tenantA.id,
    [{ productVariantId: variantA.id, quantity: 3 }],
    "cod",
    customer,
    shipping,
    shippingMethodA.id,
  );
  assert.equal(result.success, true);

  const after = await prisma.inventory.findFirst({
    where: { tenantId: tenantA.id, productVariantId: variantA.id },
  });
  assert.equal(after!.reserved, before!.reserved + 3);
});

test("discount: an ACTIVE discount is applied server-side and snapshotted onto the order item", async () => {
  await prisma.discount.create({
    data: { tenantId: tenantA.id, productId: productA.id, percentOff: 25, enabled: true },
  });

  const result = await createOrder(
    tenantA.id,
    [{ productVariantId: variantA.id, quantity: 1 }],
    "cod",
    customer,
    shipping,
    shippingMethodA.id,
  );
  assert.equal(result.success, true);
  if (!result.success) return;

  const items = await prisma.orderItem.findMany({ where: { orderId: result.data.orderId } });
  // 100_000 - 25% = 75_000 charged; the pre-discount price is retained.
  assert.equal(items[0].price, 75_000);
  assert.equal(items[0].originalUnitPrice, UNIT_PRICE);
  assert.equal(items[0].discountPercent, 25);
});

test("discount: editing the discount later never changes an already-placed order", async () => {
  const result = await createOrder(
    tenantA.id,
    [{ productVariantId: variantA.id, quantity: 1 }],
    "cod",
    customer,
    shipping,
    shippingMethodA.id,
  );
  assert.equal(result.success, true);
  if (!result.success) return;

  // Change the live discount out from under the placed order.
  await prisma.discount.updateMany({
    where: { tenantId: tenantA.id, productId: productA.id },
    data: { percentOff: 90 },
  });

  const items = await prisma.orderItem.findMany({ where: { orderId: result.data.orderId } });
  assert.equal(items[0].price, 75_000, "historical order must keep its original charged price");
  assert.equal(items[0].discountPercent, 25, "historical order must keep its original discount percent");
});

test("discount: a DISABLED discount is not applied", async () => {
  await prisma.discount.updateMany({
    where: { tenantId: tenantA.id, productId: productA.id },
    data: { enabled: false, percentOff: 50 },
  });

  const result = await createOrder(
    tenantA.id,
    [{ productVariantId: variantA.id, quantity: 1 }],
    "cod",
    customer,
    shipping,
    shippingMethodA.id,
  );
  assert.equal(result.success, true);
  if (!result.success) return;

  const items = await prisma.orderItem.findMany({ where: { orderId: result.data.orderId } });
  assert.equal(items[0].price, UNIT_PRICE);
  assert.equal(items[0].discountPercent, null);
});

test("discount: an EXPIRED discount is not applied", async () => {
  await prisma.discount.updateMany({
    where: { tenantId: tenantA.id, productId: productA.id },
    data: { enabled: true, percentOff: 50, endsAt: new Date(Date.now() - 60_000) },
  });

  const result = await createOrder(
    tenantA.id,
    [{ productVariantId: variantA.id, quantity: 1 }],
    "cod",
    customer,
    shipping,
    shippingMethodA.id,
  );
  assert.equal(result.success, true);
  if (!result.success) return;

  const items = await prisma.orderItem.findMany({ where: { orderId: result.data.orderId } });
  assert.equal(items[0].price, UNIT_PRICE);
  assert.equal(items[0].discountPercent, null);

  // Reset so later tests aren't affected by this one's fixture.
  await prisma.discount.deleteMany({ where: { tenantId: tenantA.id } });
});

test("TENANT ISOLATION: cannot order tenant B's variant through tenant A's context", async () => {
  const result = await createOrder(
    tenantA.id,
    [{ productVariantId: variantB.id, quantity: 1 }],
    "cod",
    customer,
    shipping,
    shippingMethodA.id,
  );
  assert.equal(result.success, false, "a cross-tenant variant id must never resolve");
});

test("TENANT ISOLATION: cannot use tenant B's shipping method through tenant A's context", async () => {
  const result = await createOrder(
    tenantA.id,
    [{ productVariantId: variantA.id, quantity: 1 }],
    "cod",
    customer,
    shipping,
    shippingMethodB.id,
  );
  assert.equal(result.success, false, "a cross-tenant shipping method id must never resolve");
});

test("archived variant is rejected even when its id is submitted directly", async () => {
  const archived = await prisma.productVariant.create({
    data: {
      tenantId: tenantA.id,
      productId: productA.id,
      price: UNIT_PRICE,
      sku: `SKU-ARCHIVED-${randomUUID().slice(0, 6)}`,
      combinationKey: `archived-${randomUUID().slice(0, 6)}`,
      status: "archived",
    },
  });
  await prisma.inventory.create({
    data: { tenantId: tenantA.id, productVariantId: archived.id, locationId: locationA.id, onHand: 5 },
  });

  const result = await createOrder(
    tenantA.id,
    [{ productVariantId: archived.id, quantity: 1 }],
    "cod",
    customer,
    shipping,
    shippingMethodA.id,
  );
  assert.equal(result.success, false, "storefront filtering is a UI convenience, not the guard");
});

test("insufficient stock is rejected and reserves nothing", async () => {
  const before = await prisma.inventory.findFirst({
    where: { tenantId: tenantA.id, productVariantId: variantA.id },
  });
  const result = await createOrder(
    tenantA.id,
    [{ productVariantId: variantA.id, quantity: 9999 }],
    "cod",
    customer,
    shipping,
    shippingMethodA.id,
  );
  assert.equal(result.success, false);

  const after = await prisma.inventory.findFirst({
    where: { tenantId: tenantA.id, productVariantId: variantA.id },
  });
  assert.equal(after!.reserved, before!.reserved, "a failed order must not leave stock reserved");
});
