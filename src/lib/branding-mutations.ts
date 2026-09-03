import { getScopedDb } from "./db/tenant-db";
import type { ActionResult } from "./action-result";

const URL_PATTERN = /^https?:\/\//i;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export type BrandingInput = {
  storeName: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  secondaryColor: string;
  // Plain instructional text for a customer who chose bank_transfer at
  // checkout — no format validation beyond trimming, same as storeName.
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
};

/**
 * Normalizes one branding field: trims, and an empty result becomes `null`
 * (explicitly clearing the stored value so the existing fallback chain in
 * resolve-branding.ts takes effect), per the approved 4B decision.
 */
function trimToNull(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

function validateUrlField(raw: string, label: string): { value: string | null; error?: string } {
  const value = trimToNull(raw);
  if (value !== null && !URL_PATTERN.test(value)) {
    return { value, error: `${label} must start with http:// or https://, or be left empty.` };
  }
  return { value };
}

function validateColorField(raw: string, label: string): { value: string | null; error?: string } {
  const value = trimToNull(raw);
  if (value !== null && !HEX_COLOR_PATTERN.test(value)) {
    return { value, error: `${label} must be a hex color like #rgb or #rrggbb, or be left empty.` };
  }
  return { value };
}

/**
 * Updates the calling tenant's own Branding row — creating it first if it
 * doesn't exist yet. Not every Tenant is guaranteed to have a Branding row
 * (confirmed by inspection: Platform Admin's createTenant() in
 * tenant-mutations.ts only creates Tenant + Domain, not Branding), so this
 * must not assume update() alone can succeed.
 *
 * SECURITY: tenantId must be the trusted value returned by
 * requireTenantAdmin() — never accepted from form input. Uses
 * getScopedDb(tenantId) exclusively, never platformDb or raw prisma.
 */
export async function updateBranding(tenantId: string, input: BrandingInput): Promise<ActionResult> {
  const storeName = trimToNull(input.storeName);
  const logoUrl = validateUrlField(input.logoUrl, "Logo URL");
  const faviconUrl = validateUrlField(input.faviconUrl, "Favicon URL");
  const primaryColor = validateColorField(input.primaryColor, "Primary color");
  const secondaryColor = validateColorField(input.secondaryColor, "Secondary color");

  const firstError = logoUrl.error ?? faviconUrl.error ?? primaryColor.error ?? secondaryColor.error;
  if (firstError) {
    return { success: false, error: firstError };
  }

  const data = {
    storeName,
    logoUrl: logoUrl.value,
    faviconUrl: faviconUrl.value,
    primaryColor: primaryColor.value,
    secondaryColor: secondaryColor.value,
    bankName: trimToNull(input.bankName),
    bankAccountNumber: trimToNull(input.bankAccountNumber),
    bankAccountHolder: trimToNull(input.bankAccountHolder),
  };

  try {
    const db = getScopedDb(tenantId);
    await db.branding.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
    return { success: true, data: undefined };
  } catch (e) {
    console.error("updateBranding failed:", e);
    return { success: false, error: "Something went wrong saving branding." };
  }
}
