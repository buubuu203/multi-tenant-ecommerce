# Deploying `20261014160000_add_order_event_sequence`

This migration is **not safe to run unattended on a large `order_events`
table**. Read this before deploying to Preview or Production.

As of writing it has been applied to the **local development database only**.

## What the migration does, and why that is a problem

```sql
ALTER TABLE "order_events" ADD COLUMN "sequence" SERIAL;
```

`SERIAL` means the column's default is `nextval(...)`, which PostgreSQL
classifies as **volatile** (`pg_proc.provolatile = 'v'`). PostgreSQL 11+
can add a column with a *constant* default as a metadata-only change, but a
volatile default forces it to **rewrite the entire table** so it can
evaluate the default once per row.

Measured locally on a 100-row table rather than assumed — `pg_class.relfilenode`
is the file backing the table, so a change means the table was rewritten:

| Statement | relfilenode | Rewrite |
|---|---|---|
| *(baseline)* | 16922 | — |
| `ADD COLUMN seq SERIAL` | 16927 | **yes** |
| `ADD COLUMN seq2 integer` (nullable, no default) | 16927 | no |

Lock taken, read from `pg_locks` during the statement:

```
AccessExclusiveLock on order_events
AccessExclusiveLock on order_events_sequence_seq
```

`ACCESS EXCLUSIVE` is PostgreSQL's strongest table lock. It blocks
**everything**, including plain `SELECT`. It is held for the full duration
of the rewrite, so the outage is proportional to table size, not constant.
On a table of a few thousand rows this is milliseconds. On tens of millions
it is minutes of total unavailability for `order_events` — which means
checkout and order status writes block too, because they record events in
the same transaction.

A follow-up migration **cannot fix this**. Migrations run in order, so
anything added later executes *after* the rewrite has already happened. The
only way to avoid the lock is to not let this script run against the large
table — see "Option B".

## Preflight (run against the target database, read-only)

```sql
-- 1. Size. This is the decision input.
SELECT count(*) AS rows,
       pg_size_pretty(pg_total_relation_size('order_events')) AS total_size
FROM order_events;

-- 2. Has it somehow already been applied?
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'order_events' AND column_name = 'sequence';

-- 3. Migration state as Prisma sees it.
SELECT migration_name, finished_at, rolled_back_at
FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5;

-- 4. Anything long-running that the ALTER would queue behind, and that
--    would in turn queue every reader behind it.
SELECT pid, state, wait_event_type, now() - xact_start AS age, query
FROM pg_stat_activity
WHERE datname = current_database() AND state <> 'idle'
ORDER BY xact_start;
```

## Decision criteria

| `count(*)` | Action |
|---|---|
| under ~100k | **Option A.** Run the migration normally. Expect well under a second of lock. Still deploy outside peak. |
| ~100k – 1M | **Option A inside a short maintenance window**, with `lock_timeout` set. Measure on a Preview copy of comparable size first. |
| over ~1M, or any table where a multi-second write stall is unacceptable | **Option B.** Do not let this script run. |

These thresholds are rules of thumb about rewrite throughput, not
guarantees. The honest version: **measure it on Preview with a
production-sized table and use that number.**

## Option A — run it normally (small table)

```bash
# Always lock_timeout, so a blocked ALTER fails fast instead of silently
# queueing every reader behind it.
PGOPTIONS='-c lock_timeout=5s' npx prisma migrate deploy
```

If it fails on lock timeout, nothing was changed — retry when the table is
quiet. Never use `prisma migrate dev` against a deployed database: it can
reset the database if it detects drift.

## Option B — perform it online, then record it as applied

Produce the identical end state with non-blocking statements, then tell
Prisma the migration is done so its script never runs.

The end state must match **exactly** what the schema expects, or the next
`migrate diff` reports drift:

- column `sequence`, type `integer`, `NOT NULL`,
  default `nextval('order_events_sequence_seq'::regclass)`
- the sequence owned by the column
- index `order_events_tenantId_orderId_sequence_idx` on
  `("tenantId", "orderId", "sequence")`

```sql
-- B1. Metadata-only. No rewrite (verified above). Momentary ACCESS EXCLUSIVE.
ALTER TABLE order_events ADD COLUMN sequence integer;

-- B2. Create the sequence SERIAL would have created, by the same name.
--     Start it above the current row count with generous headroom, so every
--     NEW row sorts after every backfilled historical row.
SELECT count(*) FROM order_events;              -- call this N
CREATE SEQUENCE order_events_sequence_seq START WITH <N + 1000000>;
ALTER SEQUENCE order_events_sequence_seq OWNED BY order_events.sequence;

-- B3. Default BEFORE the backfill, so rows inserted *during* the backfill
--     get a value immediately and are never missed by it.
ALTER TABLE order_events
  ALTER COLUMN sequence SET DEFAULT nextval('order_events_sequence_seq');

-- B4. Backfill historical rows only, in batches. Values 1..N stay below the
--     sequence start, so they order before everything written since B3.
--     Repeat until it reports 0 rows. Keep batches small; each one is its
--     own transaction and takes only row locks.
WITH already AS (
  -- How many historical rows are already done. Backfilled values live below
  -- the sequence start, so this never counts a live row.
  SELECT COALESCE(max(sequence), 0) AS done
  FROM order_events
  WHERE sequence < <N + 1000000>
),
batch AS (
  SELECT id,
         row_number() OVER (ORDER BY "createdAt", id) + (SELECT done FROM already) AS seq
  FROM order_events
  WHERE sequence IS NULL
  ORDER BY "createdAt", id
  LIMIT 5000
)
UPDATE order_events e
SET sequence = batch.seq
FROM batch
WHERE e.id = batch.id;

-- B5. Verify before tightening.
SELECT count(*) FROM order_events WHERE sequence IS NULL;        -- must be 0
SELECT count(*) - count(DISTINCT sequence) FROM order_events;    -- must be 0

-- B6. NOT NULL still needs a full scan to validate, under ACCESS EXCLUSIVE —
--     but a scan is far cheaper than a rewrite, and with no NULLs left it is
--     a read of the table, not a copy of it. Use a lock_timeout.
SET lock_timeout = '5s';
ALTER TABLE order_events ALTER COLUMN sequence SET NOT NULL;
RESET lock_timeout;

-- B7. The index, without blocking writes. CONCURRENTLY cannot run inside a
--     transaction block, which is exactly why this is not a Prisma migration
--     (see the note below). Run it as its own statement.
CREATE INDEX CONCURRENTLY order_events_tenantId_orderId_sequence_idx
  ON order_events ("tenantId", "orderId", "sequence");
```

If B7 is interrupted it leaves an `INVALID` index. Check and redo:

```sql
SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
DROP INDEX CONCURRENTLY IF EXISTS order_events_tenantId_orderId_sequence_idx;
```

Then record the migration **without executing it**:

```bash
npx prisma migrate resolve --applied 20261014160000_add_order_event_sequence
npx prisma migrate status   # must report up to date
```

Finally confirm no drift, against a shadow database — never the live one:

```bash
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script          # expect: no differences
```

## Why this is not shipped as a second migration

Prisma applies each migration file as a single script
(`apply_migration.rs` / `apply_script`), which PostgreSQL executes as one
implicit transaction. `CREATE INDEX CONCURRENTLY` is rejected inside a
transaction block, so step B7 cannot live in a Prisma migration at all. No
migration in this repository uses `CONCURRENTLY`. More fundamentally, a
second migration would run *after* the first one's rewrite, so it could not
prevent the lock it exists to avoid. The online path is therefore
operational by nature, not a file we can commit.

## Concurrency and ordering correctness

- **New inserts during the backfill** are safe: B3 sets the default before
  B4 begins, so any row written mid-backfill already has a value drawn from
  the sequence, is not `NULL`, and is skipped by the `WHERE sequence IS NULL`
  batch predicate.
- **Backfilled values never collide with live ones**: historical rows take
  `1..N`, the sequence starts at `N + 1000000`. B5 asserts distinctness.
- **No gap in coverage**: application code never writes `sequence`
  (asserted by test), so the default is the only producer.
- **Uniqueness** is not declared on the column and is not required —
  ordering only needs the values to be distinct and increasing per order,
  which a single sequence guarantees. B5 checks it anyway.

### The one thing the online path does worse

**Exact historical insertion order cannot be recovered from the existing
data.** It was never stored. The backfill orders by `("createdAt", id)`,
and `createdAt` is millisecond-precision — which is the very tie that
caused this bug. Where two historical rows share a timestamp, their
backfilled order is decided by UUID, i.e. arbitrary.

`ADD COLUMN SERIAL` actually does *better* here: it assigns values in
physical table order, and for an append-only table never updated in place
that is true insertion order. Verified locally — 100 pre-existing rows were
assigned `1..100` matching insertion order exactly.

So Option B trades perfect ordering of *historical* rows for availability.
Both options are exactly correct for every row written after deployment.
If historical fidelity matters more than a maintenance window, prefer
Option A.

## Rollback

The column is additive and nothing reads it except the timeline ordering,
so rolling the *application* back is safe and needs no database change —
the previous code orders by `createdAt, id` and simply ignores the column.

Dropping the column is the only destructive step and is not recommended.
It would reintroduce the ordering bug, and `DROP COLUMN` takes
`ACCESS EXCLUSIVE` again. If it must be done:

```sql
ALTER TABLE order_events DROP COLUMN sequence;  -- also drops the owned sequence
```

## Known redundancy, deliberately not addressed here

`order_events_tenantId_orderId_createdAt_idx` no longer serves any query:
both timeline readers filter on `(tenantId, orderId)` and order by
`sequence`, which the new index covers better, and nothing else in the
application orders events by `createdAt`. It is therefore redundant, but
dropping it is a separate change and must not be bundled into this
deployment. When it is done, use `DROP INDEX CONCURRENTLY`, and confirm
first on the target database that it is genuinely unused:

```sql
SELECT indexrelname, idx_scan FROM pg_stat_user_indexes
WHERE relname = 'order_events';
```
