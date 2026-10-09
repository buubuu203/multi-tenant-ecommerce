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
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function BankTransferPage() {
  const { tenantId } = await requireTenantAdmin();
  const db = getScopedDb(tenantId);
  const branding = await db.branding.findUnique({ where: { tenantId } });

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title="Bank transfer instructions"
        description="A copy of your bank details stored alongside your branding."
      />

      {/* The previous description claimed these fields are what a customer
          sees at checkout. They are not: the manual bank-transfer provider
          builds its instructions (and the VietQR code) from the config
          saved under Payments → Bank transfer, and nothing reads the
          branding copy written here. Saying so is a copy fix — the stores,
          the actions and the checkout behaviour are all left exactly as
          they are. */}
      <p
        role="note"
        className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
      >
        <strong className="font-semibold">Checkout does not read these fields.</strong> The bank
        details a customer sees, and the QR code generated for them, come from the manual bank
        transfer fields under{' '}
        <Link href="/tenant-admin/payments" className="underline">
          Payments
        </Link>
        . Set them there as well, or instead.
      </p>
      {/* One settings section rather than a page-sized card, so this
          route reads as part of the same Checkout group as Payments. */}
      <section aria-labelledby="bank-details" className={adminPanelClassName}>
        <h3 id="bank-details" className={adminPanelTitleClassName}>
          Stored account details
        </h3>
        <ActionForm
          action={updateBankTransferDetailsAction}
          submitLabel="Save bank details"
          successMessage="Bank transfer details saved."
          className="max-w-md"
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
