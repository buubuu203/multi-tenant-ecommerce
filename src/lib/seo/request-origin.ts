import { headers } from "next/headers";

/**
 * The absolute origin (scheme + host) of the CURRENT request, used to
 * build absolute URLs for sitemap.xml / robots.txt.
 *
 * Deliberately derived from the request's own headers rather than a
 * configured base URL: this platform serves many tenants from many
 * hostnames off one deployment, so there is no single correct "site URL"
 * to put in an env var. The `host` header here is the same one
 * src/proxy.ts already resolved the tenant from, so the origin and the
 * tenant context can never disagree.
 *
 * `x-forwarded-proto` is set by Vercel's proxy; the http fallback only
 * ever applies to local development.
 */
export async function getRequestOrigin(): Promise<string | null> {
  const headerList = await headers();
  const host = headerList.get("host");
  if (!host) {
    return null;
  }
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}
