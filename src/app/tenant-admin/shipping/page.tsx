import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import { getScopedDb } from '@/lib/db/tenant-db';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmActionForm } from '@/components/ConfirmActionForm';
import {
  createShippingMethodAction,
  updateShippingMethodAction,
  deleteShippingMethodAction,
} from '../actions';
import {
  adminPageClassName,
  adminPanelClassName,
  adminPanelTitleClassName,
  adminInputClassName,
  adminLabelClassName,
  adminRequiredClassName,
} from '../styles';
import { AdminPageHeader } from '../AdminPageHeader';
import { StatusBadge } from '../StatusBadge';

export const dynamic = 'force-dynamic';

export default async function ShippingPage() {
  const { tenantId } = await requireTenantAdmin();
  const db = getScopedDb(tenantId);
  // V1 Configurable Shipping — a tenant-authored list, ordered for display
  // (see TenantShippingMethod's doc comment for why this is a list rather
  // than one row per fixed method like TenantPaymentMethod).
  const shippingMethods = await db.tenantShippingMethod.findMany({
    where: { tenantId },
    orderBy: { sortOrder: 'asc' },
  });

  // Checkout requires at least one ENABLED method, so "no methods" was
  // never the only blocked state — a store with three methods all switched
  // off is equally unable to take an order, and previously said nothing at
  // all. Derived from the rows already fetched; no behaviour changes here,
  // the blocked state simply becomes visible.
  const enabledCount = shippingMethods.filter((method) => method.enabled).length;
  const blockedReason =
    shippingMethods.length === 0
      ? 'Checkout is blocked because no shipping method is configured.'
      : enabledCount === 0
        ? 'Checkout is blocked because all shipping methods are disabled.'
        : null;

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title="Shipping"
        description="Only enabled methods appear at checkout. If none is enabled, checkout is blocked entirely."
      />

      {blockedReason && (
        // role="alert": this is not decorative copy, it is the store
        // telling the merchant it cannot take orders right now.
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          <strong className="font-semibold">{blockedReason}</strong>{' '}
          {shippingMethods.length === 0
            ? 'Add a method below and enable it.'
            : 'Enable at least one method below.'}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {shippingMethods.map((method) => (
          <section key={method.id} className={adminPanelClassName}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
              <h3 className={adminPanelTitleClassName}>{method.name}</h3>
              <span className="flex flex-wrap items-center gap-1.5">
                {/* Shared badges rather than prose, so a method's state is
                    scannable and reads the same as every other status in
                    the admin. Text labels, never colour alone. */}
                <StatusBadge
                  status={method.enabled ? 'Enabled' : 'Disabled'}
                  tone={method.enabled ? 'success' : 'neutral'}
                />
                {/* Both states stay visible when a method is default but
                    disabled — hiding either would misrepresent the row —
                    but Default drops to neutral so it stops competing with
                    the state that actually decides checkout. */}
                {method.isDefault && (
                  <StatusBadge status="Default" tone={method.enabled ? 'info' : 'neutral'} />
                )}
              </span>
            </div>
            {method.isDefault && !method.enabled && (
              <p className="text-xs text-amber-700 dark:text-amber-500">
                This is the default method but it is disabled, so checkout will not offer it.
              </p>
            )}
            <ActionForm
              action={updateShippingMethodAction}
              submitLabel="Save"
              // One of these per method, so the visible word is enough in
              // place but useless in a list of buttons. The accessible name
              // carries the method's own name.
              submitAriaLabel={`Save shipping method ${method.name}`}
              successMessage="Shipping method saved."
            >
              <input type="hidden" name="methodId" value={method.id} />
              <label className={adminLabelClassName}>
                Name
                <input name="name" defaultValue={method.name} className={adminInputClassName} />
              </label>
              <label className={adminLabelClassName}>
                <span className="flex flex-wrap items-baseline gap-1.5">
                  Amount
                  <span className={adminRequiredClassName}>in VND — enter 0 for free shipping</span>
                </span>
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
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  name="isDefault"
                  defaultChecked={method.isDefault}
                  className="mt-0.5"
                />
                <span className="flex flex-col gap-0.5">
                  Default method
                  {/* The one-default rule stated where it applies, rather
                      than only in the page description: setting this
                      unsets whichever method currently holds it. */}
                  <span className="text-muted-foreground">
                    Pre-selected at checkout. Only one method can be the default — choosing this one
                    removes it from the current default.
                  </span>
                </span>
              </label>
            </ActionForm>
            {/* Delete is separated by a rule and sits alone, so it is never
                adjacent to Save in the scan path. */}
            <div className="border-t border-border pt-3">
              <ConfirmActionForm
                action={deleteShippingMethodAction}
                submitLabel="Delete"
                successMessage="Shipping method deleted."
                confirmMessage={`Delete “${method.name}”? Customers will no longer be able to choose it at checkout. Orders already placed with it keep their own snapshot and are unaffected.`}
                variant="danger"
              >
                <input type="hidden" name="methodId" value={method.id} />
              </ConfirmActionForm>
            </div>
          </section>
        ))}
      </div>

      <section aria-labelledby="add-shipping" className={adminPanelClassName}>
        <h3 id="add-shipping" className={adminPanelTitleClassName}>
          Add a shipping method
        </h3>
        <ActionForm
          action={createShippingMethodAction}
          submitLabel="Add shipping method"
          successMessage="Shipping method added."
          className="max-w-md"
        >
          <label className={adminLabelClassName}>
            Name
            <input name="name" placeholder="Standard" className={adminInputClassName} />
          </label>
          <label className={adminLabelClassName}>
            <span className="flex flex-wrap items-baseline gap-1.5">
              Amount
              <span className={adminRequiredClassName}>in VND — enter 0 for free shipping</span>
            </span>
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
    </div>
  );
}
