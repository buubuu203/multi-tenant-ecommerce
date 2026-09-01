-- Hand-written migration (Step 32 — Customer Identity & Checkout Information).
-- Purely additive: one new table, one new required column on the existing
-- `orders` table. No backfill needed — confirmed `orders` has 0 rows
-- before this migration was written (every prior step's baseline check
-- has independently verified this, most recently right before writing
-- this file).
--
-- Apply via: prisma db execute --file <this file>
-- Then register via: prisma migrate resolve --applied 20260830113000_add_customer_identity
-- Never via `prisma migrate dev` / `migrate reset` / `db push` on this environment.

BEGIN;

-- =========================================================================
-- 1. Customer — guest-checkout identity only. No password/session columns
--    (this is not an authenticated account). Identity is (tenantId, email).
-- =========================================================================
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customers_tenantId_email_key" ON "customers"("tenantId", "email");
CREATE UNIQUE INDEX "customers_id_tenantId_key" ON "customers"("id", "tenantId");
CREATE INDEX "customers_tenantId_idx" ON "customers"("tenantId");

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- 2. Order.customerId — required, no DEFAULT: safe only because `orders`
--    is empty right now (confirmed above). onDelete: Restrict protects
--    historical orders from ever being orphaned by a Customer deletion
--    (no Customer delete mutation exists in this step anyway, but the FK
--    itself is the actual guarantee, not the absence of a delete button).
-- =========================================================================
ALTER TABLE "orders" ADD COLUMN "customerId" TEXT NOT NULL;

CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_customerId_tenantId_fkey"
  FOREIGN KEY ("customerId", "tenantId") REFERENCES "customers"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
