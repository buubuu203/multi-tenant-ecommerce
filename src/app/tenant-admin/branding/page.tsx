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
        {/* Storefront footer (UI/UX revamp, Board 5): every field here is
            optional — the storefront footer shows each line only when
            it's filled in, never a placeholder, so leaving any of these
            blank is a normal, supported state, not a draft. */}
        <section aria-labelledby="brand-footer" className={adminPanelClassName}>
          <h3 id="brand-footer" className={adminPanelTitleClassName}>
            Footer contact info
          </h3>
          <label className={adminLabelClassName}>
            Address
            <input name="address" defaultValue={branding?.address ?? ''} className={adminInputClassName} />
          </label>
          <label className={adminLabelClassName}>
            Phone
            <input name="phone" defaultValue={branding?.phone ?? ''} className={adminInputClassName} />
          </label>
          <label className={adminLabelClassName}>
            Contact email
            <input
              name="contactEmail"
              type="email"
              defaultValue={branding?.contactEmail ?? ''}
              className={adminInputClassName}
            />
          </label>
          <label className={adminLabelClassName}>
            Business registration ID
            <input name="businessId" defaultValue={branding?.businessId ?? ''} className={adminInputClassName} />
          </label>
          <label className={adminLabelClassName}>
            Facebook URL
            <input name="facebookUrl" defaultValue={branding?.facebookUrl ?? ''} className={adminInputClassName} />
          </label>
          <label className={adminLabelClassName}>
            TikTok URL
            <input name="tiktokUrl" defaultValue={branding?.tiktokUrl ?? ''} className={adminInputClassName} />
          </label>
          <label className={adminLabelClassName}>
            Zalo URL
            <input name="zaloUrl" defaultValue={branding?.zaloUrl ?? ''} className={adminInputClassName} />
          </label>
        </section>
      </ActionForm>
    </div>
  );
}
