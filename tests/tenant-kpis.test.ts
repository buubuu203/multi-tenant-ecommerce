// DB-backed tests — LOCAL dev Postgres only. See tests/README.md.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { getTenantKpis } from "../src/lib/tenant-kpis";

const UNIT_PRICE = 50_000;
const SHIPPING = 10_000;

let tenantA: { id: string };
let tenantB: { id: string };

async function seedTenant(label: string, suffix: string) {
  const tenant = await prisma.tenant.create({
    data: { slug: `test-kpi-${label}-${suffix}`, name: `KPI Tenant ${label}`, status: "active" },
  });
  const location = await prisma.location.create({
    data: { tenantId: tenant.id, name: "Main", isDefault: true },
  });
  const product = await prisma.product.create({
    data: { tenantId: tenant.id, name: `KPI Product ${label}`, status: "active" },
  });
  const variant = await prisma.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      price: UNIT_PRICE,
      sku: `KPI-${label}-${suffix}`,
      combinationKey: "",
    },
  });
  await prisma.inventory.create({
    data: { tenantId: tenant.id, productVariantId: variant.id, locationId: location.id, onHand: 100 },
  });
  const customer = await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      name: "KPI Customer",
      email: `kpi-${label}-${suffix}@example.com`,
      phone: "0912345678",
    },
  });
  return { tenant, product, variant, customer };
}

async function placeOrder(
  tenantId: string,
  customerId: string,
  variantId: string,
  status: "pending" | "fulfilled" | "cancelled",
  quantity = 2,
) {
  const order = await prisma.order.create({
    data: {
      tenantId,
      customerId,
      status,
      paymentMethod: "cod",
      shippingAddress: "1 Test",
      shippingWard: "W",
      shippingDistrict: "D",
      shippingCity: "C",
      shippingAmount: SHIPPING,
    },
  });
  await prisma.orderItem.create({
    data: { tenantId, orderId: order.id, productVariantId: variantId, quantity, price: UNIT_PRICE },
  });
  return order;
}

before(async () => {
  const suffix = randomUUID().slice(0, 8);
  const a = await seedTenant("a", suffix);
  const b = await seedTenant("b", suffix);
  tenantA = a.tenant;
  tenantB = b.tenant;

  // Tenant A: one pending (counts toward revenue), one cancelled (must not).
  await placeOrder(tenantA.id, a.customer.id, a.variant.id, "pending");
  await placeOrder(tenantA.id, a.customer.id, a.variant.id, "cancelled");

  // Tenant B gets its own, larger order — if isolation leaks, A's numbers move.
  await placeOrder(tenantB.id, b.customer.id, b.variant.id, "fulfilled", 10);
});

after(async () => {
  const tenantIds = [tenantA.id, tenantB.id];
  await prisma.orderItem.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.order.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.inventory.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.productVariant.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.product.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.location.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

test("KPIs: counts only this tenant's pending orders", async () => {
  const kpis = await getTenantKpis(tenantA.id);
  assert.equal(kpis.pendingOrders, 1);
});

test("KPIs: revenue excludes cancelled orders and includes shipping", async () => {
  const kpis = await getTenantKpis(tenantA.id);
  // One non-cancelled order: 2 × 50_000 + 10_000 shipping.
  assert.equal(kpis.revenueInWindow, 2 * UNIT_PRICE + SHIPPING);
});

test("KPIs: order count in window includes cancelled (it's a volume metric, not revenue)", async () => {
  const kpis = await getTenantKpis(tenantA.id);
  assert.equal(kpis.ordersInWindow, 2);
});

test("KPIs: TENANT ISOLATION — tenant B's larger order never affects tenant A", async () => {
  const a = await getTenantKpis(tenantA.id);
  const b = await getTenantKpis(tenantB.id);

  assert.equal(a.revenueInWindow, 2 * UNIT_PRICE + SHIPPING);
  assert.equal(b.revenueInWindow, 10 * UNIT_PRICE + SHIPPING);
  assert.equal(a.activeProducts, 1, "must not see tenant B's product");
  assert.equal(b.pendingOrders, 0, "tenant B's only order is fulfilled");
});

test("KPIs: counts only this tenant's active products", async () => {
  const kpis = await getTenantKpis(tenantA.id);
  assert.equal(kpis.activeProducts, 1);
});
