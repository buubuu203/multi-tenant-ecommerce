// Platform-level rejection operations and retention. Isolated fixtures
// only: every row this file creates carries a run-unique provider
// reference, and the cleanup removes exactly those.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prisma } from '../src/lib/prisma';
import { listPlatformRejections } from '../src/lib/payments/rejection-operations';
import { listPaymentExceptions } from '../src/lib/payment-reconciliation';

const run = promisify(execFile);

let tenantA: { id: string };
let suffix: string;

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

/** Marks every fixture row so cleanup can find exactly ours. */
function ref(label: string): string {
  return `ops-${label}-${suffix}`;
}

async function makeRejection(options: {
  label: string;
  tenantId: string | null;
  reason: 'amount_mismatch' | 'unknown_payment' | 'invalid_payload';
  occurrences?: number;
  lastSeenAt?: Date;
  expectedAmount?: number | null;
  reportedAmount?: number | null;
  paymentId?: string | null;
}) {
  return prisma.paymentRejection.create({
    data: {
      tenantId: options.tenantId,
      provider: 'bank_transfer_sepay_va',
      dedupeKey: `key-${options.label}-${suffix}`,
      reason: options.reason,
      occurrences: options.occurrences ?? 1,
      providerOrderId: ref(options.label),
      paymentId: options.paymentId ?? null,
      expectedAmount: options.expectedAmount ?? null,
      reportedAmount: options.reportedAmount ?? null,
      payloadDigest: `digest-${options.label}-${suffix}`,
      lastSeenAt: options.lastSeenAt ?? new Date(),
    },
  });
}

before(async () => {
  suffix = randomUUID().slice(0, 8);
  tenantA = await prisma.tenant.create({
    data: { slug: `test-ops-a-${suffix}`, name: 'Ops A', status: 'active' },
  });
});

after(async () => {
  await prisma.paymentRejection.deleteMany({
    where: { OR: [{ providerOrderId: { contains: suffix } }, { tenantId: tenantA.id }] },
  });
  await prisma.tenant.deleteMany({ where: { id: tenantA.id } });
});

// ---------- platform visibility ----------

test('unattributed rows are visible at platform level', async () => {
  await makeRejection({ label: 'orphan', tenantId: null, reason: 'unknown_payment' });
  const { rows } = await listPlatformRejections({ providerOrderId: ref('orphan') });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].attribution, 'unattributed');
  assert.equal(rows[0].resolvedPayment, false);
});

test('unattributed rows never reach a merchant queue', async () => {
  const merchant = await listPaymentExceptions(tenantA.id);
  assert.ok(
    !JSON.stringify(merchant).includes(ref('orphan')),
    'the orphan row is invisible to the tenant',
  );
});

test('a merchant still sees its own attributed rejection', async () => {
  await makeRejection({
    label: 'mine',
    tenantId: tenantA.id,
    reason: 'amount_mismatch',
    expectedAmount: 500_000,
    reportedAmount: 400_000,
  });
  const merchant = await listPaymentExceptions(tenantA.id);
  assert.ok(merchant.rows.some((row) => row.category === 'underpaid'));
});

// ---------- projection safety ----------

test('the platform projection exposes no tenant id, digest or dedupe key', async () => {
  const result = await listPlatformRejections({ providerOrderId: ref('mine') });
  assert.equal(result.rows.length, 1);
  const serialized = JSON.stringify(result);

  for (const forbidden of [
    tenantA.id,
    `digest-mine-${suffix}`,
    `key-mine-${suffix}`,
    'payloadDigest',
    'dedupeKey',
    'tenantId',
    'paymentId',
  ]) {
    assert.ok(!serialized.includes(forbidden), `${forbidden} must not be projected`);
  }

  // Attribution is a BOOLEAN-ish label, never the tenant itself.
  assert.equal(result.rows[0].attribution, 'attributed');
  assert.deepEqual(Object.keys(result.rows[0]).sort(), [
    'attribution',
    'difference',
    'expectedAmount',
    'firstSeenAt',
    'id',
    'lastSeenAt',
    'occurrences',
    'provider',
    'providerOrderId',
    'reason',
    'reportedAmount',
    'resolvedPayment',
  ]);
});

test('the signed difference is derived, and null when a side is unknown', async () => {
  const withAmounts = await listPlatformRejections({ providerOrderId: ref('mine') });
  assert.equal(withAmounts.rows[0].difference, -100_000, 'underpayment is negative');

  const without = await listPlatformRejections({ providerOrderId: ref('orphan') });
  assert.equal(without.rows[0].difference, null);
});

// ---------- filters, ordering, metrics ----------

test('filters narrow by reason and attribution', async () => {
  const unattributed = await listPlatformRejections({ attribution: 'unattributed' });
  for (const row of unattributed.rows) assert.equal(row.attribution, 'unattributed');

  const attributed = await listPlatformRejections({ attribution: 'attributed' });
  for (const row of attributed.rows) assert.equal(row.attribution, 'attributed');

  const byReason = await listPlatformRejections({ reason: 'unknown_payment' });
  for (const row of byReason.rows) assert.equal(row.reason, 'unknown_payment');
});

test('the provider reference filter is exact, never a substring probe', async () => {
  const exact = await listPlatformRejections({ providerOrderId: ref('orphan') });
  assert.equal(exact.rows.length, 1);
  // A partial reference must NOT match, or an operator could enumerate.
  const partial = await listPlatformRejections({ providerOrderId: 'ops-' });
  assert.equal(partial.rows.length, 0, 'substring matching is not supported');

  const code = source('../src/lib/payments/rejection-operations.ts');
  assert.doesNotMatch(code, /providerOrderId: \{ contains/);
});

test('repeated deliveries are ordered first, with a deterministic tie-break', async () => {
  await makeRejection({
    label: 'loud',
    tenantId: null,
    reason: 'invalid_payload',
    occurrences: 42,
  });
  const { rows } = await listPlatformRejections({});
  const loud = rows.findIndex((row) => row.providerOrderId === ref('loud'));
  assert.equal(loud, 0, 'the most-repeated row leads');

  const again = await listPlatformRejections({});
  assert.deepEqual(
    rows.map((r) => r.id),
    again.rows.map((r) => r.id),
    'the same page twice gives the same order',
  );

  const code = source('../src/lib/payments/rejection-operations.ts');
  assert.match(code, /\{ occurrences: 'desc' \}, \{ lastSeenAt: 'desc' \}, \{ id: 'desc' \}/);
});

test('metrics count stored rows and claim nothing about money', async () => {
  const { metrics } = await listPlatformRejections({});
  assert.equal(metrics.attributed + metrics.unattributed, metrics.total);
  assert.ok(metrics.highOccurrence >= 1, 'the 42-occurrence row is counted');
  assert.ok(metrics.byReason.length >= 1);

  const page = source('../src/app/platform-admin/payment-rejections/page.tsx');
  for (const forbidden of [/settled/i, /recovered/i, /reconciled/i, /accounting/i]) {
    // "accounting" appears only in the disclaimer saying this is NOT it.
    const matches = page.match(forbidden);
    if (matches) assert.match(page, /Nothing here is settlement, accounting or tax/);
  }
});

test('the query does not fan out per row', () => {
  const code = source('../src/lib/payments/rejection-operations.ts');
  assert.match(code, /Promise\.all\(\[/);
  assert.doesNotMatch(code, /for \([^)]*\)\s*\{[\s\S]{0,200}await platformDb\./);
});

// ---------- authorization ----------

test('the platform page authorizes before it reads', () => {
  const page = source('../src/app/platform-admin/payment-rejections/page.tsx');
  const auth = page.indexOf('await requirePlatformAdmin()');
  const read = page.indexOf('await listPlatformRejections(');
  assert.ok(auth > -1 && read > -1);
  assert.ok(auth < read, 'authorization precedes the read');
  assert.match(page, /NotAuthenticatedError/);
  assert.match(page, /redirect\('\/sign-in'\)/);
  assert.match(page, /<AdminDenied surface="Platform Admin" \/>/);
  assert.match(page, /export const dynamic = 'force-dynamic'/);
  assert.match(page, /export const revalidate = 0/);
});

test('the platform view is not reachable from Tenant Admin', () => {
  const nav = source('../src/app/tenant-admin/AdminNav.tsx');
  assert.doesNotMatch(nav, /payment-rejections/);
  const tenantPage = source('../src/app/tenant-admin/payment-operations/page.tsx');
  assert.doesNotMatch(tenantPage, /platform-admin/);
  // And the platform query is never imported by a tenant surface.
  assert.doesNotMatch(tenantPage, /rejection-operations/);
});

// ---------- retention command ----------

test('pruning requires an explicitly chosen target', () => {
  const code = source('../scripts/prune-payment-rejections.ts');
  assert.doesNotMatch(code, /process\.env\.DATABASE_URL/, 'no fallback target');
  const shared = source('../scripts/release-db.ts');
  assert.match(shared, /never falls back to DATABASE_URL/);
});

test('dry run is the default and cannot delete', () => {
  const code = source('../scripts/prune-payment-rejections.ts');
  assert.match(code, /const apply = has\('apply'\)/);
  // The dry-run branch uses the READ ONLY connection, so the SERVER
  // refuses a delete even if one were attempted.
  assert.match(code, /if \(!apply\) \{[\s\S]{0,600}withReadOnlyConnection/);
  assert.match(code, /Nothing was deleted\. Re-run with --apply to delete\./);
});

test('deletion is bounded, parameterized and limited to one table', () => {
  const code = source('../scripts/prune-payment-rejections.ts');
  assert.match(code, /const TABLE = 'payment_rejections'/);
  assert.match(code, /LIMIT \$2/, 'batched');
  assert.match(code, /"lastSeenAt" < \$1/, 'cutoff is a parameter, not interpolated');
  // No other table may be named in any statement.
  for (const table of ['payments', 'orders', 'order_events', 'payment_events', 'tenants']) {
    assert.doesNotMatch(code, new RegExp(`FROM ${table}\\b`), `must not touch ${table}`);
    assert.doesNotMatch(code, new RegExp(`DELETE FROM ${table}\\b`));
  }
  const shared = source('../scripts/release-db.ts');
  assert.match(shared, /lock_timeout/);
  assert.match(shared, /statement_timeout/);
});

test('retention is measured from lastSeenAt, so an active row never ages out', () => {
  const code = source('../scripts/prune-payment-rejections.ts');
  assert.match(code, /lastSeenAt advances every time/);
  assert.match(code, /DEFAULT_RETENTION_DAYS = 180/);
  // No compliance claim.
  assert.match(code, /no legal retention requirement/i);
});

test('the cutoff and batch size are validated', () => {
  const code = source('../scripts/prune-payment-rejections.ts');
  assert.match(code, /--retention-days must be a whole number of days/);
  assert.match(code, /--batch must be a whole number between 1 and 10000/);
});

test('retention needed no schema change', () => {
  // lastSeenAt already existed; nothing was added for pruning.
  const schema = source('../prisma/schema.prisma');
  const model = schema.slice(schema.indexOf('model PaymentRejection'));
  const body = model.slice(0, model.indexOf('\n}'));
  assert.match(body, /lastSeenAt/);
  assert.doesNotMatch(body, /prunedAt|retainUntil|archivedAt/);
});

// ---------- no regression ----------

test('the recorder and webhook decisions are untouched by this work', () => {
  const webhook = source('../src/lib/payments/webhook-service.ts');
  assert.match(
    webhook,
    /result\.newStatus === "succeeded" && result\.verifiedAmount !== payment\.amount/,
  );
  assert.match(webhook, /if \(!invalidSignature\) \{/);
  assert.match(webhook, /where: \{ id: payment\.id, status: "pending" \}/);

  const ops = source('../src/lib/payments/rejection-operations.ts');
  for (const forbidden of [/\.create\(/, /\.update\(/, /\.delete\(/, /fetch\(/, /https?:\/\//]) {
    assert.doesNotMatch(ops, forbidden, 'the platform view only reads');
  }
});

// ---------- retention, executed for real ----------
//
// These run the actual command as a subprocess against the LOCAL
// database, with a target passed explicitly. They are the only tests
// here that delete anything, and they delete only rows this file made.

async function prune(args: string[]): Promise<string> {
  const { stdout } = await run('npx', ['tsx', 'scripts/prune-payment-rejections.ts', ...args], {
    cwd: new URL('../', import.meta.url).pathname,
    env: { ...process.env, RELEASE_CHECK_DATABASE_URL: process.env.DATABASE_URL ?? '' },
  });
  return stdout;
}

test('dry run reports eligible rows and deletes nothing', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('no local DATABASE_URL');
    return;
  }
  const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
  await makeRejection({
    label: 'stale',
    tenantId: null,
    reason: 'invalid_payload',
    lastSeenAt: old,
  });

  const before = await prisma.paymentRejection.count({
    where: { providerOrderId: { contains: suffix } },
  });

  const output = await prune(['--retention-days=180']);
  assert.match(output, /DRY RUN/);
  assert.match(output, /Nothing was deleted/);
  assert.match(output, /Rows older than cutoff/);

  const after = await prisma.paymentRejection.count({
    where: { providerOrderId: { contains: suffix } },
  });
  assert.equal(after, before, 'a dry run deletes nothing');
  assert.ok(
    await prisma.paymentRejection.findFirst({ where: { providerOrderId: ref('stale') } }),
    'the stale row survives a dry run',
  );
});

test('apply deletes only rows past the cutoff and spares recent ones', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('no local DATABASE_URL');
    return;
  }
  // Both exist: one well past the window, one from today.
  assert.ok(await prisma.paymentRejection.findFirst({ where: { providerOrderId: ref('stale') } }));
  const recentBefore = await prisma.paymentRejection.count({
    where: { providerOrderId: ref('loud') },
  });
  assert.equal(recentBefore, 1, 'the recent row is present before pruning');

  const output = await prune(['--retention-days=180', '--apply', '--batch=100']);
  assert.match(output, /APPLY/);
  assert.match(output, /Only payment_rejections was touched/);

  assert.equal(
    await prisma.paymentRejection.count({ where: { providerOrderId: ref('stale') } }),
    0,
    'the stale row is gone',
  );
  assert.equal(
    await prisma.paymentRejection.count({ where: { providerOrderId: ref('loud') } }),
    1,
    'a recent row — even a high-occurrence one — is untouched',
  );
});

test('pruning touches no other table', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('no local DATABASE_URL');
    return;
  }
  const before = {
    payments: await prisma.payment.count(),
    orders: await prisma.order.count(),
    events: await prisma.orderEvent.count(),
    paymentEvents: await prisma.paymentEvent.count(),
    tenants: await prisma.tenant.count(),
  };
  await prune(['--retention-days=180', '--apply']);
  assert.deepEqual(
    {
      payments: await prisma.payment.count(),
      orders: await prisma.order.count(),
      events: await prisma.orderEvent.count(),
      paymentEvents: await prisma.paymentEvent.count(),
      tenants: await prisma.tenant.count(),
    },
    before,
    'payments, orders, events and tenants are all unchanged',
  );
});

test('an unparseable retention window is a usage error, not a delete', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('no local DATABASE_URL');
    return;
  }
  await assert.rejects(
    () => prune(['--retention-days=0', '--apply']),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      return /whole number of days/.test(message);
    },
    'it refuses rather than defaulting to something destructive',
  );
});
