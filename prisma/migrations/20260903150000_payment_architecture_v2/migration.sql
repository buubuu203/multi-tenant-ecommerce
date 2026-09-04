-- Payment Architecture V2 (Step 51).
--
-- Adds a generic payment-provider abstraction on top of the existing
-- Step 48 MoMo-only Payment model:
--   - PaymentProviderType: which adapter handled a Payment (cod,
--     bank_transfer_manual, bank_transfer_sepay_va, momo) — distinct from
--     the customer-facing PaymentMethod enum, which is unchanged.
--   - Payment gains provider/expiresAt/failureReason/providerMetadata.
--   - PaymentEvent: webhook audit trail + authoritative dedupe key,
--     independent of (and in addition to) the existing atomic
--     status-guard idempotency pattern.
--   - TenantPaymentMethod: per-tenant enable/configure state, closing the
--     gap where any tenant could have a customer select any payment
--     method regardless of whether it was actually configured.
--
-- BACKFILL SAFETY (Payment.provider is NOT NULL): existing Payment rows
-- are added as nullable first, backfilled, then locked to NOT NULL — safe
-- on any environment, not just one confirmed empty locally. The backfill
-- value is not a guess: in every version of this codebase prior to this
-- migration, a Payment row was created EXCLUSIVELY by the MoMo path
-- (checkout-actions.ts only ever called initiatePaymentForOrder() when
-- paymentMethod === "momo") — so every pre-existing Payment row's
-- provider is unambiguously 'momo' by construction, not an assumption.
--
-- Apply via: prisma db execute --file <this file>
-- Then register via: prisma migrate resolve --applied 20260903150000_payment_architecture_v2
-- Never via `prisma migrate dev` / `migrate reset` / `db push` on Preview
-- or Production.

BEGIN;

-- 1. Extend PaymentStatus with the two new terminal states.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'cancelled';

-- 2. New provider-adapter enum.
CREATE TYPE "PaymentProviderType" AS ENUM ('cod', 'bank_transfer_manual', 'bank_transfer_sepay_va', 'momo');

-- 3. Payment: add provider (nullable), backfill, then enforce NOT NULL.
ALTER TABLE "payments" ADD COLUMN "provider" "PaymentProviderType";
UPDATE "payments" SET "provider" = 'momo' WHERE "provider" IS NULL;
ALTER TABLE "payments" ALTER COLUMN "provider" SET NOT NULL;

-- 4. Payment: remaining additive columns.
ALTER TABLE "payments" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN "failureReason" TEXT;
ALTER TABLE "payments" ADD COLUMN "providerMetadata" JSONB;

-- 5. PaymentEvent.
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "provider" "PaymentProviderType" NOT NULL,
    "providerEventId" TEXT,
    "rawPayload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_events_provider_providerEventId_key" ON "payment_events"("provider", "providerEventId");
CREATE INDEX "payment_events_paymentId_idx" ON "payment_events"("paymentId");

ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. TenantPaymentMethod.
CREATE TABLE "tenant_payment_methods" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "provider" "PaymentProviderType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,

    CONSTRAINT "tenant_payment_methods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_payment_methods_tenantId_method_key" ON "tenant_payment_methods"("tenantId", "method");

ALTER TABLE "tenant_payment_methods" ADD CONSTRAINT "tenant_payment_methods_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
