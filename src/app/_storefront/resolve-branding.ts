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

// Storefront footer contact/legal block (UI/UX revamp, Board 5) — kept as
// its own type rather than folded into ResolvedBranding, since nothing
// but SiteFooter needs it and every other caller of resolveBranding()
// would otherwise have to carry these around unused.
export type FooterContact = {
  address: string | null;
  phone: string | null;
  email: string | null;
  businessId: string | null;
  facebookUrl: string | null;
  tiktokUrl: string | null;
  zaloUrl: string | null;
  instagramUrl: string | null;
  tagline: string | null;
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

export function resolveFooterContact(branding: Branding | null): FooterContact {
  return {
    address: branding?.address || null,
    phone: branding?.phone || null,
    email: branding?.contactEmail || null,
    businessId: branding?.businessId || null,
    facebookUrl: branding?.facebookUrl || null,
    tiktokUrl: branding?.tiktokUrl || null,
    zaloUrl: branding?.zaloUrl || null,
    instagramUrl: branding?.instagramUrl || null,
    tagline: branding?.tagline || null,
  };
}
