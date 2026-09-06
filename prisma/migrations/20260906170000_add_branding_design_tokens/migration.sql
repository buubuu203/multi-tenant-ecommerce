-- Stores only the server-parsed design-token configuration. The uploaded
-- Markdown source is never persisted or rendered.
BEGIN;

ALTER TABLE "branding" ADD COLUMN "designTokens" JSONB;

COMMIT;
