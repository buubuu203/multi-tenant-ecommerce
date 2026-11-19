-- Drift fix, not a new feature. 20261119120000_add_privacy_controls is
-- recorded as applied and two of its three `orders` columns
-- (privacyNoticeVersionId, privacyNoticeAvailableAt) are present on the
-- live database, but `privacyConsentAt` specifically is not — confirmed
-- by a direct information_schema check, not inferred from the drift
-- warning alone. This re-adds exactly that one column, additive only, so
-- the schema matches what that migration always intended.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "privacyConsentAt" TIMESTAMP(3);
