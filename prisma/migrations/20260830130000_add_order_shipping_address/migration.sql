-- Hand-written migration (Step 34 — Shipping Address at Checkout).
-- Purely additive: five new columns on the existing `orders` table. No
-- other table/model/enum touched. No backfill needed — confirmed `orders`
-- has 0 rows before this migration was written (every prior step's
-- baseline check has independently verified this, most recently right
-- before writing this file).
--
-- Apply via: prisma db execute --file <this file>
-- Then register via: prisma migrate resolve --applied 20260830130000_add_order_shipping_address
-- Never via `prisma migrate dev` / `migrate reset` / `db push` on this environment.

BEGIN;

ALTER TABLE "orders" ADD COLUMN "shippingAddress" TEXT NOT NULL;
ALTER TABLE "orders" ADD COLUMN "shippingWard" TEXT NOT NULL;
ALTER TABLE "orders" ADD COLUMN "shippingDistrict" TEXT NOT NULL;
ALTER TABLE "orders" ADD COLUMN "shippingCity" TEXT NOT NULL;
ALTER TABLE "orders" ADD COLUMN "shippingNote" TEXT;

COMMIT;
