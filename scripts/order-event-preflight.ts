import {
  withReadOnlyConnection,
  UsageError,
  usage,
  line,
  asNumber,
  asString,
  scalar,
  MIGRATION_NAME,
  EXPECTED_SEQUENCE,
  EXPECTED_INDEX,
  LEGACY_INDEX,
  EXIT_OK,
  EXIT_FAIL,
  type QueryFn,
} from './release-db';

/**
 * Read-only preflight for 20261014160000_add_order_event_sequence.
 *
 * It gathers the facts §2 of the migration RUNBOOK asks for and prints a
 * decision summary. It deliberately does NOT choose between Option A and
 * Option B, and it never executes either — that judgement needs a human
 * who knows the maintenance window and the traffic pattern.
 *
 * Every statement runs in a READ ONLY transaction (see release-db.ts).
 */

type Verdict = 'APPLIED' | 'PENDING' | 'STOP';

async function collect(query: QueryFn) {
  const version = asString(
    scalar(await query(`SELECT current_setting('server_version') AS v`), 'v'),
  );

  const exactRows = asNumber(
    scalar(await query(`SELECT count(*)::bigint AS n FROM order_events`), 'n'),
  );

  const sizes = (
    await query(`
      SELECT pg_table_size('order_events')::bigint            AS heap,
             pg_indexes_size('order_events')::bigint          AS indexes,
             pg_total_relation_size('order_events')::bigint   AS total
    `)
  )[0];

  const estimate = (
    await query(
      `SELECT reltuples::bigint AS estimated, relpages::bigint AS pages
       FROM pg_class WHERE relname = $1`,
      ['order_events'],
    )
  )[0];

  const longRunning = await query(`
    SELECT pid, state, EXTRACT(EPOCH FROM (now() - xact_start))::bigint AS age_seconds
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND state <> 'idle'
      AND xact_start IS NOT NULL
      AND now() - xact_start > interval '30 seconds'
    ORDER BY xact_start
  `);

  // Lock waits touching this table specifically.
  const lockWaits = await query(`
    SELECT l.pid, l.mode
    FROM pg_locks l
    JOIN pg_class c ON c.oid = l.relation
    WHERE c.relname = 'order_events' AND NOT l.granted
  `);

  const recentWrites = asNumber(
    scalar(
      await query(
        `SELECT count(*)::bigint AS n FROM order_events WHERE "createdAt" > now() - interval '1 hour'`,
      ),
      'n',
    ),
  );

  const column = (
    await query(
      `SELECT data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'order_events' AND column_name = 'sequence'`,
    )
  )[0];

  const nullCount = column
    ? asNumber(
        scalar(
          await query(`SELECT count(*)::bigint AS n FROM order_events WHERE sequence IS NULL`),
          'n',
        ),
      )
    : null;

  const sequenceObject = (
    await query(
      `SELECT c.relname AS name, pg_get_serial_sequence('order_events', 'sequence') AS owned
       FROM pg_class c WHERE c.relkind = 'S' AND c.relname = $1`,
      [EXPECTED_SEQUENCE],
    )
  )[0];

  // relname, NOT indexrelid::regclass::text — regclass quotes mixed-case
  // identifiers ("order_events_tenantId_..."), so comparing that against a
  // bare constant silently never matches.
  const indexes = await query(
    `SELECT ic.relname AS name, i.indisvalid AS valid,
            COALESCE(s.idx_scan, 0)::bigint AS scans
     FROM pg_index i
     JOIN pg_class ic ON ic.oid = i.indexrelid
     JOIN pg_class c ON c.oid = i.indrelid
     LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = i.indexrelid
     WHERE c.relname = 'order_events'
     ORDER BY 1`,
  );

  const migration = (
    await query(
      `SELECT started_at, finished_at, rolled_back_at, applied_steps_count
       FROM _prisma_migrations WHERE migration_name = $1`,
      [MIGRATION_NAME],
    )
  )[0];

  return {
    version,
    exactRows,
    sizes,
    estimate,
    longRunning,
    lockWaits,
    recentWrites,
    column,
    nullCount,
    sequenceObject,
    indexes,
    migration,
  };
}

function mb(bytes: unknown): string {
  const n = asNumber(bytes);
  if (n == null) return 'unknown';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const { target, result } = await withReadOnlyConnection(collect);
  const r = result;

  const out: string[] = [];
  out.push(`\nOrderEvent migration preflight  —  READ ONLY`);
  out.push(`Target: ${target}`);
  out.push(`Migration: ${MIGRATION_NAME}\n`);

  out.push('Environment');
  out.push(line('PostgreSQL version', r.version ?? 'unknown'));
  const major = Number((r.version ?? '').split('.')[0]);
  out.push(
    line(
      'SET NOT NULL fast path (PG 12+)',
      Number.isFinite(major) && major >= 12 ? 'available' : 'NOT available',
    ),
  );

  out.push('\nTable');
  out.push(line('Exact rows', r.exactRows == null ? 'unknown' : r.exactRows.toLocaleString()));
  out.push(line('Planner estimate', String(asNumber(r.estimate?.estimated) ?? 'unknown')));
  out.push(line('Heap size', mb(r.sizes?.heap)));
  out.push(line('Index size', mb(r.sizes?.indexes)));
  out.push(line('Total size', mb(r.sizes?.total)));
  out.push(line('Events written in last hour', String(r.recentWrites ?? 'unknown')));

  out.push('\nActivity');
  out.push(line('Transactions open > 30s', String(r.longRunning.length)));
  out.push(line('Ungranted locks on order_events', String(r.lockWaits.length)));

  out.push('\nSchema state');
  out.push(line('sequence column', r.column ? 'present' : 'absent'));
  if (r.column) {
    out.push(line('  type', asString(r.column.data_type) ?? '?'));
    out.push(line('  nullable', asString(r.column.is_nullable) ?? '?'));
    out.push(line('  default', asString(r.column.column_default) ?? '(none)'));
    out.push(line('  null values', String(r.nullCount ?? 'unknown')));
  }
  out.push(line('sequence object', r.sequenceObject ? 'present' : 'absent'));
  if (r.sequenceObject) {
    out.push(line('  owned by column', asString(r.sequenceObject.owned) ?? '(not owned)'));
  }

  out.push('\nIndexes  (Phase 7 audit — this tool never drops anything)');
  for (const idx of r.indexes) {
    const name = asString(idx.name) ?? '?';
    const valid = idx.valid === false ? '  INVALID' : '';
    out.push(line(`  ${name}`, `${asNumber(idx.scans) ?? 0} scans${valid}`));
  }
  const hasNew = r.indexes.some((i) => asString(i.name) === EXPECTED_INDEX);
  const hasLegacy = r.indexes.some((i) => asString(i.name) === LEGACY_INDEX);
  out.push(line('expected sequence index', hasNew ? 'present' : 'absent'));
  out.push(line('legacy createdAt index', hasLegacy ? 'present (keep for now)' : 'absent'));
  out.push(
    '  NOTE: low idx_scan counts are NOT sufficient evidence to drop an index.\n' +
      '        Removal needs a separate reviewed schema change plus a query audit\n' +
      '        over a representative period on this environment.',
  );

  out.push('\nMigration history');
  if (!r.migration) {
    out.push(line('_prisma_migrations row', 'absent'));
  } else {
    out.push(line('started_at', asString(r.migration.started_at) ?? '?'));
    out.push(line('finished_at', asString(r.migration.finished_at) ?? '(null)'));
    out.push(line('rolled_back_at', asString(r.migration.rolled_back_at) ?? '(null)'));
  }

  // ---- decision summary -------------------------------------------------
  const recorded = Boolean(r.migration?.finished_at);
  const failedAttempt = Boolean(r.migration) && !r.migration?.finished_at;
  const rolledBack = Boolean(r.migration?.rolled_back_at);
  const columnPresent = Boolean(r.column);
  const invalidIndex = r.indexes.some((i) => i.valid === false);

  const stops: string[] = [];
  if (rolledBack) stops.push('A previous attempt is recorded as rolled back.');
  if (failedAttempt)
    stops.push('A _prisma_migrations row exists with no finished_at — a failed attempt.');
  if (columnPresent && !recorded)
    stops.push(
      'The sequence column exists but the migration is not recorded as applied. ' +
        'This looks like a partially completed Option B.',
    );
  if (recorded && !columnPresent)
    stops.push('The migration is recorded as applied but the column is missing.');
  if (columnPresent && (r.nullCount ?? 0) > 0)
    stops.push(`${r.nullCount} rows have a NULL sequence.`);
  if (columnPresent && !r.sequenceObject)
    stops.push(`Expected sequence ${EXPECTED_SEQUENCE} is missing.`);
  if (columnPresent && !hasNew) stops.push(`Expected index ${EXPECTED_INDEX} is missing.`);
  if (invalidIndex) stops.push('An INVALID index exists (interrupted CREATE INDEX CONCURRENTLY).');

  let verdict: Verdict;
  if (stops.length > 0) verdict = 'STOP';
  else if (recorded && columnPresent) verdict = 'APPLIED';
  else verdict = 'PENDING';

  out.push('\n' + '─'.repeat(64));
  out.push(`VERDICT: ${verdict}`);
  out.push('─'.repeat(64));

  if (verdict === 'STOP') {
    out.push('Partial or inconsistent state. Do NOT run either option. Escalate.');
    for (const s of stops) out.push(`  • ${s}`);
  } else if (verdict === 'APPLIED') {
    out.push('Already applied and consistent. Run the post-deployment verification:');
    out.push('  npm run release:verify:order-events');
  } else {
    out.push('Migration is PENDING on this target.');
    // Lock-risk signal only — never a choice.
    const rows = r.exactRows ?? 0;
    const risk = rows < 100_000 ? 'LOW' : rows < 1_000_000 ? 'MEDIUM' : 'HIGH';
    out.push(line('Estimated rewrite/lock risk', risk));
    out.push(
      '  ADD COLUMN ... SERIAL rewrites the table under ACCESS EXCLUSIVE,\n' +
        '  which blocks reads AND writes — including checkout, which records an\n' +
        '  OrderEvent in the same transaction.',
    );
    if (r.longRunning.length > 0 || r.lockWaits.length > 0) {
      out.push(
        '  WARNING: long-running transactions or lock waits are present right now.\n' +
          '           An ALTER would queue behind them and every reader behind it.',
      );
    }
    out.push(
      '\n  This tool does not choose Option A or Option B and never executes either.\n' +
        '  Take these numbers to RUNBOOK.md §3 and decide with a human.',
    );
  }

  process.stdout.write(out.join('\n') + '\n');
  process.exit(verdict === 'STOP' ? EXIT_FAIL : EXIT_OK);
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) usage(error.message);
  process.stderr.write(
    `\nPreflight failed: ${error instanceof Error ? error.message : 'unknown'}\n`,
  );
  process.exit(EXIT_FAIL);
});
