-- Hand-written migration (Step 48 — MoMo Payment MVP).
-- Purely additive: one new enum, one new table. No existing table/column
-- touched. Payment is a brand-new, separate concept from Order/OrderStatus
-- (see schema.prisma's doc comments) — no backfill needed, no existing
-- Order row gets a Payment row created for it by this migration.
--
-- Apply via: prisma db execute --file <this file>
-- Then register via: prisma migrate resolve --applied 20260901150000_add_payment
-- Never via `prisma migrate dev` / `migrate reset` / `db push` on this environment.

BEGIN;

CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'succeeded', 'failed');

CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "providerOrderId" TEXT NOT NULL,
    "providerTransactionId" TEXT,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payments_providerOrderId_key" ON "payments"("providerOrderId");

CREATE UNIQUE INDEX "payments_orderId_tenantId_key" ON "payments"("orderId", "tenantId");

CREATE INDEX "payments_tenantId_idx" ON "payments"("tenantId");

ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_tenantId_fkey" FOREIGN KEY ("orderId", "tenantId") REFERENCES "orders"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
