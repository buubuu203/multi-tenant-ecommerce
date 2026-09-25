import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { getScopedDb } from "@/lib/db/tenant-db";
import { ActionForm } from "@/components/ActionForm";
import { updateBrandingAction } from "../actions";
import { BrandingUploadControls } from "../BrandingUploadControls";
import { adminInputClassName, adminLabelClassName, adminSectionClassName } from "../styles";

export const dynamic = "force-dynamic";

export default async function BrandingPage() {
  const { tenantId } = await requireTenantAdmin();
  const db = getScopedDb(tenantId);
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  const branding = await db.branding.findUnique({ where: { tenantId } });

  return (
    <section className={adminSectionClassName}>
      <h2 className="text-lg font-medium tracking-tight">Branding</h2>
      <ActionForm
        action={updateBrandingAction}
        submitLabel="Save branding"
        successMessage="Branding saved."
        className="flex max-w-md flex-col gap-3"
      >
        <label className={adminLabelClassName}>
          Store name
          <input
            name="storeName"
            defaultValue={branding?.storeName ?? ""}
            placeholder={tenant?.name}
            className={adminInputClassName}
          />
        </label>
        <BrandingUploadControls
          initialLogoUrl={branding?.logoUrl ?? ""}
          initialFaviconUrl={branding?.faviconUrl ?? ""}
          hasTokens={Boolean(branding?.designTokens)}
        />
      </ActionForm>
    </section>
  );
}
