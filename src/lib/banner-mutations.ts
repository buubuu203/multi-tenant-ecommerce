import { getScopedDb } from "./db/tenant-db";
import type { ActionResult } from "./action-result";
import type { Banner } from "@/generated/prisma/client";

export type BannerInput = {
  ctaLabel: string;
  ctaUrl: string;
  enabled: boolean;
  sortOrder: string; // whole-number-from-form-field convention, same as ShippingMethodInput.amount
};

// Storefront Carousel/Banner (V1): a CTA URL is either a same-site
// relative path ("/products/abc123") or an absolute http(s) URL — never
// javascript:/data:/any other scheme. Same posture as the Markdown
// description link sanitizer (src/lib/markdown.ts) — a restricted scheme
// allowlist, checked server-side, never trusting what the browser would
// otherwise happily submit.
export function validateCtaUrl(rawUrl: string): { url: string } | { error: string } {
  const url = rawUrl.trim();
  if (!url) {
    return { url: "" };
  }
  if (url.startsWith("/")) {
    // A same-site relative path — "//evil.com" (protocol-relative) is
    // deliberately rejected by requiring exactly one leading slash not
    // followed by another.
    if (url.startsWith("//")) {
      return { error: "CTA URL must be a same-site path (e.g. /products/abc123) or a full https:// link." };
    }
    return { url };
  }
  if (/^https?:\/\//i.test(url)) {
    return { url };
  }
  return { error: "CTA URL must be a same-site path (e.g. /products/abc123) or a full https:// link." };
}

function validateBannerInput(
  input: BannerInput,
): { ctaLabel: string | null; ctaUrl: string | null; enabled: boolean; sortOrder: number } | { error: string } {
  const ctaLabel = input.ctaLabel.trim();
  const ctaUrlResult = validateCtaUrl(input.ctaUrl);
  if ("error" in ctaUrlResult) {
    return ctaUrlResult;
  }
  // A CTA needs BOTH a label and a URL to make sense — one without the
  // other is treated as "no CTA" rather than a half-configured button
  // rendering on the storefront.
  const hasCompleteCta = ctaLabel.length > 0 && ctaUrlResult.url.length > 0;

  if (!/^-?\d+$/.test(input.sortOrder.trim())) {
    return { error: "Sort order must be a whole number." };
  }
  const sortOrder = Number(input.sortOrder.trim());
  if (!Number.isSafeInteger(sortOrder)) {
    return { error: "Sort order must be a whole number." };
  }

  return {
    ctaLabel: hasCompleteCta ? ctaLabel : null,
    ctaUrl: hasCompleteCta ? ctaUrlResult.url : null,
    enabled: input.enabled,
    sortOrder,
  };
}

/**
 * Creates a new banner. tenantId must be the trusted value from
 * requireTenantAdmin() — never accepted from form input, same rule as
 * every other Tenant Admin mutation. imageUrl/mobileImageUrl are
 * already-uploaded Vercel Blob URLs (see uploadBannerImageAction /
 * uploadBannerMobileImageAction in tenant-admin/actions.ts, which call
 * uploadBannerImageFile() BEFORE this function ever runs) — this function
 * never touches Blob storage itself, same separation ProductMediaGallery's
 * upload/create split already established. mobileImageUrl is optional:
 * null means "no separate mobile image", and the storefront falls back to
 * imageUrl on every viewport.
 */
export async function createBanner(
  tenantId: string,
  imageUrl: string,
  mobileImageUrl: string | null,
  input: BannerInput,
): Promise<ActionResult> {
  if (!imageUrl) {
    return { success: false, error: "A desktop image is required." };
  }
  const validated = validateBannerInput(input);
  if ("error" in validated) {
    return { success: false, error: validated.error };
  }

  const db = getScopedDb(tenantId);
  try {
    await db.banner.create({
      data: {
        tenantId,
        imageUrl,
        mobileImageUrl,
        ctaLabel: validated.ctaLabel,
        ctaUrl: validated.ctaUrl,
        enabled: validated.enabled,
        sortOrder: validated.sortOrder,
      },
    });
    return { success: true, data: undefined };
  } catch (e) {
    console.error("createBanner failed:", e);
    return { success: false, error: "Something went wrong creating the banner." };
  }
}

/**
 * Updates an existing banner's fields. `bannerId` is scoped under
 * getScopedDb(tenantId) — a bannerId belonging to another tenant matches
 * no row, surfaced as "not found" rather than a cross-tenant write.
 *
 * Image replacement: `imageUrl` (desktop) is optional-to-replace — pass a
 * new Blob URL to swap it, or null to keep the existing one (a desktop
 * image is always required, so "keep existing" is the only other valid
 * state). `mobileImageUrl` is always fully specified on every save: a URL
 * to set/replace it, or null to clear it back to "fall back to desktop" —
 * unlike the desktop image, "no mobile image" is itself a valid, directly
 * selectable state via the admin UI's "Remove mobile image" control.
 *
 * Returns the PREVIOUS image URLs on success so the caller
 * (updateBannerAction) can safely delete any Blob file that was just
 * replaced — this function never touches Blob storage itself.
 */
export async function updateBanner(
  tenantId: string,
  bannerId: string,
  imageUrl: string | null,
  mobileImageUrl: string | null,
  input: BannerInput,
): Promise<ActionResult<{ previousImageUrl: string; previousMobileImageUrl: string | null }>> {
  const validated = validateBannerInput(input);
  if ("error" in validated) {
    return { success: false, error: validated.error };
  }

  const db = getScopedDb(tenantId);
  try {
    const existing = await db.banner.findFirst({ where: { id: bannerId, tenantId } });
    if (!existing) {
      return { success: false, error: "Banner not found." };
    }

    await db.banner.updateMany({
      where: { id: bannerId, tenantId },
      data: {
        ...(imageUrl ? { imageUrl } : {}),
        mobileImageUrl,
        ctaLabel: validated.ctaLabel,
        ctaUrl: validated.ctaUrl,
        enabled: validated.enabled,
        sortOrder: validated.sortOrder,
      },
    });
    return {
      success: true,
      data: { previousImageUrl: existing.imageUrl, previousMobileImageUrl: existing.mobileImageUrl },
    };
  } catch (e) {
    console.error("updateBanner failed:", e);
    return { success: false, error: "Something went wrong updating the banner." };
  }
}

/**
 * Deletes a banner row. Does NOT delete the underlying Blob objects — the
 * caller (deleteBannerAction) reads the returned URLs to delete both the
 * desktop and (if present) mobile blob via deleteBannerImageFile() AFTER
 * this succeeds, same "delete the DB row, then best-effort clean up
 * storage" ordering as removeProductMedia().
 */
export async function deleteBanner(
  tenantId: string,
  bannerId: string,
): Promise<ActionResult<{ imageUrl: string; mobileImageUrl: string | null }>> {
  const db = getScopedDb(tenantId);
  try {
    const banner = await db.banner.findFirst({ where: { id: bannerId, tenantId } });
    if (!banner) {
      return { success: false, error: "Banner not found." };
    }
    await db.banner.deleteMany({ where: { id: bannerId, tenantId } });
    return { success: true, data: { imageUrl: banner.imageUrl, mobileImageUrl: banner.mobileImageUrl } };
  } catch (e) {
    console.error("deleteBanner failed:", e);
    return { success: false, error: "Something went wrong deleting the banner." };
  }
}

export async function listBanners(tenantId: string): Promise<Banner[]> {
  const db = getScopedDb(tenantId);
  return db.banner.findMany({ where: { tenantId }, orderBy: { sortOrder: "asc" } });
}
