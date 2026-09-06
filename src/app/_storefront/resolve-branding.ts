import type { Branding, Tenant } from '@/generated/prisma/client';
import { sanitizeDesignTokens, type DesignTokenConfig } from '@/lib/design-tokens';

// Platform defaults used whenever a tenant hasn't configured a given
// branding field. Deliberately not a "theme system" — just fallback values.
const PLATFORM_DEFAULTS = {
  primaryColor: '#3b3b3b',
  secondaryColor: '#8a8a8a',
};

export type ResolvedBranding = {
  storeName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  designTokens: DesignTokenConfig | null;
};

export function resolveBranding(
  tenant: Pick<Tenant, 'name'>,
  branding: Branding | null,
): ResolvedBranding {
  const designTokens = sanitizeDesignTokens(branding?.designTokens);
  return {
    storeName: branding?.storeName || tenant.name,
    logoUrl: branding?.logoUrl || null,
    primaryColor:
      designTokens?.colors['--color-nozzle'] ||
      branding?.primaryColor ||
      PLATFORM_DEFAULTS.primaryColor,
    secondaryColor:
      designTokens?.colors['--color-support'] ||
      branding?.secondaryColor ||
      PLATFORM_DEFAULTS.secondaryColor,
    designTokens,
  };
}
