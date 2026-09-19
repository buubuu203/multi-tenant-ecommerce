import { getScopedDb } from "./db/tenant-db";
import type { ActionResult } from "./action-result";
import type { Banner } from "@/generated/prisma/client";

export type BannerInput = {
  title: string;
  subtitle: string;
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
function validateCtaUrl(rawUrl: string): { url: string } | { error: string } {
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
): { title: string; subtitle: string | null; ctaLabel: string | null; ctaUrl: string | null; enabled: boolean; sortOrder: number } | { error: string } {
  const title = input.title.trim();
  if (!title) {
    return { error: "Title is required." };
  }

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
    title,
    subtitle: input.subtitle.trim() || null,
    ctaLabel: hasCompleteCta ? ctaLabel : null,
    ctaUrl: hasCompleteCta ? ctaUrlResult.url : null,
    enabled: input.enabled,
    sortOrder,
  };
}

/**
 * Creates a new banner. tenantId must be the trusted value from
 * requireTenantAdmin() — never accepted from form input, same rule as
 * every other Tenant Admin mutation. imageUrl is the already-uploaded
 * Vercel Blob URL (see uploadBannerImageAction in tenant-admin/actions.ts,
 * which calls uploadBannerImageFile() BEFORE this function ever runs) —
 * this function never touches Blob storage itself, same separation
 * ProductMediaGallery's upload/create split already established.
 */
export async function createBanner(tenantId: string, imageUrl: string, input: BannerInput): Promise<ActionResult> {
  if (!imageUrl) {
    return { success: false, error: "A banner image is required." };
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
        title: validated.title,
        subtitle: validated.subtitle,
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
 * Image replacement is optional: pass a new `imageUrl` to swap it, or
 * omit/pass null to keep the existing one (the same "only touch what's
 * provided" convention as updateBrandingLogoUrl).
 */
export async function updateBanner(
  tenantId: string,
  bannerId: string,
  imageUrl: string | null,
  input: BannerInput,
): Promise<ActionResult> {
  const validated = validateBannerInput(input);
  if ("error" in validated) {
    return { success: false, error: validated.error };
  }

  const db = getScopedDb(tenantId);
  try {
    const result = await db.banner.updateMany({
      where: { id: bannerId, tenantId },
      data: {
        ...(imageUrl ? { imageUrl } : {}),
        title: validated.title,
        subtitle: validated.subtitle,
        ctaLabel: validated.ctaLabel,
        ctaUrl: validated.ctaUrl,
        enabled: validated.enabled,
        sortOrder: validated.sortOrder,
      },
    });
    if (result.count === 0) {
      return { success: false, error: "Banner not found." };
    }
    return { success: true, data: undefined };
  } catch (e) {
    console.error("updateBanner failed:", e);
    return { success: false, error: "Something went wrong updating the banner." };
  }
}

/**
 * Deletes a banner row. Does NOT delete the underlying Blob object — the
 * caller (deleteBannerAction) reads the row first to get its imageUrl,
 * then deletes the blob via deleteBannerImageFile() AFTER this succeeds,
 * same "delete the DB row, then best-effort clean up storage" ordering as
 * removeProductMedia().
 */
export async function deleteBanner(tenantId: string, bannerId: string): Promise<ActionResult<{ imageUrl: string }>> {
  const db = getScopedDb(tenantId);
  try {
    const banner = await db.banner.findFirst({ where: { id: bannerId, tenantId } });
    if (!banner) {
      return { success: false, error: "Banner not found." };
    }
    await db.banner.deleteMany({ where: { id: bannerId, tenantId } });
    return { success: true, data: { imageUrl: banner.imageUrl } };
  } catch (e) {
    console.error("deleteBanner failed:", e);
    return { success: false, error: "Something went wrong deleting the banner." };
  }
}

export async function listBanners(tenantId: string): Promise<Banner[]> {
  const db = getScopedDb(tenantId);
  return db.banner.findMany({ where: { tenantId }, orderBy: { sortOrder: "asc" } });
}
