// Operational analytics: metric arithmetic, tenant isolation and the
// claims the page must never make.
//
// Isolated tenants are provisioned and deleted by this file. Existing QA
// data is never read as a fixture and never modified: every assertion
// compares against rows this file created, so a figure can be checked
// against the raw facts rather than against another query.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { prisma } from '../src/lib/prisma';
import { getOperationalMetrics } from '../src/lib/analytics/operational-metrics';
import { resolveAnalyticsRange } from '../src/lib/analytics/date-range';
import { LOW_STOCK_THRESHOLD } from '../src/lib/inventory-availability';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = (relative: string) => readFileSync(join(root, relative), 'utf8');

const UNIT = 100_000;
const SHIPPING = 20_000;

/** A window the fixtures sit inside, far from any real QA data. */
const FROM = '2026-06-01';
const TO = '2026-06-30';
const RANGE = resolveAnalyticsRange({ from: FROM, to: TO });
/** Local noon on 15 June 2026 (UTC+7), comfortably inside the range. */
const IN_RANGE = new Date('2026-06-15T05:00:00.000Z');
/** Local noon on 15 January 2026 — a different year's month, far outside. */
const OUT_OF_RANGE = new Date('2026-01-15T05:00:00.000Z');

let tenantA: string;
let tenantB: string;
let variantA: string;
let variantB: string;
let locationA: string;
let suffix: string;

async function provision(label: string) {
  const tenant = await prisma.tenant.create({
    data: { slug: `test-anl-${label}-${suffix}`, name: `Anl ${label}`, status: 'active' },
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
      onHand: 50,
      reserved: 0,
    },
  });
  return { id: tenant.id, variantId: variant.id, locationId: location.id };
}

async function seedOrder(options: {
  tenantId: string;
  variantId: string;
  customerId: string;
  status: 'pending' | 'fulfilled' | 'cancelled';
  quantity: number;
  createdAt: Date;
  paymentMethod?: 'cod' | 'momo' | 'bank_transfer';
  payment?: { status: 'pending' | 'succeeded' | 'failed' | 'expired' | 'cancelled' };
}) {
  const order = await prisma.order.create({
    data: {
      tenantId: options.tenantId,
      customerId: options.customerId,
      status: options.status,
      paymentMethod: options.paymentMethod ?? 'cod',
      shippingAddress: '1 Lê Lợi',
      shippingWard: 'Bến Nghé',
      shippingDistrict: 'Quận 1',
      shippingCity: 'Hồ Chí Minh',
      shippingAmount: SHIPPING,
      shippingMethodName: 'Giao hàng tiêu chuẩn',
      createdAt: options.createdAt,
    },
  });
  await prisma.orderItem.create({
    data: {
      tenantId: options.tenantId,
      orderId: order.id,
      productVariantId: options.variantId,
      quantity: options.quantity,
      price: UNIT,
    },
  });
  if (options.payment) {
    await prisma.payment.create({
      data: {
        tenantId: options.tenantId,
        orderId: order.id,
        status: options.payment.status,
        provider: 'cod',
        providerOrderId: `anl-${randomUUID()}`,
        amount: UNIT * options.quantity + SHIPPING,
        createdAt: options.createdAt,
      },
    });
  }
  return order.id;
}

async function seedCustomer(tenantId: string, label: string, createdAt: Date) {
  const customer = await prisma.customer.create({
    data: {
      tenantId,
      name: `Khách ${label}`,
      email: `anl-${label}-${suffix}@example.com`,
      phone: '0912345678',
      createdAt,
    },
  });
  return customer.id;
}

before(async () => {
  suffix = randomUUID().slice(0, 8);
  const a = await provision('a');
  const b = await provision('b');
  tenantA = a.id;
  tenantB = b.id;
  variantA = a.variantId;
  variantB = b.variantId;
  locationA = a.locationId;

  // --- Tenant A, inside the range ---
  // c1: two orders (a repeat customer), one of them cancelled.
  const c1 = await seedCustomer(tenantA, 'one', IN_RANGE);
  await seedOrder({
    tenantId: tenantA,
    variantId: variantA,
    customerId: c1,
    status: 'fulfilled',
    quantity: 2,
    createdAt: IN_RANGE,
    payment: { status: 'succeeded' },
  });
  await seedOrder({
    tenantId: tenantA,
    variantId: variantA,
    customerId: c1,
    status: 'cancelled',
    quantity: 5,
    createdAt: IN_RANGE,
    payment: { status: 'cancelled' },
  });

  // c2: one pending COD order, payment left pending — the normal COD shape.
  const c2 = await seedCustomer(tenantA, 'two', IN_RANGE);
  await seedOrder({
    tenantId: tenantA,
    variantId: variantA,
    customerId: c2,
    status: 'pending',
    quantity: 1,
    createdAt: IN_RANGE,
    payment: { status: 'pending' },
  });

  // c3: a customer with no orders at all.
  await seedCustomer(tenantA, 'three', IN_RANGE);

  // c4: created and ordering OUTSIDE the range.
  const c4 = await seedCustomer(tenantA, 'four', OUT_OF_RANGE);
  await seedOrder({
    tenantId: tenantA,
    variantId: variantA,
    customerId: c4,
    status: 'fulfilled',
    quantity: 9,
    createdAt: OUT_OF_RANGE,
    payment: { status: 'succeeded' },
  });

  // --- Tenant B: deliberately LARGER, to prove it cannot leak into A ---
  const b1 = await seedCustomer(tenantB, 'bee', IN_RANGE);
  for (let i = 0; i < 4; i += 1) {
    await seedOrder({
      tenantId: tenantB,
      variantId: variantB,
      customerId: b1,
      status: 'fulfilled',
      quantity: 100,
      createdAt: IN_RANGE,
      payment: { status: 'succeeded' },
    });
  }

  await prisma.paymentRejection.create({
    data: {
      tenantId: tenantA,
      provider: 'bank_transfer_sepay_va',
      dedupeKey: `anl-${suffix}-1`,
      reason: 'amount_mismatch',
      payloadDigest: 'a'.repeat(64),
      expectedAmount: 220_000,
      reportedAmount: 100_000,
      firstSeenAt: IN_RANGE,
      lastSeenAt: IN_RANGE,
    },
  });
  await prisma.paymentRejection.create({
    data: {
      tenantId: tenantB,
      provider: 'bank_transfer_sepay_va',
      dedupeKey: `anl-${suffix}-2`,
      reason: 'amount_mismatch',
      payloadDigest: 'b'.repeat(64),
      firstSeenAt: IN_RANGE,
      lastSeenAt: IN_RANGE,
    },
  });
});

after(async () => {
  const ids = [tenantA, tenantB];
  await prisma.paymentRejection.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.payment.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.orderItem.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.order.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.inventory.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.productVariant.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.product.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.location.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
});

// ---------- order arithmetic ----------

test('order status counts match the seeded rows exactly', async () => {
  const m = await getOperationalMetrics(tenantA, RANGE);
  const byStatus = Object.fromEntries(m.ordersByStatus.map((r) => [r.key, r.count]));

  assert.deepEqual(byStatus, { pending: 1, fulfilled: 1, cancelled: 1 });
  assert.equal(m.ordersTotal, 3, 'cancelled orders ARE counted in the order total');
});

test('every status appears even at zero, so absence is never ambiguous', async () => {
  const m = await getOperationalMetrics(tenantA, RANGE);
  assert.deepEqual(
    m.ordersByStatus.map((r) => r.key),
    ['pending', 'fulfilled', 'cancelled'],
  );
  assert.deepEqual(
    m.paymentsByStatus.map((r) => r.key),
    ['pending', 'succeeded', 'failed', 'expired', 'cancelled'],
  );
});

test('ORDER VALUE excludes cancelled, includes shipping, includes unpaid', async () => {
  const m = await getOperationalMetrics(tenantA, RANGE);

  // Fulfilled: 2 × 100_000 + 20_000 = 220_000
  // Pending (unpaid COD): 1 × 100_000 + 20_000 = 120_000
  // Cancelled (5 × 100_000 + 20_000 = 520_000) must NOT appear.
  assert.equal(m.orderValue, 340_000);
  assert.equal(m.orderValueOrderCount, 2, 'two non-cancelled orders');

  // Stated as arithmetic against the raw facts, not against another query.
  const itemsAndShipping = 2 * UNIT + SHIPPING + (1 * UNIT + SHIPPING);
  assert.equal(m.orderValue, itemsAndShipping);
});

test('shipping is part of order value', async () => {
  const m = await getOperationalMetrics(tenantA, RANGE);
  const itemsOnly = 2 * UNIT + 1 * UNIT;
  assert.equal(m.orderValue - itemsOnly, 2 * SHIPPING, 'exactly two shipping amounts');
});

test('an unpaid order still contributes to order value — it is not revenue', async () => {
  const m = await getOperationalMetrics(tenantA, RANGE);
  // The pending COD order has a pending payment and is still counted.
  assert.ok(m.orderValue >= 1 * UNIT + SHIPPING);
  const pending = m.paymentsByStatus.find((r) => r.key === 'pending');
  assert.equal(pending?.count, 1, 'and its payment really is pending');
});

// ---------- date boundaries ----------

test('orders outside the range are excluded', async () => {
  const m = await getOperationalMetrics(tenantA, RANGE);
  // The out-of-range order is 9 units; if it leaked in, value would jump.
  assert.equal(m.ordersTotal, 3);
  assert.ok(m.orderValue < 9 * UNIT, 'the January order did not leak in');

  const wider = resolveAnalyticsRange({ from: '2026-01-01', to: '2026-06-30' });
  const widened = await getOperationalMetrics(tenantA, wider);
  assert.equal(widened.ordersTotal, 4, 'widening the range does include it');
});

test('a range boundary is half-open at both the query and the resolver', async () => {
  // A range ending the day BEFORE the fixture must exclude it entirely.
  const before = resolveAnalyticsRange({ from: '2026-06-01', to: '2026-06-14' });
  const m = await getOperationalMetrics(tenantA, before);
  assert.equal(m.ordersTotal, 0);
  assert.equal(m.orderValue, 0);

  // A range starting exactly on the fixture's local day includes it.
  const onTheDay = resolveAnalyticsRange({ from: '2026-06-15', to: '2026-06-15' });
  const onDay = await getOperationalMetrics(tenantA, onTheDay);
  assert.equal(onDay.ordersTotal, 3);
});

// ---------- payments ----------

test('payment status counts match the seeded payments', async () => {
  const m = await getOperationalMetrics(tenantA, RANGE);
  const byStatus = Object.fromEntries(m.paymentsByStatus.map((r) => [r.key, r.count]));

  assert.deepEqual(byStatus, {
    pending: 1,
    succeeded: 1,
    failed: 0,
    expired: 0,
    cancelled: 1,
  });
  assert.equal(m.paymentsTotal, 3);
});

test('a pending COD payment is reported as pending, never as collected or failed', async () => {
  const m = await getOperationalMetrics(tenantA, RANGE);
  const pending = m.paymentsByStatus.find((r) => r.key === 'pending');
  const failed = m.paymentsByStatus.find((r) => r.key === 'failed');

  assert.equal(pending?.count, 1, 'the COD payment stays pending');
  assert.equal(failed?.count, 0, 'and is NOT counted as a failure');

  // There is no field that could claim collection.
  assert.ok(!Object.keys(m).some((key) => /collected|settled|received/i.test(key)));
});

// ---------- rejections ----------

test('rejection counts are tenant-attributed and use the real reason set', async () => {
  const m = await getOperationalMetrics(tenantA, RANGE);
  assert.equal(m.rejectionsTotal, 1, "tenant B's rejection is not counted");

  assert.deepEqual(
    m.rejectionsByReason.map((r) => r.key),
    ['amount_mismatch', 'unknown_payment', 'invalid_payload'],
    'exactly the three values the schema declares, no invented reasons',
  );
  assert.equal(m.rejectionsByReason.find((r) => r.key === 'amount_mismatch')?.count, 1);
});

test('no rejection projection carries a digest, dedupe key or raw payload', async () => {
  const m = await getOperationalMetrics(tenantA, RANGE);
  const serialized = JSON.stringify(m);
  for (const secret of [
    'a'.repeat(64),
    'b'.repeat(64),
    `anl-${suffix}-1`,
    'dedupeKey',
    'payloadDigest',
  ]) {
    assert.ok(!serialized.includes(secret), `${secret} must not reach the projection`);
  }
});

// ---------- customers ----------

test('customer counts separate "created in range" from current totals', async () => {
  const m = await getOperationalMetrics(tenantA, RANGE);

  assert.equal(m.customersCreated, 3, 'c1, c2, c3 — not c4, who predates the range');
  assert.equal(m.snapshot.customersTotal, 4, 'the snapshot is as of now, not range-scoped');
});

test('repeat customers are a count of stored orders, not a segment', async () => {
  const m = await getOperationalMetrics(tenantA, RANGE);

  // c1 has two orders, c2 one, c3 none, c4 one.
  assert.equal(m.snapshot.customersWithOrders, 3);
  assert.equal(m.snapshot.customersWithRepeatOrders, 1, 'only c1 has two or more');

  // A cancelled order still counts toward "has ordered" — c1's second
  // order is cancelled and c1 is still a repeat customer by this rule.
  assert.ok(m.snapshot.customersWithRepeatOrders <= m.snapshot.customersWithOrders);
});

// ---------- inventory ----------

test('inventory semantics are on hand, reserved, and available as the difference', async () => {
  const product = await prisma.product.create({
    data: { tenantId: tenantA, name: 'Stock probe', status: 'draft' },
  });
  const zero = await prisma.productVariant.create({
    data: { tenantId: tenantA, productId: product.id, price: UNIT, combinationKey: 'z' },
  });
  const low = await prisma.productVariant.create({
    data: { tenantId: tenantA, productId: product.id, price: UNIT, combinationKey: 'l' },
  });
  // Available 0: fully reserved, though on hand is not zero.
  await prisma.inventory.create({
    data: {
      tenantId: tenantA,
      productVariantId: zero.id,
      locationId: locationA,
      onHand: 4,
      reserved: 4,
    },
  });
  // Available exactly at the threshold, which is inclusive.
  await prisma.inventory.create({
    data: {
      tenantId: tenantA,
      productVariantId: low.id,
      locationId: locationA,
      onHand: LOW_STOCK_THRESHOLD,
      reserved: 0,
    },
  });

  const m = await getOperationalMetrics(tenantA, RANGE);

  assert.equal(m.snapshot.variantsOutOfStock, 1, 'reserved stock is not available stock');
  assert.equal(m.snapshot.variantsLowStock, 1, 'the threshold boundary counts as low');
  assert.equal(m.snapshot.lowStockThreshold, LOW_STOCK_THRESHOLD);
  assert.equal(m.snapshot.onHandUnits, 50 + 4 + LOW_STOCK_THRESHOLD);
  assert.equal(m.snapshot.reservedUnits, 4);

  assert.equal(m.snapshot.draftProducts, 1);
  assert.equal(m.snapshot.activeProducts, 1);

  await prisma.inventory.deleteMany({ where: { productVariantId: { in: [zero.id, low.id] } } });
  await prisma.productVariant.deleteMany({ where: { id: { in: [zero.id, low.id] } } });
  await prisma.product.delete({ where: { id: product.id } });
});

// ---------- isolation ----------

test('TENANT ISOLATION — a larger tenant B never affects tenant A', async () => {
  const a = await getOperationalMetrics(tenantA, RANGE);
  const b = await getOperationalMetrics(tenantB, RANGE);

  // B is deliberately much bigger: 4 orders of 100 units each.
  assert.equal(b.ordersTotal, 4);
  assert.equal(b.orderValue, 4 * (100 * UNIT + SHIPPING));

  // A is unchanged by B's existence.
  assert.equal(a.ordersTotal, 3);
  assert.equal(a.orderValue, 340_000);
  assert.ok(a.orderValue < b.orderValue);

  assert.equal(a.snapshot.customersTotal, 4);
  assert.equal(b.snapshot.customersTotal, 1);
  assert.equal(a.rejectionsTotal, 1);
  assert.equal(b.rejectionsTotal, 1);
});

test('an unknown tenant id returns zeroes, not another tenant and not an error', async () => {
  const m = await getOperationalMetrics(randomUUID(), RANGE);
  assert.equal(m.ordersTotal, 0);
  assert.equal(m.orderValue, 0);
  assert.equal(m.paymentsTotal, 0);
  assert.equal(m.rejectionsTotal, 0);
  assert.equal(m.snapshot.customersTotal, 0);
  assert.equal(m.snapshot.onHandUnits, 0);
});

test('an empty tenant renders every figure as zero rather than undefined', async () => {
  const empty = await prisma.tenant.create({
    data: { slug: `test-anl-empty-${suffix}`, name: 'Empty', status: 'active' },
  });
  try {
    const m = await getOperationalMetrics(empty.id, RANGE);
    assert.equal(m.ordersTotal, 0);
    assert.equal(m.orderValue, 0);
    assert.equal(m.orderValueOrderCount, 0);
    for (const row of [...m.ordersByStatus, ...m.paymentsByStatus, ...m.rejectionsByReason]) {
      assert.equal(row.count, 0);
      assert.equal(typeof row.count, 'number');
    }
    for (const value of Object.values(m.snapshot)) {
      assert.equal(typeof value, 'number');
      assert.ok(Number.isFinite(value));
    }
  } finally {
    await prisma.tenant.delete({ where: { id: empty.id } });
  }
});

test('repeated identical requests return identical results', async () => {
  const first = await getOperationalMetrics(tenantA, RANGE);
  const second = await getOperationalMetrics(tenantA, RANGE);
  assert.deepEqual(first, second);
});

// ---------- query shape ----------

test('the metrics module performs no row-by-row aggregation over tenant data', () => {
  const src = source('src/lib/analytics/operational-metrics.ts')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  // findMany would mean loading rows to count them, which is the exact
  // pattern this page must not repeat.
  assert.ok(!/\.findMany\s*\(/.test(src), 'no findMany: every figure must be an aggregate');

  // Each raw query must bind tenantId rather than interpolate it.
  for (const match of src.matchAll(/\$queryRawUnsafe<[\s\S]*?`([\s\S]*?)`/g)) {
    const sql = match[1];
    assert.ok(
      /"tenantId"\s*=\s*\$1/.test(sql),
      `a raw query is missing its tenant predicate: ${sql.slice(0, 80)}`,
    );
    assert.ok(!/\$\{/.test(sql), 'no template interpolation may reach SQL');
  }
});

test('the number of queries is fixed, not proportional to the data', () => {
  const src = source('src/lib/analytics/operational-metrics.ts');
  // One Promise.all, and no await inside a loop.
  assert.match(src, /Promise\.all\(\[/);
  assert.ok(!/for\s*\([^)]*\)\s*\{[^}]*await /.test(src), 'no awaited query inside a loop');
});

test('no provider metadata, payload or internal id reaches the projection', async () => {
  const m = await getOperationalMetrics(tenantA, RANGE);
  const serialized = JSON.stringify(m);

  for (const forbidden of [tenantA, tenantB, variantA, variantB, locationA]) {
    assert.ok(!serialized.includes(forbidden), 'no internal id may appear in the projection');
  }
  for (const key of [
    'providerMetadata',
    'rawPayload',
    'providerOrderId',
    'providerTransactionId',
  ]) {
    assert.ok(!serialized.includes(key), `${key} must not appear`);
  }
});

// ---------- unsupported claims ----------

test('the metrics module claims no revenue, settlement, delivery, profit or collection', () => {
  const src = source('src/lib/analytics/operational-metrics.ts');
  const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  for (const forbidden of [
    /\brevenue\b/i,
    /\bnetSales\b/i,
    /\bsettled\b/i,
    /\bsettlement\b/i,
    /\bprofit\b/i,
    /\bmargin\b/i,
    /\bdelivered\b/i,
    /\bcollected\b/i,
    /\brefund/i,
    /\bconsent\b/i,
    /\bconversion\b/i,
    /\bchurn\b/i,
    /\bVIP\b/i,
    /\bloyalty\b/i,
    /\blifetime\b/i,
  ]) {
    assert.ok(!forbidden.test(code), `${forbidden} must not appear in analytics code`);
  }

  // And the doc comment must say so rather than leaving it implicit.
  assert.match(src, /NOT revenue/);
});

test('no metric on the page is LABELLED as revenue, profit or settlement', () => {
  const page = source('src/app/tenant-admin/analytics/page.tsx');

  // The page deliberately contains the sentence "It is not revenue, net
  // sales, cash received or profit", so a bare phrase match would flag
  // its own disclaimer. The real question is narrower: does any figure
  // CARRY one of those names? Metric labels and panel headings are the
  // text a merchant reads as the meaning of a number.
  const labels = [...page.matchAll(/\blabel="([^"]+)"/g)].map((m) => m[1]);
  const headings = [...page.matchAll(/\btitle="([^"]+)"/g)].map((m) => m[1]);
  const captions = [...page.matchAll(/\bcaption="([^"]+)"/g)].map((m) => m[1]);
  const named = [...labels, ...headings, ...captions];

  assert.ok(named.length >= 12, `expected the page's metric names, found ${named.length}`);

  for (const name of named) {
    for (const forbidden of [
      /revenue/i,
      /net sales/i,
      /cash/i,
      /settle/i,
      /profit/i,
      /margin/i,
      /collected/i,
      /delivered/i,
      /shipped/i,
      /refund/i,
      /conversion/i,
      /VIP/i,
      /loyalty/i,
      /lifetime/i,
    ]) {
      assert.ok(!forbidden.test(name), `metric named "${name}" claims ${forbidden}`);
    }
  }

  // The label that does exist must be the honest one, and the denial
  // must be present rather than merely implied.
  assert.ok(labels.includes('Order value'), 'order value is named as order value');
  assert.match(page, /not revenue/i);
  assert.match(page, /It is not revenue, net sales, cash received or profit/);
});

test('unmeasurable concepts appear ONLY inside the limitations section', () => {
  const page = source('src/app/tenant-admin/analytics/page.tsx');

  // The page names what it cannot tell you — deliberately, in one place.
  // So the test is not "does this word appear" (it must) but "does it
  // appear anywhere it could read as a claim". Everything outside the
  // limitations section is where a claim would live.
  const sectionStart = page.indexOf('id="not-measured"');
  assert.ok(sectionStart > 0, 'the limitations section must exist');
  const outside = page.slice(0, sectionStart);

  for (const forbidden of [
    /\brevenue\b/i,
    /\bprofit\b/i,
    /\bmargin\b/i,
    /\bconversion rate\b/i,
    /\bdelivery performance\b/i,
    /\bcarrier performance\b/i,
    /\brefund rate\b/i,
    /\bsell-through\b/i,
    /\bshrinkage\b/i,
    /\bforecast/i,
    /\bVAT\b/,
    /\bmarketing\b/i,
    /\bconsent\b/i,
  ]) {
    const hit = forbidden.exec(outside);
    if (!hit) continue;
    // One exception: an explicit denial attached to a figure is exactly
    // the wording this phase wants, so it must survive.
    const context = outside.slice(Math.max(0, hit.index - 120), hit.index + 40);
    assert.match(
      context,
      /\bnot\b|\bnever\b|\bcannot\b|\bdoes not\b/i,
      `${forbidden} appears outside the limitations section and outside a denial: ...${context.slice(-110)}`,
    );
  }

  // And the section really does name them, rather than being an empty
  // heading that makes the check above pass vacuously.
  const limitations = page.slice(sectionStart);
  for (const named of [
    'settlement',
    'COD cash collection',
    'profit',
    'margin',
    'conversion rate',
    'consent',
  ]) {
    assert.ok(limitations.includes(named), `the limitations section must name ${named}`);
  }
});

test('the page states the limits of each figure, not just the figure', () => {
  const page = source('src/app/tenant-admin/analytics/page.tsx');

  assert.match(page, /does not prove[\s\S]{0,80}bank account/i, 'succeeded is not settlement');
  assert.match(page, /COD order is normal/i, 'pending COD is not a failure');
  assert.match(page, /not reconciliation/i, 'rejection evidence is not reconciliation');
  assert.match(page, /What this page cannot tell you/, 'the limits are named explicitly');
});

// ---------- route and navigation ----------

test('the analytics page authorizes before reading any tenant data', () => {
  const page = source('src/app/tenant-admin/analytics/page.tsx');
  const authIndex = page.indexOf('await requireTenantAdmin()');
  const readIndex = page.indexOf('getOperationalMetrics(');

  assert.ok(authIndex > 0, 'the page must call requireTenantAdmin itself');
  assert.ok(readIndex > authIndex, 'authorization must come before the read');
  assert.match(page, /force-dynamic/, 'it must not be statically cached');
});

test('the page adds no second h1 and no second main landmark', () => {
  const page = source('src/app/tenant-admin/analytics/page.tsx');
  assert.ok(!/<h1/.test(page), 'the admin layout owns the h1');
  assert.ok(!/<main/.test(page), 'the admin layout owns the main landmark');
  assert.match(page, /<AdminPageHeader/, 'it uses the shared header');
});

test('analytics is reachable from the tenant admin navigation and nowhere else', () => {
  const nav = source('src/app/tenant-admin/AdminNav.tsx');
  assert.match(nav, /\["\/tenant-admin\/analytics", "Analytics"\]/);

  // No platform-admin surface gained a link to it.
  const platformDir = 'src/app/platform-admin';
  const files = (function collect(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(join(root, dir))) {
      const rel = `${dir}/${entry}`;
      if (statSync(join(root, rel)).isDirectory()) collect(rel, out);
      else if (/\.tsx?$/.test(entry)) out.push(rel);
    }
    return out;
  })(platformDir);

  for (const file of files) {
    assert.ok(
      !source(file).includes('/tenant-admin/analytics'),
      `${file} links to a tenant surface from platform admin`,
    );
  }
});

test('the help guide documents the new route with its limits', () => {
  const help = source('src/app/tenant-admin/help/help-content.ts');
  assert.match(help, /'\/tenant-admin\/analytics'/, 'the route is documented');
  assert.match(
    help,
    /KHÔNG phải doanh thu đã thu được/,
    'order value is not revenue, in Vietnamese',
  );
  assert.match(
    help,
    /không chứng minh tiền đã về tài khoản ngân hàng/,
    'succeeded is not settlement',
  );
});
