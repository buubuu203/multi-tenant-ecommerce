-- Additive only. Instagram joins the existing social-link fields;
-- tagline is a new short-description field for the footer (see
-- Branding model's doc comments in schema.prisma).
ALTER TABLE "branding"
    ADD COLUMN "instagramUrl" TEXT,
    ADD COLUMN "tagline" TEXT;
