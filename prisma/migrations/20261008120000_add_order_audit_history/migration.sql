-- Order Audit History. Purely additive: two new enums and one new table.
-- No existing table, column, constraint or row is touched, so this is safe
-- to apply to a populated database and needs no backfill — orders placed
-- before this migration simply have an empty timeline, which is accurate
-- rather than misleading.
BEGIN;

CREATE TYPE "OrderEventType" AS ENUM ('order_created', 'order_status_changed', 'payment_status_changed', 'inventory_released');
CREATE TYPE "OrderEventActorType" AS ENUM ('system', 'tenant_admin', 'platform_admin');

CREATE TABLE "order_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "OrderEventType" NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "summary" TEXT NOT NULL,
    "actorType" "OrderEventActorType" NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- The timeline is always read as (tenant, order, chronological).
CREATE INDEX "order_events_tenantId_orderId_createdAt_idx" ON "order_events"("tenantId", "orderId", "createdAt");
CREATE INDEX "order_events_tenantId_idx" ON "order_events"("tenantId");

ALTER TABLE "order_events" ADD CONSTRAINT "order_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Composite FK to (id, tenantId): an event cannot be attached to another
-- tenant's order. Cascade so deleting an order leaves no orphan events.
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_orderId_tenantId_fkey" FOREIGN KEY ("orderId", "tenantId") REFERENCES "orders"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
