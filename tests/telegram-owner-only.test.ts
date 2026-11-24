// Telegram bot credentials are owner-only (2026-11-25): a "tenant_staff"
// account must never see, change or test-probe them. The actual
// authorization matrix is unit-tested in admin-authorization.test.ts;
// this confirms the two call sites that matter actually USE it, since
// nothing else would catch a future edit silently dropping the check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));

function source(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

test("updateBrandingAction only forwards Telegram fields when role is tenant_admin", () => {
  const body = source("src/app/tenant-admin/actions.ts");
  const start = body.indexOf("export async function updateBrandingAction");
  const end = body.indexOf("export async function publishPrivacyNoticeAction");
  const fn = body.slice(start, end);
  assert.match(fn, /isOwner\s*=\s*role === 'tenant_admin'/);
  assert.match(fn, /isOwner\s*\?\s*\{[\s\S]*telegramBotToken/);
});

test("sendTestTelegramNotificationAction refuses a non-owner role", () => {
  const body = source("src/app/tenant-admin/actions.ts");
  const start = body.indexOf("export async function sendTestTelegramNotificationAction");
  const end = body.indexOf("export async function publishPrivacyNoticeAction");
  const fn = body.slice(start, end);
  assert.match(fn, /role !== 'tenant_admin'/);
  assert.match(fn, /success:\s*false/);
});

test("the branding admin page hides the whole Telegram section from a non-owner, not just disables it", () => {
  const body = source("src/app/tenant-admin/branding/page.tsx");
  assert.match(body, /isOwner\s*=\s*role === 'tenant_admin'/);
  assert.match(body, /\{isOwner &&[\s\S]*brand-telegram/);
});
