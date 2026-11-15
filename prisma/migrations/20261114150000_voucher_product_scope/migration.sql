-- CreateEnum: VoucherScope
CREATE TYPE "VoucherScope" AS ENUM ('order', 'product');

-- Add scope column to vouchers (defaults to 'order', all existing vouchers stay order-scoped)
ALTER TABLE "vouchers" ADD COLUMN "scope" "VoucherScope" NOT NULL DEFAULT 'order';

-- Add product voucher snapshot fields to order_items
ALTER TABLE "order_items" ADD COLUMN "voucherUnitDiscount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "order_items" ADD COLUMN "voucherCode" TEXT;

-- CreateTable: voucher_products (product targeting for product-scoped vouchers)
CREATE TABLE "voucher_products" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "voucher_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voucher_products_productId_idx" ON "voucher_products"("productId");
CREATE UNIQUE INDEX "voucher_products_voucherId_productId_key" ON "voucher_products"("voucherId", "productId");

-- AddForeignKey
ALTER TABLE "voucher_products" ADD CONSTRAINT "voucher_products_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "voucher_products" ADD CONSTRAINT "voucher_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
