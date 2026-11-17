-- Add one optional, merchant-managed category label to each product.
-- Apply via: prisma db execute --file <this file>
-- Then register via: prisma migrate resolve --applied 20261118120000_add_product_category
-- Never via `prisma migrate dev` / `migrate reset` / `db push` on this environment.

BEGIN;

ALTER TABLE "products" ADD COLUMN "category" TEXT;
CREATE INDEX "products_tenantId_category_idx" ON "products"("tenantId", "category");

COMMIT;
