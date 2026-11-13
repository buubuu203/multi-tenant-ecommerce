# Release checklist

Work top to bottom. Do not skip a step because the previous one passed.

**Current status: NOT READY FOR PRODUCTION.** Two migrations are local
only, and no authenticated browser QA has ever been run. See
[docs/release-readiness.md](docs/release-readiness.md) for the evidence
behind both.

Every command here was verified against `package.json`. Nothing below is
invented.

---

## 0. Before anything

- [ ] Working tree clean, on the branch you intend to release.
- [ ] All four gates pass locally:
  - [ ] `npm test` — expect 738 passing
  - [ ] `npx tsc --noEmit`
  - [ ] `npm run lint`
  - [ ] `npm run build`
- [ ] `npx prisma migrate status` against the local database reports the
      schema is up to date.

**Green gates are not release readiness.** They say the code is
self-consistent. They say nothing about the two unapplied migrations or
about anything rendered in a browser.

---

## 1. Preflight — read-only, against the target

Set the target explicitly. These commands **never** fall back to
`DATABASE_URL` and exit 2 if it is unset, so there is no way to check
development while believing you checked production.

```bash
RELEASE_CHECK_DATABASE_URL="postgresql://..." npm run release:preflight
```

- [ ] Whole-release migration drift check passes.
      It STOPs non-zero if `_prisma_migrations` is missing, a migration
      failed, a migration was rolled back, or a migration is recorded in
      the database but absent from this checkout.
- [ ] Note every migration it flags as outstanding.

```bash
RELEASE_CHECK_DATABASE_URL="postgresql://..." npm run release:preflight:order-events
```

- [ ] Record the **row count of `order_events`** in the target. This is
      the number the migration decision depends on. Measure it; do not
      estimate it.
- [ ] Record whether the column, sequence and index already exist
      (a partial state is possible and the output distinguishes it).

Exit codes: `0` ok, `1` fail, `2` usage.

Both commands run inside `BEGIN TRANSACTION READ ONLY` and always roll
back, so they cannot write. Only host, port and database name are
printed — never credentials.

---

## 2. Migration decision

Read `prisma/migrations/20261014160000_add_order_event_sequence/RUNBOOK.md`
in full. Use its decision table with the row count from step 1.

- [ ] **`20261016120000_add_payment_rejections`** — additive: one enum,
      one table, two indexes, in a transaction. No existing table, column
      or row is touched. No backfill. Safe to deploy with
      `prisma migrate deploy`.
      Note: rejections occurring before this migration were never recorded
      and cannot be recovered.

- [ ] **`20261014160000_add_order_event_sequence`** — choose one:

  - [ ] **Option A — run the committed migration in a maintenance
        window.** `ADD COLUMN ... SERIAL` has a volatile default, forcing
        a full table rewrite under `ACCESS EXCLUSIVE`, which blocks
        everything including `SELECT`. Correct and simple for a small
        table.
  - [ ] **Option B — reproduce the end state online**, then record the
        migration as applied without executing it. Follow runbook §5 step
        by step: nullable column → sequence → default **before** backfill
        → batched backfill → validate → `SET NOT NULL` →
        `CREATE INDEX CONCURRENTLY`.

> **Option B is not universally safe.** It has prerequisites and
> trade-offs, it is many more steps to get wrong, and
> `CREATE INDEX CONCURRENTLY` is not transactional — an interrupted run
> leaves an invalid index that must be dropped explicitly before
> retrying. Do not treat it as the default; choose it only when the row
> count makes Option A's lock unacceptable.

- [ ] Decision recorded, with the row count that justified it, and who
      approved it.

**Never** use `prisma migrate dev`, `migrate reset` or `db push` against
Preview or Production — each can reset the database. Use
`prisma migrate deploy`.

---

## 3. Preview rollout

- [ ] Confirm the target really is Preview before running anything.
- [ ] Take a backup / confirm point-in-time recovery is available.
- [ ] Apply migrations with `prisma migrate deploy`.
- [ ] Verify:

```bash
RELEASE_CHECK_DATABASE_URL="postgresql://..." npm run release:verify:order-events
```

- [ ] Re-run `npm run release:preflight` against Preview; no migration
      should remain outstanding.
- [ ] Deploy the application to Preview.

---

## 4. Preview smoke tests

**This is the step that clears the browser-QA blocker.** Everything below
is currently unverified. Sign in through the normal Preview auth flow.

- [ ] Tenant Admin loads; the `?` help icon renders in the header.
- [ ] `/tenant-admin/help` renders and is readable.
- [ ] Orders list; open one order; the audit timeline is in correct order.
- [ ] **Print preview for all three documents** — order summary, packing
      slip, shipping note. Check the actual print dialog, not just the
      page.
- [ ] Catalog loads; create a product; upload an image and confirm WebP
      conversion.
- [ ] CSV import: upload, review the preview, confirm, and verify the
      result.
- [ ] Customers list; sorting; open a customer.
- [ ] Fulfillment workspace; categories and blockers look right.
- [ ] Payment operations; needs-review count matches the list.
- [ ] `/tenant-admin/analytics`; change the date range; confirm the
      figures move and that an invalid date falls back rather than
      widening.
- [ ] Platform Admin payment rejections page.
- [ ] **Confirmation dialogs: press Cancel and verify nothing happens.**
      Only ever structurally tested.
- [ ] **375px** — every admin page, no horizontal overflow.
- [ ] **414px** — same.
- [ ] Vietnamese labels wrap rather than overflow.

- [ ] Verify provider webhook configuration points at the Preview URLs,
      and that a test payment reaches `/api/webhooks/sepay` or
      `/api/momo/webhook` as expected.

---

## 5. Production rollout

Do not start until every Preview step above is signed off.

- [ ] Backup / point-in-time recovery confirmed.
- [ ] Maintenance window agreed if Option A was chosen.
- [ ] Re-run preflight against Production and re-check the
      `order_events` row count — it will differ from Preview.
- [ ] Apply migrations with `prisma migrate deploy`, or execute the
      Option B procedure.
- [ ] Run `npm run release:verify:order-events` against Production.
- [ ] Deploy the application.
- [ ] Repeat the step 4 smoke tests against Production.
- [ ] Confirm provider webhook URLs point at Production.

---

## 6. Monitoring after deployment

- [ ] Error rate and latency for the first hour.
- [ ] `/api/webhooks/sepay` and `/api/momo/webhook` return 200 for valid
      deliveries.
- [ ] Payment operations: no unexpected spike in needs-review.
- [ ] Platform rejections page: no unexpected spike, and no unattributed
      rows that should have resolved.
- [ ] Order audit timelines read in a sensible order.
- [ ] Database CPU and lock waits, especially if Option A ran.

---

## 7. Rollback limitations

**Read before you need it.**

- Dropping the column and index is mechanically possible, but
  `CREATE INDEX CONCURRENTLY` is not transactional: an interrupted run
  leaves an **invalid** index that must be dropped explicitly.
- A completed table rewrite cannot be undone by re-running anything.
- Plan **forward recovery**, not rollback. Restoring from backup is the
  real fallback, with the data loss that implies.
- Runbook §6 has the detail, including pausing and resuming a backfill.

---

## 8. Retention pruning

Payment rejection retention is **manual**. There is no scheduler, cron or
job runner in this project.

```bash
# Dry run — reports only. It runs in a READ ONLY transaction, so the
# server itself refuses a delete.
RELEASE_CHECK_DATABASE_URL="postgresql://..." npm run release:prune:rejections

# Only after reviewing the dry run. The `--` is REQUIRED.
RELEASE_CHECK_DATABASE_URL="postgresql://..." npm run release:prune:rejections -- \
  --retention-days=180 --apply --batch=500
```

> **The `--` separator is load-bearing.** `npm run release:prune:rejections
--apply` without it is swallowed by npm as its own config flag: the
> script receives no arguments and runs as a **dry run**, while the
> operator believes the pruning was applied. Verified by probing
> `process.argv`.

Options: `--retention-days=<n>` (whole days, minimum 1, default 180) and
`--batch=<n>` (1–10000, default 500). Deletes in bounded batches, using a
separate writable connection with statement and lock timeouts.

- [ ] Dry run reviewed before any `--apply`.
- [ ] A recurring owner is assigned, since nothing runs this
      automatically.

---

## 9. Sign-off

Do not sign off while any box above is unchecked.

- [ ] Preflight run against the target and output retained
- [ ] Migration option chosen, with the row count that justified it
- [ ] Preview migrated and verified
- [ ] Preview smoke tests passed, **including 375px, 414px and print
      preview**
- [ ] Production migrated and verified
- [ ] Production smoke tests passed
- [ ] Monitoring reviewed after one hour
- [ ] Retention pruning owner assigned

| Role             | Name | Date | Signature |
| ---------------- | ---- | ---- | --------- |
| Engineering      |      |      |           |
| Operations       |      |      |           |
| Release approver |      |      |           |

---

**This checklist covers technical release safety only.** It is not a
legal, financial, tax, banking, logistics or privacy compliance review,
and none is claimed. Refunds, returns, notifications, carrier tracking,
delivery confirmation, COD collection evidence and payment settlement are
**not supported** — see [docs/release-readiness.md](docs/release-readiness.md).
