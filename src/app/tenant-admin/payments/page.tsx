import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import { getScopedDb } from '@/lib/db/tenant-db';
import { isProviderConfigured } from '@/lib/payments/payment-service';
import { ActionForm } from '@/components/ActionForm';
import { updateTenantPaymentMethodAction } from '../actions';
import {
  adminPageClassName,
  adminPanelClassName,
  adminPanelTitleClassName,
  adminInputClassName,
  adminLabelClassName,
  adminHelpTextClassName,
  adminEyebrowClassName,
} from '../styles';
import { AdminPageHeader } from '../AdminPageHeader';
import { StatusBadge } from '../StatusBadge';

export const dynamic = 'force-dynamic';

type BankConfig = {
  bankName?: string;
  accountNumber?: string;
  accountHolder?: string;
  baUuid?: string;
};

export default async function PaymentsPage() {
  const { tenantId } = await requireTenantAdmin();
  const db = getScopedDb(tenantId);
  // Step 51: one row per PaymentMethod at most, keyed by method — see
  // TenantPaymentMethod.@@unique([tenantId, method]).
  const tenantPaymentMethods = await db.tenantPaymentMethod.findMany({ where: { tenantId } });
  const paymentMethodByMethod = new Map(tenantPaymentMethods.map((row) => [row.method, row]));

  const cod = paymentMethodByMethod.get('cod');
  const bank = paymentMethodByMethod.get('bank_transfer');
  const momo = paymentMethodByMethod.get('momo');

  const bankConfig = (bank?.config ?? null) as BankConfig | null;
  const bankProvider = bank?.provider ?? 'bank_transfer_manual';
  const isSepay = bankProvider === 'bank_transfer_sepay_va';

  // Readiness is DISPLAY-ONLY and deliberately derived from the very
  // predicate that gates the storefront's method selector
  // (isProviderConfigured, exported from payment-service) rather than a
  // second copy of the rule here — so this badge can never claim a method
  // is usable when checkout would reject it, or vice versa.
  const bankReady = isProviderConfigured(
    bankProvider,
    (bankConfig ?? null) as Record<string, unknown> | null,
  );

  // Which specific manual fields are missing, so the helper text can name
  // them instead of saying "incomplete".
  const missingManual = [
    !bankConfig?.bankName && 'bank name',
    !bankConfig?.accountNumber && 'account number',
    !bankConfig?.accountHolder && 'account holder',
  ].filter((v): v is string => typeof v === 'string');

  return (
    <div className={adminPageClassName}>
      {/* Lead description carries only the rule that decides whether a
          customer can pay at all; the per-provider detail lives beside the
          fields it governs, which is what keeps the first control high on
          a 375px screen. */}
      <AdminPageHeader
        title="Payments"
        description="A method appears at checkout only when it is both enabled and fully configured."
      />

      {/* Cash on delivery — no configuration, just enable/disable. */}
      <section aria-labelledby="pm-cod" className={adminPanelClassName}>
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 id="pm-cod" className={adminPanelTitleClassName}>
              Cash on delivery
            </h3>
            <p className="text-xs text-muted-foreground">
              The customer pays the courier. Nothing to configure, so enabling it is enough to make
              it available.
            </p>
          </div>
          <StatusBadge
            status={cod?.enabled ? 'Enabled' : 'Disabled'}
            tone={cod?.enabled ? 'success' : 'neutral'}
          />
        </div>
        <ActionForm
          action={updateTenantPaymentMethodAction}
          submitLabel="Save"
          successMessage="Cash on delivery settings saved."
          className="max-w-md"
        >
          <input type="hidden" name="method" value="cod" />
          <input type="hidden" name="provider" value="cod" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={cod?.enabled ?? false} />
            Enabled
          </label>
        </ActionForm>
      </section>

      {/* Bank transfer — two possible providers behind the same
        customer-facing method; manual requires bank details, SePay VA
        requires a registered bank-account UUID (set up with SePay
        directly — that account linking happens outside this app). */}
      <section aria-labelledby="pm-bank" className={adminPanelClassName}>
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 id="pm-bank" className={adminPanelTitleClassName}>
              Bank transfer
            </h3>
            <p className="text-xs text-muted-foreground">
              {isSepay
                ? "SePay virtual account — confirmed automatically by SePay's webhook."
                : 'Manual — you confirm each payment yourself from the order.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge
              status={bank?.enabled ? 'Enabled' : 'Disabled'}
              tone={bank?.enabled ? 'success' : 'neutral'}
            />
            {/* Enabled and Ready are different questions: a method can be
                switched on and still be missing the fields checkout needs.
                Both are words, never colour alone. */}
            <StatusBadge
              status={bankReady ? 'Ready' : 'Needs setup'}
              tone={bankReady ? 'success' : 'warning'}
            />
            <StatusBadge status={isSepay ? 'SePay' : 'Manual'} tone="info" />
          </div>
        </div>
        <ActionForm
          action={updateTenantPaymentMethodAction}
          submitLabel="Save"
          successMessage="Bank transfer settings saved."
          className="max-w-md"
        >
          <input type="hidden" name="method" value="bank_transfer" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={bank?.enabled ?? false} />
            Enabled
          </label>
          <label className={adminLabelClassName}>
            Provider
            <select name="provider" defaultValue={bankProvider} className={adminInputClassName}>
              <option value="bank_transfer_manual">
                Manual (merchant confirms transfers by hand)
              </option>
              <option value="bank_transfer_sepay_va">
                SePay virtual account (automatic confirmation)
              </option>
            </select>
            {/* Existing save behaviour, stated rather than changed: the
                action writes config for the SELECTED provider only, so the
                other group's values are not kept. A merchant who switches
                provider should know that before pressing Save, not after. */}
            <span className="text-xs text-muted-foreground">
              Only the selected provider&apos;s fields below are saved. Switching provider replaces
              the stored configuration with that provider&apos;s fields.
            </span>
          </label>

          {/* Two providers, two labelled groups, divided by a hairline —
              rather than five flat fields whose "(manual)" and "(SePay VA)"
              suffixes were the only clue about which ones mattered. */}
          <fieldset className="flex flex-col gap-3 border-t border-border pt-3">
            <legend className={adminEyebrowClassName}>Manual bank transfer</legend>
            {!isSepay && missingManual.length > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-500">
                Needs setup: add the {missingManual.join(', ')} below. All three are required before
                manual bank transfer can be enabled.
              </p>
            )}
            <label className={adminLabelClassName}>
              Bank name
              <input
                name="bankName"
                defaultValue={bankConfig?.bankName ?? ''}
                placeholder="Vietcombank"
                className={adminInputClassName}
              />
            </label>
            <label className={adminLabelClassName}>
              Account number
              <input
                name="bankAccountNumber"
                defaultValue={bankConfig?.accountNumber ?? ''}
                placeholder="0123456789"
                className={adminInputClassName}
              />
            </label>
            <label className={adminLabelClassName}>
              Account holder
              <input
                name="bankAccountHolder"
                defaultValue={bankConfig?.accountHolder ?? ''}
                placeholder="NGUYEN VAN A"
                className={adminInputClassName}
              />
            </label>
          </fieldset>

          <fieldset className="flex flex-col gap-3 border-t border-border pt-3">
            <legend className={adminEyebrowClassName}>SePay virtual account</legend>
            {isSepay && !bankConfig?.baUuid && (
              <p className="text-xs text-amber-700 dark:text-amber-500">
                Needs setup: add the SePay bank account UUID below. It is required before SePay
                virtual accounts can be enabled.
              </p>
            )}
            <label className={adminLabelClassName}>
              SePay bank account UUID
              <input
                name="sepayBaUuid"
                defaultValue={bankConfig?.baUuid ?? ''}
                placeholder="From your SePay dashboard"
                className={adminInputClassName}
              />
              <span className="text-xs text-muted-foreground">
                Created when you register your bank account with SePay — that linking happens in
                SePay, not here.
              </span>
            </label>
          </fieldset>
        </ActionForm>
      </section>

      {/* MoMo — platform-level credentials (env vars), no per-tenant
        config to enter; enabling it here just opts this tenant into
        the shared platform MoMo integration once it's configured. */}
      <section aria-labelledby="pm-momo" className={adminPanelClassName}>
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 id="pm-momo" className={adminPanelTitleClassName}>
              MoMo
            </h3>
            <p className="text-xs text-muted-foreground">
              Uses this platform&apos;s shared MoMo credentials — there is nothing to enter here.
            </p>
          </div>
          <StatusBadge
            status={momo?.enabled ? 'Enabled' : 'Disabled'}
            tone={momo?.enabled ? 'success' : 'neutral'}
          />
        </div>
        <ActionForm
          action={updateTenantPaymentMethodAction}
          submitLabel="Save"
          successMessage="MoMo settings saved."
          className="max-w-md"
        >
          <input type="hidden" name="method" value="momo" />
          <input type="hidden" name="provider" value="momo" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={momo?.enabled ?? false} />
            Enabled
          </label>
          {/* No readiness badge here on purpose: MoMo's credentials are
              platform-level environment variables, which this page cannot
              read, so any Ready/Needs setup claim would be a guess. */}
          <p className={adminHelpTextClassName}>
            Readiness is not shown for MoMo: it depends on platform credentials this page cannot
            see. If MoMo fails at checkout while enabled, the platform operator needs to check it.
          </p>
        </ActionForm>
      </section>
    </div>
  );
}
