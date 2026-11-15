-- CreateEnum
CREATE TYPE "VoucherDiscountType" AS ENUM ('percentage', 'fixed_amount');

-- CreateTable
CREATE TABLE "vouchers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountType" "VoucherDiscountType" NOT NULL,
    "discountValue" INTEGER NOT NULL,
    "minOrderAmount" INTEGER,
    "maxDiscount" INTEGER,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_usages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "discountAmount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_usages_pkey" PRIMARY KEY ("id")
);

-- AlterTable: add voucher snapshot fields to orders
ALTER TABLE "orders" ADD COLUMN "voucherCode" TEXT;
ALTER TABLE "orders" ADD COLUMN "voucherDiscount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_tenantId_code_key" ON "vouchers"("tenantId", "code");
CREATE INDEX "vouchers_tenantId_idx" ON "vouchers"("tenantId");

CREATE UNIQUE INDEX "voucher_usages_orderId_key" ON "voucher_usages"("orderId");
CREATE UNIQUE INDEX "voucher_usages_orderId_tenantId_key" ON "voucher_usages"("orderId", "tenantId");
CREATE INDEX "voucher_usages_voucherId_idx" ON "voucher_usages"("voucherId");
CREATE INDEX "voucher_usages_tenantId_idx" ON "voucher_usages"("tenantId");

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "voucher_usages" ADD CONSTRAINT "voucher_usages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "voucher_usages" ADD CONSTRAINT "voucher_usages_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "voucher_usages" ADD CONSTRAINT "voucher_usages_orderId_tenantId_fkey" FOREIGN KEY ("orderId", "tenantId") REFERENCES "orders"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
