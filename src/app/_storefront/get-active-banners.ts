import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

export type StorefrontBanner = {
  id: string;
  imageUrl: string;
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
};

// Storefront Carousel/Banner (V1) — same trusted-header read pattern as
// get-current-tenant.ts: the x-tenant-id header is resolved server-side
// by src/proxy.ts from the verified request hostname, not an
// authorization token accepted from the client. Only ENABLED banners,
// ordered by sortOrder — this is the one place `enabled: false` banners
// (visible in Tenant Admin) are filtered out before anything reaches the
// browser.
export async function getActiveBanners(): Promise<StorefrontBanner[]> {
  const headerList = await headers();
  const tenantId = headerList.get("x-tenant-id");
  if (!tenantId) {
    return [];
  }

  const banners = await prisma.banner.findMany({
    where: { tenantId, enabled: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, imageUrl: true, title: true, subtitle: true, ctaLabel: true, ctaUrl: true },
  });
  return banners;
}
