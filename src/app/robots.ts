import type { MetadataRoute } from "next";
import { getRequestOrigin } from "@/lib/seo/request-origin";

// Same caching caveat as sitemap.ts: force-dynamic so each tenant
// hostname gets its own robots.txt pointing at its own sitemap, never a
// cached one built for a different host.
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await getRequestOrigin();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        // Admin surfaces: authorization already blocks them, but there's
        // no reason to spend crawl budget on pages that can only ever
        // return a sign-in redirect.
        "/tenant-admin",
        "/platform-admin",
        "/sign-in",
        // Guest order lookup and order detail pages. These are gated on a
        // high-entropy order id plus a checkout-time field, so they're not
        // secret-by-obscurity — but they are personal data by definition
        // and have no business in a search index.
        "/orders",
      ],
    },
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}
