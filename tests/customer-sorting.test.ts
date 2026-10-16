// Server-side customer sorting. Isolated tenants, fixed timestamps — no
// sleeps and nothing depends on wall-clock ordering.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { prisma } from '../src/lib/prisma';
import {
  listCustomers,
  CUSTOMER_SORTS,
  DEFAULT_CUSTOMER_SORT,
  isCustomerSort,
  CUSTOMER_PAGE_SIZE,
} from '../src/lib/customer-queries';
import { buildCustomersExport } from '../src/lib/exports/customers-export';

const UNIT = 100_000;
const SHIPPING = 20_000;

let tenantA: { id: string };
let tenantB: { id: string };
let variantA: string;
let variantB: string;
let suffix: string;

/** Deterministic, explicit dates — never Date.now(). */
const DAY = (n: number) => new Date(`2026-03-${String(n).padStart(2, '0')}T10:00:00.000Z`);

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

async function provision(label: string) {
  const tenant = await prisma.tenant.create({
    data: { slug: `test-sort-${label}-${suffix}`, name: `Sort ${label}`, status: 'active' },
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

async function seed(
  tenantId: string,
  variantId: string,
  options: {
    name: string;
    createdAt: Date;
    orders?: { status: 'pending' | 'fulfilled' | 'cancelled'; quantity: number; at: Date }[];
  },
) {
  const customer = await prisma.customer.create({
    data: {
      tenantId,
      name: options.name,
      email: `${options.name.toLowerCase().replace(/\s+/g, '')}-${suffix}@example.com`,
      phone: `09${Math.floor(Math.random() * 100_000_000)}`.slice(0, 10),
      createdAt: options.createdAt,
    },
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
        createdAt: spec.at,
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

let alpha: string;
let beta: string;
let gamma: string;
let noOrders: string;

before(async () => {
  suffix = randomUUID().slice(0, 8);
  const a = await provision('a');
  const b = await provision('b');
  tenantA = a.tenant;
  tenantB = b.tenant;
  variantA = a.variantId;
  variantB = b.variantId;

  // Alpha: oldest customer, 3 orders (one cancelled), most recent order.
  alpha = await seed(tenantA.id, variantA, {
    name: 'Alpha',
    createdAt: DAY(1),
    orders: [
      { status: 'fulfilled', quantity: 1, at: DAY(5) },
      { status: 'pending', quantity: 1, at: DAY(6) },
      { status: 'cancelled', quantity: 10, at: DAY(20) },
    ],
  });
  // Beta: 1 order, but the largest value.
  beta = await seed(tenantA.id, variantA, {
    name: 'Beta',
    createdAt: DAY(2),
    orders: [{ status: 'fulfilled', quantity: 9, at: DAY(10) }],
  });
  // Gamma: 2 orders, middling value, oldest last order.
  gamma = await seed(tenantA.id, variantA, {
    name: 'Gamma',
    createdAt: DAY(3),
    orders: [
      { status: 'fulfilled', quantity: 2, at: DAY(4) },
      { status: 'fulfilled', quantity: 1, at: DAY(4) },
    ],
  });
  // Newest customer, no orders at all.
  noOrders = await seed(tenantA.id, variantA, { name: 'Zeta', createdAt: DAY(9) });
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

const idsOf = (rows: { id: string }[]) => rows.map((row) => row.id);

// ---------- the sort set ----------

test('the sort modes are a closed, whitelisted set', () => {
  assert.deepEqual([...CUSTOMER_SORTS], ['newest', 'last_order', 'order_count', 'order_value']);
  assert.equal(DEFAULT_CUSTOMER_SORT, 'newest');
  for (const bad of ['', 'name', 'DROP TABLE', 'order_value; --', undefined]) {
    assert.equal(isCustomerSort(bad), false, `${String(bad)} must be rejected`);
  }
});

test('an unknown sort cannot reach SQL', () => {
  const code = source('../src/lib/customer-queries.ts');
  // The ORDER BY is looked up by a key already narrowed to the union.
  assert.match(code, /ORDER BY \$\{ORDER_BY\[sort\]\}/);
  assert.match(code, /const ORDER_BY: Record<CustomerSort, string>/);
  const page = source('../src/app/tenant-admin/customers/page.tsx');
  assert.match(page, /isCustomerSort\(params\.sort\) \? params\.sort : DEFAULT_CUSTOMER_SORT/);
});

test('every user value is a bound parameter, never interpolated', () => {
  const code = source('../src/lib/customer-queries.ts');
  const fn = code.slice(code.indexOf('async function orderedCustomerIds'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  // Search text, phone variants, limit and offset all go through params.
  assert.match(body, /params\.push\(`%\$\{search\}%`\)/);
  assert.match(body, /params\.push\(phoneVariants\)/);
  assert.match(body, /params\.push\(limit\)/);
  assert.match(body, /params\.push\(offset\)/);
  // Nothing user-supplied is spliced into the SQL string.
  assert.doesNotMatch(body, /\$\{search\}(?!%`)/);
  assert.doesNotMatch(body, /\$\{tenantId\}/);
  assert.doesNotMatch(body, /\$\{limit\}|\$\{offset\}/);
});

// ---------- default is unchanged ----------

test('the default ordering is still newest customer first', async () => {
  const explicit = await listCustomers(tenantA.id, { sort: 'newest' });
  const implied = await listCustomers(tenantA.id, {});
  assert.deepEqual(idsOf(implied.rows), idsOf(explicit.rows), 'omitting sort means newest');
  // Zeta created last, Alpha first.
  assert.equal(explicit.rows[0].id, noOrders);
  assert.equal(explicit.rows[explicit.rows.length - 1].id, alpha);
});

// ---------- last order ----------

test('last-order sort ranks by most recent order, newest first', async () => {
  const { rows } = await listCustomers(tenantA.id, { sort: 'last_order' });
  // Alpha's most recent order is DAY(20) — a CANCELLED one, which still
  // counts as contact. Beta DAY(10), Gamma DAY(4).
  assert.deepEqual(idsOf(rows).slice(0, 3), [alpha, beta, gamma]);
});

test('customers with no orders come last, with no invented date', async () => {
  const { rows } = await listCustomers(tenantA.id, { sort: 'last_order' });
  assert.equal(rows[rows.length - 1].id, noOrders, 'Zeta sorts last despite being newest');
  assert.equal(rows[rows.length - 1].lastOrderAt, null, 'no placeholder date');
});

test('equal last-order timestamps fall back to a deterministic id order', async () => {
  // Gamma's two orders share DAY(4); repeated calls must not reshuffle.
  const first = await listCustomers(tenantA.id, { sort: 'last_order' });
  const again = await listCustomers(tenantA.id, { sort: 'last_order' });
  assert.deepEqual(idsOf(first.rows), idsOf(again.rows));
  const code = source('../src/lib/customer-queries.ts');
  assert.match(code, /last_order: 'agg\.last_order_at DESC NULLS LAST, c\.id DESC'/);
});

// ---------- order count ----------

test('order-count sort is descending and counts cancelled orders', async () => {
  const { rows } = await listCustomers(tenantA.id, { sort: 'order_count' });
  assert.deepEqual(idsOf(rows).slice(0, 3), [alpha, gamma, beta]);
  // Alpha leads on 3 only because the cancelled order counts.
  assert.equal(rows[0].orderCount, 3);
  assert.equal(rows[0].cancelledCount, 1);
});

test('a customer with no orders sorts as zero, not as missing', async () => {
  const { rows } = await listCustomers(tenantA.id, { sort: 'order_count' });
  const zeta = rows.find((row) => row.id === noOrders);
  assert.ok(zeta, 'still present in the list');
  assert.equal(zeta.orderCount, 0);
  assert.equal(rows[rows.length - 1].id, noOrders);
});

// ---------- order value ----------

test('order-value sort is descending and excludes cancelled orders', async () => {
  const { rows } = await listCustomers(tenantA.id, { sort: 'order_value' });
  // Beta  : 9×100000 + 20000               = 920000
  // Gamma : (2×100000+20000)+(1×100000+20000) = 340000
  // Alpha : (1×100000+20000)×2             = 240000  (cancelled 10-unit excluded)
  assert.deepEqual(idsOf(rows).slice(0, 3), [beta, gamma, alpha]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  assert.equal(byId.get(beta)?.orderValue, 920_000);
  assert.equal(byId.get(gamma)?.orderValue, 340_000);
  assert.equal(byId.get(alpha)?.orderValue, 240_000, 'the cancelled order contributes nothing');
});

test('unpaid orders still count toward order value', async () => {
  // Alpha's DAY(6) order is `pending` and has no payment row at all.
  const { rows } = await listCustomers(tenantA.id, { sort: 'order_value' });
  const alphaRow = rows.find((row) => row.id === alpha);
  assert.equal(alphaRow?.orderValue, 240_000, 'both non-cancelled orders are included');
  assert.equal(alphaRow?.latestPaymentStatus, null, 'and none of them is paid');
});

test('shipping is included once per non-cancelled order', async () => {
  const { rows } = await listCustomers(tenantA.id, { sort: 'order_value' });
  const alphaRow = rows.find((row) => row.id === alpha);
  assert.equal((alphaRow?.orderValue ?? 0) - 2 * UNIT, 2 * SHIPPING);
});

test('value and count ordering agree with the hydrated row figures', async () => {
  for (const sort of ['order_value', 'order_count'] as const) {
    const { rows } = await listCustomers(tenantA.id, { sort });
    const key = sort === 'order_value' ? 'orderValue' : 'orderCount';
    for (let i = 1; i < rows.length; i++) {
      assert.ok(
        rows[i - 1][key] >= rows[i][key],
        `${sort} must be descending: ${rows[i - 1][key]} then ${rows[i][key]}`,
      );
    }
  }
});

// ---------- search, pagination, isolation ----------

test('search and sort compose, and stay tenant-scoped', async () => {
  const { rows, totalCount } = await listCustomers(tenantA.id, {
    search: 'Alpha',
    sort: 'order_value',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, alpha);
  assert.equal(totalCount, 1, 'the count reflects the filtered set, not the page');
});

test("TENANT ISOLATION — no sort can reach another tenant's customers", async () => {
  await seed(tenantB.id, variantB, {
    name: 'Bravo',
    createdAt: DAY(1),
    orders: [{ status: 'fulfilled', quantity: 50, at: DAY(28) }],
  });
  for (const sort of CUSTOMER_SORTS) {
    const { rows } = await listCustomers(tenantA.id, { sort });
    assert.ok(
      !rows.some((row) => row.name === 'Bravo'),
      `${sort} must not surface tenant B's customer`,
    );
  }
  // Tenant B's big-value customer would lead order_value if it leaked.
  const byValue = await listCustomers(tenantA.id, { sort: 'order_value' });
  assert.equal(byValue.rows[0].id, beta);
});

test('pagination neither duplicates nor skips across pages', async () => {
  for (const sort of CUSTOMER_SORTS) {
    const all: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const { rows } = await listCustomers(tenantA.id, { sort, page });
      all.push(...idsOf(rows));
      if (rows.length < CUSTOMER_PAGE_SIZE) break;
    }
    assert.equal(new Set(all).size, all.length, `${sort} paged without duplicates`);
    const total = await prisma.customer.count({ where: { tenantId: tenantA.id } });
    assert.equal(all.length, total, `${sort} returned every customer exactly once`);
  }
});

test('repeated identical requests return identical ordering', async () => {
  for (const sort of CUSTOMER_SORTS) {
    const a = await listCustomers(tenantA.id, { sort });
    const b = await listCustomers(tenantA.id, { sort });
    assert.deepEqual(idsOf(a.rows), idsOf(b.rows), `${sort} is stable`);
  }
});

test('duplicate-phone indicators survive sorting', async () => {
  const shared = '0900000111';
  await prisma.customer.create({
    data: { tenantId: tenantA.id, name: 'Dup One', email: `d1-${suffix}@e.com`, phone: shared },
  });
  await prisma.customer.create({
    data: { tenantId: tenantA.id, name: 'Dup Two', email: `d2-${suffix}@e.com`, phone: shared },
  });
  for (const sort of CUSTOMER_SORTS) {
    const { rows } = await listCustomers(tenantA.id, { sort, search: shared });
    assert.equal(rows.length, 2);
    for (const row of rows) assert.equal(row.possibleDuplicatePhone, true);
  }
});

// ---------- bounded work ----------

test('the page is bounded in the database, not in JavaScript', () => {
  const code = source('../src/lib/customer-queries.ts');
  const fn = code.slice(code.indexOf('async function orderedCustomerIds'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /LIMIT \$\{limitParam\} OFFSET \$\{offsetParam\}/);
  // No array sort over the full dataset anywhere in the module.
  assert.doesNotMatch(code, /\.sort\(\(/, "ordering is the database's job");
  // And no per-customer follow-up query.
  assert.doesNotMatch(code, /for \([^)]*\)\s*\{[\s\S]{0,200}await db\./);
});

test("hydration restores the database's order", () => {
  const code = source('../src/lib/customer-queries.ts');
  assert.match(code, /findMany does not preserve the `in` order/);
  assert.match(code, /customerIds\s*\n?\s*\.map\(\(id\) => byId\.get\(id\)\)/);
});

// ---------- export contract ----------

test('the CSV export keeps its own deterministic order, ignoring the list sort', async () => {
  // The export takes no sort argument: its contract is the default
  // ordering, unchanged by whatever the merchant is looking at.
  const code = source('../src/lib/exports/customers-export.ts');
  assert.match(code, /listCustomers\(tenantId, \{ page \}\)/);
  assert.doesNotMatch(code, /sort/, 'the export never forwards a sort');

  const first = await buildCustomersExport(tenantA.id);
  const again = await buildCustomersExport(tenantA.id);
  assert.deepEqual(first.rows, again.rows, 'two exports are identical');
});

// ---------- UI ----------

test('the sort control is a real labelled control that preserves filters', () => {
  const page = source('../src/app/tenant-admin/customers/page.tsx');
  assert.match(page, /Sort customers by/);
  assert.match(page, /<select name="sort" defaultValue=\{sort\}/);
  assert.match(page, /CUSTOMER_SORTS\.map/);
  // One form carries search and sort together, so applying one keeps the
  // other, and submitting drops `page`.
  assert.match(page, /aria-label="Search customers"/);
  assert.match(page, /method="get"/);
  assert.doesNotMatch(page, /'use client'/, 'no client state is needed for correctness');
});

test('paging preserves the selected sort', () => {
  const page = source('../src/app/tenant-admin/customers/page.tsx');
  // Pagination forwards the existing query string, sort included.
  assert.match(page, /searchParams=\{params\}/);
});

test('the page explains the no-orders tie-break without over-claiming', () => {
  const page = source('../src/app/tenant-admin/customers/page.tsx');
  assert.match(page, /puts customers who have never ordered at the end/);
  assert.match(page, /not settled revenue/);
  for (const forbidden of [/lifetime revenue/i, /collected revenue/i, /loyalty/i, /\bVIP\b/]) {
    assert.doesNotMatch(page, forbidden);
  }
});
