import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { listVouchers } from "@/lib/voucher-mutations";
import { getScopedDb } from "@/lib/db/tenant-db";
import { AdminPageHeader } from "../AdminPageHeader";
import {
  adminPageClassName,
  adminPanelClassName,
  adminPanelFlushClassName,
  adminDividedListClassName,
  adminEyebrowClassName,
} from "../styles";
import { VoucherForm, VoucherRow } from "./VoucherClient";

export const dynamic = "force-dynamic";

export default async function VouchersPage() {
  const { tenantId } = await requireTenantAdmin();
  const [vouchers, products] = await Promise.all([
    listVouchers(tenantId),
    getScopedDb(tenantId).product.findMany({
      where: { tenantId, status: "active" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const productOptions = products.map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title="Promotions"
        description="Coupon codes and automatic promotions for your store."
        meta={
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
            {vouchers.length}
          </span>
        }
      />

      <div className={adminPanelClassName}>
        <p className={adminEyebrowClassName}>Create promotion</p>
        <VoucherForm products={productOptions} />
      </div>

      {vouchers.length > 0 && (
        <div className={adminPanelFlushClassName}>
          <div className={adminDividedListClassName}>
            {vouchers.map((v) => (
              <VoucherRow key={v.id} voucher={v} products={productOptions} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
