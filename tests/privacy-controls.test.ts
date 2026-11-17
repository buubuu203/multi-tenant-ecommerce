import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validatePrivacyNoticeInput,
  parseRequestReceivedDate,
  isCurrentPrivacyNoticeVersion,
} from '../src/lib/privacy-mutations';

const root = new URL('../', import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), 'utf8');

test('privacy notice input is trimmed and requires both approved language versions', () => {
  const valid = validatePrivacyNoticeInput({
    controllerName: ' Example Store ',
    contactEmail: ' privacy@example.com ',
    noticeTextVi: '  Thông báo giải thích cách cửa hàng sử dụng thông tin đơn hàng.  ',
    noticeTextEn: '  This notice explains how this store uses order information.  ',
  });
  assert.deepEqual(valid, {
    success: true,
    data: {
      controllerName: 'Example Store',
      contactEmail: 'privacy@example.com',
      noticeTextVi: 'Thông báo giải thích cách cửa hàng sử dụng thông tin đơn hàng.',
      noticeTextEn: 'This notice explains how this store uses order information.',
    },
  });

  assert.equal(
    validatePrivacyNoticeInput({
      controllerName: 'Store',
      contactEmail: 'not-an-email',
      noticeTextVi: 'Một nội dung thông báo đủ dài cho bài kiểm thử này.',
      noticeTextEn: 'An otherwise long enough notice body for this test.',
    }).success,
    false,
  );
  assert.equal(
    validatePrivacyNoticeInput({
      controllerName: 'Store',
      contactEmail: 'privacy@example.com',
      noticeTextVi: 'Nội dung thông báo đủ dài cho bài kiểm thử này.',
      noticeTextEn: 'Too short',
    }).success,
    false,
  );
});

test('public privacy notice selects the copy matching the active locale', () => {
  const page = source('src/app/privacy/page.tsx');
  assert.match(page, /locale === 'vi' \? notice\.noticeTextVi : notice\.noticeTextEn/);
});

test('privacy request date rejects malformed, impossible, and future dates', () => {
  const now = new Date('2026-11-19T12:00:00.000Z');
  const valid = parseRequestReceivedDate('2026-11-18', now);
  assert.equal(valid.success, true);
  if (valid.success) assert.equal(valid.data.toISOString(), '2026-11-18T00:00:00.000Z');
  assert.equal(parseRequestReceivedDate('2026-02-30', now).success, false);
  assert.equal(parseRequestReceivedDate('2026-11-20', now).success, false);
  assert.equal(parseRequestReceivedDate('', now).success, false);
});

test('checkout rejects a missing or stale privacy notice version server-side', () => {
  assert.equal(isCurrentPrivacyNoticeVersion(null, 'notice-1'), false);
  assert.equal(isCurrentPrivacyNoticeVersion('notice-2', undefined), false);
  assert.equal(isCurrentPrivacyNoticeVersion('notice-2', 'notice-1'), false);
  assert.equal(isCurrentPrivacyNoticeVersion('notice-2', 'notice-2'), true);

  const checkout = source('src/app/_storefront/checkout-actions.ts');
  const orders = source('src/lib/order-mutations.ts');
  const widget = source('src/app/_storefront/CartWidget.tsx');
  assert.match(checkout, /isCurrentPrivacyNoticeVersion\(/);
  assert.match(checkout, /if \(!privacyConsentAccepted\)/);
  assert.match(widget, /checked=\{privacyConsentAccepted\}/);
  assert.match(widget, /consentedPrivacyNoticeVersionId === privacyNoticeVersionId/);
  assert.match(orders, /isCurrent:\s*true/);
  assert.match(orders, /privacyConsentAt:\s*privacyConsentAccepted \? new Date\(\) : null/);
  assert.match(orders, /privacyConsentRequired/);
});

test('anonymization requires admin confirmation and redacts persisted direct identifiers', () => {
  const actions = source('src/app/tenant-admin/actions.ts');
  const mutations = source('src/lib/privacy-mutations.ts');
  assert.match(actions, /confirmPrivacyRequest/);
  assert.match(mutations, /providerMetadata:\s*Prisma\.DbNull/);
  assert.match(mutations, /rawPayload:\s*\{\s*redacted:\s*true\s*\}/);
  assert.match(mutations, /tx\.customerPrivacyEvent\.create/);
});
