import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import { getScopedDb } from '@/lib/db/tenant-db';
import { ActionForm } from '@/components/ActionForm';
import { updateBankTransferDetailsAction } from '../actions';
import {
  adminInputClassName,
  adminLabelClassName,
  adminPageClassName,
  adminPanelClassName,
  adminPanelTitleClassName,
} from '../styles';
import { AdminPageHeader } from '../AdminPageHeader';

export const dynamic = 'force-dynamic';

export default async function BankTransferPage() {
  const { tenantId } = await requireTenantAdmin();
  const db = getScopedDb(tenantId);
  const branding = await db.branding.findUnique({ where: { tenantId } });

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title="Bank transfer instructions"
        description="These details are shown to customers who choose manual bank transfer."
      />
      {/* One settings section rather than a page-sized card, so this
          route reads as part of the same Checkout group as Payments. */}
      <section aria-labelledby="bank-details" className={adminPanelClassName}>
        <h3 id="bank-details" className={adminPanelTitleClassName}>
          Account details shown at checkout
        </h3>
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
              defaultValue={branding?.bankName ?? ''}
              placeholder="Vietcombank"
              className={adminInputClassName}
            />
          </label>
          <label className={adminLabelClassName}>
            Account number
            <input
              name="bankAccountNumber"
              defaultValue={branding?.bankAccountNumber ?? ''}
              placeholder="0123456789"
              className={adminInputClassName}
            />
          </label>
          <label className={adminLabelClassName}>
            Account holder name
            <input
              name="bankAccountHolder"
              defaultValue={branding?.bankAccountHolder ?? ''}
              placeholder="NGUYEN VAN A"
              className={adminInputClassName}
            />
          </label>
        </ActionForm>
      </section>
    </div>
  );
}
