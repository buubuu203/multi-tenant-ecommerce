/**
 * Paths that belong to the platform itself (Platform Admin, sign-in, and
 * future platform-level routes like /api or /platform) rather than to any
 * tenant's storefront. These bypass tenant hostname resolution entirely in
 * src/proxy.ts — a routing decision, not an authorization one. Actual
 * authentication/authorization for these routes happens in their own
 * layout/server code (e.g. src/app/platform-admin/layout.tsx).
 */
// Step 48: /api added — a payment provider's webhook (MoMo's IPN, see
// src/app/api/momo/webhook/route.ts) is called using this platform's own
// public hostname, never a tenant storefront hostname, so it must bypass
// tenant-hostname resolution exactly like /platform-admin and /sign-in
// already do (this file's own doc comment above anticipated exactly this
// extension). Without this, an unrecognized Host header would be rewritten
// to /store-not-found before ever reaching the webhook handler.
const PLATFORM_ROUTE_PREFIXES = ["/platform-admin", "/sign-in", "/api"] as const;

export function isPlatformRoute(pathname: string): boolean {
  return PLATFORM_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
