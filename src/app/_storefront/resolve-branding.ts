import type { Branding, Tenant } from "@/generated/prisma/client";

// Platform defaults used whenever a tenant hasn't configured a given
// branding field. Deliberately not a "theme system" — just fallback values.
const PLATFORM_DEFAULTS = {
  primaryColor: "#3b3b3b",
  secondaryColor: "#8a8a8a",
};

export type ResolvedBranding = {
  storeName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
};

export function resolveBranding(
  tenant: Pick<Tenant, "name">,
  branding: Branding | null,
): ResolvedBranding {
  return {
    storeName: branding?.storeName || tenant.name,
    logoUrl: branding?.logoUrl || null,
    primaryColor: branding?.primaryColor || PLATFORM_DEFAULTS.primaryColor,
    secondaryColor: branding?.secondaryColor || PLATFORM_DEFAULTS.secondaryColor,
  };
}
