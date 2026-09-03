-- Adds merchant-configured bank transfer instructions to Branding.
-- Purely additive (3 nullable columns) — safe, non-destructive on any
-- environment. Apply via: prisma db execute --file <this file>, then
-- register via: prisma migrate resolve --applied 20260903100000_add_branding_bank_transfer_info
-- Never via `prisma migrate dev` / `migrate reset` / `db push` on Preview
-- or Production.

BEGIN;

ALTER TABLE "branding" ADD COLUMN "bankName" TEXT;
ALTER TABLE "branding" ADD COLUMN "bankAccountNumber" TEXT;
ALTER TABLE "branding" ADD COLUMN "bankAccountHolder" TEXT;

COMMIT;
