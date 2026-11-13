// Returns and refunds: a capability audit expressed as tests.
//
// The finding is that this application CANNOT represent a refund. These
// tests exist so that stays true by accident of nobody noticing, and so
// that the day someone adds the capability they have to change these
// assertions deliberately rather than slip past them.
//
// They also pin the four inferences that would be easiest to make wrongly:
// cancellation is not a refund, fulfilment is not settlement, COD is not
// collected cash, and a released reservation is not restocked goods.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { prisma } from '../src/lib/prisma';
import { createOrder, updateOrderStatus } from '../src/lib/order-mutations';
import { getOrderTimeline } from '../src/lib/order-events';
import { listPaymentReconciliation } from '../src/lib/payment-reconciliation';

const root = fileURLToPath(new URL('../', import.meta.url));

function source(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

function code(relativePath: string): string {
  return source(relativePath)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const UNIT = 200_000;
const SHIPPING = 20_000;

let tenant: { id: string };
let variantId: string;
let shippingMethodId: string;
let suffix: string;

before(async () => {
  suffix = randomUUID().slice(0, 8);
  tenant = await prisma.tenant.create({
    data: { slug: `test-refund-${suffix}`, name: 'Refund audit', status: 'active' },
  });
  const location = await prisma.location.create({
    data: { tenantId: tenant.id, name: 'Main', isDefault: true },
  });
  const product = await prisma.product.create({
    data: { tenantId: tenant.id, name: 'Ghế gỗ', status: 'active' },
  });
  const variant = await prisma.productVariant.create({
    data: { tenantId: tenant.id, productId: product.id, price: UNIT, combinationKey: '' },
  });
  variantId = variant.id;
  await prisma.inventory.create({
    data: {
      tenantId: tenant.id,
      productVariantId: variant.id,
      locationId: location.id,
      onHand: 20,
    },
  });
  const shipping = await prisma.tenantShippingMethod.create({
    data: {
      tenantId: tenant.id,
      name: 'Standard',
      amount: SHIPPING,
      enabled: true,
      isDefault: true,
    },
  });
  shippingMethodId = shipping.id;
  await prisma.tenantPaymentMethod.create({
    data: { tenantId: tenant.id, method: 'cod', provider: 'cod', enabled: true },
  });
});

after(async () => {
  await prisma.orderEvent.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.orderItem.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.payment.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.order.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.customer.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.inventory.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.productVariant.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.product.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.location.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.tenantShippingMethod.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.tenantPaymentMethod.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.tenant.delete({ where: { id: tenant.id } });
});

/**
 * createOrder() does NOT create a Payment row — checkout calls
 * createPaymentForOrder() separately once the order has succeeded. The
 * payment is created explicitly here so these tests exercise the same
 * shape a real COD order has.
 */
async function place(label: string): Promise<string> {
  const result = await createOrder(
    tenant.id,
    [{ productVariantId: variantId, quantity: 2 }],
    'cod',
    { name: 'Nguyễn Văn A', email: `rf-${label}-${suffix}@example.com`, phone: '0912345678' },
    { address: '1 Lê Lợi', ward: 'Bến Nghé', district: 'Quận 1', city: 'Hồ Chí Minh' },
    shippingMethodId,
  );
  assert.ok(result.success, result.success ? '' : result.error);
  const orderId = result.data.orderId;

  await prisma.payment.create({
    data: {
      tenantId: tenant.id,
      orderId,
      status: 'pending',
      provider: 'cod',
      providerOrderId: `po-${label}-${suffix}`,
      amount: 2 * UNIT + SHIPPING,
    },
  });
  return orderId;
}

// ---------- the schema cannot represent a refund ----------

test('no model, field or enum value represents a refund or a return', () => {
  const schema = source('prisma/schema.prisma');
  for (const term of [
    /model\s+Refund/i,
    /model\s+Return/i,
    /refundId/i,
    /refundAmount/i,
    /refundedAt/i,
    /returnedQuantity/i,
    /returnReason/i,
    /restock/i,
    /chargeback/i,
  ]) {
    assert.doesNotMatch(schema, term, `the schema unexpectedly contains ${term}`);
  }
});

test('PaymentStatus has no refunded state, and none of its values may stand in for one', () => {
  const schema = source('prisma/schema.prisma');
  const block = schema.slice(schema.indexOf('enum PaymentStatus'));
  const body = block.slice(0, block.indexOf('}'));
  const values = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('enum') && !line.startsWith('//'));

  assert.deepEqual(values, ['pending', 'succeeded', 'failed', 'expired', 'cancelled']);
  for (const value of values) {
    assert.ok(!/refund|revers|return/i.test(value), `${value} must not imply a refund`);
  }
});

test('the payment provider boundary has no refund operation', () => {
  const provider = code('src/lib/payments/provider.ts');
  const iface = provider.slice(provider.indexOf('interface PaymentProvider'));
  const body = iface.slice(0, iface.indexOf('}'));

  // Exactly three operations, and refunding is not one of them.
  assert.match(body, /createPayment\(/);
  assert.match(body, /handleWebhook\(/);
  assert.match(body, /cancelPayment\(/);
  assert.doesNotMatch(body, /refund/i, 'no adapter can submit a refund');
});

test('cancelPayment is not a refund — no adapter moves money back', () => {
  for (const adapter of [
    'src/lib/payments/cod-provider.ts',
    'src/lib/payments/manual-bank-transfer-provider.ts',
    'src/lib/payments/sepay-va-provider.ts',
    'src/lib/payments/momo-provider.ts',
  ]) {
    assert.doesNotMatch(code(adapter), /refund/i, `${adapter} must not claim a refund path`);
  }
});

test('the webhook pipeline understands no refund event type', () => {
  const webhook = code('src/lib/payments/webhook-service.ts');
  assert.doesNotMatch(webhook, /refund/i);
  // Its only outcomes remain the ones it always had.
  assert.match(
    webhook,
    /"invalid_signature" \| "invalid_payload" \| "unknown_payment" \| "amount_mismatch"/,
  );
});

test('the audit vocabulary cannot express a refund decision', () => {
  const events = code('src/lib/order-events.ts');
  const block = events.slice(events.indexOf('export type OrderEventType'));
  const body = block.slice(0, block.indexOf(';'));
  assert.match(body, /order_created/);
  assert.match(body, /order_status_changed/);
  assert.match(body, /payment_status_changed/);
  assert.match(body, /inventory_released/);
  for (const absent of ['refund', 'return', 'approved', 'rejected', 'requested']) {
    assert.ok(!body.includes(absent), `the event vocabulary must not contain ${absent}`);
  }
});

// ---------- the four inferences that must not be made ----------

test('CANCELLATION IS NOT A REFUND — cancelling leaves the payment untouched', async () => {
  const orderId = await place('cancel');
  const before = await prisma.payment.findFirstOrThrow({ where: { tenantId: tenant.id, orderId } });

  const result = await updateOrderStatus(tenant.id, orderId, 'cancelled');
  assert.ok(result.success);

  const after = await prisma.payment.findFirstOrThrow({ where: { tenantId: tenant.id, orderId } });
  assert.equal(after.status, before.status, 'payment status is unchanged by cancelling an order');
  assert.equal(after.amount, before.amount, 'and no amount is reversed');
  assert.deepEqual(after, before, 'the payment row is byte-identical');
});

test('A RELEASED RESERVATION IS NOT RESTOCKED GOODS', async () => {
  const orderId = await place('restock');
  const inventoryBefore = await prisma.inventory.findFirstOrThrow({
    where: { tenantId: tenant.id, productVariantId: variantId },
  });

  await updateOrderStatus(tenant.id, orderId, 'cancelled');

  const inventoryAfter = await prisma.inventory.findFirstOrThrow({
    where: { tenantId: tenant.id, productVariantId: variantId },
  });

  // onHand does not rise: nothing came back. Only the hold is released,
  // because the goods were never dispatched in the first place.
  assert.equal(inventoryAfter.onHand, inventoryBefore.onHand, 'onHand must not increase');
  assert.ok(inventoryAfter.reserved < inventoryBefore.reserved, 'only the reservation is freed');

  const timeline = await getOrderTimeline(tenant.id, orderId);
  const released = timeline.find((entry) => entry.type === 'inventory_released');
  assert.ok(released, 'the release is audited as a release');
  assert.ok(!/refund|return|restock/i.test(released.summary), 'and is not described as a return');
});

test('FULFILMENT IS NOT SETTLEMENT — a fulfilled COD order is still unpaid', async () => {
  const orderId = await place('fulfil');
  await updateOrderStatus(tenant.id, orderId, 'fulfilled');

  const payment = await prisma.payment.findFirstOrThrow({
    where: { tenantId: tenant.id, orderId },
  });
  assert.equal(payment.status, 'pending', 'marking an order fulfilled settles nothing');
});

test('COD HOLDS NO EVIDENCE OF COLLECTED CASH', async () => {
  const orderId = await place('cod');
  await updateOrderStatus(tenant.id, orderId, 'fulfilled');

  const payment = await prisma.payment.findFirstOrThrow({
    where: { tenantId: tenant.id, orderId },
  });
  // There is no field anywhere that records the courier remitting cash.
  assert.equal(payment.status, 'pending');
  assert.equal(payment.providerTransactionId, null);
  const schema = source('prisma/schema.prisma');
  assert.doesNotMatch(schema, /collectedAt|cashCollected|remitted/i);
});

// ---------- nothing in the product claims otherwise ----------

test('no admin surface renders a refund or return action', () => {
  const surfaces = [
    'src/app/tenant-admin/orders/page.tsx',
    'src/app/tenant-admin/payment-operations/page.tsx',
    'src/app/tenant-admin/fulfillment/page.tsx',
    'src/app/tenant-admin/customers/page.tsx',
    'src/app/tenant-admin/customers/[customerId]/page.tsx',
  ];
  for (const surface of surfaces) {
    const src = code(surface);
    for (const action of [
      /Request refund/i,
      /Issue refund/i,
      /Mark refunded/i,
      /Approve return/i,
    ]) {
      assert.doesNotMatch(src, action, `${surface} must not offer ${action}`);
    }
  }
});

test('no Server Action exists that could record a refund', () => {
  const actions = code('src/app/tenant-admin/actions.ts');
  assert.doesNotMatch(actions, /refund/i);
  assert.doesNotMatch(actions, /\breturnRequest\b/i);
});

test('where refunds are mentioned, it is only to say they happen elsewhere', () => {
  // payment-reconciliation tells a merchant to refund OUTSIDE this
  // system. That wording is deliberate and must not become an action.
  const recon = source('src/lib/payment-reconciliation.ts');
  assert.match(recon, /Refund the customer outside this system/);
  assert.match(recon, /Refund the difference outside this system/);
});

test('the reconciliation projection reports no refund state', async () => {
  const orderId = await place('projection');
  const result = await listPaymentReconciliation(tenant.id, { search: orderId });
  const serialized = JSON.stringify(result);
  for (const term of ['refund', 'refunded', 'returned', 'reversal']) {
    assert.ok(!serialized.toLowerCase().includes(term), `the projection mentions ${term}`);
  }
});

// ---------- the documented position ----------

test('the capability audit is documented and says it is unsupported', () => {
  const doc = source('docs/returns-and-refunds.md');
  assert.match(doc, /not supported/i);
  assert.match(doc, /Outcome A/);
  // The prerequisites are named rather than hand-waved.
  for (const prerequisite of [
    /refund record/i,
    /provider refund/i,
    /returned quantity/i,
    /audit/i,
  ]) {
    assert.match(doc, prerequisite, `the document must name the missing ${prerequisite}`);
  }
  // And it makes none of the claims it exists to prevent.
  for (const claim of [/money (was )?returned/i, /refund completed/i, /customer notified/i]) {
    assert.doesNotMatch(doc, claim);
  }
});
