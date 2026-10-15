// Tests for the Order Print Center against the real local database,
// using isolated tenants this file provisions and deletes. Existing QA
// data is never read as a fixture and never modified.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { prisma } from '../src/lib/prisma';
import { createOrder } from '../src/lib/order-mutations';
import {
  getOrderForPrint,
  formatAddress,
  isPrintDocument,
  PRINT_DOCUMENTS,
  DOCUMENT_TITLE,
} from '../src/lib/order-print';

const UNIT_PRICE = 150_000;
const SHIPPING = 20_000;

let tenantA: { id: string };
let tenantB: { id: string };
let orderA: string;
let orderB: string;
let suffix: string;

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

async function provision(label: string, productName: string, sku: string | null) {
  const tenant = await prisma.tenant.create({
    data: {
      slug: `test-print-${label}-${suffix}`,
      name: `Print Tenant ${label}`,
      status: 'active',
    },
  });
  const location = await prisma.location.create({
    data: { tenantId: tenant.id, name: 'Main', isDefault: true },
  });
  const product = await prisma.product.create({
    data: { tenantId: tenant.id, name: productName, status: 'active' },
  });
  const variant = await prisma.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      price: UNIT_PRICE,
      sku,
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
  const shippingMethod = await prisma.tenantShippingMethod.create({
    data: {
      tenantId: tenant.id,
      name: 'Giao hàng tiêu chuẩn',
      amount: SHIPPING,
      enabled: true,
      isDefault: true,
    },
  });
  await prisma.tenantPaymentMethod.create({
    data: { tenantId: tenant.id, method: 'cod', provider: 'cod', enabled: true },
  });
  return { tenant, variant, shippingMethod };
}

async function place(tenantId: string, variantId: string, shippingMethodId: string, label: string) {
  const result = await createOrder(
    tenantId,
    [{ productVariantId: variantId, quantity: 2 }],
    'cod',
    { name: 'Nguyễn Văn Ánh', email: `print-${label}-${suffix}@example.com`, phone: '0912345678' },
    {
      address: '123 Đường Nguyễn Huệ',
      ward: 'Phường Bến Nghé',
      district: 'Quận 1',
      city: 'Thành phố Hồ Chí Minh',
    },
    shippingMethodId,
  );
  assert.ok(result.success, result.success ? '' : result.error);
  return result.data.orderId;
}

before(async () => {
  suffix = randomUUID().slice(0, 8);
  const a = await provision('a', 'Ghế gỗ óc chó', `PRINT-A-${suffix}`);
  const b = await provision('b', 'Tenant B product', `PRINT-B-${suffix}`);
  tenantA = a.tenant;
  tenantB = b.tenant;
  orderA = await place(tenantA.id, a.variant.id, a.shippingMethod.id, 'a');
  orderB = await place(tenantB.id, b.variant.id, b.shippingMethod.id, 'b');
});

after(async () => {
  const ids = [tenantA.id, tenantB.id];
  await prisma.orderEvent.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.orderItem.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.payment.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.order.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.inventory.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.productVariant.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.product.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.location.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantShippingMethod.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantPaymentMethod.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
});

// ---------- document types ----------

test('only the three known document types are accepted', () => {
  assert.deepEqual([...PRINT_DOCUMENTS], ['order-summary', 'packing-slip', 'shipping-note']);
  for (const valid of PRINT_DOCUMENTS) assert.equal(isPrintDocument(valid), true);
  for (const invalid of ['invoice', 'vat-invoice', 'label', '', '../../etc/passwd', undefined]) {
    assert.equal(isPrintDocument(invalid), false, `${String(invalid)} must be rejected`);
  }
});

test('no document is named as a tax invoice or a carrier label', () => {
  const titles = Object.values(DOCUMENT_TITLE).join(' ').toLowerCase();
  for (const forbidden of ['vat', 'invoice', 'tax', 'carrier label', 'waybill']) {
    assert.ok(!titles.includes(forbidden), `a document must not be called "${forbidden}"`);
  }
});

// ---------- tenant isolation ----------

test("TENANT ISOLATION — a tenant cannot print another tenant's order", async () => {
  assert.ok(await getOrderForPrint(tenantA.id, orderA), 'its own order resolves');
  assert.equal(await getOrderForPrint(tenantA.id, orderB), null);
  assert.equal(await getOrderForPrint(tenantB.id, orderA), null);
});

test('a missing order and a foreign order are indistinguishable', async () => {
  const foreign = await getOrderForPrint(tenantA.id, orderB);
  const absent = await getOrderForPrint(tenantA.id, randomUUID());
  assert.equal(foreign, absent, 'both are null — existence cannot be probed');
});

test('malformed and empty ids fail safely rather than throwing', async () => {
  for (const id of ['', '   ', 'not-a-uuid', '../../../etc/passwd', "' OR 1=1 --"]) {
    assert.equal(await getOrderForPrint(tenantA.id, id), null, `${id} must be null`);
  }
  assert.equal(await getOrderForPrint('', orderA), null, 'a blank tenant reads nothing');
});

test('the route authorizes before it reads anything', () => {
  const src = source('../src/app/tenant-admin/orders/[orderId]/print/page.tsx');
  const auth = src.indexOf('requireTenantAdmin()');
  // The CALL site, not the import at the top of the file.
  const read = src.indexOf('getOrderForPrint(tenantId');
  assert.ok(auth > -1 && read > -1);
  assert.ok(auth < read, 'authorization precedes the order read');
  assert.match(src, /notFound\(\)/);
});

test('print pages are never cached', () => {
  const src = source('../src/app/tenant-admin/orders/[orderId]/print/page.tsx');
  assert.match(src, /export const dynamic = 'force-dynamic'/);
  assert.match(src, /export const revalidate = 0/);
});

// ---------- read-only ----------

test('printing mutates nothing and records no order event', async () => {
  const before_ = await prisma.order.findUnique({ where: { id: orderA } });
  const eventsBefore = await prisma.orderEvent.count({ where: { tenantId: tenantA.id } });

  // Once per document type, as a merchant printing all three would.
  for (let i = 0; i < PRINT_DOCUMENTS.length; i++) {
    await getOrderForPrint(tenantA.id, orderA);
  }

  const after_ = await prisma.order.findUnique({ where: { id: orderA } });
  assert.deepEqual(after_, before_, 'the order row is byte-identical, updatedAt included');
  assert.equal(
    await prisma.orderEvent.count({ where: { tenantId: tenantA.id } }),
    eventsBefore,
    'viewing a document is not an order event',
  );
});

test('the projection module performs no write', () => {
  const code = source('../src/lib/order-print.ts')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  for (const forbidden of [
    /\.create\(/,
    /\.update\(/,
    /\.delete\(/,
    /\$executeRaw/,
    /recordOrderEvent/,
  ]) {
    assert.doesNotMatch(code, forbidden, `order-print must not call ${forbidden}`);
  }
});

// ---------- data correctness ----------

test('line items, totals and units are correct', async () => {
  const order = await getOrderForPrint(tenantA.id, orderA);
  assert.ok(order);
  assert.equal(order.items.length, 1);
  const [item] = order.items;
  assert.equal(item.quantity, 2);
  assert.equal(item.unitPrice, UNIT_PRICE);
  assert.equal(item.lineTotal, UNIT_PRICE * 2);
  assert.equal(item.sku, `PRINT-A-${suffix}`);

  assert.equal(order.totals.subtotal, UNIT_PRICE * 2);
  assert.equal(order.totals.shipping, SHIPPING);
  assert.equal(order.totals.total, UNIT_PRICE * 2 + SHIPPING);
  assert.equal(order.totals.currency, 'VND');
  assert.equal(order.totalUnits, 2);
});

test("COD is derived from the order's own payment method", async () => {
  const order = await getOrderForPrint(tenantA.id, orderA);
  assert.ok(order);
  assert.equal(order.paymentMethod, 'cod');
  assert.equal(order.codAmount, order.totals.total, 'a COD order collects the full total');
});

test('Vietnamese text and addresses survive the projection intact', async () => {
  const order = await getOrderForPrint(tenantA.id, orderA);
  assert.ok(order);
  assert.equal(order.customer.name, 'Nguyễn Văn Ánh');
  assert.equal(order.items[0].productName, 'Ghế gỗ óc chó');
  assert.equal(order.shipping.methodName, 'Giao hàng tiêu chuẩn');
  assert.equal(
    formatAddress(order.shipping),
    '123 Đường Nguyễn Huệ, Phường Bến Nghé, Quận 1, Thành phố Hồ Chí Minh',
  );
});

test('a store with no branding still gets a heading', async () => {
  const order = await getOrderForPrint(tenantA.id, orderA);
  assert.ok(order);
  assert.equal(order.store.name, 'Print Tenant a', 'falls back to the tenant name');
  assert.equal(order.store.logoUrl, null, 'a missing logo is null, never a placeholder URL');
});

test('nullable fields come through as null rather than invented text', async () => {
  const order = await getOrderForPrint(tenantA.id, orderA);
  assert.ok(order);
  assert.equal(order.shipping.note, null, 'no note was given at checkout');
  assert.equal(order.items[0].combinationLabel, null, 'a simple product has no options');
});

// ---------- what must never be exposed ----------

test('no payment secret, webhook payload or internal id is in the projection', async () => {
  const order = await getOrderForPrint(tenantA.id, orderA);
  assert.ok(order);
  const serialized = JSON.stringify(order);

  // The tenant id is the clearest canary: it is on every row the query
  // touched and must appear nowhere in the output.
  assert.ok(!serialized.includes(tenantA.id), 'tenantId must not leak');

  for (const forbidden of [
    'providerMetadata',
    'providerOrderId',
    'providerTransactionId',
    'failureReason',
    'customerId',
    'productVariantId',
    'sequence',
    'tenantId',
  ]) {
    assert.ok(!serialized.includes(forbidden), `${forbidden} must not appear`);
  }
});

test('the projection is plain serializable data, not Prisma rows', async () => {
  const order = await getOrderForPrint(tenantA.id, orderA);
  assert.ok(order);
  // Structured-cloneable with no surprises beyond the Date we intend.
  const round = JSON.parse(JSON.stringify(order));
  assert.equal(round.reference, order.reference);
  assert.equal(typeof round.placedAt, 'string');
  assert.deepEqual(Object.keys(order.customer).sort(), ['email', 'name', 'phone']);
});

// ---------- document structure ----------

const DOCS = [
  ['OrderSummaryDocument', 'order-summary'],
  ['PackingSlipDocument', 'packing-slip'],
  ['ShippingNoteDocument', 'shipping-note'],
] as const;

test('all three documents exist and declare their own label', () => {
  for (const [file] of DOCS) {
    const src = source(`../src/app/tenant-admin/orders/[orderId]/print/${file}.tsx`);
    assert.match(src, /aria-label="(Order summary|Packing slip|Shipping note)"/);
  }
});

test('the packing slip shows no prices at all', () => {
  const src = source('../src/app/tenant-admin/orders/[orderId]/print/PackingSlipDocument.tsx');
  assert.doesNotMatch(src, /formatVnd/, 'no money is rendered on a packing slip');
  assert.doesNotMatch(src, /unitPrice|lineTotal|subtotal/);
  assert.match(src, /quantity/, 'quantities are the point of it');
  assert.match(src, /sku/);
});

test('each document carries its required disclaimer', () => {
  const summary = source('../src/app/tenant-admin/orders/[orderId]/print/OrderSummaryDocument.tsx');
  assert.match(summary, /not an electronic VAT invoice/);

  const packing = source('../src/app/tenant-admin/orders/[orderId]/print/PackingSlipDocument.tsx');
  assert.match(packing, /not a tax invoice/);

  const note = source('../src/app/tenant-admin/orders/[orderId]/print/ShippingNoteDocument.tsx');
  assert.match(note, /not an official carrier label/);
});

test('the shipping note invents no tracking number or carrier', () => {
  const src = source('../src/app/tenant-admin/orders/[orderId]/print/ShippingNoteDocument.tsx');
  assert.match(src, /No tracking number is[\s\S]{0,20}issued/, 'it says so explicitly');

  // Comments stripped: the module EXPLAINS that it emits none of these,
  // so the prose legitimately names them. What matters is the rendered code.
  const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const forbidden of [/barcode/i, /GHN/, /GHTK/, /Viettel/, /waybill/i]) {
    assert.doesNotMatch(code, forbidden);
  }
  // There is no such column to read even if someone wanted to.
  const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const orderModel = schema.slice(schema.indexOf('model Order {'));
  assert.doesNotMatch(orderModel.slice(0, orderModel.indexOf('\n}')), /tracking/i);
});

test('documents add no second main landmark and no second h1', () => {
  for (const [file] of DOCS) {
    const src = source(`../src/app/tenant-admin/orders/[orderId]/print/${file}.tsx`);
    assert.doesNotMatch(src, /<main/, `${file} must not nest a main`);
    assert.doesNotMatch(src, /<h1/, `${file} must not add an h1`);
    assert.match(src, /<h2/, 'it still has real headings');
  }
});

// ---------- print CSS and screen-only controls ----------

test('admin chrome and print controls are hidden when printing', () => {
  const layout = source('../src/app/tenant-admin/layout.tsx');
  assert.match(layout, /<header[^>]*print:hidden/, 'the top bar is screen-only');
  assert.match(layout, /<aside[^>]*print:hidden/, 'the sidebar is screen-only');

  const page = source('../src/app/tenant-admin/orders/[orderId]/print/page.tsx');
  assert.match(page, /print:hidden/, "the page's own controls are screen-only");
});

test('print CSS handles pagination, wrapping and monochrome', () => {
  const css = source('../src/app/globals.css');
  const printBlock = css.slice(css.indexOf('@media print'));
  assert.match(printBlock, /@page/);
  assert.match(printBlock, /size: A4/);
  assert.match(printBlock, /margin: 12mm/);
  assert.match(printBlock, /display: table-header-group/, 'headers repeat across pages');
  assert.match(printBlock, /break-inside: avoid/, 'rows and totals do not split');
  assert.match(printBlock, /overflow-wrap: anywhere/, 'long Vietnamese text wraps');
  assert.match(printBlock, /color: #000/, 'monochrome-safe');
});

// ---------- the admin actions ----------

test('print actions have specific accessible names, never a bare Print', () => {
  const src = source('../src/app/tenant-admin/orders/page.tsx');
  assert.match(
    src,
    /aria-label=\{`Print \$\{DOCUMENT_TITLE\[documentType\]\.toLowerCase\(\)\} for order/,
  );
  assert.match(src, /PRINT_DOCUMENTS\.map/, 'all three are offered');
  // They are links, not forms: printing mutates nothing.
  assert.doesNotMatch(src, /ConfirmActionForm[\s\S]{0,200}print/i);
});

test('print actions stack before they wrap, and keep usable touch targets', () => {
  const src = source('../src/app/tenant-admin/orders/page.tsx');
  const block = src.slice(
    src.indexOf('PRINT_DOCUMENTS.map') - 700,
    src.indexOf('PRINT_DOCUMENTS.map') + 600,
  );
  assert.match(block, /flex-col gap-2 sm:flex-row/, 'stacked on narrow screens');
  assert.match(block, /min-h-11/, '44px targets on mobile');
  assert.match(block, /lg:min-h-9/, 'compact on desktop, matching the admin');
});
