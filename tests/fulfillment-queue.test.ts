// Fulfillment workspace: classification, isolation and query behaviour.
// Isolated tenants with fixed dates; no sleeps, no QA data touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { prisma } from '../src/lib/prisma';
import {
  classifyOrder,
  listFulfillmentQueue,
  getFulfillmentSummary,
  FULFILLMENT_CATEGORIES,
  FULFILLMENT_PAGE_SIZE,
  isFulfillmentCategory,
  CATEGORY_LABEL,
} from '../src/lib/fulfillment-queue';

const UNIT = 100_000;
const SHIPPING = 20_000;

let tenantA: { id: string };
let tenantB: { id: string };
let variantA: string;
let variantB: string;
let suffix: string;

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

async function provision(label: string) {
  const tenant = await prisma.tenant.create({
    data: { slug: `test-ful-${label}-${suffix}`, name: `Ful ${label}`, status: 'active' },
  });
  const location = await prisma.location.create({
    data: { tenantId: tenant.id, name: 'Main', isDefault: true },
  });
  const product = await prisma.product.create({
    data: { tenantId: tenant.id, name: `P ${label}`, status: 'active' },
  });
  const variant = await prisma.productVariant.create({
    data: { tenantId: tenant.id, productId: product.id, price: UNIT, combinationKey: '' },
  });
  await prisma.inventory.create({
    data: {
      tenantId: tenant.id,
      productVariantId: variant.id,
      locationId: location.id,
      onHand: 99,
    },
  });
  return { tenant, variantId: variant.id };
}

/** Builds an order directly, so each state combination is exact. */
async function makeOrder(
  tenantId: string,
  variantId: string,
  options: {
    label: string;
    orderStatus: 'pending' | 'fulfilled' | 'cancelled';
    paymentMethod: 'cod' | 'momo' | 'bank_transfer';
    paymentStatus?: 'pending' | 'succeeded' | 'failed' | 'expired' | 'cancelled' | null;
    shippingMethodName?: string | null;
  },
) {
  const customer = await prisma.customer.create({
    data: {
      tenantId,
      name: `Nguyễn ${options.label}`,
      email: `ful-${options.label}-${suffix}@example.com`,
      phone: `09${Math.floor(Math.random() * 100_000_000)}`.slice(0, 10),
    },
  });
  const order = await prisma.order.create({
    data: {
      tenantId,
      customerId: customer.id,
      status: options.orderStatus,
      paymentMethod: options.paymentMethod,
      shippingAddress: '1 Đường Lê Lợi',
      shippingWard: 'Phường Bến Nghé',
      shippingDistrict: 'Quận 1',
      shippingCity: 'Hồ Chí Minh',
      shippingAmount: SHIPPING,
      shippingMethodName:
        options.shippingMethodName === undefined
          ? 'Giao hàng tiêu chuẩn'
          : options.shippingMethodName,
    },
  });
  await prisma.orderItem.create({
    data: { tenantId, orderId: order.id, productVariantId: variantId, quantity: 2, price: UNIT },
  });
  if (options.paymentStatus) {
    await prisma.payment.create({
      data: {
        tenantId,
        orderId: order.id,
        status: options.paymentStatus,
        provider: options.paymentMethod === 'cod' ? 'cod' : 'momo',
        providerOrderId: `po-${randomUUID()}`,
        amount: 2 * UNIT + SHIPPING,
        providerMetadata: { secret: `LEAK-${suffix}`, signature: 'deadbeef' },
      },
    });
  }
  return order.id;
}

before(async () => {
  suffix = randomUUID().slice(0, 8);
  const a = await provision('a');
  const b = await provision('b');
  tenantA = a.tenant;
  tenantB = b.tenant;
  variantA = a.variantId;
  variantB = b.variantId;
});

after(async () => {
  const ids = [tenantA.id, tenantB.id];
  await prisma.orderItem.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.payment.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.order.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.inventory.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.productVariant.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.product.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.location.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
});

// ---------- the classifier ----------

test('terminal order statuses are used as-is, never renamed', () => {
  assert.equal(
    classifyOrder({
      orderStatus: 'fulfilled',
      paymentMethod: 'cod',
      paymentStatus: 'pending',
      hasShippingMethod: true,
    }).category,
    'fulfilled',
  );
  assert.equal(
    classifyOrder({
      orderStatus: 'cancelled',
      paymentMethod: 'momo',
      paymentStatus: 'failed',
      hasShippingMethod: false,
    }).category,
    'cancelled',
    'cancellation wins over any blocker',
  );
  // No shipped/delivered anywhere.
  for (const label of Object.values(CATEGORY_LABEL)) {
    assert.ok(!/shipped|delivered|in transit/i.test(label), `"${label}" invents shipment state`);
  }
});

test('COD is not reported as a payment problem', () => {
  const cod = classifyOrder({
    orderStatus: 'pending',
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    hasShippingMethod: true,
  });
  assert.equal(cod.category, 'ready_to_fulfill', 'a pending COD payment is normal');
  assert.deepEqual(cod.blockers, []);
});

test('a prepaid order must actually be paid before it is ready', () => {
  const unpaid = classifyOrder({
    orderStatus: 'pending',
    paymentMethod: 'momo',
    paymentStatus: 'pending',
    hasShippingMethod: true,
  });
  assert.equal(unpaid.category, 'needs_payment');
  assert.deepEqual(unpaid.blockers, [], 'awaiting payment is not a blocker, it is a stage');

  const paid = classifyOrder({
    orderStatus: 'pending',
    paymentMethod: 'momo',
    paymentStatus: 'succeeded',
    hasShippingMethod: true,
  });
  assert.equal(paid.category, 'ready_to_fulfill');
});

test('dead payments and a missing shipping method are named blockers', () => {
  for (const [status, reason] of [
    ['failed', 'payment_failed'],
    ['expired', 'payment_expired'],
    ['cancelled', 'payment_cancelled'],
  ] as const) {
    const result = classifyOrder({
      orderStatus: 'pending',
      paymentMethod: 'momo',
      paymentStatus: status,
      hasShippingMethod: true,
    });
    assert.equal(result.category, 'needs_review');
    assert.deepEqual(result.blockers, [reason]);
  }

  const noShipping = classifyOrder({
    orderStatus: 'pending',
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    hasShippingMethod: false,
  });
  assert.equal(noShipping.category, 'needs_review');
  assert.deepEqual(noShipping.blockers, ['no_shipping_method']);
});

test('multiple blockers are all reported, not just the first', () => {
  const result = classifyOrder({
    orderStatus: 'pending',
    paymentMethod: 'momo',
    paymentStatus: 'failed',
    hasShippingMethod: false,
  });
  assert.deepEqual(result.blockers, ['no_shipping_method', 'payment_failed']);
});

test('an order with no payment row at all is handled without guessing', () => {
  // Pre-Payment-row orders: COD is still ready, prepaid still awaits.
  assert.equal(
    classifyOrder({
      orderStatus: 'pending',
      paymentMethod: 'cod',
      paymentStatus: null,
      hasShippingMethod: true,
    }).category,
    'ready_to_fulfill',
  );
  assert.equal(
    classifyOrder({
      orderStatus: 'pending',
      paymentMethod: 'momo',
      paymentStatus: null,
      hasShippingMethod: true,
    }).category,
    'needs_payment',
  );
});

test('the category set offers nothing the data cannot prove', () => {
  for (const invented of [
    'shipped',
    'delivered',
    'in_transit',
    'returned',
    'refunded',
    'picked_up',
  ]) {
    assert.ok(
      !(FULFILLMENT_CATEGORIES as readonly string[]).includes(invented),
      `${invented} must not be a category`,
    );
  }
  for (const bad of ['', 'shipped', 'DROP TABLE', undefined]) {
    assert.equal(isFulfillmentCategory(bad), false);
  }
});

test('inventory is deliberately not a blocker, with the reason recorded', () => {
  const code = source('../src/lib/fulfillment-queue.ts');
  assert.match(code, /INVENTORY IS DELIBERATELY NOT A BLOCKER/);
  // The comment wraps, so match across the line break.
  assert.match(code, /reserves stock[\s\S]{0,20}inside the order's own transaction/);

  // And no inventory table is read anywhere in the CODE — the prose
  // above legitimately discusses it at length.
  const body = code.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(body, /inventory/i, 'no inventory is queried');
});

// ---------- end to end against the database ----------

test('each seeded state lands in the category the classifier promises', async () => {
  const ready = await makeOrder(tenantA.id, variantA, {
    label: 'ready',
    orderStatus: 'pending',
    paymentMethod: 'cod',
    paymentStatus: 'pending',
  });
  const awaiting = await makeOrder(tenantA.id, variantA, {
    label: 'awaiting',
    orderStatus: 'pending',
    paymentMethod: 'momo',
    paymentStatus: 'pending',
  });
  const review = await makeOrder(tenantA.id, variantA, {
    label: 'review',
    orderStatus: 'pending',
    paymentMethod: 'momo',
    paymentStatus: 'failed',
  });
  const noShip = await makeOrder(tenantA.id, variantA, {
    label: 'noship',
    orderStatus: 'pending',
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    shippingMethodName: null,
  });
  const done = await makeOrder(tenantA.id, variantA, {
    label: 'done',
    orderStatus: 'fulfilled',
    paymentMethod: 'cod',
    paymentStatus: 'pending',
  });
  const gone = await makeOrder(tenantA.id, variantA, {
    label: 'gone',
    orderStatus: 'cancelled',
    paymentMethod: 'momo',
    paymentStatus: 'cancelled',
  });

  const { rows } = await listFulfillmentQueue(tenantA.id);
  const byRef = new Map(rows.map((row) => [row.reference, row]));

  assert.equal(byRef.get(ready)?.category, 'ready_to_fulfill');
  assert.equal(byRef.get(awaiting)?.category, 'needs_payment');
  assert.equal(byRef.get(review)?.category, 'needs_review');
  assert.deepEqual(byRef.get(review)?.blockers, ['payment_failed']);
  assert.equal(byRef.get(noShip)?.category, 'needs_review');
  assert.deepEqual(byRef.get(noShip)?.blockers, ['no_shipping_method']);
  assert.equal(byRef.get(done)?.category, 'fulfilled');
  assert.equal(byRef.get(gone)?.category, 'cancelled');
});

test('the total uses the same items-plus-shipping rule as everywhere else', async () => {
  const { rows } = await listFulfillmentQueue(tenantA.id);
  for (const row of rows) {
    assert.equal(row.total, 2 * UNIT + SHIPPING);
  }
});

test('summary counts cover the whole tenant and match the classifier', async () => {
  const summary = await getFulfillmentSummary(tenantA.id);
  assert.equal(summary.ready_to_fulfill, 1);
  assert.equal(summary.needs_payment, 1);
  assert.equal(summary.needs_review, 2, 'failed payment and missing shipping method');
  assert.equal(summary.fulfilled, 1);
  assert.equal(summary.cancelled, 1);

  const total = Object.values(summary).reduce((sum, n) => sum + n, 0);
  assert.equal(total, await prisma.order.count({ where: { tenantId: tenantA.id } }));
});

test('the destination is coarse — district and city, never the street', async () => {
  const { rows } = await listFulfillmentQueue(tenantA.id);
  assert.equal(rows[0].destination, 'Quận 1, Hồ Chí Minh');
  assert.ok(!rows[0].destination.includes('Lê Lợi'), 'the street address is not in the list');
  assert.ok(!JSON.stringify(rows).includes('Phường Bến Nghé'), 'nor the ward');
});

// ---------- isolation and privacy ----------

test("TENANT ISOLATION — tenant B's orders never reach tenant A", async () => {
  await makeOrder(tenantB.id, variantB, {
    label: 'bravo',
    orderStatus: 'pending',
    paymentMethod: 'cod',
    paymentStatus: 'pending',
  });

  const a = await listFulfillmentQueue(tenantA.id);
  assert.ok(!a.rows.some((row) => row.customerName.includes('bravo')));

  const aSummary = await getFulfillmentSummary(tenantA.id);
  assert.equal(
    Object.values(aSummary).reduce((sum, n) => sum + n, 0),
    await prisma.order.count({ where: { tenantId: tenantA.id } }),
    "B's order does not inflate A's counts",
  );
});

test("tenant A cannot find tenant B's order by reference or phone", async () => {
  const bOrder = await prisma.order.findFirstOrThrow({
    where: { tenantId: tenantB.id },
    include: { customer: true },
  });
  const byRef = await listFulfillmentQueue(tenantA.id, { search: bOrder.id });
  assert.equal(byRef.rows.length, 0);
  assert.equal(byRef.totalCount, 0);

  const byPhone = await listFulfillmentQueue(tenantA.id, { search: bOrder.customer.phone });
  assert.equal(byPhone.rows.length, 0);
});

test('no provider metadata, webhook payload or internal id leaks', async () => {
  const result = await listFulfillmentQueue(tenantA.id);
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    `LEAK-${suffix}`,
    'deadbeef',
    'providerMetadata',
    'providerOrderId',
    'tenantId',
    'customerId',
    'productVariantId',
    tenantA.id,
  ]) {
    assert.ok(!serialized.includes(forbidden), `${forbidden} must not appear`);
  }
});

test('the module performs no write', () => {
  const code = source('../src/lib/fulfillment-queue.ts')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  for (const forbidden of [/\.create\(/, /\.update\(/, /\.delete\(/, /\$executeRaw/]) {
    assert.doesNotMatch(code, forbidden, 'the workspace is read-only');
  }
});

// ---------- filters, search, pagination ----------

test('the category filter narrows, and an unknown value does not widen', async () => {
  const review = await listFulfillmentQueue(tenantA.id, { category: 'needs_review' });
  assert.ok(review.rows.length >= 2);
  for (const row of review.rows) assert.equal(row.category, 'needs_review');

  // The page resolves an unknown value to undefined before it gets here.
  const page = source('../src/app/tenant-admin/fulfillment/page.tsx');
  assert.match(page, /isFulfillmentCategory\(params\.category\) \? params\.category : undefined/);
});

test('search and filter compose and stay tenant-scoped', async () => {
  const { rows } = await listFulfillmentQueue(tenantA.id, { search: 'Nguyễn ready' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, 'ready_to_fulfill');
});

test('pagination is bounded and deterministic', async () => {
  const first = await listFulfillmentQueue(tenantA.id, { page: 1 });
  const again = await listFulfillmentQueue(tenantA.id, { page: 1 });
  assert.deepEqual(
    first.rows.map((r) => r.reference),
    again.rows.map((r) => r.reference),
  );
  assert.ok(first.rows.length <= FULFILLMENT_PAGE_SIZE);

  const code = source('../src/lib/fulfillment-queue.ts');
  assert.match(code, /orderBy: \[\{ createdAt: 'desc' \}, \{ id: 'desc' \}\]/);
});

test('the query does not fan out per order', () => {
  const code = source('../src/lib/fulfillment-queue.ts');
  assert.match(code, /Promise\.all\(\[/);
  assert.match(code, /items: \{ select: \{ price: true, quantity: true \} \}/);
  assert.doesNotMatch(code, /for \([^)]*\)\s*\{[\s\S]{0,200}await db\./, 'no await inside a loop');
});

test('the summary groups by state combination rather than scanning orders', () => {
  const code = source('../src/lib/fulfillment-queue.ts');
  assert.match(code, /GROUP BY 1, 2, 3, 4/);
  assert.match(code, /o\."tenantId" = \$1/, 'the tenant is bound, not interpolated');
  assert.match(code, /classifyOrder\(\{/, 'the same classifier is reused on each combination');
});

// ---------- UI structure ----------

test('the page uses the shared shell and adds no landmark', () => {
  const page = source('../src/app/tenant-admin/fulfillment/page.tsx');
  assert.match(page, /<AdminPageHeader/);
  assert.doesNotMatch(page, /<h1/);
  assert.doesNotMatch(page, /<main/);
  assert.match(page, /requireTenantAdmin\(\)/);
  assert.match(page, /export const dynamic = 'force-dynamic'/);
  assert.match(page, /export const revalidate = 0/);
});

test('no mutation exists on the page', () => {
  const page = source('../src/app/tenant-admin/fulfillment/page.tsx');
  assert.doesNotMatch(page, /ActionForm|ConfirmActionForm|action=\{/);
  for (const forbidden of [/mark as shipped/i, /assign carrier/i, /add tracking/i]) {
    assert.doesNotMatch(page, forbidden);
  }
});

test('links to orders and print documents are precisely named', () => {
  const page = source('../src/app/tenant-admin/fulfillment/page.tsx');
  assert.match(page, /aria-label=\{`Open order \$\{row\.reference\}`\}/);
  assert.match(page, /aria-label=\{`Print packing slip for order \$\{row\.reference\}`\}/);
  assert.match(page, /aria-label=\{`Print shipping note for order \$\{row\.reference\}`\}/);
});

test('the page states what it is not', () => {
  const page = source('../src/app/tenant-admin/fulfillment/page.tsx');
  assert.match(page, /internal queue, not a shipment or carrier system/);
  assert.match(page, /no tracking number/);
  assert.match(page, /inventory is not shown as a blocker/);
});

test('filter controls carry visible labels', () => {
  const page = source('../src/app/tenant-admin/fulfillment/page.tsx');
  assert.match(page, /aria-label="Filter the fulfillment queue"/);
  assert.ok(page.includes('Category') && page.includes('Search'));
});
