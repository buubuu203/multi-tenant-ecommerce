# Deploying `20261014160000_add_order_event_sequence`

Operational runbook. Read it fully before touching Preview or Production.

**Status: applied to the local development database only.** Preview and
Production have never been contacted. Nothing in this document has been
executed against either, and running the preflight below is the first step
of doing so.

This migration is **not safe to run unattended on a large `order_events`
table**. It is safe on a small one. Which case you are in is a measurement,
not a guess — see Preflight.

---

## 1. What the migration does, and why it needs a decision

```sql
ALTER TABLE "order_events" ADD COLUMN "sequence" SERIAL;
CREATE INDEX "order_events_tenantId_orderId_sequence_idx"
  ON "order_events"("tenantId", "orderId", "sequence");
```

`SERIAL` gives the column a `nextval(...)` default, which PostgreSQL
classifies as **volatile** (`pg_proc.provolatile = 'v'`). PostgreSQL 11+
adds a column with a _constant_ default as a metadata-only change, but a
volatile default forces a **full table rewrite** so the default can be
evaluated once per row.

Measured on a 100-row probe table rather than assumed. `pg_class.relfilenode`
identifies the file backing the table, so a change means a rewrite:

| Statement                                        | relfilenode | Rewrite |
| ------------------------------------------------ | ----------- | ------- |
| _(baseline)_                                     | 16922       | —       |
| `ADD COLUMN seq SERIAL`                          | 16927       | **yes** |
| `ADD COLUMN seq2 integer` (nullable, no default) | 16927       | no      |

Locks observed in `pg_locks` while the statement ran:

```
AccessExclusiveLock on order_events
AccessExclusiveLock on order_events_sequence_seq
```

`ACCESS EXCLUSIVE` is PostgreSQL's strongest table lock. It blocks
**everything, including plain `SELECT`**, and is held for the entire
rewrite. The outage therefore scales with table size. It is not confined to
the admin timeline: order creation, status changes and payment updates all
write an `OrderEvent` inside their own transaction, so while this lock is
held **checkout blocks too**.

**A follow-up migration cannot fix this.** Prisma applies migrations in
order, so anything added later runs _after_ the rewrite. Avoiding the lock
means not letting this script run against a large table — that is Option B.

---

## 1a. Tooling

> **Two migrations are local-only.**
> `20261014160000_add_order_event_sequence` and
> `20261016120000_add_payment_rejections` have been applied to the local
> development database only. Both are release blockers for every other
> environment. The second is additive and brief; the first is the one this
> runbook exists for.

Two scripts automate the read-only parts of this runbook. **Neither can
execute a migration, and neither chooses Option A or B.**

| Command                                  | Purpose                                                                                             | When                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------- |
| `npm run release:preflight:order-events` | Gathers everything in §2 and prints a verdict                                                       | Before deciding, per environment |
| `npm run release:verify:order-events`    | Checks the end state (§7.1–7.3)                                                                     | After Option A or B completes    |
| `npm run release:preflight`              | Lists which migrations this target is missing, and flags history that disagrees with the repository | **First**, before anything else  |

### Required environment variable

```bash
RELEASE_CHECK_DATABASE_URL="postgresql://…"   # the target you intend to inspect
```

One variable, and it is **not** `DATABASE_URL`. The scripts never fall back
to it: running "the check" against your dev database while believing you
checked production is the mistake this prevents. With the variable unset
they exit **2** and explain themselves, having connected to nothing.

Supply it only for the command, so it does not linger in your shell:

```bash
RELEASE_CHECK_DATABASE_URL="…" npm run release:preflight:order-events
```

### Read-only guarantee

Enforced by PostgreSQL, not by the scripts. Every statement runs inside
`BEGIN TRANSACTION READ ONLY`, always rolled back, with a 15s
`statement_timeout` so a check cannot become the slow query that causes an
incident. `tests/release-tooling.test.ts` proves this against the local
database by attempting an `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`,
`DROP` and `TRUNCATE` and asserting the server refuses each one.

Output never contains a connection string. Only `host:port/database` is
printed; an unparseable value is reported as `(unparseable connection
string)` rather than echoed, since it may be the credential itself. Output
is therefore safe to paste into a ticket.

### Exit codes

| Code | Meaning                                                                                     |
| ---- | ------------------------------------------------------------------------------------------- |
| `0`  | Preflight: `APPLIED` or `PENDING`. Verify: all checks passed.                               |
| `1`  | Preflight: `STOP` — partial/inconsistent state. Verify: at least one check failed.          |
| `2`  | Usage error: the target variable is unset, or the connection failed. Nothing was inspected. |

### Sample output shape

Values below are illustrative, not from any real environment:

```
OrderEvent migration preflight  —  READ ONLY
Target: db.example.internal:5432/shop
Migration: 20261014160000_add_order_event_sequence

Environment
  PostgreSQL version                 17.11
  SET NOT NULL fast path (PG 12+)    available

Table
  Exact rows                         4,812,003
  Planner estimate                   4811920
  Heap size                          1402.5 MB
  Index size                         655.2 MB
  Events written in last hour        1884

Activity
  Transactions open > 30s            0
  Ungranted locks on order_events    0

Schema state
  sequence column                    absent
  sequence object                    absent

Indexes  (Phase 7 audit — this tool never drops anything)
    order_events_tenantId_orderId_createdAt_idx   91422 scans
  expected sequence index            absent
  legacy createdAt index             present (keep for now)

Migration history
  _prisma_migrations row             absent

────────────────────────────────────────────────────────────────
VERDICT: PENDING
────────────────────────────────────────────────────────────────
Migration is PENDING on this target.
  Estimated rewrite/lock risk        HIGH
```

### Interpreting a partial state

`VERDICT: STOP` means the target is in a state no option should be run
through. The script lists which condition tripped. The ones that matter
most:

- **column exists but the migration is unrecorded** — almost certainly a
  half-finished Option B. Resume at §5 from the first failing check in
  `release:verify:order-events`; do **not** start over and do not run
  Option A.
- **migration recorded but the column is missing** — the history and the
  schema disagree. Escalate; do not reconcile by guesswork.
- **rows with a NULL sequence** — an incomplete backfill. Resume §5.6.
- **an INVALID index** — an interrupted `CREATE INDEX CONCURRENTLY`. See §6.
- **a failed or rolled-back `_prisma_migrations` row** — escalate.

### Order of use

0. `release:preflight` against the target, to see what it is missing and
   whether its history is consistent at all. Exits non-zero on a database
   with no Prisma history, on a failed or rolled-back migration, and on a
   migration recorded there but absent from this checkout.
1. `release:preflight:order-events` against the target.
2. If `STOP`, stop. If `APPLIED`, go to step 5.
3. Take the numbers to §3 and choose Option A or B **with a human**.
4. Execute §4 or §5.
5. `release:verify:order-events` against the same target.
6. Application smoke tests, §7.4. The verifier covers schema and stored
   ordering only — it does not exercise the application.

## 2. Preflight — read-only, run against the target environment

None of these modify anything. Run them all and record the output; the
decision table in §3 consumes them. Use the environment's own connection
method. **Never paste credentials into this file or into a ticket.**

```sql
-- 2.1 Server version. The Option B NOT NULL path needs PostgreSQL 12+.
SELECT current_setting('server_version') AS server_version;

-- 2.2 Exact row count and on-disk size. This is the primary decision input.
SELECT count(*) AS exact_rows FROM order_events;

SELECT pg_size_pretty(pg_table_size('order_events'))    AS heap_size,
       pg_size_pretty(pg_indexes_size('order_events'))  AS index_size,
       pg_size_pretty(pg_total_relation_size('order_events')) AS total_size;

-- 2.3 Planner's estimate. If this is wildly below 2.2 the table has not been
--     analysed recently; prefer the exact count, and note that bloat makes a
--     rewrite slower than row count alone suggests.
SELECT reltuples::bigint AS estimated_rows, relpages
FROM pg_class WHERE relname = 'order_events';

-- 2.4 Per-index sizes, so you know what the rewrite and the new index cost.
SELECT indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) AS size, idx_scan
FROM pg_stat_user_indexes WHERE relname = 'order_events'
ORDER BY indexrelname;

-- 2.5 Is the table actively written right now?
SELECT n_tup_ins, n_tup_upd, n_tup_del, n_live_tup, n_dead_tup, last_autovacuum
FROM pg_stat_user_tables WHERE relname = 'order_events';

-- 2.6 Recent write volume, as a traffic proxy. Run twice a few minutes apart
--     and compare, or bound it by time:
SELECT count(*) AS events_last_hour
FROM order_events WHERE "createdAt" > now() - interval '1 hour';

-- 2.7 Long-running transactions. An ALTER queues behind these, and every
--     reader then queues behind the ALTER. This is how a fast migration
--     still causes an outage.
SELECT pid, state, wait_event_type, wait_event,
       now() - xact_start AS xact_age, left(query, 120) AS query
FROM pg_stat_activity
WHERE datname = current_database() AND state <> 'idle'
ORDER BY xact_start NULLS LAST;

-- 2.8 Existing lock waits anywhere in the database.
SELECT bl.pid AS blocked_pid, ka.query AS blocking_query, bl.query AS blocked_query
FROM pg_stat_activity bl
JOIN pg_locks bll ON bll.pid = bl.pid AND NOT bll.granted
JOIN pg_locks kl ON kl.locktype = bll.locktype AND kl.relation IS NOT DISTINCT FROM bll.relation AND kl.granted
JOIN pg_stat_activity ka ON ka.pid = kl.pid;

-- 2.9 Has Prisma already recorded this migration?
SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count
FROM _prisma_migrations
WHERE migration_name = '20261014160000_add_order_event_sequence';

-- 2.10 Does the column already exist, and in what shape?
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'order_events' AND column_name = 'sequence';

-- 2.11 Any rows without a value? (Only meaningful if 2.10 returned a row.)
SELECT count(*) AS null_sequences FROM order_events WHERE sequence IS NULL;

-- 2.12 Does the expected sequence object exist, and is it owned by the column?
SELECT c.relname AS sequence_name,
       pg_get_serial_sequence('order_events', 'sequence') AS owned_by_column
FROM pg_class c WHERE c.relkind = 'S' AND c.relname = 'order_events_sequence_seq';

-- 2.13 Does the expected index exist, and is it valid?
-- NB: join pg_class for the name. indexrelid::regclass::text QUOTES a
-- mixed-case identifier, so comparing it to a bare string never matches.
SELECT ic.relname AS index_name, i.indisvalid, i.indisready
FROM pg_index i
JOIN pg_class ic ON ic.oid = i.indexrelid
WHERE ic.relname = 'order_events_tenantId_orderId_sequence_idx';
```

### Interpreting 2.9–2.13

| Result                                             | Meaning                                                                                                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.9 empty, 2.10 empty                              | Clean target. Proceed to §3.                                                                                                                                                |
| 2.9 has `finished_at` and 2.10 shows the column    | Already deployed. Run §7 verification only; do nothing else.                                                                                                                |
| 2.9 empty but 2.10 shows the column                | Schema was changed outside Prisma. **Stop.** Do not run either option; reconcile first (likely a partially completed Option B — resume at §5 from the first failing check). |
| 2.9 has `rolled_back_at`, or `finished_at` is null | A previous attempt failed. **Stop and escalate.**                                                                                                                           |
| 2.13 shows `indisvalid = false`                    | A previous `CREATE INDEX CONCURRENTLY` aborted. See §6.                                                                                                                     |

---

## 3. Decision table

**There is no universal safe row threshold.** Rewrite speed depends on row
width, bloat, disk throughput and concurrent load. The only trustworthy
number is one measured on a Preview database restored to production scale.
The sizes below are a starting point for that measurement, not permission.

| Condition                                                                                                                                                                                    | Action                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Size and traffic both **known**, measured lock duration on a production-scale Preview copy is **within an approved maintenance window**, and checkout downtime for that period is signed off | **Option A** (§4)                                       |
| Table is large, **or** measured lock duration exceeds the approved window, **or** checkout cannot tolerate blocking writes at all                                                            | **Option B** (§5)                                       |
| Size **unknown**, traffic **unknown**, or preflight not run against this environment                                                                                                         | **Stop and investigate.** Neither option is authorised. |
| Active incident, elevated error rates, ongoing peak traffic, or any unresolved lock wait from 2.7/2.8                                                                                        | **Do not run either option.** Reschedule.               |
| Preflight 2.9/2.10 disagree (§2 table)                                                                                                                                                       | **Stop and escalate.**                                  |

As a rough orientation only, and subject to the measurement above: tables
in the low tens of thousands of rows typically rewrite in well under a
second; millions of rows should be assumed to need Option B until proven
otherwise.

---

## 4. Option A — run the committed migration

Appropriate only when §3 selected it.

### 4.1 Before

1. **Written maintenance approval**, naming the window and stating that
   `order_events` writes — and therefore checkout — are blocked for its
   duration.
2. **Confirm a current backup / PITR restore point exists** and that you
   know its timestamp. You are not expected to use it; you are expected to
   be able to.
3. Re-run preflight 2.7 and 2.8 immediately before starting. Abort if
   anything is long-running.
4. Have application error-rate and database lock dashboards open.

### 4.2 Run

```bash
# lock_timeout: if the ALTER cannot take its lock quickly, fail fast rather
# than silently queue every reader behind it.
# statement_timeout: bound the rewrite itself, so a worse-than-expected
# table cannot hold the lock indefinitely. Set it ABOVE your measured
# rewrite time with margin — too low and you guarantee failure.
PGOPTIONS='-c lock_timeout=5s -c statement_timeout=120s' \
  npx prisma migrate deploy
```

While it runs, watch for blocked sessions:

```sql
SELECT pid, now() - xact_start AS age, wait_event_type, left(query, 80)
FROM pg_stat_activity
WHERE datname = current_database() AND state <> 'idle' ORDER BY xact_start;
```

### 4.3 If it times out or fails

The migration script is applied as a single unit, so a failure rolls back:
no column, no index, no partial state. Prisma records the attempt and
**the migration remains pending** — it has not been applied, and
`prisma migrate status` will continue to list it.

Do the following, in order:

1. Verify nothing was left behind: preflight 2.10 must return no rows.
2. Check `_prisma_migrations` (2.9). If a row exists with `finished_at`
   null, the migration is in a failed state and `migrate deploy` will
   refuse to proceed until it is resolved. **Escalate rather than guessing
   at `migrate resolve`.**
3. A lock timeout means the table was busy — retry in a quieter window.
4. A statement timeout means the rewrite is genuinely too slow for this
   table. **Stop using Option A and switch to Option B.**

### 4.4 After

Run §7.

### 4.5 Two standing rules

- **Never edit the migration after it has been applied anywhere.** Prisma
  stores a checksum of `migration.sql`; changing the file makes every
  subsequent `migrate deploy` / `migrate status` fail with a modified-script
  error on every environment that already ran it. Corrections go in a new
  migration.
- **Never run `prisma migrate dev` against Preview or Production.** It is a
  development command: on detecting drift it can **reset the database**,
  destroying all data. Deployed environments use `migrate deploy` only.

---

## 5. Option B — reproduce the end state online, then record it

**This is an operational procedure performed by hand, not a Prisma
migration file**, and it cannot become one: step 5.9 uses
`CREATE INDEX CONCURRENTLY`, which PostgreSQL refuses to run inside a
transaction block, while Prisma applies each migration as a single script.
No migration in this repository uses `CONCURRENTLY`.

The goal is to reach the **exact** end state the committed migration would
produce, so that Prisma sees no drift afterwards:

- column `sequence`, type `integer`, `NOT NULL`,
  default `nextval('order_events_sequence_seq'::regclass)`
- sequence `order_events_sequence_seq`, **owned by** that column
- index `order_events_tenantId_orderId_sequence_idx`
  on `("tenantId", "orderId", "sequence")`

Run each step separately and check its result before continuing. Steps are
individually transactional unless noted.

### 5.1 Add the column — metadata only

```sql
SET lock_timeout = '5s';
ALTER TABLE order_events ADD COLUMN sequence integer;   -- nullable, NO default
RESET lock_timeout;
```

No rewrite (measured, §1). It still takes a brief `ACCESS EXCLUSIVE` lock to
update the catalog, hence `lock_timeout`.

### 5.2 Record the historical boundary

```sql
SELECT count(*) AS n FROM order_events;      -- record this as N
```

### 5.3 Create the sequence, starting above the historical range

```sql
-- START well above N so that every row inserted from 5.4 onward sorts
-- after every historical row backfilled in 5.6. The headroom absorbs rows
-- written between 5.2 and 5.4.
CREATE SEQUENCE order_events_sequence_seq START WITH <N + 1000000>;
ALTER SEQUENCE order_events_sequence_seq OWNED BY order_events.sequence;
```

### 5.4 Set the default **before** backfilling

```sql
SET lock_timeout = '5s';
ALTER TABLE order_events
  ALTER COLUMN sequence SET DEFAULT nextval('order_events_sequence_seq');
RESET lock_timeout;
```

Order matters and this is the step that makes the procedure safe. From here
on, every newly inserted row gets a value immediately, so the backfill's
`WHERE sequence IS NULL` predicate can never miss a live insert. Setting a
default does not rewrite the table.

### 5.5 Decide whether to quiesce writers

The backfill does **not** require stopping writes — 5.4 makes concurrent
inserts safe and correctly ordered relative to each other and to history.

Pause writers only if you need the _historical_ rows' relative order to be
as faithful as possible and the table is still receiving events that would
interleave in `createdAt` with the tail of history. In practice this is
rarely worth an outage; see 5.7 for why perfect historical order is
unattainable regardless.

### 5.6 Backfill historical rows in batches

Each statement is its own transaction and takes only row-level locks.
Repeat until it reports `UPDATE 0`. Start with a small batch and increase
only if replication lag and lock waits stay flat.

```sql
WITH already AS (
  -- Backfilled values live below the sequence start, so this counts only
  -- historical rows, never a live one.
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
```

Between batches, watch for lock waits (2.8) and, if applicable, replica lag.
It is safe to stop between batches and resume later — see §6.

### 5.7 Historical ordering: what is and is not recoverable

**Exact historical insertion order cannot be reconstructed. It was never
stored.** The backfill orders by `("createdAt", id)`, and `createdAt` is the
millisecond-precision field whose ties are the reason this column exists.
Where two historical rows share a timestamp, their relative order is decided
by a random UUID — arbitrary, though stable once written.

Note the trade-off honestly: `ADD COLUMN SERIAL` (Option A) does _better_
here, assigning values in physical table order, which on an append-only
table never updated in place is true insertion order. Verified locally —
100 pre-existing rows received `1..100` matching insertion order exactly.

**Option B trades historical ordering fidelity for availability.** Both
options are exactly correct for every row written after deployment.

### 5.8 Validate before tightening

```sql
SELECT count(*) AS remaining_nulls FROM order_events WHERE sequence IS NULL;
-- must be 0

SELECT count(*) - count(DISTINCT sequence) AS duplicates FROM order_events;
-- must be 0

SELECT count(*) AS total_rows FROM order_events;
-- must be >= N from 5.2 (greater by exactly the rows written since)

SELECT max(sequence) FILTER (WHERE sequence <  <N + 1000000>) AS max_historical,
       min(sequence) FILTER (WHERE sequence >= <N + 1000000>) AS min_live
FROM order_events;
-- max_historical must be < min_live (or min_live null if no new rows yet)

SELECT last_value FROM order_events_sequence_seq;
-- confirms the sequence is advancing for live inserts
```

Do not proceed unless every check passes.

### 5.9 `SET NOT NULL`, then the index

`SET NOT NULL` normally requires a full validating scan under
`ACCESS EXCLUSIVE`. Cheaper than a rewrite, but still a whole-table read.
On **PostgreSQL 12+** (confirm with preflight 2.1) it can be made nearly
instant by validating a `CHECK` constraint first, which takes only
`SHARE UPDATE EXCLUSIVE` and does not block reads or writes:

```sql
-- Fast path, PostgreSQL 12+
ALTER TABLE order_events
  ADD CONSTRAINT order_events_sequence_not_null CHECK (sequence IS NOT NULL) NOT VALID;

ALTER TABLE order_events VALIDATE CONSTRAINT order_events_sequence_not_null;  -- no blocking

SET lock_timeout = '5s';
ALTER TABLE order_events ALTER COLUMN sequence SET NOT NULL;  -- uses the proven constraint
ALTER TABLE order_events DROP CONSTRAINT order_events_sequence_not_null;
RESET lock_timeout;
```

On older PostgreSQL, or if you prefer fewer moving parts, do it directly and
accept the scan:

```sql
SET lock_timeout = '5s';
ALTER TABLE order_events ALTER COLUMN sequence SET NOT NULL;
RESET lock_timeout;
```

Then build the index without blocking writes. This statement must run on its
own, outside any transaction block:

```sql
CREATE INDEX CONCURRENTLY order_events_tenantId_orderId_sequence_idx
  ON order_events ("tenantId", "orderId", "sequence");
```

### 5.10 Verify the end state matches exactly

Re-run preflight 2.10, 2.12 and 2.13. They must show:

- `integer`, `is_nullable = NO`,
  default `nextval('order_events_sequence_seq'::regclass)`
- the sequence owned by `order_events.sequence`
- the index present with `indisvalid = true`

### 5.11 Record the migration without executing it

Only once 5.10 matches:

```bash
npx prisma migrate resolve --applied 20261014160000_add_order_event_sequence
npx prisma migrate status    # must report up to date
```

This writes the `_prisma_migrations` row so the locking script never runs.

Then confirm Prisma agrees there is no drift, using a **shadow database**,
never the live one:

```bash
npx prisma migrate diff \
  --from-url "$SHADOW_DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script        # expect no differences
```

### 5.12 Deploy the application and verify reads

Deploy or restart the application so it runs the code that orders by
`sequence`, then run §7.

---

## 6. Failure, pausing and rollback

### What is transactional and what is not

| Step                            | Transactional    | If it fails                                           |
| ------------------------------- | ---------------- | ----------------------------------------------------- |
| Option A, whole migration       | Yes — one script | Fully rolled back; migration stays **pending** (§4.3) |
| 5.1 add column                  | Yes              | Nothing added; safe to retry                          |
| 5.3 create sequence             | Yes              | Nothing created; safe to retry                        |
| 5.4 set default                 | Yes              | Default unset; **re-run before resuming 5.6**         |
| 5.6 each batch                  | Yes, per batch   | That batch is undone; earlier batches persist         |
| 5.9 `SET NOT NULL`              | Yes              | Column stays nullable; safe to retry                  |
| 5.9 `CREATE INDEX CONCURRENTLY` | **No**           | May leave an **invalid** index (see below)            |
| 5.11 `migrate resolve`          | Metadata only    | Re-runnable                                           |

### Pausing and resuming

Option B is safe to pause between batches of 5.6 — the column is nullable
and unused until 5.9, and live inserts keep getting values from the default.
To resume, re-run the 5.6 batch statement; it picks up exactly where it
stopped because it selects on `sequence IS NULL`. Confirm 5.4's default is
still in place before resuming.

### Invalid index after an interrupted `CREATE INDEX CONCURRENTLY`

```sql
SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE NOT indisvalid;
DROP INDEX CONCURRENTLY IF EXISTS order_events_tenantId_orderId_sequence_idx;
-- then re-run 5.9's CREATE INDEX CONCURRENTLY
```

An invalid index is not used by the planner but **is** maintained on writes,
so do not leave one in place.

### Rollback

Rolling back the **application** is always safe and needs no database
change: the previous code orders by `createdAt, id` and ignores the column
entirely. This is the rollback you should plan to use.

Rolling back the **schema** is forward-only in practice once 5.6 has begun.
Dropping the column is the only reversal, it reintroduces the ordering bug,
it takes `ACCESS EXCLUSIVE` again, and the backfilled values cannot be
reconstructed afterwards. Not recommended:

```sql
ALTER TABLE order_events DROP COLUMN sequence;   -- also drops the owned sequence
```

### Leave the old index alone for now

`order_events_tenantId_orderId_createdAt_idx` **must remain in place
through this deployment.** It is the index serving the timeline query until
the application is deployed and the new index is in use, and keeping it
means an application rollback still performs.

It is expected to become redundant afterwards — both timeline readers filter
on `(tenantId, orderId)` and order by `sequence`, and nothing else in the
application orders events by `createdAt`. Removing it is a **separate
change**, after the new index has been observed in use:

```sql
-- Audit first, on the target environment, over a representative period.
SELECT indexrelname, idx_scan FROM pg_stat_user_indexes WHERE relname = 'order_events';

-- Only if genuinely unused:
DROP INDEX CONCURRENTLY order_events_tenantId_orderId_createdAt_idx;
```

Note that dropping it also requires a corresponding schema change, or
Prisma will report drift.

---

## 7. Post-deployment verification

All read-only except the smoke tests, which create data through the normal
application path. **Do not submit destructive admin actions.**

### 7.1 Schema

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'order_events' AND column_name = 'sequence';
-- integer | NO | nextval('order_events_sequence_seq'::regclass)

SELECT pg_get_serial_sequence('order_events', 'sequence') AS owned_sequence,
       last_value FROM order_events_sequence_seq;

SELECT ic.relname, i.indisvalid
FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
WHERE ic.relname = 'order_events_tenantId_orderId_sequence_idx';
-- present, indisvalid = true
```

### 7.2 Data

```sql
SELECT count(*) FILTER (WHERE sequence IS NULL) AS nulls,
       count(*) - count(DISTINCT sequence)      AS duplicates,
       count(*)                                  AS total
FROM order_events;
-- nulls 0, duplicates 0
```

### 7.3 Ordering actually used by the application

Pick a recent order with several events:

```sql
SELECT sequence, type, "createdAt"
FROM order_events
WHERE "tenantId" = '<tenant>' AND "orderId" = '<order>'
ORDER BY sequence;
-- order_created first; sequence strictly increasing
```

Confirm the planner uses the new index rather than sorting:

```sql
EXPLAIN SELECT * FROM order_events
WHERE "tenantId" = '<tenant>' AND "orderId" = '<order>' ORDER BY sequence;
```

### 7.4 Application smoke tests

Through the UI or normal API, on a test tenant:

1. Place an order → timeline shows `order_created` first.
2. Change its status → the new event appears **after** creation, not before.
3. Record a payment update → same.
4. Open the Tenant Admin order timeline and confirm the order reads correctly.
5. Open any destructive confirmation only to **cancel** it.

### 7.5 Automated check

```bash
RELEASE_CHECK_DATABASE_URL="…" npm run release:verify:order-events
```

Covers 7.1–7.3 plus the migration-history row and the timeline DTO. Exits
non-zero naming each discrepancy. It repairs nothing, and it is not a
substitute for 7.4.

### 7.6 Health

- Application error rate and logs — no Prisma errors mentioning `sequence`.
- `pg_stat_activity` / 2.8 — no lingering lock waits.
- `prisma migrate status` — up to date.

---

## 8. Escalate and stop if

- Preflight 2.9 and 2.10 disagree about whether the migration is applied.
- `_prisma_migrations` shows a failed or rolled-back attempt.
- Option A exceeds `statement_timeout`.
- 5.8 reports nulls or duplicates that do not resolve on a repeat batch.
- An invalid index persists after a retry.
- Replication lag or lock waits grow during the backfill and do not recover
  when batch size is reduced.
