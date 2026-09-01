-- Hand-written migration (Step 30 — Payment Method Selection).
-- Purely additive: one enum, one NOT NULL column on the existing `orders`
-- table. No backfill needed — confirmed the table has 0 rows before this
-- migration was written (every prior step's baseline check independently
-- verified this, most recently right before writing this file).
--
-- Apply via: prisma db execute --file <this file>
-- Then register via: prisma migrate resolve --applied 20260830103000_add_order_payment_method
-- Never via `prisma migrate dev` / `migrate reset` / `db push` on this environment.

BEGIN;

CREATE TYPE "PaymentMethod" AS ENUM ('cod', 'momo', 'bank_transfer');

-- NOT NULL with no DEFAULT: safe only because `orders` is empty right now.
-- If this table ever has rows before a migration like this runs again,
-- that future migration MUST add a DEFAULT or backfill first — this one
-- deliberately does not, to avoid silently defaulting every historical
-- order to a payment method it was never actually assigned.
ALTER TABLE "orders" ADD COLUMN "paymentMethod" "PaymentMethod" NOT NULL;

COMMIT;
