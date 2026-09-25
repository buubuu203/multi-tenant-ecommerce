import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { getScopedDb } from "@/lib/db/tenant-db";
import { ActionForm } from "@/components/ActionForm";
import { updateTenantPaymentMethodAction } from "../actions";
import { adminInputClassName, adminLabelClassName, adminSectionClassName, adminCardClassName } from "../styles";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const { tenantId } = await requireTenantAdmin();
  const db = getScopedDb(tenantId);
  // Step 51: one row per PaymentMethod at most, keyed by method — see
  // TenantPaymentMethod.@@unique([tenantId, method]).
  const tenantPaymentMethods = await db.tenantPaymentMethod.findMany({ where: { tenantId } });
  const paymentMethodByMethod = new Map(tenantPaymentMethods.map((row) => [row.method, row]));

  return (
    <section className={adminSectionClassName}>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium tracking-tight">Payments</h2>
        <p className="text-xs text-muted-foreground">
          Only enabled AND fully configured methods appear at checkout — a customer can never
          select a method you haven&apos;t set up here, even if this toggle is on but the required
          fields below are empty.
        </p>
      </div>

      {/* Cash on delivery — no configuration, just enable/disable. */}
      <div className={adminCardClassName}>
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Cash on delivery</h3>
          <span className="text-xs text-muted-foreground">
            {paymentMethodByMethod.get("cod")?.enabled ? "Enabled" : "Disabled"}
          </span>
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
      </div>

      {/* Bank transfer — two possible providers behind the same
        customer-facing method; manual requires bank details, SePay VA
        requires a registered bank-account UUID (set up with SePay
        directly — that account linking happens outside this app). */}
      <div className={adminCardClassName}>
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Bank transfer</h3>
          <span className="text-xs text-muted-foreground">
            {paymentMethodByMethod.get("bank_transfer")?.enabled ? "Enabled" : "Disabled"} ·{" "}
            {paymentMethodByMethod.get("bank_transfer")?.provider === "bank_transfer_sepay_va"
              ? "SePay virtual account"
              : "Manual"}
          </span>
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
      </div>

      {/* MoMo — platform-level credentials (env vars), no per-tenant
        config to enter; enabling it here just opts this tenant into
        the shared platform MoMo integration once it's configured. */}
      <div className={adminCardClassName}>
        <div className="flex items-center justify-between">
          <h3 className="font-medium">MoMo</h3>
          <span className="text-xs text-muted-foreground">
            {paymentMethodByMethod.get("momo")?.enabled ? "Enabled" : "Disabled"}
          </span>
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
      </div>
    </section>
  );
}
