/**
 * Paths that belong to the platform itself (Platform Admin, sign-in, and
 * future platform-level routes like /api or /platform) rather than to any
 * tenant's storefront. These bypass tenant hostname resolution entirely in
 * src/proxy.ts — a routing decision, not an authorization one. Actual
 * authentication/authorization for these routes happens in their own
 * layout/server code (e.g. src/app/platform-admin/layout.tsx).
 */
const PLATFORM_ROUTE_PREFIXES = ["/platform-admin", "/sign-in"] as const;

export function isPlatformRoute(pathname: string): boolean {
  return PLATFORM_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
