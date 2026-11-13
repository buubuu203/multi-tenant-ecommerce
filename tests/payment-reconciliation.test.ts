// Tests for the payment reconciliation view. Pure derivation is tested
// directly; the query is tested against the real local database using
// isolated tenants this file provisions and deletes. No provider API is
// ever called — there is no network client in this path at all.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { prisma } from '../src/lib/prisma';
import {
  categoryFor,
  reviewReasonsFor,
  listPaymentReconciliation,
  RECONCILIATION_CATEGORIES,
  REVIEW_REASON_LABEL,
  PAGE_SIZE,
} from '../src/lib/payment-reconciliation';

let tenantA: { id: string };
let tenantB: { id: string };
let suffix: string;

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

/** Creates an order + payment pair directly: no checkout, no provider. */
async function seed(
  tenantId: string,
  options: {
    status: 'pending' | 'succeeded' | 'failed' | 'expired' | 'cancelled';
    provider: 'cod' | 'bank_transfer_manual' | 'bank_transfer_sepay_va' | 'momo';
    method: 'cod' | 'momo' | 'bank_transfer';
    orderStatus: 'pending' | 'fulfilled' | 'cancelled';
    amount?: number;
    expiresAt?: Date | null;
  },
) {
  const customer = await prisma.customer.create({
    data: {
      tenantId,
      email: `recon-${randomUUID().slice(0, 8)}@example.com`,
      name: 'Nguyễn Văn Ánh',
      phone: '0912345678',
    },
  });
  const order = await prisma.order.create({
    data: {
      tenantId,
      customerId: customer.id,
      status: options.orderStatus,
      paymentMethod: options.method,
      shippingAddress: '1 Đường Lê Lợi',
      shippingWard: 'Phường Bến Nghé',
      shippingDistrict: 'Quận 1',
      shippingCity: 'Hồ Chí Minh',
      shippingAmount: 0,
    },
  });
  await prisma.payment.create({
    data: {
      tenantId,
      orderId: order.id,
      status: options.status,
      provider: options.provider,
      providerOrderId: `po-${randomUUID()}`,
      amount: options.amount ?? 100_000,
      expiresAt: options.expiresAt ?? null,
    },
  });
  return order.id;
}

before(async () => {
  suffix = randomUUID().slice(0, 8);
  tenantA = await prisma.tenant.create({
    data: { slug: `test-recon-a-${suffix}`, name: 'Recon A', status: 'active' },
  });
  tenantB = await prisma.tenant.create({
    data: { slug: `test-recon-b-${suffix}`, name: 'Recon B', status: 'active' },
  });
});

after(async () => {
  const ids = [tenantA.id, tenantB.id];
  await prisma.paymentEvent.deleteMany({ where: { payment: { tenantId: { in: ids } } } });
  await prisma.payment.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.order.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
});

// ---------- state derivation ----------

test('every stored payment status maps to exactly one category', () => {
  assert.equal(categoryFor('pending'), 'awaiting_payment');
  assert.equal(categoryFor('succeeded'), 'paid');
  assert.equal(categoryFor('failed'), 'failed');
  assert.equal(categoryFor('expired'), 'expired');
  assert.equal(categoryFor('cancelled'), 'cancelled');
});

test('an unknown status is never guessed into a category', () => {
  for (const unknown of ['processing', 'settled', 'refunded', '', 'PAID']) {
    assert.equal(categoryFor(unknown), null, `${unknown} must not be mapped`);
  }
});

test('pending is never reported as paid', () => {
  assert.notEqual(categoryFor('pending'), 'paid');
  assert.equal(categoryFor('pending'), 'awaiting_payment');
});

test('the category list contains no state the data cannot prove', () => {
  // Underpaid, overpaid, unmatched and duplicate_event are impossible to
  // derive — the webhook path discards all four before persisting.
  for (const absent of ['underpaid', 'overpaid', 'unmatched', 'duplicate_event', 'processing']) {
    assert.ok(
      !(RECONCILIATION_CATEGORIES as readonly string[]).includes(absent),
      `${absent} must not be offered as a category`,
    );
  }
});

// ---------- review rules ----------

const BASE = {
  status: 'pending',
  provider: 'momo',
  orderStatus: 'pending',
  expiresAt: null,
  now: new Date('2026-06-01T00:00:00Z'),
};

test('a pending payment past its window needs review', () => {
  assert.deepEqual(reviewReasonsFor({ ...BASE, expiresAt: new Date('2026-05-01T00:00:00Z') }), [
    'pending_past_expiry',
  ]);
  // Still inside the window: nothing to review.
  assert.deepEqual(reviewReasonsFor({ ...BASE, expiresAt: new Date('2026-07-01T00:00:00Z') }), []);
  // No window at all cannot be past it.
  assert.deepEqual(reviewReasonsFor(BASE), []);
});

test('money taken for a cancelled order needs review', () => {
  assert.deepEqual(reviewReasonsFor({ ...BASE, status: 'succeeded', orderStatus: 'cancelled' }), [
    'paid_for_cancelled_order',
  ]);
});

test('fulfilled without a succeeded payment needs review', () => {
  assert.deepEqual(reviewReasonsFor({ ...BASE, orderStatus: 'fulfilled', provider: 'momo' }), [
    'fulfilled_without_payment',
  ]);
});

test('COD is not treated as a bank settlement failure', () => {
  // A fulfilled COD order with a pending payment is normal: cash is
  // settled with the courier and never recorded here.
  const reasons = reviewReasonsFor({ ...BASE, orderStatus: 'fulfilled', provider: 'cod' });
  assert.deepEqual(reasons, ['cod_awaiting_confirmation']);
  assert.ok(!reasons.includes('fulfilled_without_payment'));
  assert.match(REVIEW_REASON_LABEL.cod_awaiting_confirmation, /not recorded in the system/);
});

test('a healthy paid order needs no review', () => {
  assert.deepEqual(
    reviewReasonsFor({ ...BASE, status: 'succeeded', orderStatus: 'fulfilled' }),
    [],
  );
});

// ---------- tenant isolation ----------

test('TENANT ISOLATION — a tenant sees only its own payments', async () => {
  await seed(tenantA.id, {
    status: 'succeeded',
    provider: 'momo',
    method: 'momo',
    orderStatus: 'fulfilled',
  });
  await seed(tenantB.id, {
    status: 'succeeded',
    provider: 'momo',
    method: 'momo',
    orderStatus: 'fulfilled',
  });

  const a = await listPaymentReconciliation(tenantA.id);
  const b = await listPaymentReconciliation(tenantB.id);

  assert.equal(a.totalCount, 1);
  assert.equal(b.totalCount, 1);
  assert.notEqual(a.rows[0].orderReference, b.rows[0].orderReference);
});

test("another tenant's order reference cannot be found by searching", async () => {
  const foreign = await seed(tenantB.id, {
    status: 'pending',
    provider: 'bank_transfer_manual',
    method: 'bank_transfer',
    orderStatus: 'pending',
  });
  const result = await listPaymentReconciliation(tenantA.id, { search: foreign });
  assert.equal(result.totalCount, 0, 'searching a foreign reference reveals nothing');
  assert.equal(result.rows.length, 0);
});

test("the summary counts only this tenant's payments", async () => {
  const a = await listPaymentReconciliation(tenantA.id);
  const total = Object.values(a.summary.counts).reduce((sum, n) => sum + n, 0);
  const actual = await prisma.payment.count({ where: { tenantId: tenantA.id } });
  assert.equal(total, actual, 'the grouped summary matches the underlying rows');
});

// ---------- projection safety ----------

test('no raw payload, signature or secret reaches the projection', async () => {
  const orderId = await seed(tenantA.id, {
    status: 'succeeded',
    provider: 'bank_transfer_sepay_va',
    method: 'bank_transfer',
    orderStatus: 'fulfilled',
  });
  // A real webhook payload on the record, to prove it does not surface.
  const payment = await prisma.payment.findFirstOrThrow({
    where: { tenantId: tenantA.id, orderId },
  });
  await prisma.paymentEvent.create({
    data: {
      paymentId: payment.id,
      provider: 'bank_transfer_sepay_va',
      providerEventId: `evt-${randomUUID()}`,
      rawPayload: { secretToken: 'SHOULD-NEVER-APPEAR', signature: 'deadbeef', transferAmount: 1 },
    },
  });

  const result = await listPaymentReconciliation(tenantA.id, { search: orderId });
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    'SHOULD-NEVER-APPEAR',
    'deadbeef',
    'rawPayload',
    'signature',
    'providerOrderId',
    'tenantId',
  ]) {
    assert.ok(!serialized.includes(forbidden), `${forbidden} must not appear`);
  }
  assert.ok(!serialized.includes(tenantA.id), 'tenantId must not leak');
});

test('the module performs no write and calls no provider', () => {
  const code = source('../src/lib/payment-reconciliation.ts')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  for (const forbidden of [
    /\.create\(/,
    /\.update\(/,
    /\.delete\(/,
    /fetch\(/,
    /axios/,
    /https?:\/\//,
  ]) {
    assert.doesNotMatch(code, forbidden, `reconciliation must not use ${forbidden}`);
  }
});

// ---------- query behaviour ----------

test('filters are tenant-scoped and narrow the result', async () => {
  await seed(tenantA.id, {
    status: 'failed',
    provider: 'momo',
    method: 'momo',
    orderStatus: 'pending',
  });

  const failed = await listPaymentReconciliation(tenantA.id, { category: 'failed' });
  assert.ok(failed.totalCount >= 1);
  for (const row of failed.rows) assert.equal(row.category, 'failed');

  const cod = await listPaymentReconciliation(tenantA.id, { provider: 'cod' });
  for (const row of cod.rows) assert.equal(row.provider, 'cod');
});

test('ordering is deterministic and pagination is bounded', async () => {
  const first = await listPaymentReconciliation(tenantA.id, { page: 1 });
  const again = await listPaymentReconciliation(tenantA.id, { page: 1 });
  assert.deepEqual(
    first.rows.map((r) => r.orderReference),
    again.rows.map((r) => r.orderReference),
    'the same page twice gives the same order',
  );
  assert.ok(first.rows.length <= PAGE_SIZE, 'a page is bounded');

  const code = source('../src/lib/payment-reconciliation.ts');
  assert.match(
    code,
    /orderBy: \[\{ createdAt: 'desc' \}, \{ id: 'desc' \}\]/,
    'ties are broken by id',
  );
});

test('the query does not fan out per row', () => {
  const code = source('../src/lib/payment-reconciliation.ts');
  // One page query, one count, one grouped summary — inside a single
  // Promise.all, with the order joined via select rather than re-queried.
  assert.match(code, /Promise\.all\(\[/);
  assert.match(code, /order: \{ select: \{ status: true, paymentMethod: true \} \}/);
  assert.doesNotMatch(code, /for \([^)]*\)\s*\{[\s\S]{0,200}await db\./, 'no await inside a loop');
});

test('needs-review filtering returns only rows with a reason', async () => {
  await seed(tenantA.id, {
    status: 'succeeded',
    provider: 'momo',
    method: 'momo',
    orderStatus: 'cancelled',
  });
  const reviewed = await listPaymentReconciliation(tenantA.id, { needsReview: true });
  assert.ok(reviewed.rows.length >= 1);
  for (const row of reviewed.rows) {
    assert.ok(row.reviewReasons.length > 0, 'every row has a reason');
  }
});

// ---------- no new mutation ----------

test('the page adds no payment mutation of its own', () => {
  const page = source('../src/app/tenant-admin/payment-operations/page.tsx');
  // It links to the order, where the existing audited controls live.
  assert.doesNotMatch(page, /markManualPaymentReceived|ActionForm|action=\{/);
  assert.match(page, /\/tenant-admin\/orders\?search=/);
  assert.match(page, /confirmed on the order itself/);
});

// ---------- UI structure ----------

test('the page uses the shared shell and adds no landmark', () => {
  const page = source('../src/app/tenant-admin/payment-operations/page.tsx');
  assert.match(page, /<AdminPageHeader/);
  assert.doesNotMatch(page, /<h1/, 'the layout owns the h1');
  assert.doesNotMatch(page, /<main/);
  assert.match(page, /requireTenantAdmin\(\)/);
  assert.match(page, /export const dynamic = 'force-dynamic'/);
});

test('the Checkout nav group lists payment operations', () => {
  const nav = source('../src/app/tenant-admin/AdminNav.tsx');
  assert.match(nav, /\["\/tenant-admin\/payment-operations", "Payment operations"\]/);
});

test('state is conveyed as words, not colour alone', () => {
  const page = source('../src/app/tenant-admin/payment-operations/page.tsx');
  assert.match(page, /CATEGORY_LABEL: Record<ReconciliationCategory, string>/);
  assert.match(page, /StatusBadge/, 'the shared badge renders its own label');
  assert.match(page, /Awaiting payment/);
});

test('the page states what it cannot tell you', () => {
  const page = source('../src/app/tenant-admin/payment-operations/page.tsx');
  // Underpayments and overpayments ARE shown now that rejected
  // deliveries are persisted. What remains unavailable is unmatched,
  // and the page must say why rather than going quiet about it.
  assert.match(page, /Unmatched transfers are not shown here/);
  assert.match(page, /resolves to[\s\S]{0,20}no tenant/);
  assert.match(page, /not an accounting, tax or banking system/);
  assert.match(page, /never[\s\S]{0,15}confirms that money reached/i);
});

test('filter controls carry visible labels', () => {
  const page = source('../src/app/tenant-admin/payment-operations/page.tsx');
  assert.match(page, /aria-label="Filter payments"/);
  for (const label of ['Provider', 'State', 'Search', 'Needs review only']) {
    assert.ok(page.includes(label), `${label} is a visible label`);
  }
});
