-- Additive only. New-order alerts via Telegram (see Branding model's doc
-- comments in schema.prisma) — both nullable, feature is off until a
-- tenant admin fills both in via /tenant-admin/branding.
ALTER TABLE "branding"
    ADD COLUMN "telegramBotToken" TEXT,
    ADD COLUMN "telegramChatId" TEXT;
