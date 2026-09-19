import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { getScopedDb } from "@/lib/db/tenant-db";
import { ActionForm } from "@/components/ActionForm";
import {
  createShippingMethodAction,
  updateShippingMethodAction,
  deleteShippingMethodAction,
} from "../actions";
import { adminInputClassName, adminLabelClassName, adminSectionClassName, adminCardClassName } from "../styles";

export const dynamic = "force-dynamic";

export default async function ShippingPage() {
  const { tenantId } = await requireTenantAdmin();
  const db = getScopedDb(tenantId);
  // V1 Configurable Shipping — a tenant-authored list, ordered for display
  // (see TenantShippingMethod's doc comment for why this is a list rather
  // than one row per fixed method like TenantPaymentMethod).
  const shippingMethods = await db.tenantShippingMethod.findMany({
    where: { tenantId },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <section className={adminSectionClassName}>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium tracking-tight">Shipping</h2>
        <p className="text-xs text-muted-foreground">
          Only enabled methods appear at checkout. If no method is enabled, checkout is blocked
          entirely — same rule as payment methods. At most one method can be the default
          (pre-selected at checkout).
        </p>
      </div>

      {shippingMethods.length === 0 && (
        <p className="text-xs text-red-600">
          No shipping methods yet — checkout is currently blocked for this store.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {shippingMethods.map((method) => (
          <div key={method.id} className={adminCardClassName}>
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{method.name}</h3>
              <span className="text-xs text-muted-foreground">
                {method.enabled ? "Enabled" : "Disabled"} {method.isDefault && "· Default"}
              </span>
            </div>
            <ActionForm action={updateShippingMethodAction} submitLabel="Save">
              <input type="hidden" name="methodId" value={method.id} />
              <label className={adminLabelClassName}>
                Name
                <input name="name" defaultValue={method.name} className={adminInputClassName} />
              </label>
              <label className={adminLabelClassName}>
                Amount (VND, 0 = free)
                <input
                  name="amount"
                  inputMode="numeric"
                  defaultValue={String(method.amount)}
                  className={adminInputClassName}
                />
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="enabled" defaultChecked={method.enabled} />
                Enabled
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="isDefault" defaultChecked={method.isDefault} />
                Default method
              </label>
            </ActionForm>
            <ActionForm action={deleteShippingMethodAction} submitLabel="Delete">
              <input type="hidden" name="methodId" value={method.id} />
            </ActionForm>
          </div>
        ))}
      </div>

      <ActionForm
        action={createShippingMethodAction}
        submitLabel="Add shipping method"
        className="flex max-w-md flex-col gap-3"
      >
        <label className={adminLabelClassName}>
          Name
          <input name="name" placeholder="Standard" className={adminInputClassName} />
        </label>
        <label className={adminLabelClassName}>
          Amount (VND, 0 = free)
          <input
            name="amount"
            inputMode="numeric"
            placeholder="20000"
            className={adminInputClassName}
          />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" name="enabled" />
          Enabled
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" name="isDefault" />
          Default method
        </label>
      </ActionForm>
    </section>
  );
}
