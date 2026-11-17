-- Versioned public privacy notices and auditable customer anonymization.
-- Additive only. Existing orders remain valid with a null notice version.
-- This migration has not been applied to any hosted database.

BEGIN;

ALTER TABLE "customers"
    ADD COLUMN "anonymizedAt" TIMESTAMP(3);

CREATE TABLE "privacy_notice_versions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "controllerName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "noticeTextVi" TEXT NOT NULL,
    "noticeTextEn" TEXT NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "privacy_notice_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "privacy_notice_versions_tenantId_version_key"
    ON "privacy_notice_versions"("tenantId", "version");
CREATE UNIQUE INDEX "privacy_notice_versions_id_tenantId_key"
    ON "privacy_notice_versions"("id", "tenantId");
CREATE UNIQUE INDEX "privacy_notice_versions_one_current_per_tenant_idx"
    ON "privacy_notice_versions"("tenantId")
    WHERE "isCurrent" = true;
CREATE INDEX "privacy_notice_versions_tenantId_isCurrent_idx"
    ON "privacy_notice_versions"("tenantId", "isCurrent");

ALTER TABLE "privacy_notice_versions"
    ADD CONSTRAINT "privacy_notice_versions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "orders"
    ADD COLUMN "privacyNoticeVersionId" TEXT,
    ADD COLUMN "privacyNoticeAvailableAt" TIMESTAMP(3),
    ADD COLUMN "privacyConsentAt" TIMESTAMP(3);

CREATE INDEX "orders_privacyNoticeVersionId_idx"
    ON "orders"("privacyNoticeVersionId");

ALTER TABLE "orders"
    ADD CONSTRAINT "orders_privacyNoticeVersionId_tenantId_fkey"
    FOREIGN KEY ("privacyNoticeVersionId", "tenantId")
    REFERENCES "privacy_notice_versions"("id", "tenantId")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "customer_privacy_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "requestReceivedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "affectedOrderCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_privacy_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_privacy_events_tenantId_requestReceivedAt_idx"
    ON "customer_privacy_events"("tenantId", "requestReceivedAt");
CREATE INDEX "customer_privacy_events_customerId_idx"
    ON "customer_privacy_events"("customerId");

ALTER TABLE "customer_privacy_events"
    ADD CONSTRAINT "customer_privacy_events_customerId_tenantId_fkey"
    FOREIGN KEY ("customerId", "tenantId")
    REFERENCES "customers"("id", "tenantId")
    ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
