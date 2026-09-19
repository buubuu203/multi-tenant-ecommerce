import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { listBanners } from "@/lib/banner-mutations";
import { ActionForm } from "@/components/ActionForm";
import { createBannerAction, updateBannerAction, deleteBannerAction } from "../actions";
import { BannerImageUpload } from "../BannerImageUpload";
import { adminInputClassName, adminLabelClassName, adminSectionClassName, adminCardClassName } from "../styles";

export const dynamic = "force-dynamic";

export default async function BannersPage() {
  const { tenantId } = await requireTenantAdmin();
  const banners = await listBanners(tenantId);

  return (
    <section className={adminSectionClassName}>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium tracking-tight">Storefront banners</h2>
        <p className="text-xs text-muted-foreground">
          Shown as a carousel at the top of your storefront, in place of the default welcome
          banner. Only enabled banners appear, ordered by sort order (lowest first).
        </p>
      </div>

      <ActionForm
        action={createBannerAction}
        submitLabel="Add banner"
        className="flex max-w-md flex-col gap-3 rounded-lg border border-border bg-surface-muted p-4"
      >
        <BannerImageUpload />
        <label className={adminLabelClassName}>
          Title
          <input name="title" className={adminInputClassName} />
        </label>
        <label className={adminLabelClassName}>
          Subtitle (optional)
          <input name="subtitle" className={adminInputClassName} />
        </label>
        <label className={adminLabelClassName}>
          CTA label (optional)
          <input name="ctaLabel" placeholder="Shop now" className={adminInputClassName} />
        </label>
        <label className={adminLabelClassName}>
          CTA URL (optional)
          <input
            name="ctaUrl"
            placeholder="/products/abc123 or https://..."
            className={adminInputClassName}
          />
        </label>
        <label className={adminLabelClassName}>
          Sort order
          <input name="sortOrder" inputMode="numeric" defaultValue="0" className={adminInputClassName} />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" name="enabled" defaultChecked />
          Enabled
        </label>
      </ActionForm>

      <div className="flex flex-col gap-3">
        {banners.map((banner) => (
          <div key={banner.id} className={adminCardClassName}>
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{banner.title}</h3>
              <span className="text-xs text-muted-foreground">
                {banner.enabled ? "Enabled" : "Disabled"} · Sort {banner.sortOrder}
              </span>
            </div>
            <ActionForm action={updateBannerAction} submitLabel="Save" className="flex flex-col gap-3">
              <input type="hidden" name="bannerId" value={banner.id} />
              <BannerImageUpload initialUrl={banner.imageUrl} />
              <label className={adminLabelClassName}>
                Title
                <input name="title" defaultValue={banner.title} className={adminInputClassName} />
              </label>
              <label className={adminLabelClassName}>
                Subtitle (optional)
                <input name="subtitle" defaultValue={banner.subtitle ?? ""} className={adminInputClassName} />
              </label>
              <label className={adminLabelClassName}>
                CTA label (optional)
                <input name="ctaLabel" defaultValue={banner.ctaLabel ?? ""} className={adminInputClassName} />
              </label>
              <label className={adminLabelClassName}>
                CTA URL (optional)
                <input name="ctaUrl" defaultValue={banner.ctaUrl ?? ""} className={adminInputClassName} />
              </label>
              <label className={adminLabelClassName}>
                Sort order
                <input
                  name="sortOrder"
                  inputMode="numeric"
                  defaultValue={String(banner.sortOrder)}
                  className={adminInputClassName}
                />
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="enabled" defaultChecked={banner.enabled} />
                Enabled
              </label>
            </ActionForm>
            <ActionForm action={deleteBannerAction} submitLabel="Delete banner">
              <input type="hidden" name="bannerId" value={banner.id} />
            </ActionForm>
          </div>
        ))}
        {banners.length === 0 && (
          <p className="text-sm text-muted-foreground">No banners yet — the default welcome banner is shown.</p>
        )}
      </div>
    </section>
  );
}
