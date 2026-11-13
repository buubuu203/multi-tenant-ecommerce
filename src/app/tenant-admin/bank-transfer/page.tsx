import Link from 'next/link';
import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import { getScopedDb } from '@/lib/db/tenant-db';
import { isProviderConfigured } from '@/lib/payments/payment-service';
import {
  adminButtonPrimaryClassName,
  adminPageClassName,
  adminPanelClassName,
  adminPanelTitleClassName,
} from '../styles';
import { AdminPageHeader } from '../AdminPageHeader';
import { StatusBadge } from '../StatusBadge';

export const dynamic = 'force-dynamic';

/**
 * This route used to be a second, competing bank-details form.
 *
 * It wrote Branding.bankName / bankAccountNumber / bankAccountHolder, and
 * nothing read them. What a customer actually sees at checkout and on the
 * order-lookup page comes from the manual bank-transfer PROVIDER, which
 * builds its instructions and its VietQR code from
 * TenantPaymentMethod.config (see manual-bank-transfer-provider.ts and
 * getPaymentInstructions in payment-service.ts). A merchant could fill this
 * page in completely and still have an unconfigured store.
 *
 * The form is therefore gone rather than rewired. Rewiring it would have
 * meant writing bank fields into a config object that the existing mutation
 * replaces wholesale per provider — so saving here while the tenant is on
 * SePay would have silently destroyed their baUuid — and it would have left
 * two editors for one record. Payments is the single place that owns this
 * configuration; this route now points at it and reports the live state.
 *
 * Nothing about checkout, the provider, the stored config or the Branding
 * columns is changed by this commit. The stale Branding values are simply
 * no longer presented as settings.
 */
export default async function BankTransferPage() {
  const { tenantId } = await requireTenantAdmin();
  const db = getScopedDb(tenantId);
  const bank = await db.tenantPaymentMethod.findUnique({
    where: { tenantId_method: { tenantId, method: 'bank_transfer' } },
  });

  const configured = bank
    ? isProviderConfigured(bank.provider, bank.config as Record<string, unknown> | null)
    : false;
  const isSepay = bank?.provider === 'bank_transfer_sepay_va';

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title="Bank transfer instructions"
        description="What a customer sees when they pay by bank transfer. These details are configured under Payments."
      />

      <section aria-labelledby="bank-where" className={adminPanelClassName}>
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-3">
          <h3 id="bank-where" className={adminPanelTitleClassName}>
            Current bank transfer setup
          </h3>
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge
              status={bank?.enabled ? 'Enabled' : 'Disabled'}
              tone={bank?.enabled ? 'success' : 'neutral'}
            />
            <StatusBadge
              status={configured ? 'Ready' : 'Needs setup'}
              tone={configured ? 'success' : 'warning'}
            />
            <StatusBadge status={isSepay ? 'SePay' : 'Manual'} tone="info" />
          </span>
        </div>

        <p className="text-sm text-muted-foreground">
          {isSepay
            ? 'This store uses SePay virtual accounts. SePay generates the account details for each order, and confirms payment automatically by webhook.'
            : 'This store uses manual bank transfer. The bank name, account number and account holder you set under Payments are the ones shown to the customer, and the ones used to build the VietQR code on the order.'}
        </p>

        <p className="text-sm text-muted-foreground">
          This page is read-only. Editing happens in one place so the two can never disagree.
        </p>

        <div>
          <Link href="/tenant-admin/payments" className={adminButtonPrimaryClassName}>
            Edit bank transfer under Payments
          </Link>
        </div>
      </section>
    </div>
  );
}
