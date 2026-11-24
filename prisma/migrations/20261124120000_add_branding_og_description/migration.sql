-- Additive only. A longer, separate SEO/Open Graph description, distinct
-- from the short `tagline` field — see Branding's doc comments in
-- schema.prisma.
ALTER TABLE "branding"
    ADD COLUMN "ogDescription" TEXT;
