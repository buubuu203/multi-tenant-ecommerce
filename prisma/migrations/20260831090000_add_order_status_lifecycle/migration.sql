-- Hand-written migration (Step 36 — Minimal Order Status Lifecycle).
-- Purely additive: two new enum values on the existing OrderStatus type.
-- No table structure changed, no existing Order rows touched. No backfill
-- needed — `orders` has 0 rows, confirmed before writing this file (same
-- baseline check performed before every prior schema-touching step).
--
-- Apply via: prisma db execute --file <this file>
-- Then register via: prisma migrate resolve --applied 20260831090000_add_order_status_lifecycle
-- Never via `prisma migrate dev` / `migrate reset` / `db push` on this environment.
--
-- Each ADD VALUE is its own statement: Postgres does not allow a newly
-- added enum value to be used within the same transaction that added it,
-- but multiple ADD VALUE statements consecutively (adding nothing else) in
-- one transaction is safe on Postgres 12+, which this project's WASM
-- Postgres 17.5 satisfies.

BEGIN;

ALTER TYPE "OrderStatus" ADD VALUE 'fulfilled';
ALTER TYPE "OrderStatus" ADD VALUE 'cancelled';

COMMIT;
