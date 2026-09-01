-- Hand-written migration (Step 28 — Order Creation foundation).
-- Purely additive: one enum, two new tables, their indexes/FKs. No
-- existing table is touched. No data backfill needed (no prior order data
-- exists anywhere in this schema).
--
-- Apply via: prisma db execute --file <this file>
-- Then register via: prisma migrate resolve --applied 20260830090000_add_order_foundation
-- Never via `prisma migrate dev` / `migrate reset` / `db push` on this environment.

BEGIN;

-- =========================================================================
-- 1. OrderStatus enum — intentionally a single value ('pending'). This
--    step's lifecycle produces no other state; later steps (payment,
--    fulfillment) will extend this enum when their design is approved.
-- =========================================================================
CREATE TYPE "OrderStatus" AS ENUM ('pending');

-- =========================================================================
-- 2. Order
-- =========================================================================
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "orders_id_tenantId_key" ON "orders"("id", "tenantId");
CREATE INDEX "orders_tenantId_idx" ON "orders"("tenantId");

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =========================================================================
-- 3. OrderItem — price is a snapshot (see schema.prisma doc comment),
--    never updated after insert. productVariant FK is RESTRICT: an order
--    item is a historical record that must never be silently orphaned by
--    a variant deletion (mirrors inventory.locationId's existing
--    RESTRICT). Defensive CHECK constraints: quantity must be positive,
--    price must be non-negative — the database remains the final
--    authority on both, consistent with this project's existing
--    conventions (Step 27's reservation logic, the combinationKey unique
--    index, etc.) rather than trusting only application-level validation.
-- =========================================================================
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_items_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "order_items_price_check" CHECK ("price" >= 0)
);

CREATE INDEX "order_items_tenantId_idx" ON "order_items"("tenantId");
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");
CREATE INDEX "order_items_productVariantId_idx" ON "order_items"("productVariantId");

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_orderId_tenantId_fkey"
  FOREIGN KEY ("orderId", "tenantId") REFERENCES "orders"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_productVariantId_tenantId_fkey"
  FOREIGN KEY ("productVariantId", "tenantId") REFERENCES "product_variants"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
