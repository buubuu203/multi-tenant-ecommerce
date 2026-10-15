// Tests for the read-only release-readiness tooling in scripts/.
//
// The read-only guarantee is the whole point of these scripts, so it is
// proven here against the real local database rather than asserted in a
// comment: the attempted writes below are REFUSED BY POSTGRES, which is
// also why running this file mutates nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  describeTarget,
  withReadOnlyConnection,
  UsageError,
  TARGET_ENV_VAR,
  EXIT_OK,
  EXIT_FAIL,
  EXIT_USAGE,
} from '../scripts/release-db';

const root = fileURLToPath(new URL('../', import.meta.url));

function source(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

// ---------- target selection ----------

test('the tooling refuses to run without an explicitly chosen target', async () => {
  const saved = process.env[TARGET_ENV_VAR];
  delete process.env[TARGET_ENV_VAR];
  try {
    await assert.rejects(
      () => withReadOnlyConnection(async () => null),
      (error: unknown) => error instanceof UsageError,
      'a missing target must be a usage error, not a crash',
    );
  } finally {
    if (saved !== undefined) process.env[TARGET_ENV_VAR] = saved;
  }
});

test('it never falls back to DATABASE_URL', () => {
  // Running "the check" against dev while believing you checked production
  // is the mistake this guards, so no fallback may exist anywhere.
  const src = source('scripts/release-db.ts');
  assert.equal(TARGET_ENV_VAR, 'RELEASE_CHECK_DATABASE_URL');
  assert.doesNotMatch(src, /process\.env\.DATABASE_URL/);
  assert.doesNotMatch(src, /process\.env\[['"]DATABASE_URL/);
  for (const script of ['scripts/order-event-preflight.ts', 'scripts/order-event-verify.ts']) {
    assert.doesNotMatch(source(script), /DATABASE_URL/, `${script} must not read DATABASE_URL`);
  }
});

// ---------- credential safety ----------

test('only host, port and database name are ever printed', () => {
  const described = describeTarget(
    'postgresql://someone:hunter2@db.internal:5433/shop?sslmode=require',
  );
  assert.equal(described, 'db.internal:5433/shop');
  assert.doesNotMatch(described, /someone|hunter2|sslmode/);
});

test('an unparseable connection string is never echoed back', () => {
  // It may BE the credential, so it must not reach the output.
  const described = describeTarget('not a url hunter2');
  assert.doesNotMatch(described, /hunter2/);
  assert.match(described, /unparseable/);
});

test('no script prints a whole connection string', () => {
  for (const script of [
    'scripts/release-db.ts',
    'scripts/order-event-preflight.ts',
    'scripts/order-event-verify.ts',
  ]) {
    const src = source(script);
    // Output always goes through describeTarget(), never the raw url.
    assert.doesNotMatch(src, /write\([^)]*\burl\b[^)]*\)/, `${script} must not print the url`);
  }
});

// ---------- the read-only guarantee, proven ----------

test('the connection cannot write, because PostgreSQL refuses', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('no local DATABASE_URL configured');
    return;
  }
  // Point the tooling at the LOCAL database only, explicitly.
  const saved = process.env[TARGET_ENV_VAR];
  process.env[TARGET_ENV_VAR] = process.env.DATABASE_URL;
  try {
    // A read works.
    const { result } = await withReadOnlyConnection(async (query) => {
      const rows = await query('SELECT count(*)::int AS n FROM order_events');
      return rows[0].n;
    });
    assert.equal(typeof result, 'number');

    // Every category of write is rejected by the server. Each would be a
    // real mutation if the transaction were not READ ONLY — that none of
    // them lands is exactly the guarantee.
    const writes: [string, string][] = [
      ['INSERT', "INSERT INTO order_events (id) VALUES ('nope')"],
      ['UPDATE', "UPDATE order_events SET summary = 'nope'"],
      ['DELETE', 'DELETE FROM order_events'],
      ['CREATE', 'CREATE TABLE readonly_probe (id int)'],
      ['ALTER', 'ALTER TABLE order_events ADD COLUMN readonly_probe int'],
      ['DROP', 'DROP INDEX IF EXISTS order_events_tenantId_idx'],
      ['TRUNCATE', 'TRUNCATE order_events'],
    ];

    for (const [label, sql] of writes) {
      await assert.rejects(
        () => withReadOnlyConnection(async (query) => query(sql)),
        (error: unknown) => error instanceof Error && /read-only transaction/i.test(error.message),
        `${label} must be refused by the server`,
      );
    }
  } finally {
    if (saved === undefined) delete process.env[TARGET_ENV_VAR];
    else process.env[TARGET_ENV_VAR] = saved;
  }
});

test('the data the tooling inspects is untouched by inspecting it', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('no local DATABASE_URL configured');
    return;
  }
  const saved = process.env[TARGET_ENV_VAR];
  process.env[TARGET_ENV_VAR] = process.env.DATABASE_URL;
  try {
    const count = async () =>
      (
        await withReadOnlyConnection(async (query) => {
          const rows = await query('SELECT count(*)::int AS n FROM order_events');
          return rows[0].n;
        })
      ).result;
    const before = await count();
    await withReadOnlyConnection(async (query) => query('SELECT 1 AS ok'));
    assert.equal(await count(), before);
  } finally {
    if (saved === undefined) delete process.env[TARGET_ENV_VAR];
    else process.env[TARGET_ENV_VAR] = saved;
  }
});

// ---------- structural guarantees ----------

test('the transaction is opened READ ONLY and always rolled back', () => {
  const src = source('scripts/release-db.ts');
  assert.match(src, /BEGIN TRANSACTION READ ONLY/);
  assert.match(src, /ROLLBACK/);
  assert.match(src, /finally/, 'the rollback is in a finally block');
  assert.match(src, /statement_timeout/, 'a check cannot become the slow query');
});

test('neither script can execute a migration or choose an option', () => {
  for (const script of ['scripts/order-event-preflight.ts', 'scripts/order-event-verify.ts']) {
    const src = source(script);
    assert.doesNotMatch(src, /migrate deploy|migrate dev|migrate resolve\b.*exec|execSync|spawn/);
    assert.doesNotMatch(src, /\bVACUUM\b/i);
  }
  // The preflight reports a risk level but must never pick a path.
  const pre = source('scripts/order-event-preflight.ts');
  assert.match(pre, /does not choose Option A or Option B and never executes either/);
});

test('exit codes are distinct and documented', () => {
  assert.equal(EXIT_OK, 0);
  assert.equal(EXIT_FAIL, 1);
  assert.equal(EXIT_USAGE, 2);
});

test('the verifier repairs nothing', () => {
  const src = source('scripts/order-event-verify.ts');
  assert.match(src, /repairs nothing/);
  // It reports and exits; it must not contain remediation SQL.
  assert.doesNotMatch(src, /ALTER TABLE|CREATE INDEX|UPDATE order_events/);
});
