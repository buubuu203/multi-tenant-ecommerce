import { readFileSync } from 'node:fs';
import {
  withReadOnlyConnection,
  UsageError,
  usage,
  asNumber,
  asString,
  scalar,
  MIGRATION_NAME,
  EXPECTED_SEQUENCE,
  EXPECTED_INDEX,
  EXIT_OK,
  EXIT_FAIL,
  type QueryFn,
} from './release-db';

/**
 * Post-deployment verification for the OrderEvent sequence migration.
 *
 * Run AFTER an operator has completed Option A or Option B. It proves the
 * end state matches what the schema expects and that the timeline really
 * reads in creation order. It repairs nothing: every failure is reported
 * with the exact discrepancy and the process exits non-zero.
 *
 * Read-only, same guarantee as the preflight (see release-db.ts).
 */

type Check = { name: string; ok: boolean; detail: string };

function check(name: string, ok: boolean, detail: string): Check {
  return { name, ok, detail };
}

async function run(query: QueryFn): Promise<Check[]> {
  const checks: Check[] = [];

  const column = (
    await query(
      `SELECT data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'order_events' AND column_name = 'sequence'`,
    )
  )[0];

  checks.push(check('sequence column exists', Boolean(column), column ? 'present' : 'MISSING'));

  if (column) {
    const type = asString(column.data_type);
    checks.push(check('type is integer', type === 'integer', `got ${type}`));

    const nullable = asString(column.is_nullable);
    checks.push(check('column is NOT NULL', nullable === 'NO', `is_nullable=${nullable}`));

    const def = asString(column.column_default) ?? '';
    checks.push(
      check(
        'default uses the expected sequence',
        def.includes(EXPECTED_SEQUENCE),
        def === '' ? '(no default)' : def,
      ),
    );
  }

  const nulls = asNumber(
    scalar(
      await query(`SELECT count(*)::bigint AS n FROM order_events WHERE sequence IS NULL`),
      'n',
    ),
  );
  checks.push(check('no NULL sequence values', nulls === 0, `${nulls} null rows`));

  // Global uniqueness. Ordering only needs distinctness within an order,
  // but a single sequence gives it globally, so a duplicate anywhere means
  // the backfill collided with live inserts.
  const dupes = asNumber(
    scalar(
      await query(`SELECT (count(*) - count(DISTINCT sequence))::bigint AS n FROM order_events`),
      'n',
    ),
  );
  checks.push(check('no duplicate sequence values', dupes === 0, `${dupes} duplicates`));

  const perOrderDupes = asNumber(
    scalar(
      await query(`
        SELECT COALESCE(sum(c), 0)::bigint AS n FROM (
          SELECT count(*) - count(DISTINCT sequence) AS c
          FROM order_events GROUP BY "tenantId", "orderId"
        ) t
      `),
      'n',
    ),
  );
  checks.push(
    check('no duplicates within any order', perOrderDupes === 0, `${perOrderDupes} duplicates`),
  );

  // Catalog lookups only: naming the sequence directly in SQL would throw
  // instead of reporting a clean failure when it is the missing thing.
  const seqObj = (
    await query(
      `SELECT pg_get_serial_sequence('order_events', 'sequence') AS owned,
              (SELECT count(*) FROM pg_class WHERE relkind = 'S' AND relname = $1)::bigint AS exists_count`,
      [EXPECTED_SEQUENCE],
    )
  )[0];
  checks.push(
    check(
      `sequence ${EXPECTED_SEQUENCE} exists`,
      (asNumber(seqObj?.exists_count) ?? 0) > 0,
      'not found in pg_class',
    ),
  );
  checks.push(
    check(
      'sequence is owned by the column',
      Boolean(seqObj?.owned),
      asString(seqObj?.owned) ?? 'not owned by the column',
    ),
  );

  // Join pg_class for the unquoted name; regclass::text would quote the
  // mixed-case identifier and never match the parameter.
  const idx = (
    await query(
      `SELECT i.indisvalid AS valid
       FROM pg_index i
       JOIN pg_class ic ON ic.oid = i.indexrelid
       WHERE ic.relname = $1`,
      [EXPECTED_INDEX],
    )
  )[0];
  checks.push(check('expected index exists', Boolean(idx), idx ? 'present' : 'MISSING'));
  if (idx) {
    checks.push(check('index is valid', idx.valid === true, `indisvalid=${String(idx.valid)}`));
  }

  // Ordering actually holds: for every order with more than one event, the
  // sequence order must agree with a strictly increasing walk, and the
  // first event must be the creation one where such an event exists.
  const misordered = asNumber(
    scalar(
      await query(`
        SELECT count(*)::bigint AS n FROM (
          SELECT "tenantId", "orderId",
                 bool_and(sequence > prev) AS ok
          FROM (
            SELECT "tenantId", "orderId", sequence,
                   lag(sequence) OVER (PARTITION BY "tenantId", "orderId" ORDER BY sequence) AS prev
            FROM order_events
          ) w
          WHERE prev IS NOT NULL
          GROUP BY "tenantId", "orderId"
        ) g
        WHERE ok IS NOT TRUE
      `),
      'n',
    ),
  );
  checks.push(
    check(
      'sequence strictly increases within every order',
      misordered === 0,
      `${misordered} orders`,
    ),
  );

  const creationNotFirst = asNumber(
    scalar(
      await query(`
        SELECT count(*)::bigint AS n FROM (
          SELECT DISTINCT ON ("tenantId", "orderId") "tenantId", "orderId", type
          FROM order_events
          ORDER BY "tenantId", "orderId", sequence
        ) f
        WHERE f.type <> 'order_created'
          AND EXISTS (
            SELECT 1 FROM order_events e
            WHERE e."tenantId" = f."tenantId" AND e."orderId" = f."orderId"
              AND e.type = 'order_created'
          )
      `),
      'n',
    ),
  );
  checks.push(
    check(
      'order_created is first wherever it exists',
      creationNotFirst === 0,
      `${creationNotFirst} orders read out of order`,
    ),
  );

  const migration = (
    await query(
      `SELECT finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = $1`,
      [MIGRATION_NAME],
    )
  )[0];
  checks.push(
    check(
      'migration recorded as applied',
      Boolean(migration?.finished_at) && !migration?.rolled_back_at,
      migration
        ? `finished_at=${asString(migration.finished_at) ?? 'null'} rolled_back_at=${asString(migration.rolled_back_at) ?? 'null'}`
        : 'no _prisma_migrations row',
    ),
  );

  return checks;
}

/**
 * Source-level check, not a database one: the application's timeline DTO
 * must not leak the ordering key. Kept here so one command covers the
 * whole contract an operator cares about after deploying.
 */
function checkDtoDoesNotExposeSequence(): Check {
  const src = readFileSync(new URL('../src/lib/order-events.ts', import.meta.url), 'utf8');
  const dto = src.slice(src.indexOf('export type OrderTimelineEntry'));
  const body = dto.slice(0, dto.indexOf('};') + 2);
  return check(
    'sequence is not exposed in the timeline DTO',
    !/\bsequence\b/.test(body),
    body.includes('sequence') ? 'OrderTimelineEntry mentions sequence' : 'not exposed',
  );
}

async function main() {
  const { target, result } = await withReadOnlyConnection(run);
  const checks = [...result, checkDtoDoesNotExposeSequence()];

  const out: string[] = [];
  out.push(`\nOrderEvent migration verification  —  READ ONLY`);
  out.push(`Target: ${target}`);
  out.push(`Migration: ${MIGRATION_NAME}\n`);

  for (const c of checks) {
    out.push(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(48)} ${c.ok ? '' : `→ ${c.detail}`}`);
  }

  const failed = checks.filter((c) => !c.ok);
  out.push('\n' + '─'.repeat(64));
  if (failed.length === 0) {
    out.push(`VERIFIED: all ${checks.length} checks passed.`);
    out.push('─'.repeat(64));
    out.push('This confirms the schema end state and stored ordering only.');
    out.push('Application smoke tests (RUNBOOK §7.4) are still required.');
    process.stdout.write(out.join('\n') + '\n');
    process.exit(EXIT_OK);
  }

  out.push(`FAILED: ${failed.length} of ${checks.length} checks.`);
  out.push('─'.repeat(64));
  out.push('This tool repairs nothing. Each failure above names the exact');
  out.push('discrepancy — see RUNBOOK.md §6 for resume/rollback guidance.');
  process.stdout.write(out.join('\n') + '\n');
  process.exit(EXIT_FAIL);
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) usage(error.message);
  process.stderr.write(
    `\nVerification failed: ${error instanceof Error ? error.message : 'unknown'}\n`,
  );
  process.exit(EXIT_FAIL);
});
