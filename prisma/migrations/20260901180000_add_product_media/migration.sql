-- Hand-written migration (Step 50 — Product Media Gallery).
-- Replaces Product.imageUrl (Step 44, a single merchant-pasted URL) with a
-- proper one-to-many ProductMedia relation (uploaded via Vercel Blob).
-- Drops the old column rather than keeping both, to avoid two competing
-- sources of truth for "the product's picture" (per the approved design).
--
-- Safe to drop imageUrl here: as of this migration, no product on the
-- production `store-mvp` database has ever been created through the app
-- (the pilot tenant `poprint` has zero products — confirmed before writing
-- this migration, per the explicit "do not add sample products yet"
-- instruction). Locally, any demo products' imageUrl values are lost, but
-- those are disposable test/demo rows, not real data.
--
-- Apply via: prisma db execute --file <this file>
-- Then register via: prisma migrate resolve --applied 20260901180000_add_product_media
-- Never via `prisma migrate dev` / `migrate reset` / `db push` on this environment.

BEGIN;

CREATE TYPE "ProductMediaType" AS ENUM ('image', 'video');

CREATE TABLE "product_media" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "ProductMediaType" NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_media_tenantId_idx" ON "product_media"("tenantId");
CREATE INDEX "product_media_productId_idx" ON "product_media"("productId");

ALTER TABLE "product_media" ADD CONSTRAINT "product_media_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_productId_tenantId_fkey" FOREIGN KEY ("productId", "tenantId") REFERENCES "products"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "products" DROP COLUMN "imageUrl";

COMMIT;
