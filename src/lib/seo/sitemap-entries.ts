import { prisma } from "@/lib/prisma";

export type SitemapEntry = {
  url: string;
  lastModified: Date;
  changeFrequency: "daily" | "weekly" | "monthly";
  priority: number;
};

/**
 * Builds the sitemap entry list for ONE tenant.
 *
 * Extracted from src/app/sitemap.ts so the tenant-isolation rule that
 * matters most here — a sitemap must never expose another tenant's
 * product URLs — is directly testable without a request context.
 *
 * Two deliberate exclusions:
 *   - Only `status: "active"` products that still have a non-archived
 *     variant. A draft product is not public, and a product with nothing
 *     left to sell now returns a real 404 (see getTenantProductForTenant);
 *     listing either would hand crawlers a URL the storefront itself
 *     refuses to render.
 *   - No customer-facing order URLs (/orders, /orders/<id>). Those are
 *     reachable only with a high-entropy order id plus a checkout-time
 *     field; putting any of it in a public sitemap would defeat that.
 */
export async function buildSitemapEntries(tenantId: string, origin: string): Promise<SitemapEntry[]> {
  const products = await prisma.product.findMany({
    // `some` rather than a count: one surviving variant is enough to make
    // the product page renderable, which is exactly the PDP's own rule.
    where: { tenantId, status: "active", variants: { some: { status: { not: "archived" } } } },
    select: { id: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  const now = new Date();
  const newestProductUpdate = products[0]?.updatedAt ?? now;

  return [
    {
      url: `${origin}/`,
      // The storefront home lists the catalog, so its freshness tracks
      // the most recently edited product rather than "now" (which would
      // tell a crawler the page changed on every single fetch).
      lastModified: newestProductUpdate,
      changeFrequency: "daily",
      priority: 1,
    },
    ...products.map((product) => ({
      url: `${origin}/products/${product.id}`,
      lastModified: product.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
