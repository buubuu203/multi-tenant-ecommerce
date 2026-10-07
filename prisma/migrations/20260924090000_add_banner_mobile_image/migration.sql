-- Banner UX improvements (V1.1): a separate, optional mobile-crop image,
-- and title/subtitle no longer required now that the storefront never
-- renders banner text (the image is the whole visual). Both changes are
-- backwards-compatible: mobileImageUrl is a new nullable column (existing
-- banners simply have no mobile image and fall back to imageUrl), and
-- relaxing title's NOT NULL constraint never touches existing values.
BEGIN;

ALTER TABLE "banners" ADD COLUMN "mobileImageUrl" TEXT;
ALTER TABLE "banners" ALTER COLUMN "title" DROP NOT NULL;

COMMIT;
