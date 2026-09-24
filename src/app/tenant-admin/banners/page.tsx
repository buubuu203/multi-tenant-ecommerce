import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { listBanners } from "@/lib/banner-mutations";
import { ActionForm } from "@/components/ActionForm";
import {
  createBannerAction,
  updateBannerAction,
  deleteBannerAction,
  uploadBannerImageAction,
  uploadBannerMobileImageAction,
} from "../actions";
import { BannerImageUpload } from "../BannerImageUpload";
import { adminInputClassName, adminLabelClassName, adminSectionClassName, adminCardClassName } from "../styles";

export const dynamic = "force-dynamic";

// Matches BannerCarousel.tsx's rendered aspect ratios exactly, so what an
// admin crops is exactly what a customer sees — never a mismatched ratio
// that gets silently re-cropped again by the storefront's object-cover.
const DESKTOP_ASPECT_RATIO = 21 / 9;
const MOBILE_ASPECT_RATIO = 4 / 3;
const DESKTOP_OUTPUT_WIDTH = 1400;
const MOBILE_OUTPUT_WIDTH = 900;

export default async function BannersPage() {
  const { tenantId } = await requireTenantAdmin();
  const banners = await listBanners(tenantId);

  return (
    <section className={adminSectionClassName}>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium tracking-tight">Storefront banners</h2>
        <p className="text-xs text-muted-foreground">
          Shown as a carousel at the top of your storefront, in place of the default welcome
          banner. Only enabled banners appear, ordered by sort order (lowest first). The image
          is the whole banner — no text is overlaid, so use a photo that speaks for itself.
        </p>
      </div>

      <details className="group rounded-lg border border-border bg-surface-muted">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium marker:content-none">
          <span className="inline-flex items-center gap-1.5">
            <span className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
            Add banner
          </span>
        </summary>
        <ActionForm
          action={createBannerAction}
          submitLabel="Add banner"
          successMessage="Banner created."
          className="flex max-w-md flex-col gap-4 px-4 pb-4"
        >
          <BannerImageUpload
            fieldName="imageUrl"
            action={uploadBannerImageAction}
            aspectRatio={DESKTOP_ASPECT_RATIO}
            outputWidth={DESKTOP_OUTPUT_WIDTH}
            label="Desktop image"
            helpText="JPG, PNG, or WebP — max 8MB. Crops to 21:9. Shown on tablet and larger."
            required
          />
          <BannerImageUpload
            fieldName="mobileImageUrl"
            action={uploadBannerMobileImageAction}
            aspectRatio={MOBILE_ASPECT_RATIO}
            outputWidth={MOBILE_OUTPUT_WIDTH}
            label="Mobile image (optional)"
            helpText="A separate crop for small screens (4:3). Falls back to the desktop image if not set."
            removable
          />
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
          <div className="flex items-end gap-4">
            <label className={`${adminLabelClassName} w-28`}>
              Sort order
              <input name="sortOrder" inputMode="numeric" defaultValue="0" className={adminInputClassName} />
            </label>
            <label className="flex items-center gap-2 pb-2 text-xs">
              <input type="checkbox" name="enabled" defaultChecked />
              Enabled
            </label>
          </div>
        </ActionForm>
      </details>

      <div className="flex flex-col gap-3">
        {banners.map((banner) => (
          <details key={banner.id} className={`group ${adminCardClassName}`}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 marker:content-none">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <span className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
                {/* eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra, see ProductList.tsx */}
                <img src={banner.imageUrl} alt="" className="h-8 w-14 rounded object-cover" />
                Banner
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {banner.enabled ? "Enabled" : "Disabled"} · Sort {banner.sortOrder}
              </span>
            </summary>

            <div className="mt-4 flex flex-col gap-4">
              <ActionForm
                action={updateBannerAction}
                submitLabel="Save"
                successMessage="Banner saved."
                className="flex flex-col gap-4"
              >
                <input type="hidden" name="bannerId" value={banner.id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <BannerImageUpload
                    fieldName="imageUrl"
                    action={uploadBannerImageAction}
                    aspectRatio={DESKTOP_ASPECT_RATIO}
                    outputWidth={DESKTOP_OUTPUT_WIDTH}
                    initialUrl={banner.imageUrl}
                    label="Desktop image"
                    helpText="JPG, PNG, or WebP — max 8MB. Crops to 21:9. Shown on tablet and larger."
                    required
                  />
                  <BannerImageUpload
                    fieldName="mobileImageUrl"
                    action={uploadBannerMobileImageAction}
                    aspectRatio={MOBILE_ASPECT_RATIO}
                    outputWidth={MOBILE_OUTPUT_WIDTH}
                    initialUrl={banner.mobileImageUrl ?? undefined}
                    label="Mobile image (optional)"
                    helpText="A separate crop for small screens (4:3). Falls back to the desktop image if not set."
                    removable
                  />
                </div>
                <label className={adminLabelClassName}>
                  CTA label (optional)
                  <input name="ctaLabel" defaultValue={banner.ctaLabel ?? ""} className={adminInputClassName} />
                </label>
                <label className={adminLabelClassName}>
                  CTA URL (optional)
                  <input name="ctaUrl" defaultValue={banner.ctaUrl ?? ""} className={adminInputClassName} />
                </label>
                <div className="flex items-end gap-4">
                  <label className={`${adminLabelClassName} w-28`}>
                    Sort order
                    <input
                      name="sortOrder"
                      inputMode="numeric"
                      defaultValue={String(banner.sortOrder)}
                      className={adminInputClassName}
                    />
                  </label>
                  <label className="flex items-center gap-2 pb-2 text-xs">
                    <input type="checkbox" name="enabled" defaultChecked={banner.enabled} />
                    Enabled
                  </label>
                </div>
              </ActionForm>
              <ActionForm
                action={deleteBannerAction}
                submitLabel="Delete banner"
                successMessage="Banner deleted."
                className="border-t border-border pt-3"
              >
                <input type="hidden" name="bannerId" value={banner.id} />
              </ActionForm>
            </div>
          </details>
        ))}
        {banners.length === 0 && (
          <p className="text-sm text-muted-foreground">No banners yet — the default welcome banner is shown.</p>
        )}
      </div>
    </section>
  );
}
