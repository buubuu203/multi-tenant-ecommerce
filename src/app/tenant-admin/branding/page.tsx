import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import { getScopedDb } from '@/lib/db/tenant-db';
import { ActionForm } from '@/components/ActionForm';
import { updateBrandingAction } from '../actions';
import { BrandingUploadControls } from '../BrandingUploadControls';
import {
  adminInputClassName,
  adminLabelClassName,
  adminPageClassName,
  adminPanelClassName,
  adminPanelTitleClassName,
} from '../styles';
import { AdminPageHeader } from '../AdminPageHeader';

export const dynamic = 'force-dynamic';

export default async function BrandingPage() {
  const { tenantId } = await requireTenantAdmin();
  const db = getScopedDb(tenantId);
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  const branding = await db.branding.findUnique({ where: { tenantId } });

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title="Branding"
        description="Your store name, logo and colours, used across the storefront."
      />
      <ActionForm
        action={updateBrandingAction}
        submitLabel="Save branding"
        successMessage="Branding saved."
        className="flex max-w-xl flex-col gap-4"
      >
        {/* Identity first, assets after: the store name is what every
            other setting on this page decorates. */}
        <section aria-labelledby="brand-identity" className={adminPanelClassName}>
          <h3 id="brand-identity" className={adminPanelTitleClassName}>
            Store identity
          </h3>
          <label className={adminLabelClassName}>
            Store name
            <input
              name="storeName"
              defaultValue={branding?.storeName ?? ''}
              placeholder={tenant?.name}
              className={adminInputClassName}
            />
          </label>
        </section>
        <section aria-labelledby="brand-assets" className={adminPanelClassName}>
          <h3 id="brand-assets" className={adminPanelTitleClassName}>
            Logo, favicon and design tokens
          </h3>
          <BrandingUploadControls
            initialLogoUrl={branding?.logoUrl ?? ''}
            initialFaviconUrl={branding?.faviconUrl ?? ''}
            hasTokens={Boolean(branding?.designTokens)}
          />
        </section>
      </ActionForm>
    </div>
  );
}
