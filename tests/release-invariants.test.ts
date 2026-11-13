// Behavioural tests for the pure predicates extracted during release
// hardening: the confirmation decision, shipping availability, and payment
// readiness. These exercise real functions, not source text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldRequestConfirmation, resolveConfirmMessage } from '../src/components/confirm-policy';
import {
  shippingBlockedReason,
  enabledShippingMethodCount,
  NO_METHODS_BLOCKED_REASON,
  ALL_DISABLED_BLOCKED_REASON,
} from '../src/lib/shipping-availability';
import { isProviderConfigured } from '../src/lib/payments/payment-service';

// A stand-in for the submitted form: only `get` is used.
function submitted(values: Record<string, string>) {
  return { get: (name: string) => values[name] ?? null };
}
function reader(values: Record<string, string>) {
  return (name: string) => values[name] ?? '';
}

// ---------- confirmation policy ----------
//
// LIMIT OF THIS COVERAGE: these are pure functions. They prove WHEN a
// confirmation is requested and WHICH message is shown. They prove nothing
// about the browser — that declining the dialog issues no network request
// is still only verified by reading ConfirmActionForm, never at runtime.

test('switching a configured provider requires confirmation', () => {
  assert.equal(
    shouldRequestConfirmation({
      confirmWhen: { field: 'provider', differsFrom: 'bank_transfer_manual' },
      readField: reader({ provider: 'bank_transfer_sepay_va' }),
    }),
    true,
  );
});

test('an unchanged provider does not require confirmation', () => {
  assert.equal(
    shouldRequestConfirmation({
      confirmWhen: { field: 'provider', differsFrom: 'bank_transfer_manual' },
      readField: reader({ provider: 'bank_transfer_manual' }),
    }),
    false,
    'saving bank details without touching the provider must not nag',
  );
});

test('an empty configuration does not require confirmation', () => {
  // skipConfirmation is what the server passes when nothing is stored yet,
  // so a first provider choice has nothing to lose.
  assert.equal(
    shouldRequestConfirmation({
      skipConfirmation: true,
      confirmWhen: { field: 'provider', differsFrom: 'bank_transfer_manual' },
      readField: reader({ provider: 'bank_transfer_sepay_va' }),
    }),
    false,
  );
});

test('destructive actions with no condition always confirm', () => {
  // Discount removal, option removal, value deletion: no confirmWhen, so
  // the original always-confirm behaviour is preserved.
  assert.equal(shouldRequestConfirmation({ readField: reader({}) }), true);
  assert.equal(shouldRequestConfirmation({ confirmWhen: undefined, readField: reader({}) }), true);
});

test('a missing field is treated as changed, never as a silent pass', () => {
  // If the guarded field were absent, failing OPEN (no dialog) would be the
  // dangerous direction.
  assert.equal(
    shouldRequestConfirmation({
      confirmWhen: { field: 'provider', differsFrom: 'bank_transfer_manual' },
      readField: reader({}),
    }),
    true,
  );
});

test('the confirmation message is stable for a plain string', () => {
  const message = 'Switch bank transfer provider?';
  assert.equal(resolveConfirmMessage(message, submitted({})), message);
  assert.equal(
    resolveConfirmMessage(message, submitted({ provider: 'anything' })),
    message,
    'the same input always yields the same message',
  );
});

test('a function message sees the values actually submitted', () => {
  const resolved = resolveConfirmMessage(
    (form) => `provider=${String(form.get('provider'))}`,
    submitted({ provider: 'bank_transfer_sepay_va' }),
  );
  assert.equal(resolved, 'provider=bank_transfer_sepay_va');
});

test('the policy adds no form field and reads nothing it was not given', () => {
  const seen: string[] = [];
  shouldRequestConfirmation({
    confirmWhen: { field: 'provider', differsFrom: 'x' },
    readField: (name) => {
      seen.push(name);
      return 'x';
    },
  });
  assert.deepEqual(seen, ['provider'], 'only the guarded field is read');
});

// ---------- shipping availability ----------

test('no shipping methods blocks checkout', () => {
  assert.equal(shippingBlockedReason([]), NO_METHODS_BLOCKED_REASON);
  assert.match(NO_METHODS_BLOCKED_REASON, /no shipping method is configured/);
});

test('methods that all exist but are disabled block checkout', () => {
  const reason = shippingBlockedReason([
    { enabled: false },
    { enabled: false },
    { enabled: false },
  ]);
  assert.equal(reason, ALL_DISABLED_BLOCKED_REASON);
  assert.notEqual(reason, NO_METHODS_BLOCKED_REASON, 'the two cases are distinguished');
});

test('one enabled method is enough to unblock checkout', () => {
  assert.equal(shippingBlockedReason([{ enabled: false }, { enabled: true }]), null);
  assert.equal(shippingBlockedReason([{ enabled: true }]), null);
});

test('the enabled count ignores disabled methods', () => {
  assert.equal(enabledShippingMethodCount([]), 0);
  assert.equal(enabledShippingMethodCount([{ enabled: false }]), 0);
  assert.equal(enabledShippingMethodCount([{ enabled: true }, { enabled: false }]), 1);
});

test('a disabled default method is still just a disabled method', () => {
  // isDefault does not make a method available; only enabled does. The admin
  // shows both states separately, and this is the half that gates checkout.
  assert.equal(shippingBlockedReason([{ enabled: false }]), ALL_DISABLED_BLOCKED_REASON);
});

// ---------- payment readiness ----------
//
// Reuses the predicate that gates the storefront selector, rather than a
// second copy of the rule.

test('manual bank transfer is not ready until all three fields are present', () => {
  assert.equal(isProviderConfigured('bank_transfer_manual', null), false);
  assert.equal(isProviderConfigured('bank_transfer_manual', {}), false);
  assert.equal(
    isProviderConfigured('bank_transfer_manual', { bankName: 'Vietcombank' }),
    false,
    'partial configuration is not ready',
  );
  assert.equal(
    isProviderConfigured('bank_transfer_manual', {
      bankName: 'Vietcombank',
      accountNumber: '0123456789',
    }),
    false,
  );
  assert.equal(
    isProviderConfigured('bank_transfer_manual', {
      bankName: 'Vietcombank',
      accountNumber: '0123456789',
      accountHolder: 'NGUYEN VAN A',
    }),
    true,
  );
});

test('an empty string does not count as configured', () => {
  assert.equal(
    isProviderConfigured('bank_transfer_manual', {
      bankName: '',
      accountNumber: '0123456789',
      accountHolder: 'NGUYEN VAN A',
    }),
    false,
  );
});

test('SePay is not ready without its bank account UUID', () => {
  assert.equal(isProviderConfigured('bank_transfer_sepay_va', null), false);
  assert.equal(isProviderConfigured('bank_transfer_sepay_va', { baUuid: '' }), false);
  assert.equal(isProviderConfigured('bank_transfer_sepay_va', { baUuid: 'abc-123' }), true);
  // Manual fields do not satisfy SePay.
  assert.equal(
    isProviderConfigured('bank_transfer_sepay_va', {
      bankName: 'Vietcombank',
      accountNumber: '0123456789',
      accountHolder: 'NGUYEN VAN A',
    }),
    false,
  );
});

test('cash on delivery needs no configuration', () => {
  assert.equal(isProviderConfigured('cod', null), true);
  assert.equal(isProviderConfigured('cod', {}), true);
});

test("MoMo's platform-credential limitation stays explicit", () => {
  // The predicate returns true because per-tenant config does not apply —
  // its credentials are platform env vars. The admin therefore shows NO
  // readiness badge for MoMo rather than a Ready it cannot justify.
  assert.equal(isProviderConfigured('momo', null), true);

  const page = readFileSync(
    new URL('../src/app/tenant-admin/payments/page.tsx', import.meta.url),
    'utf8',
  );
  assert.match(page, /Readiness is not shown for MoMo/);
  assert.match(page, /platform credentials this page cannot/);
});
