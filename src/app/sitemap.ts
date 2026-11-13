import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { getRequestOrigin } from "@/lib/seo/request-origin";
import { buildSitemapEntries } from "@/lib/seo/sitemap-entries";

// A sitemap route handler is CACHED BY DEFAULT in this Next.js version
// unless it uses a request-time API. That default is actively dangerous
// for a multi-tenant app off one deployment: a cached response could
// serve tenant A's product URLs on tenant B's domain. Reading headers()
// already opts out, but force-dynamic makes the guarantee explicit
// rather than an emergent property of how the body happens to be
// written — the same convention every tenant-scoped page here uses.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const headerList = await headers();
  // Same trusted-header read as get-current-tenant.ts: resolved
  // server-side by src/proxy.ts from the verified request hostname,
  // never accepted from the client.
  const tenantId = headerList.get("x-tenant-id");
  const origin = await getRequestOrigin();

  // An unresolvable host has no catalog to advertise — an empty sitemap
  // is the correct answer, not a 500 and not another tenant's URLs.
  if (!tenantId || !origin) {
    return [];
  }

  return buildSitemapEntries(tenantId, origin);
}
