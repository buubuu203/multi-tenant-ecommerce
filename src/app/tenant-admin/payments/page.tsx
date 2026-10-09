import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { getScopedDb } from "@/lib/db/tenant-db";
import { ActionForm } from "@/components/ActionForm";
import { updateTenantPaymentMethodAction } from "../actions";
import {
  adminPageClassName,
  adminPanelClassName,
  adminPanelTitleClassName,
  adminInputClassName,
  adminLabelClassName,
} from "../styles";
import { AdminPageHeader } from "../AdminPageHeader";
import { StatusBadge } from "../StatusBadge";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const { tenantId } = await requireTenantAdmin();
  const db = getScopedDb(tenantId);
  // Step 51: one row per PaymentMethod at most, keyed by method — see
  // TenantPaymentMethod.@@unique([tenantId, method]).
  const tenantPaymentMethods = await db.tenantPaymentMethod.findMany({ where: { tenantId } });
  const paymentMethodByMethod = new Map(tenantPaymentMethods.map((row) => [row.method, row]));

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title="Payments"
        description="Only enabled AND fully configured methods appear at checkout — a customer can never select a method you have not set up here, even if this toggle is on but the required fields below are empty."
      />

      {/* Cash on delivery — no configuration, just enable/disable. */}
      <section aria-labelledby="pm-cod" className={adminPanelClassName}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <div className="flex flex-col gap-0.5">
            <h3 id="pm-cod" className={adminPanelTitleClassName}>
              Cash on delivery
            </h3>
            <p className="text-xs text-muted-foreground">
              No configuration needed — the customer pays the courier.
            </p>
          </div>
          {/* Shared badge rather than a grey word, so a method's state is
              as scannable here as a status is anywhere else in the admin. */}
          <StatusBadge
            status={paymentMethodByMethod.get("cod")?.enabled ? "Enabled" : "Disabled"}
            tone={paymentMethodByMethod.get("cod")?.enabled ? "success" : "neutral"}
          />
        </div>
        <ActionForm action={updateTenantPaymentMethodAction} submitLabel="Save" successMessage="Cash on delivery settings saved.">
          <input type="hidden" name="method" value="cod" />
          <input type="hidden" name="provider" value="cod" />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={paymentMethodByMethod.get("cod")?.enabled ?? false}
            />
            Enabled
          </label>
        </ActionForm>
      </section>

      {/* Bank transfer — two possible providers behind the same
        customer-facing method; manual requires bank details, SePay VA
        requires a registered bank-account UUID (set up with SePay
        directly — that account linking happens outside this app). */}
      <section aria-labelledby="pm-bank" className={adminPanelClassName}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <div className="flex flex-col gap-0.5">
            <h3 id="pm-bank" className={adminPanelTitleClassName}>
              Bank transfer
            </h3>
            <p className="text-xs text-muted-foreground">
              {paymentMethodByMethod.get("bank_transfer")?.provider === "bank_transfer_sepay_va"
                ? "SePay virtual account — confirmed automatically by SePay's webhook."
                : "Manual — you confirm each payment yourself from the order."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge
              status={paymentMethodByMethod.get("bank_transfer")?.enabled ? "Enabled" : "Disabled"}
              tone={paymentMethodByMethod.get("bank_transfer")?.enabled ? "success" : "neutral"}
            />
            <StatusBadge
              status={
                paymentMethodByMethod.get("bank_transfer")?.provider === "bank_transfer_sepay_va"
                  ? "SePay"
                  : "Manual"
              }
              tone="info"
            />
          </div>
        </div>
        <ActionForm action={updateTenantPaymentMethodAction} submitLabel="Save" successMessage="Bank transfer settings saved.">
          <input type="hidden" name="method" value="bank_transfer" />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={paymentMethodByMethod.get("bank_transfer")?.enabled ?? false}
            />
            Enabled
          </label>
          <label className={adminLabelClassName}>
            Provider
            <select
              name="provider"
              defaultValue={
                paymentMethodByMethod.get("bank_transfer")?.provider ?? "bank_transfer_manual"
              }
              className={adminInputClassName}
            >
              <option value="bank_transfer_manual">
                Manual (merchant confirms transfers by hand)
              </option>
              <option value="bank_transfer_sepay_va">
                SePay virtual account (automatic confirmation)
              </option>
            </select>
          </label>
          <label className={adminLabelClassName}>
            Bank name (manual)
            <input
              name="bankName"
              defaultValue={
                (
                  paymentMethodByMethod.get("bank_transfer")?.config as {
                    bankName?: string;
                  } | null
                )?.bankName ?? ""
              }
              placeholder="Vietcombank"
              className={adminInputClassName}
            />
          </label>
          <label className={adminLabelClassName}>
            Account number (manual)
            <input
              name="bankAccountNumber"
              defaultValue={
                (
                  paymentMethodByMethod.get("bank_transfer")?.config as {
                    accountNumber?: string;
                  } | null
                )?.accountNumber ?? ""
              }
              placeholder="0123456789"
              className={adminInputClassName}
            />
          </label>
          <label className={adminLabelClassName}>
            Account holder (manual)
            <input
              name="bankAccountHolder"
              defaultValue={
                (
                  paymentMethodByMethod.get("bank_transfer")?.config as {
                    accountHolder?: string;
                  } | null
                )?.accountHolder ?? ""
              }
              placeholder="NGUYEN VAN A"
              className={adminInputClassName}
            />
          </label>
          <label className={adminLabelClassName}>
            SePay bank account UUID (SePay VA)
            <input
              name="sepayBaUuid"
              defaultValue={
                (
                  paymentMethodByMethod.get("bank_transfer")?.config as {
                    baUuid?: string;
                  } | null
                )?.baUuid ?? ""
              }
              placeholder="From your SePay dashboard, after registering your bank account"
              className={adminInputClassName}
            />
          </label>
        </ActionForm>
      </section>

      {/* MoMo — platform-level credentials (env vars), no per-tenant
        config to enter; enabling it here just opts this tenant into
        the shared platform MoMo integration once it's configured. */}
      <section aria-labelledby="pm-momo" className={adminPanelClassName}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <div className="flex flex-col gap-0.5">
            <h3 id="pm-momo" className={adminPanelTitleClassName}>
              MoMo
            </h3>
            <p className="text-xs text-muted-foreground">
              Uses this platform&apos;s shared MoMo credentials — there is nothing to enter here.
            </p>
          </div>
          <StatusBadge
            status={paymentMethodByMethod.get("momo")?.enabled ? "Enabled" : "Disabled"}
            tone={paymentMethodByMethod.get("momo")?.enabled ? "success" : "neutral"}
          />
        </div>
        <ActionForm action={updateTenantPaymentMethodAction} submitLabel="Save" successMessage="MoMo settings saved.">
          <input type="hidden" name="method" value="momo" />
          <input type="hidden" name="provider" value="momo" />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={paymentMethodByMethod.get("momo")?.enabled ?? false}
            />
            Enabled
          </label>
        </ActionForm>
      </section>
    </div>
  );
}
