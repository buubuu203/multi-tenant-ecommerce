-- Append-only evidence for REJECTED payment webhook deliveries.
--
-- Purely additive: one enum, one table, two indexes. No existing table,
-- column, constraint or row is touched, and no backfill is needed —
-- rejections before this migration were never recorded and cannot be
-- recovered, which is stated in the documentation rather than faked.
--
-- Never via `prisma migrate dev` / `migrate reset` / `db push` on Preview
-- or Production: those can reset the database. Use `migrate deploy`.
BEGIN;

CREATE TYPE "PaymentRejectionReason" AS ENUM ('amount_mismatch', 'unknown_payment', 'invalid_payload');

CREATE TABLE "payment_rejections" (
    "id" TEXT NOT NULL,
    -- Nullable on purpose: a webhook that resolves to no payment has no
    -- trustworthy tenant, and must never surface in a tenant's queue.
    "tenantId" TEXT,
    "provider" "PaymentProviderType" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "reason" "PaymentRejectionReason" NOT NULL,
    "providerOrderId" TEXT,
    "paymentId" TEXT,
    "orderId" TEXT,
    "expectedAmount" INTEGER,
    "reportedAmount" INTEGER,
    "payloadDigest" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_rejections_pkey" PRIMARY KEY ("id")
);

-- The deduplication contract: one row per (provider, stable key). A retry
-- of the same rejected delivery bumps occurrences rather than inserting.
CREATE UNIQUE INDEX "payment_rejections_provider_dedupeKey_key"
    ON "payment_rejections"("provider", "dedupeKey");

-- The tenant queue's only access path, newest first.
CREATE INDEX "payment_rejections_tenantId_firstSeenAt_idx"
    ON "payment_rejections"("tenantId", "firstSeenAt");

COMMIT;
