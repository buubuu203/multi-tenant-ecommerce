import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import { listBanners } from '@/lib/banner-mutations';
import { ActionForm } from '@/components/ActionForm';
import {
  createBannerAction,
  updateBannerAction,
  deleteBannerAction,
} from '../actions';
import { ConfirmActionForm } from '@/components/ConfirmActionForm';
import { BannerImageUpload } from '../BannerImageUpload';
import {
  adminInputClassName,
  adminLabelClassName,
  adminPageClassName,
  adminPanelClassName,
  adminPanelFlushClassName,
  adminPanelTitleClassName,
  adminSubtleClassName,
} from '../styles';
import { StatusBadge } from '../StatusBadge';
import { AdminPageHeader } from '../AdminPageHeader';
import { getDictionary, getLocale } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

// Matches BannerCarousel.tsx's desktop (≥1024px) rendered aspect ratio
// exactly — ImageCropModal renders to a canvas at exactly this ratio
// (canvas.height = outputWidth / aspectRatio), so the uploaded output can
// never deviate from 21:9 by construction. That's why there's no
// separate ">10% off 21:9" warning check anywhere in this flow: the crop
// step makes that case unreachable, which is a stronger guarantee than a
// warning would be. (The storefront's <768px frame is a different ratio,
// 16:10, but still fills via object-cover regardless of the source
// image's exact ratio — no mismatch results from keeping one upload
// ratio for both slots.)
const BANNER_ASPECT_RATIO = 21 / 9;
const DESKTOP_OUTPUT_WIDTH = 2520;
const MOBILE_OUTPUT_WIDTH = 1260;

export default async function BannersPage() {
  const { tenantId } = await requireTenantAdmin();
  const [banners, locale] = await Promise.all([listBanners(tenantId), getLocale()]);
  const dict = await getDictionary(locale);

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title="Storefront banners"
        description="Shown as a carousel at the top of your storefront, in place of the default welcome banner. Only enabled banners appear, ordered by sort order (lowest first). The image is the whole banner — no text is overlaid, so use a photo that speaks for itself."
      />
      <p className="text-sm text-muted-foreground">{dict.admin.bannerExistingImageNote}</p>

      {/* The one creating action on the page, kept collapsed so the
          banners a merchant already has stay the first thing read. */}
      <details className={`group ${adminPanelFlushClassName}`}>
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium marker:content-none">
          <span className="inline-flex items-center gap-1.5">
            <span className="text-muted-foreground transition-transform group-open:rotate-90">
              ›
            </span>
            Add a banner
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
            variant="desktop"
            aspectRatio={BANNER_ASPECT_RATIO}
            outputWidth={DESKTOP_OUTPUT_WIDTH}
            label="Desktop image"
            helpText={dict.admin.bannerDesktopHelp}
            required
          />
          <BannerImageUpload
            fieldName="mobileImageUrl"
            variant="mobile"
            aspectRatio={BANNER_ASPECT_RATIO}
            outputWidth={MOBILE_OUTPUT_WIDTH}
            label="Mobile image (optional)"
            helpText={dict.admin.bannerMobileHelp}
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
              <input
                name="sortOrder"
                inputMode="numeric"
                defaultValue="0"
                className={adminInputClassName}
              />
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
          <details key={banner.id} className={`group ${adminPanelClassName}`}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 marker:content-none">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <span className="text-muted-foreground transition-transform group-open:rotate-90">
                  ›
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra, see ProductList.tsx */}
                <img src={banner.imageUrl} alt="" className="h-8 w-14 rounded object-cover" />
                <span className={adminPanelTitleClassName}>Banner</span>
              </span>
              <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                {/* Badge, not grey prose: whether a banner is live is the
                    one thing a merchant scans this list for. */}
                <StatusBadge
                  status={banner.enabled ? 'Enabled' : 'Disabled'}
                  tone={banner.enabled ? 'success' : 'neutral'}
                />
                <span className="text-xs text-muted-foreground">Sort {banner.sortOrder}</span>
              </span>
            </summary>

            <div className="mt-4 flex flex-col gap-4">
              <ActionForm
                action={updateBannerAction}
                submitLabel="Save"
                // Banners have no name, so the accessible name uses the sort
                // order already shown in this row's summary.
                submitAriaLabel={`Save banner with sort order ${banner.sortOrder}`}
                successMessage="Banner saved."
                className="flex flex-col gap-4"
              >
                <input type="hidden" name="bannerId" value={banner.id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <BannerImageUpload
                    fieldName="imageUrl"
                    variant="desktop"
                    aspectRatio={BANNER_ASPECT_RATIO}
                    outputWidth={DESKTOP_OUTPUT_WIDTH}
                    initialUrl={banner.imageUrl}
                    label="Desktop image"
                    helpText={dict.admin.bannerDesktopHelp}
                    required
                  />
                  <BannerImageUpload
                    fieldName="mobileImageUrl"
                    variant="mobile"
                    aspectRatio={BANNER_ASPECT_RATIO}
                    outputWidth={MOBILE_OUTPUT_WIDTH}
                    initialUrl={banner.mobileImageUrl ?? undefined}
                    label="Mobile image (optional)"
                    helpText={dict.admin.bannerMobileHelp}
                    removable
                  />
                </div>
                <label className={adminLabelClassName}>
                  CTA label (optional)
                  <input
                    name="ctaLabel"
                    defaultValue={banner.ctaLabel ?? ''}
                    className={adminInputClassName}
                  />
                </label>
                <label className={adminLabelClassName}>
                  CTA URL (optional)
                  <input
                    name="ctaUrl"
                    defaultValue={banner.ctaUrl ?? ''}
                    className={adminInputClassName}
                  />
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
              <ConfirmActionForm
                action={deleteBannerAction}
                submitLabel="Delete banner"
                successMessage="Banner deleted."
                confirmMessage="Delete this banner? Its images are removed from storage and this cannot be undone."
                variant="danger"
                className="border-t border-border pt-3"
              >
                <input type="hidden" name="bannerId" value={banner.id} />
              </ConfirmActionForm>
            </div>
          </details>
        ))}
        {banners.length === 0 && (
          // An empty state that says what is on the storefront now and
          // what to do next, rather than only noting the absence.
          <div className={adminSubtleClassName}>
            <p className={adminPanelTitleClassName}>No banners yet</p>
            <p className="text-xs text-muted-foreground">
              Your storefront is showing the default welcome banner. Use “Add a banner” above to
              replace it with your own images.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
