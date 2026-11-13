// Tests for rejected-webhook evidence: what gets persisted, what must
// never be, and how it classifies. Isolated tenants only; no provider
// API is reachable from this path at all.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { prisma } from '../src/lib/prisma';
import {
  recordPaymentRejection,
  payloadDigest,
  dedupeKeyFor,
} from '../src/lib/payments/payment-rejection';
import {
  exceptionCategoryFor,
  listPaymentExceptions,
  countPaymentsNeedingReview,
  EXCEPTION_CATEGORIES,
} from '../src/lib/payment-reconciliation';

let tenantA: { id: string };
let tenantB: { id: string };
let suffix: string;

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

async function seedPayment(
  tenantId: string,
  options: {
    status: 'pending' | 'succeeded';
    orderStatus: 'pending' | 'fulfilled' | 'cancelled';
    expiresAt?: Date | null;
  },
) {
  const customer = await prisma.customer.create({
    data: {
      tenantId,
      email: `rej-${randomUUID().slice(0, 8)}@example.com`,
      name: 'Nguyễn Văn Ánh',
      phone: '0912345678',
    },
  });
  const order = await prisma.order.create({
    data: {
      tenantId,
      customerId: customer.id,
      status: options.orderStatus,
      paymentMethod: 'bank_transfer',
      shippingAddress: '1 Lê Lợi',
      shippingWard: 'Bến Nghé',
      shippingDistrict: 'Quận 1',
      shippingCity: 'Hồ Chí Minh',
      shippingAmount: 0,
    },
  });
  const payment = await prisma.payment.create({
    data: {
      tenantId,
      orderId: order.id,
      status: options.status,
      provider: 'bank_transfer_sepay_va',
      providerOrderId: `po-${randomUUID()}`,
      amount: 500_000,
      expiresAt: options.expiresAt ?? null,
    },
  });
  return { orderId: order.id, paymentId: payment.id, providerOrderId: payment.providerOrderId };
}

before(async () => {
  suffix = randomUUID().slice(0, 8);
  tenantA = await prisma.tenant.create({
    data: { slug: `test-rej-a-${suffix}`, name: 'Rej A', status: 'active' },
  });
  tenantB = await prisma.tenant.create({
    data: { slug: `test-rej-b-${suffix}`, name: 'Rej B', status: 'active' },
  });
});

after(async () => {
  const ids = [tenantA.id, tenantB.id];
  await prisma.paymentRejection.deleteMany({ where: { tenantId: { in: ids } } });
  // Platform-level rows this file created carry a null tenant, so they are
  // removed by the digests they were written with.
  await prisma.paymentRejection.deleteMany({
    where: { tenantId: null, providerOrderId: { contains: suffix } },
  });
  await prisma.payment.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.order.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
});

// ---------- digest and dedupe ----------

test('the payload digest is one-way and stable', () => {
  const body = '{"transferAmount":123,"secretToken":"hunter2"}';
  assert.equal(payloadDigest(body), payloadDigest(body), 'stable for identical bytes');
  assert.notEqual(payloadDigest(body), payloadDigest(body + ' '), 'sensitive to any change');
  assert.match(payloadDigest(body), /^[0-9a-f]{64}$/, 'sha-256 hex');
  assert.ok(!payloadDigest(body).includes('hunter2'), 'the secret is not recoverable from it');
});

test("the provider's event id is preferred, the digest is the documented fallback", () => {
  assert.equal(dedupeKeyFor('evt-1', 'abc'), 'event:evt-1');
  assert.equal(dedupeKeyFor(null, 'abc'), 'digest:abc');
  assert.equal(dedupeKeyFor('   ', 'abc'), 'digest:abc', 'blank is not a key');
});

test('a repeated rejection bumps occurrences instead of inserting', async () => {
  const seeded = await seedPayment(tenantA.id, { status: 'pending', orderStatus: 'pending' });
  const evidence = {
    provider: 'bank_transfer_sepay_va' as const,
    reason: 'amount_mismatch' as const,
    rawBody: `{"id":"dup-${suffix}","transferAmount":1}`,
    providerEventId: `dup-${suffix}`,
    providerOrderId: seeded.providerOrderId,
    tenantId: tenantA.id,
    paymentId: seeded.paymentId,
    orderId: seeded.orderId,
    expectedAmount: 500_000,
    reportedAmount: 400_000,
  };

  await recordPaymentRejection(evidence);
  await recordPaymentRejection(evidence);
  await recordPaymentRejection(evidence);

  const rows = await prisma.paymentRejection.findMany({
    where: { tenantId: tenantA.id, providerOrderId: seeded.providerOrderId },
  });
  assert.equal(rows.length, 1, 'one row, not three');
  assert.equal(rows[0].occurrences, 3, 'the repeats are counted');
  assert.ok(rows[0].lastSeenAt >= rows[0].firstSeenAt);
});

// ---------- what must never be persisted ----------

test('no raw payload or secret is stored', async () => {
  const seeded = await seedPayment(tenantA.id, { status: 'pending', orderStatus: 'pending' });
  await recordPaymentRejection({
    provider: 'bank_transfer_sepay_va',
    reason: 'amount_mismatch',
    rawBody: `{"signature":"deadbeef","apiKey":"SECRET-${suffix}","transferAmount":1}`,
    providerEventId: `secret-${suffix}`,
    providerOrderId: seeded.providerOrderId,
    tenantId: tenantA.id,
    paymentId: seeded.paymentId,
    orderId: seeded.orderId,
    expectedAmount: 500_000,
    reportedAmount: 1,
  });

  const row = await prisma.paymentRejection.findFirstOrThrow({
    where: { tenantId: tenantA.id, providerOrderId: seeded.providerOrderId },
  });
  const serialized = JSON.stringify(row);
  for (const forbidden of [`SECRET-${suffix}`, 'deadbeef', 'signature', 'apiKey']) {
    assert.ok(!serialized.includes(forbidden), `${forbidden} must not be stored`);
  }
  // There is no column for it at all.
  assert.ok(!('rawPayload' in row));
});

test('an invalid signature never reaches the recorder', () => {
  const code = source('../src/lib/payments/webhook-service.ts');
  // The recorder is called only on the NOT-invalid-signature branch.
  assert.match(code, /if \(!invalidSignature\) \{\s*await recordPaymentRejection/);
  assert.match(code, /An unauthenticated request writes NOTHING/);
});

test('amounts are bounded, and unknown stays null rather than zero', async () => {
  const seeded = await seedPayment(tenantA.id, { status: 'pending', orderStatus: 'pending' });
  await recordPaymentRejection({
    provider: 'momo',
    reason: 'amount_mismatch',
    rawBody: `{"bogus":"${suffix}"}`,
    providerEventId: `bogus-${suffix}`,
    providerOrderId: seeded.providerOrderId,
    tenantId: tenantA.id,
    expectedAmount: Number.NaN,
    reportedAmount: -5,
  });
  const row = await prisma.paymentRejection.findFirstOrThrow({
    where: { tenantId: tenantA.id, provider: 'momo' },
  });
  assert.equal(row.expectedAmount, null, 'NaN is not stored as a number');
  assert.equal(row.reportedAmount, null, 'a negative amount is rejected, not stored as 0');
});

// ---------- tenant attribution ----------

test('an unresolved payment is recorded WITHOUT a tenant', async () => {
  await recordPaymentRejection({
    provider: 'bank_transfer_sepay_va',
    reason: 'unknown_payment',
    rawBody: `{"id":"orphan-${suffix}"}`,
    providerEventId: `orphan-${suffix}`,
    providerOrderId: `unresolved-${suffix}`,
  });
  const row = await prisma.paymentRejection.findFirstOrThrow({
    where: { providerOrderId: `unresolved-${suffix}` },
  });
  assert.equal(row.tenantId, null, 'ownership is never guessed');
});

test("TENANT ISOLATION — platform-level rows reach no tenant's queue", async () => {
  const a = await listPaymentExceptions(tenantA.id);
  const b = await listPaymentExceptions(tenantB.id);
  const all = JSON.stringify([a, b]);
  assert.ok(!all.includes(`unresolved-${suffix}`), 'the orphan row is invisible to both tenants');
});

test("TENANT ISOLATION — tenant B cannot see tenant A's exceptions", async () => {
  const seeded = await seedPayment(tenantB.id, { status: 'pending', orderStatus: 'pending' });
  await recordPaymentRejection({
    provider: 'momo',
    reason: 'amount_mismatch',
    rawBody: `{"b":"${suffix}"}`,
    providerEventId: `b-only-${suffix}`,
    providerOrderId: seeded.providerOrderId,
    tenantId: tenantB.id,
    orderId: seeded.orderId,
    expectedAmount: 500_000,
    reportedAmount: 100,
  });

  const a = await listPaymentExceptions(tenantA.id);
  assert.ok(
    !a.rows.some((row) => row.orderReference === seeded.orderId),
    "A never sees B's rejection",
  );
  const b = await listPaymentExceptions(tenantB.id);
  assert.ok(b.rows.some((row) => row.orderReference === seeded.orderId));
});

// ---------- classification ----------

test('underpaid and overpaid are read from the two stored amounts', () => {
  assert.equal(
    exceptionCategoryFor({
      reason: 'amount_mismatch',
      expectedAmount: 500,
      reportedAmount: 400,
      occurrences: 1,
    }),
    'underpaid',
  );
  assert.equal(
    exceptionCategoryFor({
      reason: 'amount_mismatch',
      expectedAmount: 500,
      reportedAmount: 600,
      occurrences: 1,
    }),
    'overpaid',
  );
});

test('a category is never guessed when the amounts are missing', () => {
  assert.equal(
    exceptionCategoryFor({
      reason: 'amount_mismatch',
      expectedAmount: null,
      reportedAmount: 400,
      occurrences: 1,
    }),
    null,
  );
  assert.equal(
    exceptionCategoryFor({
      reason: 'amount_mismatch',
      expectedAmount: 500,
      reportedAmount: null,
      occurrences: 1,
    }),
    null,
  );
  // Equal amounts cannot be a mismatch; not invented into a bucket.
  assert.equal(
    exceptionCategoryFor({
      reason: 'amount_mismatch',
      expectedAmount: 500,
      reportedAmount: 500,
      occurrences: 1,
    }),
    null,
  );
});

test('an unparseable body classifies as invalid, and unmatched never classifies', () => {
  assert.equal(
    exceptionCategoryFor({
      reason: 'invalid_payload',
      expectedAmount: null,
      reportedAmount: null,
      occurrences: 1,
    }),
    'invalid',
  );
  assert.equal(
    exceptionCategoryFor({
      reason: 'unknown_payment',
      expectedAmount: null,
      reportedAmount: null,
      occurrences: 1,
    }),
    null,
    'unmatched is never tenant-visible',
  );
});

test('unmatched is not offered as a tenant-facing category', () => {
  assert.ok(!(EXCEPTION_CATEGORIES as readonly string[]).includes('unmatched'));
});

test('the exception projection exposes only safe fields', async () => {
  const result = await listPaymentExceptions(tenantA.id);
  assert.ok(result.rows.length > 0);
  const serialized = JSON.stringify(result);
  for (const forbidden of ['payloadDigest', 'dedupeKey', 'paymentId', 'tenantId', tenantA.id]) {
    assert.ok(!serialized.includes(forbidden), `${forbidden} must not be projected`);
  }
  const [row] = result.rows;
  assert.deepEqual(Object.keys(row).sort(), [
    'category',
    'difference',
    'expectedAmount',
    'firstSeenAt',
    'lastSeenAt',
    'occurrences',
    'orderReference',
    'provider',
    'reportedAmount',
  ]);
});

test('the difference is signed and null when either side is unknown', async () => {
  const result = await listPaymentExceptions(tenantA.id);
  for (const row of result.rows) {
    if (row.expectedAmount === null || row.reportedAmount === null) {
      assert.equal(row.difference, null);
    } else {
      assert.equal(row.difference, row.reportedAmount - row.expectedAmount);
    }
  }
});

// ---------- dataset-wide review count ----------

test('the review count covers the whole dataset, not one page', async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `test-rej-c-${suffix}`, name: 'Rej C', status: 'active' },
  });
  try {
    const past = new Date('2020-01-01T00:00:00Z');
    // Three distinct rules, plus one row tripping two at once.
    await seedPayment(tenant.id, { status: 'pending', orderStatus: 'pending', expiresAt: past });
    await seedPayment(tenant.id, { status: 'succeeded', orderStatus: 'cancelled' });
    await seedPayment(tenant.id, { status: 'pending', orderStatus: 'fulfilled' });
    await seedPayment(tenant.id, { status: 'pending', orderStatus: 'fulfilled', expiresAt: past });
    // Healthy: must not be counted.
    await seedPayment(tenant.id, { status: 'succeeded', orderStatus: 'fulfilled' });

    const count = await countPaymentsNeedingReview(tenant.id);
    assert.equal(count, 4, 'the overlapping row is counted once, the healthy one not at all');
  } finally {
    await prisma.payment.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.order.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.customer.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  }
});

test('the review count is tenant-scoped', async () => {
  const isolated = await prisma.tenant.create({
    data: { slug: `test-rej-d-${suffix}`, name: 'Rej D', status: 'active' },
  });
  try {
    assert.equal(await countPaymentsNeedingReview(isolated.id), 0, 'an empty tenant counts zero');
  } finally {
    await prisma.tenant.delete({ where: { id: isolated.id } });
  }
});

// ---------- the webhook decision is unchanged ----------

test('recording evidence cannot change a webhook outcome', () => {
  const code = source('../src/lib/payments/webhook-service.ts');
  // Every recorder call is immediately followed by the same rejection it
  // always returned — evidence is written beside the decision, not inside it.
  assert.match(code, /recordPaymentRejection\(\{[\s\S]{0,400}\}\);\s*return \{ accepted: false/);
  // The accepted path still gates on amount before anything is recorded.
  assert.match(
    code,
    /result\.newStatus === "succeeded" && result\.verifiedAmount !== payment\.amount/,
  );
  // PaymentEvent insertion and the guarded update are untouched.
  assert.match(code, /providerEventId: result\.providerEventId/);
  assert.match(code, /where: \{ id: payment\.id, status: "pending" \}/);
});

test('the recorder never calls a provider and never decides anything', () => {
  const code = source('../src/lib/payments/payment-rejection.ts')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  for (const forbidden of [/fetch\(/, /axios/, /https?:\/\//, /payment\.update/, /orderEvent/]) {
    assert.doesNotMatch(code, forbidden);
  }
});

test('the migration is additive and append-only', () => {
  const sql = source('../prisma/migrations/20261016120000_add_payment_rejections/migration.sql');
  assert.match(sql, /CREATE TABLE "payment_rejections"/);
  assert.match(sql, /CREATE UNIQUE INDEX "payment_rejections_provider_dedupeKey_key"/);
  for (const forbidden of [
    /\bDROP\b/i,
    /\bALTER TABLE "(orders|payments|payment_events)"/i,
    /DELETE FROM/i,
  ]) {
    assert.doesNotMatch(sql, forbidden, 'nothing existing may be touched');
  }
  assert.match(sql, /"tenantId" TEXT,/, 'tenantId is nullable by design');
});
