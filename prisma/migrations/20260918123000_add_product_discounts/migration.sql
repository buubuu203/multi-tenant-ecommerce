-- Product Discount (V1). Purely additive: one new table (Discount, one
-- slot per product via a unique constraint) and two new nullable columns
-- on order_items (informational snapshots only — order_items.price
-- already carries the final charged price and needs no change).
BEGIN;

CREATE TABLE "discounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "percentOff" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "discounts_productId_key" ON "discounts"("productId");
CREATE INDEX "discounts_tenantId_idx" ON "discounts"("tenantId");

ALTER TABLE "discounts" ADD CONSTRAINT "discounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_items" ADD COLUMN "originalUnitPrice" INTEGER;
ALTER TABLE "order_items" ADD COLUMN "discountPercent" INTEGER;

COMMIT;
