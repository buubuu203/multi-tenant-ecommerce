-- Replace the product category label with a tenant-managed category relation.
-- Backfills any labels already saved by the preceding migration.
-- Apply via: prisma db execute --file <this file>
-- Then register via: prisma migrate resolve --applied 20261118130000_manage_product_categories
-- Never via `prisma migrate dev` / `migrate reset` / `db push` on this environment.

BEGIN;

CREATE TABLE "product_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_categories_tenantId_name_key"
    ON "product_categories"("tenantId", "name");
CREATE INDEX "product_categories_tenantId_idx"
    ON "product_categories"("tenantId");

ALTER TABLE "products" ADD COLUMN "categoryId" TEXT;

INSERT INTO "product_categories" ("id", "tenantId", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "tenantId", "category", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "products"
WHERE "category" IS NOT NULL
GROUP BY "tenantId", "category";

UPDATE "products" AS product
SET "categoryId" = category."id"
FROM "product_categories" AS category
WHERE product."tenantId" = category."tenantId"
  AND product."category" = category."name";

ALTER TABLE "product_categories"
    ADD CONSTRAINT "product_categories_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "products"
    ADD CONSTRAINT "products_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "product_categories"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "products_tenantId_categoryId_idx"
    ON "products"("tenantId", "categoryId");

DROP INDEX "products_tenantId_category_idx";
ALTER TABLE "products" DROP COLUMN "category";

COMMIT;
