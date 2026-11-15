-- Phase 2+3: Promotion System v2
-- 1. Add DiscountType enum + convert Discount.percentOff → discountType + discountValue
-- 2. Add PromotionTrigger enum + triggerType/label on Voucher
-- 3. Make Voucher.code nullable (automatic promotions have no code)

-- 1a. DiscountType enum
CREATE TYPE "DiscountType" AS ENUM ('percentage', 'fixed_amount');

-- 1b. Add discountType column with default
ALTER TABLE "discounts" ADD COLUMN "discountType" "DiscountType" NOT NULL DEFAULT 'percentage';

-- 1c. Rename percentOff → discountValue (data is preserved, all existing rows are percentage type)
ALTER TABLE "discounts" RENAME COLUMN "percentOff" TO "discountValue";

-- 2a. PromotionTrigger enum
CREATE TYPE "PromotionTrigger" AS ENUM ('code', 'automatic');

-- 2b. Add triggerType + label to vouchers
ALTER TABLE "vouchers" ADD COLUMN "triggerType" "PromotionTrigger" NOT NULL DEFAULT 'code';
ALTER TABLE "vouchers" ADD COLUMN "label" TEXT;

-- 2c. Make code nullable (automatic promotions don't need a code)
ALTER TABLE "vouchers" ALTER COLUMN "code" DROP NOT NULL;

-- 2d. Unique constraint on label per tenant (for auto promotions)
CREATE UNIQUE INDEX "vouchers_tenantId_label_key" ON "vouchers"("tenantId", "label");
