import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { getScopedDb } from "@/lib/db/tenant-db";
import { ActionForm } from "@/components/ActionForm";
import { updateBankTransferDetailsAction } from "../actions";
import { adminInputClassName, adminLabelClassName, adminSectionClassName } from "../styles";

export const dynamic = "force-dynamic";

export default async function BankTransferPage() {
  const { tenantId } = await requireTenantAdmin();
  const db = getScopedDb(tenantId);
  const branding = await db.branding.findUnique({ where: { tenantId } });

  return (
    <section className={adminSectionClassName}>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium tracking-tight">Bank transfer instructions</h2>
        <p className="text-xs text-muted-foreground">
          These details are shown to customers who choose manual bank transfer.
        </p>
      </div>
      <ActionForm
        action={updateBankTransferDetailsAction}
        submitLabel="Save bank details"
        successMessage="Bank transfer details saved."
        className="flex max-w-md flex-col gap-3"
      >
        <label className={adminLabelClassName}>
          Bank name
          <input
            name="bankName"
            defaultValue={branding?.bankName ?? ""}
            placeholder="Vietcombank"
            className={adminInputClassName}
          />
        </label>
        <label className={adminLabelClassName}>
          Account number
          <input
            name="bankAccountNumber"
            defaultValue={branding?.bankAccountNumber ?? ""}
            placeholder="0123456789"
            className={adminInputClassName}
          />
        </label>
        <label className={adminLabelClassName}>
          Account holder name
          <input
            name="bankAccountHolder"
            defaultValue={branding?.bankAccountHolder ?? ""}
            placeholder="NGUYEN VAN A"
            className={adminInputClassName}
          />
        </label>
      </ActionForm>
    </section>
  );
}
