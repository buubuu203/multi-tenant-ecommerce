-- Storefront footer contact/legal block (UI/UX revamp, Board 5). All
-- nullable — see Branding model's doc comment in schema.prisma.
ALTER TABLE "branding"
    ADD COLUMN "address" TEXT,
    ADD COLUMN "phone" TEXT,
    ADD COLUMN "contactEmail" TEXT,
    ADD COLUMN "businessId" TEXT,
    ADD COLUMN "facebookUrl" TEXT,
    ADD COLUMN "tiktokUrl" TEXT,
    ADD COLUMN "zaloUrl" TEXT;
