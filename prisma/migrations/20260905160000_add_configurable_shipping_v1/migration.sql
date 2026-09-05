-- V1 Configurable Shipping.
--
-- Fully additive: new table + two new Order columns, no destructive
-- statements, no data migration needed beyond the DEFAULT values below
-- (every existing row gets shippingAmount = 0, shippingMethodName = NULL,
-- which is the semantically correct "this order never had shipping
-- configured" state, not a placeholder).
--
-- Apply via: prisma db execute --file <this file>
-- Then register via: prisma migrate resolve --applied 20260905160000_add_configurable_shipping_v1
-- Never via `prisma migrate dev` / `migrate reset` / `db push` on Preview
-- or Production.

BEGIN;

-- 1. Order: shipping snapshot columns.
ALTER TABLE "orders" ADD COLUMN "shippingAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "shippingMethodName" TEXT;

-- 2. TenantShippingMethod.
CREATE TABLE "tenant_shipping_methods" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_shipping_methods_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_shipping_methods_tenantId_idx" ON "tenant_shipping_methods"("tenantId");

-- Database-level "at most one default per tenant" guarantee — the same
-- partial unique index pattern already proven in this codebase for
-- Domain.isPrimary (see domains_one_primary_per_tenant in
-- 20260824150052_init_tenant_foundation/migration.sql). Application-level
-- enforcement (clearOtherDefaults() in shipping-mutations.ts) remains in
-- place and handles the normal, non-concurrent case cleanly; this index
-- is the hard backstop against two concurrent "set default" requests
-- both committing with isDefault = true.
CREATE UNIQUE INDEX "tenant_shipping_methods_one_default_per_tenant" ON "tenant_shipping_methods"("tenantId") WHERE "isDefault" = true;

ALTER TABLE "tenant_shipping_methods" ADD CONSTRAINT "tenant_shipping_methods_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
