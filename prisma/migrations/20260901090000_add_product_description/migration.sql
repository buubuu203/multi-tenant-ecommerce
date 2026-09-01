-- Hand-written migration (Step 43 — Minimal Product Description MVP).
-- Purely additive: one new nullable column on the existing `products`
-- table. No other table/model/enum touched, no backfill needed — a NULL
-- default means every existing product simply has no description until a
-- Tenant Admin sets one.
--
-- Apply via: prisma db execute --file <this file>
-- Then register via: prisma migrate resolve --applied 20260901090000_add_product_description
-- Never via `prisma migrate dev` / `migrate reset` / `db push` on this environment.

BEGIN;

ALTER TABLE "products" ADD COLUMN "description" TEXT;

COMMIT;
