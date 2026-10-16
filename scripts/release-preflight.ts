import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { withReadOnlyConnection, UsageError, usage, line, EXIT_OK, EXIT_FAIL } from './release-db';

/**
 * Whole-release migration readiness for one target database.
 *
 * The per-feature checks (order-event-preflight, order-event-verify)
 * answer "is THIS migration safe here". This answers the question that
 * comes first: which migrations does this target not have yet, and does
 * its history agree with the repository at all.
 *
 * Read-only, same guarantees as every other check in this directory: an
 * explicitly chosen target with no fallback to DATABASE_URL, a READ ONLY
 * transaction the server enforces, a statement timeout, and output that
 * contains host:port/database and never a connection string.
 *
 * It never applies anything and never chooses a deployment strategy.
 */

const MIGRATIONS_DIR = 'prisma/migrations';

/**
 * Deployment notes for migrations that need a human decision. Keyed by
 * directory name, so a migration without an entry is simply ordinary.
 */
const RISK_NOTES: Record<string, string> = {
  '20261014160000_add_order_event_sequence':
    'ADD COLUMN ... SERIAL rewrites order_events under ACCESS EXCLUSIVE, blocking reads AND writes — ' +
    'including checkout, which records an event in the same transaction. Lock time scales with table size. ' +
    'See the RUNBOOK: measure on a production-sized copy, then pick Option A (run it) or Option B (online, then resolve).',
  '20261016120000_add_payment_rejections':
    'Additive: one enum, one table, two indexes. No existing column is altered and no row is rewritten, ' +
    'so the lock is brief regardless of table size. No backfill is possible — rejections before it were never recorded.',
};

function localMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((entry) => statSync(join(MIGRATIONS_DIR, entry)).isDirectory())
    .sort();
}

type AppliedRow = {
  migration_name: string;
  finished_at: string | null;
  rolled_back_at: string | null;
};

async function main() {
  const local = localMigrations();

  const { target, result } = await withReadOnlyConnection(async (query) => {
    // A target with no Prisma history at all is a legitimate answer, not
    // a crash: it means nothing has ever been migrated there.
    const hasTable = await query(
      `SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`,
    );
    if (hasTable[0]?.present !== true) return null;

    const rows = await query(
      `SELECT migration_name, finished_at::text, rolled_back_at::text
       FROM _prisma_migrations ORDER BY started_at`,
    );
    return rows as unknown as AppliedRow[];
  });

  const out: string[] = [];
  out.push(`\nRelease migration preflight  —  READ ONLY`);
  out.push(line('Target', target));
  out.push(line('Migrations in repository', String(local.length)));

  if (result === null) {
    out.push(line('_prisma_migrations table', 'ABSENT'));
    out.push('\n' + '─'.repeat(64));
    out.push('VERDICT: STOP');
    out.push('─'.repeat(64));
    out.push('This database has no Prisma migration history. It is either brand new or');
    out.push('not the database you meant. Confirm the target before deploying anything.');
    process.stdout.write(out.join('\n') + '\n');
    process.exit(EXIT_FAIL);
  }

  const applied = new Map(result.map((row) => [row.migration_name, row]));

  const pending: string[] = [];
  const failed: string[] = [];
  const rolledBack: string[] = [];
  for (const name of local) {
    const row = applied.get(name);
    if (!row) {
      pending.push(name);
      continue;
    }
    if (row.rolled_back_at) rolledBack.push(name);
    else if (!row.finished_at) failed.push(name);
  }

  // Recorded in the target but absent from the repository: the database
  // is ahead of this checkout, or someone deleted a migration directory.
  const unknown = result.map((row) => row.migration_name).filter((name) => !local.includes(name));

  out.push(
    line(
      'Applied cleanly',
      String(local.length - pending.length - failed.length - rolledBack.length),
    ),
  );
  out.push(line('Pending', String(pending.length)));
  out.push(line('Failed (never finished)', String(failed.length)));
  out.push(line('Rolled back', String(rolledBack.length)));
  out.push(line('Recorded but not in repo', String(unknown.length)));

  if (pending.length > 0) {
    out.push('\nPending migrations, oldest first:');
    for (const name of pending) {
      out.push(`  • ${name}`);
      const note = RISK_NOTES[name];
      if (note) {
        for (const chunk of note.match(/.{1,72}(\s|$)/g) ?? [note]) {
          out.push(`      ${chunk.trim()}`);
        }
      }
    }
  }

  for (const [label, names] of [
    ['FAILED', failed],
    ['ROLLED BACK', rolledBack],
    ['RECORDED BUT MISSING FROM THIS CHECKOUT', unknown],
  ] as const) {
    if (names.length > 0) {
      out.push(`\n${label}:`);
      for (const name of names) out.push(`  • ${name}`);
    }
  }

  const inconsistent = failed.length > 0 || rolledBack.length > 0 || unknown.length > 0;

  out.push('\n' + '─'.repeat(64));
  if (inconsistent) {
    out.push('VERDICT: STOP');
    out.push('─'.repeat(64));
    out.push("This target's migration history does not agree with the repository.");
    out.push('Do not deploy. Reconcile first, and do not guess at `migrate resolve`.');
    process.stdout.write(out.join('\n') + '\n');
    process.exit(EXIT_FAIL);
  }

  if (pending.length > 0) {
    out.push('VERDICT: PENDING');
    out.push('─'.repeat(64));
    out.push('History is consistent. The migrations above have not been applied here.');
    out.push('Read each risk note, then run the per-migration preflight where one exists:');
    out.push('  npm run release:preflight:order-events');
    out.push('\nThis command applies nothing and chooses no deployment strategy.');
  } else {
    out.push('VERDICT: UP TO DATE');
    out.push('─'.repeat(64));
    out.push('Every migration in this checkout is applied here. Verify the end state:');
    out.push('  npm run release:verify:order-events');
  }

  process.stdout.write(out.join('\n') + '\n');
  process.exit(EXIT_OK);
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) usage(error.message);
  process.stderr.write(
    `\nRelease preflight failed: ${error instanceof Error ? error.message : 'unknown'}\n`,
  );
  process.exit(EXIT_FAIL);
});
