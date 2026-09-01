-- Hand-written migration (Step 44 — Minimal Product Image MVP).
-- Purely additive: one new nullable column on the existing `products`
-- table. No other table/model/enum touched, no backfill needed — a NULL
-- default means every existing product simply has no image until a
-- Tenant Admin sets one.
--
-- Apply via: prisma db execute --file <this file>
-- Then register via: prisma migrate resolve --applied 20260901120000_add_product_image_url
-- Never via `prisma migrate dev` / `migrate reset` / `db push` on this environment.

BEGIN;

ALTER TABLE "products" ADD COLUMN "imageUrl" TEXT;

COMMIT;
