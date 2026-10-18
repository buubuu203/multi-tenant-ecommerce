import { Client } from 'pg';

/**
 * Shared plumbing for the release-readiness checks in this directory.
 *
 * These scripts are pointed at a database an operator chooses deliberately,
 * which may be a production one. Three properties therefore matter more
 * than convenience:
 *
 *  1. They never pick a target by themselves. There is no fallback to
 *     DATABASE_URL — running "the check" against your dev database while
 *     believing you checked production is the exact mistake this guards.
 *  2. They cannot write. Every statement runs inside a PostgreSQL
 *     READ ONLY transaction that is always rolled back, so INSERT, UPDATE,
 *     DELETE, CREATE, ALTER, DROP and TRUNCATE are refused by the SERVER,
 *     not merely avoided by this code.
 *  3. They never print a connection URL. Only host, port and database name
 *     are ever shown, so output is safe to paste into a ticket.
 */

/** The one variable that selects a target. Deliberately not DATABASE_URL. */
export const TARGET_ENV_VAR = 'RELEASE_CHECK_DATABASE_URL';

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_USAGE = 2;

/** Host/port/database only — never user, password or query parameters. */
export function describeTarget(url: string): string {
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//, '') || '(default)';
    return `${parsed.hostname}:${parsed.port || '5432'}/${database}`;
  } catch {
    // Never echo the raw value back: it may be the credential itself.
    return '(unparseable connection string)';
  }
}

export class UsageError extends Error {}

/**
 * The npm script the operator actually invoked, for the usage message.
 *
 * Without this every script printed the order-events example, so running
 * `release:preflight` or `release:prune:rejections` without a target told
 * you to run a DIFFERENT command than the one you had just typed. A
 * release check that misnames itself is a small thing that costs real
 * time at exactly the wrong moment.
 *
 * Falls back to the generic form rather than guessing, so an unmapped or
 * directly-invoked script still prints something true.
 */
const SCRIPT_TO_NPM: Record<string, string> = {
  'release-preflight.ts': 'npm run release:preflight',
  'order-event-preflight.ts': 'npm run release:preflight:order-events',
  'order-event-verify.ts': 'npm run release:verify:order-events',
  'prune-payment-rejections.ts': 'npm run release:prune:rejections',
};

export function invokedCommand(): string {
  const entry = process.argv[1] ?? '';
  const base = entry.slice(entry.lastIndexOf('/') + 1);
  return SCRIPT_TO_NPM[base] ?? `tsx scripts/${base || '<script>'}`;
}

function missingTargetMessage(): string {
  return (
    `${TARGET_ENV_VAR} is not set.\n\n` +
    `This check never guesses a target and never falls back to DATABASE_URL.\n` +
    `Set it explicitly for the environment you intend to inspect:\n` +
    `  ${TARGET_ENV_VAR}="postgresql://..." ${invokedCommand()}\n`
  );
}

/**
 * Runs `fn` inside a read-only, always-rolled-back transaction.
 *
 * statement_timeout is set so a check against a busy production database
 * can never become the slow query that causes an incident.
 */
export async function withReadOnlyConnection<T>(
  fn: (query: QueryFn) => Promise<T>,
): Promise<{ target: string; result: T }> {
  const url = process.env[TARGET_ENV_VAR];
  if (!url || url.trim() === '') {
    throw new UsageError(missingTargetMessage());
  }

  const client = new Client({ connectionString: url, statement_timeout: 15_000 });
  try {
    await client.connect();
  } catch (error) {
    throw new UsageError(
      `Could not connect to ${describeTarget(url)}: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }

  try {
    // Server-enforced. Any write attempted below fails with
    // "cannot execute ... in a read-only transaction".
    await client.query('BEGIN TRANSACTION READ ONLY');
    const query: QueryFn = async (text, values) => {
      const res = await client.query(text, values);
      return res.rows as Record<string, unknown>[];
    };
    const result = await fn(query);
    return { target: describeTarget(url), result };
  } finally {
    // Rollback even on success: nothing here should ever commit.
    try {
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
  }
}

/**
 * A WRITABLE connection, for the one maintenance task that must delete.
 *
 * Deliberately separate from withReadOnlyConnection and deliberately
 * harder to reach: it takes the same explicitly-chosen target variable,
 * never falls back to DATABASE_URL, and sets both a statement timeout and
 * a lock timeout so a maintenance run against a busy database fails fast
 * instead of blocking it. The caller owns its own transactions.
 */
export async function withWritableConnection<T>(
  fn: (query: QueryFn) => Promise<T>,
): Promise<{ target: string; result: T }> {
  const url = process.env[TARGET_ENV_VAR];
  if (!url || url.trim() === '') {
    throw new UsageError(missingTargetMessage());
  }

  const client = new Client({
    connectionString: url,
    statement_timeout: 30_000,
    query_timeout: 30_000,
  });
  try {
    await client.connect();
  } catch (error) {
    throw new UsageError(
      `Could not connect to ${describeTarget(url)}: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }

  try {
    await client.query("SET lock_timeout = '5s'");
    const query: QueryFn = async (text, values) => {
      const res = await client.query(text, values);
      return res.rows as Record<string, unknown>[];
    };
    return { target: describeTarget(url), result: await fn(query) };
  } finally {
    await client.end();
  }
}

export type QueryFn = (text: string, values?: unknown[]) => Promise<Record<string, unknown>[]>;

/** Narrow a single scalar out of a one-row result without casting tricks. */
export function scalar(rows: Record<string, unknown>[], column: string): unknown {
  if (rows.length === 0) return undefined;
  return rows[0][column];
}

export function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : value == null ? null : String(value);
}

/** Pretty one-line status rows, so output is scannable in a terminal. */
export function line(label: string, value: string): string {
  return `  ${label.padEnd(34)} ${value}`;
}

export function fail(message: string): never {
  process.stderr.write(`\n${message}\n`);
  process.exit(EXIT_FAIL);
}

export function usage(message: string): never {
  process.stderr.write(`\n${message}\n`);
  process.exit(EXIT_USAGE);
}

/** The migration these checks are about. */
export const MIGRATION_NAME = '20261014160000_add_order_event_sequence';
export const EXPECTED_SEQUENCE = 'order_events_sequence_seq';
export const EXPECTED_INDEX = 'order_events_tenantId_orderId_sequence_idx';
export const LEGACY_INDEX = 'order_events_tenantId_orderId_createdAt_idx';
