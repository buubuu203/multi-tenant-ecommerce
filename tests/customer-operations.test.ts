// Customer Operations: isolation, metric definitions and export safety.
// Isolated tenants provisioned and deleted by this file; existing QA data
// is never read as a fixture and never modified.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { prisma } from '../src/lib/prisma';
import { listCustomers, getCustomerDetail, CUSTOMER_PAGE_SIZE } from '../src/lib/customer-queries';
import { buildCustomersExport, CUSTOMER_EXPORT_HEADERS } from '../src/lib/exports/customers-export';
import { toCsv } from '../src/lib/csv';

const UNIT = 100_000;
const SHIPPING = 20_000;

let tenantA: { id: string };
let tenantB: { id: string };
let suffix: string;
let variantA: string;
let variantB: string;

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

async function provision(label: string) {
  const tenant = await prisma.tenant.create({
    data: { slug: `test-cust-${label}-${suffix}`, name: `Cust ${label}`, status: 'active' },
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

/** Creates a customer and orders directly: no checkout, no provider. */
async function seedCustomer(
  tenantId: string,
  variantId: string,
  options: {
    name: string;
    email: string;
    phone: string;
    orders?: { status: 'pending' | 'fulfilled' | 'cancelled'; quantity: number }[];
  },
) {
  const customer = await prisma.customer.create({
    data: { tenantId, name: options.name, email: options.email, phone: options.phone },
  });
  for (const spec of options.orders ?? []) {
    const order = await prisma.order.create({
      data: {
        tenantId,
        customerId: customer.id,
        status: spec.status,
        paymentMethod: 'cod',
        shippingAddress: '1 Lê Lợi',
        shippingWard: 'Bến Nghé',
        shippingDistrict: 'Quận 1',
        shippingCity: 'Hồ Chí Minh',
        shippingAmount: SHIPPING,
        shippingMethodName: 'Giao hàng tiêu chuẩn',
      },
    });
    await prisma.orderItem.create({
      data: {
        tenantId,
        orderId: order.id,
        productVariantId: variantId,
        quantity: spec.quantity,
        price: UNIT,
      },
    });
  }
  return customer.id;
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
  await prisma.order.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.inventory.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.productVariant.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.product.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.location.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
});

// ---------- metrics ----------

test('order count includes cancelled orders; order value excludes them', async () => {
  await seedCustomer(tenantA.id, variantA, {
    name: 'Nguyễn Văn Ánh',
    email: `metrics-${suffix}@example.com`,
    phone: '0912345678',
    orders: [
      { status: 'fulfilled', quantity: 2 },
      { status: 'pending', quantity: 1 },
      { status: 'cancelled', quantity: 5 },
    ],
  });

  const { rows } = await listCustomers(tenantA.id, { search: `metrics-${suffix}` });
  assert.equal(rows.length, 1);
  const [customer] = rows;

  assert.equal(customer.orderCount, 3, 'all three orders count');
  assert.equal(customer.cancelledCount, 1);

  // (2 × 100000 + 20000) + (1 × 100000 + 20000) = 340000. The cancelled
  // 5-unit order contributes nothing.
  assert.equal(customer.orderValue, 340_000);
});

test('shipping is included in order value, per the documented definition', async () => {
  const { rows } = await listCustomers(tenantA.id, { search: `metrics-${suffix}` });
  const [customer] = rows;
  const itemsOnly = 2 * UNIT + 1 * UNIT;
  assert.equal(customer.orderValue - itemsOnly, 2 * SHIPPING, 'two non-cancelled shipping charges');
});

test('a customer with no orders reports zero, not a guess', async () => {
  await seedCustomer(tenantA.id, variantA, {
    name: 'No Orders',
    email: `noorders-${suffix}@example.com`,
    phone: '0988888888',
  });
  const { rows } = await listCustomers(tenantA.id, { search: `noorders-${suffix}` });
  assert.equal(rows[0].orderCount, 0);
  assert.equal(rows[0].orderValue, 0);
  assert.equal(rows[0].firstOrderAt, null, 'no date is invented');
  assert.equal(rows[0].lastOrderAt, null);
  assert.equal(rows[0].latestOrderStatus, null);
  assert.equal(rows[0].latestPaymentStatus, null);
});

test('latest status comes from the most recent order', async () => {
  const detail = await getCustomerDetail(
    tenantA.id,
    (await listCustomers(tenantA.id, { search: `metrics-${suffix}` })).rows[0].id,
  );
  assert.ok(detail);
  assert.equal(detail.orders.length, 3);
  // Newest first, so the first entry is the latest order.
  assert.equal(detail.latestOrderStatus, detail.orders[0].status);
  assert.ok(detail.lastOrderAt && detail.firstOrderAt);
  assert.ok(detail.lastOrderAt >= detail.firstOrderAt);
});

test('no metric is invented for delivery, returns, settlement or consent', () => {
  const code = source('../src/lib/customer-queries.ts');
  const exported = code.slice(code.indexOf('export type CustomerListRow'));
  const shape = exported.slice(0, exported.indexOf('};'));
  for (const invented of [
    'delivered',
    'returned',
    'refunded',
    'settled',
    'consent',
    'vip',
    'ltv',
  ]) {
    assert.ok(!shape.toLowerCase().includes(invented), `${invented} must not be a field`);
  }
});

// ---------- identity and duplicates ----------

test('two customers sharing a phone are flagged, never merged', async () => {
  const sharedPhone = '0901234567';
  await seedCustomer(tenantA.id, variantA, {
    name: 'Người Một',
    email: `dup1-${suffix}@example.com`,
    phone: sharedPhone,
    orders: [{ status: 'fulfilled', quantity: 1 }],
  });
  await seedCustomer(tenantA.id, variantA, {
    name: 'Người Hai',
    email: `dup2-${suffix}@example.com`,
    phone: sharedPhone,
    orders: [{ status: 'fulfilled', quantity: 1 }],
  });

  const { rows } = await listCustomers(tenantA.id, { search: sharedPhone });
  assert.equal(rows.length, 2, 'both rows are shown separately');
  for (const row of rows) {
    assert.equal(row.possibleDuplicatePhone, true);
    // Each keeps its own identity and its own orders.
    assert.equal(row.orderCount, 1);
  }
});

test('a unique phone is not flagged as a duplicate', async () => {
  const { rows } = await listCustomers(tenantA.id, { search: `noorders-${suffix}` });
  assert.equal(rows[0].possibleDuplicatePhone, false);
});

// ---------- search ----------

test('phone search matches both stored forms', async () => {
  await seedCustomer(tenantA.id, variantA, {
    name: 'Plus Form',
    email: `plus-${suffix}@example.com`,
    phone: '+84977777777',
  });
  const local = await listCustomers(tenantA.id, { search: '0977777777' });
  const international = await listCustomers(tenantA.id, { search: '+84977777777' });
  assert.equal(local.rows.length, 1, 'the 0-prefixed form finds the +84 record');
  assert.equal(international.rows.length, 1);
  assert.equal(local.rows[0].id, international.rows[0].id);
});

test('name and email search are case-insensitive', async () => {
  const upper = await listCustomers(tenantA.id, { search: `METRICS-${suffix.toUpperCase()}` });
  assert.equal(upper.rows.length, 1);
  const name = await listCustomers(tenantA.id, { search: 'nguyễn' });
  assert.ok(name.rows.length >= 1, 'Vietnamese name search works');
});

// ---------- tenant isolation ----------

test('TENANT ISOLATION — a tenant sees only its own customers', async () => {
  await seedCustomer(tenantB.id, variantB, {
    name: 'B Person',
    email: `bperson-${suffix}@example.com`,
    phone: '0966666666',
    orders: [{ status: 'fulfilled', quantity: 3 }],
  });

  const a = await listCustomers(tenantA.id, { search: `bperson-${suffix}` });
  assert.equal(a.rows.length, 0, "A cannot find B's customer by email");

  const byPhone = await listCustomers(tenantA.id, { search: '0966666666' });
  assert.equal(byPhone.rows.length, 0, 'nor by phone');

  const b = await listCustomers(tenantB.id, { search: `bperson-${suffix}` });
  assert.equal(b.rows.length, 1);
});

test('cross-tenant customer detail is indistinguishable from missing', async () => {
  const bCustomer = (await listCustomers(tenantB.id, { search: `bperson-${suffix}` })).rows[0];
  const foreign = await getCustomerDetail(tenantA.id, bCustomer.id);
  const absent = await getCustomerDetail(tenantA.id, randomUUID());
  assert.equal(foreign, null);
  assert.equal(absent, null);
  assert.equal(foreign, absent, 'both null — existence cannot be probed');
});

test('malformed and blank ids fail safely', async () => {
  for (const id of ['', '   ', 'not-a-uuid', "' OR 1=1 --"]) {
    assert.equal(await getCustomerDetail(tenantA.id, id), null);
  }
  assert.equal(await getCustomerDetail('', 'anything'), null);
});

test("customer detail contains only that customer's orders", async () => {
  const target = (await listCustomers(tenantA.id, { search: `metrics-${suffix}` })).rows[0];
  const detail = await getCustomerDetail(tenantA.id, target.id);
  assert.ok(detail);
  const ownOrders = await prisma.order.findMany({
    where: { tenantId: tenantA.id, customerId: target.id },
    select: { id: true },
  });
  assert.deepEqual(
    detail.orders.map((order) => order.reference).sort(),
    ownOrders.map((order) => order.id).sort(),
  );
});

// ---------- projection safety ----------

test('no payment metadata, webhook payload or internal id leaks', async () => {
  const { rows } = await listCustomers(tenantA.id, {});
  const detail = await getCustomerDetail(tenantA.id, rows[0].id);
  const serialized = JSON.stringify({ rows, detail });

  for (const forbidden of [
    tenantA.id,
    'tenantId',
    'providerMetadata',
    'providerOrderId',
    'providerTransactionId',
    'rawPayload',
    'customerId',
    'productVariantId',
  ]) {
    assert.ok(!serialized.includes(forbidden), `${forbidden} must not appear`);
  }
});

test('the query module only reads', () => {
  const code = source('../src/lib/customer-queries.ts')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  for (const forbidden of [/\.create\(/, /\.update\(/, /\.delete\(/, /\$executeRaw/]) {
    assert.doesNotMatch(code, forbidden, 'customer operations is read-only');
  }
});

// ---------- pagination ----------

test('pagination is deterministic and bounded', async () => {
  const first = await listCustomers(tenantA.id, { page: 1 });
  const again = await listCustomers(tenantA.id, { page: 1 });
  assert.deepEqual(
    first.rows.map((r) => r.id),
    again.rows.map((r) => r.id),
    'the same page twice gives the same order',
  );
  assert.ok(first.rows.length <= CUSTOMER_PAGE_SIZE);

  const code = source('../src/lib/customer-queries.ts');
  assert.match(code, /orderBy: \[\{ createdAt: 'desc' \}, \{ id: 'desc' \}\]/);
});

test("the count matches the tenant's own customers", async () => {
  const { totalCount } = await listCustomers(tenantA.id, {});
  assert.equal(totalCount, await prisma.customer.count({ where: { tenantId: tenantA.id } }));
});

test('the page does not fan out per customer', () => {
  const code = source('../src/lib/customer-queries.ts');
  // One orders query for the whole page, keyed on the page's ids.
  assert.match(code, /customerId: \{ in: customerIds \}/);
  assert.doesNotMatch(code, /for \([^)]*\)\s*\{[\s\S]{0,200}await db\./, 'no await inside a loop');
});

// ---------- export ----------

test('the export is tenant-scoped and uses the shared definitions', async () => {
  const a = await buildCustomersExport(tenantA.id);
  const b = await buildCustomersExport(tenantB.id);
  assert.ok(a.rows.length >= 4);
  assert.equal(b.rows.length, 1, 'B has exactly its own one customer');

  const aCsv = toCsv(a.headers, a.rows);
  assert.ok(!aCsv.includes('B Person'), "A's export contains no B customer");
});

test('export headers are the documented safe set', () => {
  assert.deepEqual(
    [...CUSTOMER_EXPORT_HEADERS],
    [
      'customer_name',
      'phone',
      'email',
      'orders',
      'cancelled_orders',
      'order_value_vnd',
      'first_order_at',
      'last_order_at',
      'latest_order_status',
      'latest_payment_status',
      'possible_duplicate_phone',
    ],
  );
});

test('Vietnamese survives, and the CSV carries a BOM', async () => {
  const { headers, rows } = await buildCustomersExport(tenantA.id);
  const csv = toCsv(headers, rows);
  assert.ok(csv.startsWith('﻿'), 'UTF-8 BOM for Excel');
  assert.ok(csv.includes('Nguyễn Văn Ánh'), 'diacritics intact');
  assert.ok(csv.includes('Người Một'));
});

test('formula injection protection is reused', async () => {
  await seedCustomer(tenantA.id, variantA, {
    name: '=SUM(A1:A9)',
    email: `formula-${suffix}@example.com`,
    phone: '0955555555',
  });
  const { headers, rows } = await buildCustomersExport(tenantA.id);
  const csv = toCsv(headers, rows);
  assert.ok(!csv.includes('\n=SUM'), 'a leading = is neutralised by the shared escaper');
  assert.ok(csv.includes('SUM(A1:A9)'), 'the value itself is preserved');
});

test('the export carries no payment or webhook fields', async () => {
  const { headers, rows } = await buildCustomersExport(tenantA.id);
  const csv = toCsv(headers, rows);
  for (const forbidden of ['providerMetadata', 'rawPayload', 'providerOrderId', tenantA.id]) {
    assert.ok(!csv.includes(forbidden), `${forbidden} must not be exported`);
  }
});

test('the export is bounded and deterministically ordered', async () => {
  const code = source('../src/lib/exports/customers-export.ts');
  assert.match(code, /CUSTOMER_EXPORT_MAX_ROWS = 5000/);
  assert.match(code, /rows\.length >= CUSTOMER_EXPORT_MAX_ROWS/);

  const first = await buildCustomersExport(tenantA.id);
  const again = await buildCustomersExport(tenantA.id);
  assert.deepEqual(first.rows, again.rows, 'two exports are identical');
});

test('the export dataset is registered behind the existing allowlist', () => {
  const route = source('../src/app/tenant-admin/exports/[dataset]/route.ts');
  assert.match(route, /customers: \{ build: buildCustomersExport/);
  // Authorization still precedes dataset resolution.
  const auth = route.indexOf('requireTenantAdmin()');
  const build = route.indexOf('DATASETS[dataset]');
  assert.ok(auth > -1 && (build === -1 || auth < build));
});

// ---------- UI structure ----------

test('the customer pages use the shared shell and add no landmark', () => {
  for (const page of [
    '../src/app/tenant-admin/customers/page.tsx',
    '../src/app/tenant-admin/customers/[customerId]/page.tsx',
  ]) {
    const src = source(page);
    assert.match(src, /<AdminPageHeader/);
    assert.doesNotMatch(src, /<h1/, 'the layout owns the h1');
    assert.doesNotMatch(src, /<main/);
    assert.match(src, /requireTenantAdmin\(\)/);
    assert.match(src, /export const dynamic = 'force-dynamic'/);
    assert.match(src, /export const revalidate = 0/, 'personal data is never cached');
  }
});

test('the export warns about personal data before download', () => {
  const src = source('../src/app/tenant-admin/customers/page.tsx');
  assert.match(src, /This file contains personal data/);
  assert.match(src, /role="note"/);
});

test('links to orders and print documents have precise names', () => {
  const list = source('../src/app/tenant-admin/customers/page.tsx');
  assert.match(list, /aria-label=\{`View order history for \$\{customer\.name\}`\}/);
  assert.match(list, /aria-label=\{`Open orders for \$\{customer\.name\}`\}/);

  const detail = source('../src/app/tenant-admin/customers/[customerId]/page.tsx');
  assert.match(detail, /aria-label=\{`Open order \$\{order\.reference\}`\}/);
  assert.match(detail, /aria-label=\{`Print order summary for order \$\{order\.reference\}`\}/);
});

test('no customer mutation action was added', () => {
  for (const page of [
    '../src/app/tenant-admin/customers/page.tsx',
    '../src/app/tenant-admin/customers/[customerId]/page.tsx',
  ]) {
    const src = source(page);
    assert.doesNotMatch(src, /ActionForm|ConfirmActionForm|action=\{/, 'read-only');
  }
});

test('the search form carries a visible label and an accessible name', () => {
  const src = source('../src/app/tenant-admin/customers/page.tsx');
  assert.match(src, /aria-label="Search customers"/);
  assert.match(src, /Search\n/, 'the input has a visible label');
  assert.match(src, /Search customers\s*<\/button>/, 'the submit names what it searches');
});
