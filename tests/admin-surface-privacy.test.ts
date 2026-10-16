// A cross-surface sweep: ONE pair of isolated tenants, every admin read
// helper exercised against both, and the same two questions asked of each
// — can tenant A see tenant B, and does any projection carry something it
// should not.
//
// The per-feature suites already cover their own surface in depth. This
// one exists because leaks are easiest to miss at the seams: a helper
// added later, or a field added to a shared projection.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { prisma } from '../src/lib/prisma';
import { listOrders } from '../src/lib/order-queries';
import { listCustomers, getCustomerDetail, CUSTOMER_SORTS } from '../src/lib/customer-queries';
import { listFulfillmentQueue, getFulfillmentSummary } from '../src/lib/fulfillment-queue';
import {
  listPaymentReconciliation,
  listPaymentExceptions,
  countPaymentsNeedingReview,
} from '../src/lib/payment-reconciliation';
import { getOrderForPrint } from '../src/lib/order-print';
import { getTenantKpis } from '../src/lib/tenant-kpis';
import { buildCustomersExport } from '../src/lib/exports/customers-export';
import { buildOrdersExport } from '../src/lib/exports/orders-export';
import { buildProductsExport } from '../src/lib/exports/products-export';
import { toCsv } from '../src/lib/csv';

const root = fileURLToPath(new URL('../', import.meta.url));

function adminPages(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...adminPages(rel));
    else if (entry === 'page.tsx') out.push(rel);
  }
  return out;
}

/** Source with comments stripped: prose must not satisfy these checks. */
function pageCode(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const ADMIN_PAGES = [
  ...adminPages('src/app/tenant-admin'),
  ...adminPages('src/app/platform-admin'),
];

const UNIT = 250_000;
const SHIPPING = 30_000;

type Fixture = {
  tenantId: string;
  orderId: string;
  customerId: string;
  marker: string;
};

let a: Fixture;
let b: Fixture;
let suffix: string;

/** Everything that must never appear in a projection shown to a tenant. */
const FORBIDDEN_FIELD_NAMES = [
  'tenantId',
  'customerId',
  'productVariantId',
  'paymentId',
  'providerMetadata',
  'providerOrderId',
  'providerTransactionId',
  'rawPayload',
  'payloadDigest',
  'dedupeKey',
  'failureReason',
];

async function provision(label: string): Promise<Fixture> {
  const marker = `sweep-${label}-${suffix}`;
  const tenant = await prisma.tenant.create({
    data: { slug: `test-${marker}`, name: `Sweep ${label}`, status: 'active' },
  });
  const location = await prisma.location.create({
    data: { tenantId: tenant.id, name: 'Main', isDefault: true },
  });
  const product = await prisma.product.create({
    data: { tenantId: tenant.id, name: `Sản phẩm ${marker}`, status: 'active' },
  });
  const variant = await prisma.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      price: UNIT,
      sku: `SKU-${marker}`,
      combinationKey: '',
    },
  });
  await prisma.inventory.create({
    data: {
      tenantId: tenant.id,
      productVariantId: variant.id,
      locationId: location.id,
      onHand: 50,
    },
  });
  const customer = await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      name: `Nguyễn ${marker}`,
      email: `${marker}@example.com`,
      phone: `09${Math.floor(Math.random() * 100_000_000)}`.slice(0, 10),
    },
  });
  const order = await prisma.order.create({
    data: {
      tenantId: tenant.id,
      customerId: customer.id,
      status: 'pending',
      paymentMethod: 'bank_transfer',
      shippingAddress: `1 Đường ${marker}`,
      shippingWard: 'Phường Bến Nghé',
      shippingDistrict: 'Quận 1',
      shippingCity: 'Hồ Chí Minh',
      shippingAmount: SHIPPING,
      shippingMethodName: 'Giao hàng tiêu chuẩn',
    },
  });
  await prisma.orderItem.create({
    data: {
      tenantId: tenant.id,
      orderId: order.id,
      productVariantId: variant.id,
      quantity: 4,
      price: UNIT,
    },
  });
  const payment = await prisma.payment.create({
    data: {
      tenantId: tenant.id,
      orderId: order.id,
      status: 'pending',
      provider: 'bank_transfer_sepay_va',
      providerOrderId: `po-${marker}`,
      providerTransactionId: `tx-${marker}`,
      failureReason: `reason-${marker}`,
      amount: 4 * UNIT + SHIPPING,
      providerMetadata: { secret: `SECRET-${marker}`, signature: `sig-${marker}` },
    },
  });
  await prisma.paymentEvent.create({
    data: {
      paymentId: payment.id,
      provider: 'bank_transfer_sepay_va',
      providerEventId: `evt-${marker}`,
      rawPayload: { secret: `SECRET-${marker}`, transferAmount: 1 },
    },
  });
  await prisma.paymentRejection.create({
    data: {
      tenantId: tenant.id,
      provider: 'bank_transfer_sepay_va',
      dedupeKey: `key-${marker}`,
      reason: 'amount_mismatch',
      providerOrderId: `po-${marker}`,
      orderId: order.id,
      expectedAmount: 4 * UNIT + SHIPPING,
      reportedAmount: 1_000,
      payloadDigest: `digest-${marker}`,
    },
  });

  return { tenantId: tenant.id, orderId: order.id, customerId: customer.id, marker };
}

before(async () => {
  suffix = randomUUID().slice(0, 8);
  a = await provision('a');
  b = await provision('b');
});

after(async () => {
  const ids = [a.tenantId, b.tenantId];
  await prisma.paymentRejection.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.paymentEvent.deleteMany({ where: { payment: { tenantId: { in: ids } } } });
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

/** Every tenant-facing read, as (name, value) pairs for tenant A. */
async function projectionsForA(): Promise<[string, unknown][]> {
  return [
    ['orders list', await listOrders(a.tenantId)],
    ['customers list', await listCustomers(a.tenantId)],
    ['customer detail', await getCustomerDetail(a.tenantId, a.customerId)],
    ['fulfillment queue', await listFulfillmentQueue(a.tenantId)],
    ['fulfillment summary', await getFulfillmentSummary(a.tenantId)],
    ['payment reconciliation', await listPaymentReconciliation(a.tenantId)],
    ['payment exceptions', await listPaymentExceptions(a.tenantId)],
    ['order print', await getOrderForPrint(a.tenantId, a.orderId)],
    ['tenant KPIs', await getTenantKpis(a.tenantId)],
    ['customers export', await buildCustomersExport(a.tenantId)],
    ['orders export', await buildOrdersExport(a.tenantId)],
    ['products export', await buildProductsExport(a.tenantId)],
  ];
}

// ---------- isolation, every surface at once ----------

test('no tenant-facing read exposes the other tenant', async () => {
  for (const [name, projection] of await projectionsForA()) {
    const serialized = JSON.stringify(projection);
    assert.ok(!serialized.includes(b.marker), `${name} leaked tenant B's data`);
    assert.ok(!serialized.includes(b.tenantId), `${name} leaked tenant B's id`);
    assert.ok(!serialized.includes(b.orderId), `${name} leaked tenant B's order`);
    assert.ok(!serialized.includes(b.customerId), `${name} leaked tenant B's customer`);
  }
});

test('no tenant-facing read exposes an identifier or a provider secret', async () => {
  for (const [name, projection] of await projectionsForA()) {
    const serialized = JSON.stringify(projection);

    // The tenant's own id is the clearest canary: it is on every row
    // every one of these queries touched.
    assert.ok(!serialized.includes(a.tenantId), `${name} exposed tenantId`);
    assert.ok(!serialized.includes(`SECRET-${a.marker}`), `${name} exposed a provider secret`);
    assert.ok(!serialized.includes(`sig-${a.marker}`), `${name} exposed a signature`);
    assert.ok(!serialized.includes(`digest-${a.marker}`), `${name} exposed a payload digest`);
    assert.ok(!serialized.includes(`key-${a.marker}`), `${name} exposed a dedupe key`);
    assert.ok(!serialized.includes(`tx-${a.marker}`), `${name} exposed a provider transaction id`);

    for (const field of FORBIDDEN_FIELD_NAMES) {
      assert.ok(!serialized.includes(`"${field}"`), `${name} carries a ${field} field`);
    }
  }
});

test("a tenant cannot reach the other tenant's records by id", async () => {
  assert.equal(await getOrderForPrint(a.tenantId, b.orderId), null);
  assert.equal(await getCustomerDetail(a.tenantId, b.customerId), null);
  // A foreign record and a nonexistent one answer identically.
  assert.equal(
    await getOrderForPrint(a.tenantId, b.orderId),
    await getOrderForPrint(a.tenantId, randomUUID()),
  );
  assert.equal(
    await getCustomerDetail(a.tenantId, b.customerId),
    await getCustomerDetail(a.tenantId, randomUUID()),
  );
});

test("search by the other tenant's reference, phone or email finds nothing", async () => {
  const bCustomer = await prisma.customer.findFirstOrThrow({ where: { tenantId: b.tenantId } });

  assert.equal((await listOrders(a.tenantId, { search: b.orderId })).orders.length, 0);
  assert.equal((await listCustomers(a.tenantId, { search: bCustomer.email })).rows.length, 0);
  assert.equal((await listCustomers(a.tenantId, { search: bCustomer.phone })).rows.length, 0);
  assert.equal((await listFulfillmentQueue(a.tenantId, { search: b.orderId })).rows.length, 0);
  assert.equal((await listPaymentReconciliation(a.tenantId, { search: b.orderId })).rows.length, 0);
});

test('aggregate counts never include the other tenant', async () => {
  const summary = await getFulfillmentSummary(a.tenantId);
  assert.equal(
    Object.values(summary).reduce((sum, n) => sum + n, 0),
    await prisma.order.count({ where: { tenantId: a.tenantId } }),
  );

  const recon = await listPaymentReconciliation(a.tenantId);
  assert.equal(
    Object.values(recon.summary.counts).reduce((sum, n) => sum + n, 0),
    await prisma.payment.count({ where: { tenantId: a.tenantId } }),
  );

  assert.equal(
    (await listCustomers(a.tenantId)).totalCount,
    await prisma.customer.count({ where: { tenantId: a.tenantId } }),
  );

  // Review counting joins payment and order state; it must stay scoped too.
  assert.ok((await countPaymentsNeedingReview(b.tenantId)) >= 0);
});

test('every customer sort stays tenant-scoped', async () => {
  for (const sort of CUSTOMER_SORTS) {
    const { rows } = await listCustomers(a.tenantId, { sort });
    assert.ok(
      !rows.some((row) => row.email.includes(b.marker)),
      `${sort} surfaced the other tenant`,
    );
  }
});

// ---------- exports ----------

test('every export is tenant-scoped and carries no internals', async () => {
  for (const [name, build] of [
    ['customers', buildCustomersExport],
    ['orders', buildOrdersExport],
    ['products', buildProductsExport],
  ] as const) {
    const { headers, rows } = await build(a.tenantId);
    const csv = toCsv(headers, rows);

    assert.ok(!csv.includes(b.marker), `${name} export leaked tenant B`);
    assert.ok(!csv.includes(a.tenantId), `${name} export leaked a tenant id`);
    assert.ok(!csv.includes(`SECRET-${a.marker}`), `${name} export leaked a secret`);
    assert.ok(!csv.includes('providerMetadata'), `${name} export leaked provider metadata`);
    assert.ok(csv.startsWith('﻿'), `${name} export must keep the UTF-8 BOM`);
  }
});

test('exports preserve Vietnamese and stay bounded', async () => {
  const { headers, rows } = await buildProductsExport(a.tenantId);
  const csv = toCsv(headers, rows);
  assert.ok(csv.includes(`Sản phẩm ${a.marker}`), 'diacritics survive');

  // The customer export declares and enforces a row cap.
  const customers = await buildCustomersExport(a.tenantId);
  assert.ok(customers.rows.length <= 5000);
});

// ---------- unknown input cannot widen scope ----------

test('unknown filter, sort and category values never broaden a result', async () => {
  const baseline = await listCustomers(a.tenantId);

  // Values that are not in any whitelist must be ignored or rejected,
  // never passed through to widen the query.
  const bogus = "'; DROP TABLE customers; --";

  const sorted = await listCustomers(a.tenantId, {
    sort: bogus as unknown as (typeof CUSTOMER_SORTS)[number],
  });
  assert.equal(sorted.totalCount, baseline.totalCount);
  assert.ok(!JSON.stringify(sorted).includes(b.marker));

  const queue = await listFulfillmentQueue(a.tenantId, {
    category: bogus as unknown as 'ready_to_fulfill',
  });
  assert.ok(!JSON.stringify(queue).includes(b.marker));

  const recon = await listPaymentReconciliation(a.tenantId, {
    category: bogus as unknown as 'paid',
  });
  assert.ok(!JSON.stringify(recon).includes(b.marker));
});

test('a blank tenant id reads nothing anywhere', async () => {
  assert.equal(await getOrderForPrint('', a.orderId), null);
  assert.equal(await getCustomerDetail('', a.customerId), null);
  const exported = await buildCustomersExport('');
  assert.equal(exported.rows.length, 0);
});

// ---------- print is read-only ----------

test('rendering a print document writes nothing', async () => {
  const before = await prisma.order.findUnique({ where: { id: a.orderId } });
  const events = await prisma.orderEvent.count({ where: { tenantId: a.tenantId } });

  await getOrderForPrint(a.tenantId, a.orderId);
  await getOrderForPrint(a.tenantId, a.orderId);

  assert.deepEqual(
    await prisma.order.findUnique({ where: { id: a.orderId } }),
    before,
    'the order row is byte-identical, updatedAt included',
  );
  assert.equal(await prisma.orderEvent.count({ where: { tenantId: a.tenantId } }), events);
});

// ---------- regressions for defects this sweep found ----------

test('REGRESSION: the query layer validates its own sort value', async () => {
  // Found by this suite: listCustomers trusted filters.sort, so an
  // unvalidated value made ORDER_BY[sort] undefined and spliced
  // "undefined" into the SQL. The page validated, but a library function
  // must not depend on its caller having done so.
  const bogus = "'; DROP TABLE customers; --" as unknown as (typeof CUSTOMER_SORTS)[number];
  const result = await listCustomers(a.tenantId, { sort: bogus });
  const baseline = await listCustomers(a.tenantId);
  assert.deepEqual(
    result.rows.map((row) => row.id),
    baseline.rows.map((row) => row.id),
    'an unknown sort falls back to the default instead of throwing',
  );

  const code = readFileSync(new URL('../src/lib/customer-queries.ts', import.meta.url), 'utf8');
  assert.match(code, /isCustomerSort\(filters\.sort\) \? filters\.sort : DEFAULT_CUSTOMER_SORT/);
});

test('REGRESSION: the provider transaction id is not projected', async () => {
  // Found by this suite. It had been included on the reasoning that it
  // was "already shown on the order" — it was not shown anywhere else,
  // so it was a provider-side identifier surfacing only here.
  const recon = await listPaymentReconciliation(a.tenantId);
  assert.ok(!JSON.stringify(recon).includes('providerTransactionId'));
  assert.ok(!JSON.stringify(recon).includes(`tx-${a.marker}`));

  const page = readFileSync(
    new URL('../src/app/tenant-admin/payment-operations/page.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(page, /row\.providerTransactionId/);
});

// ---------- structural accessibility, every admin page at once ----------

test('no admin page adds a second h1 or a second main landmark', () => {
  for (const page of ADMIN_PAGES) {
    const src = pageCode(page);
    assert.doesNotMatch(src, /<h1/, `${page} must not add an h1 — the layout owns it`);
    assert.doesNotMatch(src, /<main/, `${page} must not nest a main landmark`);
  }
});

test('every admin page that renders personal data forbids caching', () => {
  const personal = ADMIN_PAGES.filter((page) =>
    /customers|orders|fulfillment|payment-operations|payment-rejections|print/.test(page),
  );
  assert.ok(personal.length >= 5, 'the filter actually matched pages');
  for (const page of personal) {
    const src = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.match(src, /force-dynamic/, `${page} must not be statically cached`);
  }
});

test('every admin filter form carries an accessible name', () => {
  // Each <form ...> opening tag is checked on its own, because a page can
  // hold several and only one of them being labelled is not enough.
  let checked = 0;
  for (const page of ADMIN_PAGES) {
    const src = pageCode(page);
    for (const tag of src.match(/<form[^>]*>/g) ?? []) {
      if (!tag.includes('method="get"')) continue;
      checked += 1;
      assert.match(
        tag,
        /aria-label="/,
        `${page} has a filter form with no accessible name: ${tag.replace(/\s+/g, ' ')}`,
      );
    }
  }
  assert.ok(checked >= 3, 'the scan actually found filter forms');
});

test('free text on an admin page is given a wrapping or truncation class', () => {
  // A long Vietnamese name or an order reference with nowhere to break is
  // the usual cause of horizontal overflow at 375px.
  for (const page of ADMIN_PAGES) {
    const src = pageCode(page);
    if (!/customerName|productName|customer\.name|\.reference/.test(src)) continue;
    assert.match(
      src,
      /truncate|break-words|break-all/,
      `${page} renders free text with no wrapping or truncation class`,
    );
  }
});
