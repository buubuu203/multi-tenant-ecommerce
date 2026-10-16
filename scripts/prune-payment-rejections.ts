import {
  withReadOnlyConnection,
  withWritableConnection,
  UsageError,
  usage,
  asNumber,
  scalar,
  line,
  EXIT_OK,
  EXIT_FAIL,
} from './release-db';

/**
 * Retention for rejected-webhook evidence.
 *
 * THE POLICY, in one paragraph. payment_rejections holds no payload — a
 * row is a provider name, a reason, two amounts, a bounded reference and
 * two timestamps. It is kept for a configurable window measured from
 * lastSeenAt, which has a useful property: lastSeenAt advances every time
 * the same rejected delivery arrives again, so a row a provider is still
 * retrying is never old and is never pruned. Only genuinely quiet
 * evidence ages out. There is no legal retention requirement encoded
 * here, because none has been verified — the window is an operational
 * default, not a compliance claim.
 *
 * Deletion is HARD and is never the default. The command reports and
 * exits unless --apply is passed, and even then it deletes in bounded
 * batches from exactly one table.
 */

const DEFAULT_RETENTION_DAYS = 180;
const DEFAULT_BATCH = 500;
const TABLE = 'payment_rejections';

function flag(name: string): string | undefined {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return match?.split('=')[1];
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const apply = has('apply');
  const retentionDays = Number(flag('retention-days') ?? DEFAULT_RETENTION_DAYS);
  const batchSize = Number(flag('batch') ?? DEFAULT_BATCH);

  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    usage('--retention-days must be a whole number of days, 1 or more.');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    usage('--batch must be a whole number between 1 and 10000.');
  }

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const out: string[] = [];

  out.push(`\nPayment rejection retention  —  ${apply ? 'APPLY' : 'DRY RUN'}`);
  out.push(line('Table', TABLE));
  out.push(line('Retention window', `${retentionDays} days`));
  out.push(line('Cutoff (lastSeenAt <)', cutoff.toISOString()));

  if (!apply) {
    // Dry run is physically incapable of deleting: it runs inside a
    // READ ONLY transaction, so the server would refuse a DELETE.
    const { target, result } = await withReadOnlyConnection(async (query) => {
      const eligible = asNumber(
        scalar(
          await query(`SELECT count(*)::bigint AS n FROM ${TABLE} WHERE "lastSeenAt" < $1`, [
            cutoff,
          ]),
          'n',
        ),
      );
      const total = asNumber(
        scalar(await query(`SELECT count(*)::bigint AS n FROM ${TABLE}`), 'n'),
      );
      const oldest = scalar(await query(`SELECT min("lastSeenAt")::text AS n FROM ${TABLE}`), 'n');
      return { eligible, total, oldest };
    });

    out.push(line('Target', target));
    out.push(line('Rows in table', String(result.total ?? 0)));
    out.push(line('Rows older than cutoff', String(result.eligible ?? 0)));
    out.push(line('Oldest lastSeenAt', String(result.oldest ?? '(none)')));
    out.push('\nNothing was deleted. Re-run with --apply to delete.');
    process.stdout.write(out.join('\n') + '\n');
    process.exit(EXIT_OK);
  }

  const { target, result } = await withWritableConnection(async (query) => {
    let deleted = 0;
    // Bounded batches, each its own statement, so a long run never holds
    // one enormous transaction open against a live database.
    for (;;) {
      const rows = await query(
        `DELETE FROM ${TABLE}
         WHERE id IN (
           SELECT id FROM ${TABLE} WHERE "lastSeenAt" < $1 ORDER BY "lastSeenAt" LIMIT $2
         )
         RETURNING id`,
        [cutoff, batchSize],
      );
      deleted += rows.length;
      if (rows.length < batchSize) break;
    }
    return deleted;
  });

  out.push(line('Target', target));
  out.push(line('Rows deleted', String(result)));
  out.push('\nOnly payment_rejections was touched.');
  process.stdout.write(out.join('\n') + '\n');
  process.exit(EXIT_OK);
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) usage(error.message);
  process.stderr.write(`\nPruning failed: ${error instanceof Error ? error.message : 'unknown'}\n`);
  process.exit(EXIT_FAIL);
});
