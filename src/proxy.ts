import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { isPlatformRoute } from "@/lib/platform-routes";

// V1 trade-off (deliberate, approved): Proxy performs one minimal, indexed
// lookup (Domain.hostname -> Tenant.id/status) to resolve which tenant a
// request belongs to. It does NOT fetch Branding, Products, Orders, or any
// other tenant data, and does NOT contain business logic beyond "which
// tenant is this". No cache/KV layer is introduced for this step; if lookup
// latency becomes a real problem later, that's a deliberate future change,
// not something to reach for now.
//
// SECURITY: the `x-tenant-id` / `x-tenant-status` headers set below are
// RESOLVED TENANT CONTEXT ONLY — derived from the verified request Host
// header. They are NOT an authorization boundary. Downstream code must never
// treat "this header is present" as proof that the current user is allowed
// to access that tenant. Tenant Admin / Platform Admin access control will
// perform its own independent authentication and authorization checks when
// that functionality is built.
//
// Tenant selection is based ONLY on the request hostname. Query parameters,
// cookies, request bodies, and client-side state are never consulted here —
// so `shop-a.localhost:3000?tenantId=shop-b` still resolves to Shop A.
//
// PLATFORM ROUTES: paths under isPlatformRoute() (e.g. /platform-admin,
// /sign-in) belong to the platform itself, not any tenant, and bypass
// tenant hostname resolution entirely below. This is a routing boundary,
// not an authorization decision — it exists because tenant lookup would
// otherwise run for every path regardless of hostname, and reject platform
// routes as "unknown domain" before their own auth logic ever runs (this
// was found and fixed during Checkpoint 3B). Authentication/authorization
// for platform routes still lives entirely in their own layout/server code.
//
// CLERK: clerkMiddleware() here only makes the session available to
// downstream Server Components (via auth() / currentUser()) — it does NOT
// protect any route. No route is gated yet; Platform Admin authorization
// will be a separate, explicit check performed in Platform Admin's own
// layout/pages, not here. This deliberately avoids calling auth.protect()
// inside the proxy layer (a known Next.js 16 + Clerk issue can redirect a
// blocked user back to the same page instead of sign-in), and keeps this
// proxy's job limited to "which tenant is this", per the Thin Proxy
// principle already established in Step 2.
//
// signInUrl: required so that auth().redirectToSignIn() (used by Tenant
// Admin's requireTenantAdmin(), Checkpoint 4A) sends users to our own
// /sign-in route instead of Clerk's hosted Account Portal default. This is
// a config value read by clerkMiddleware itself, not a routing/authz
// decision — no auth.protect() or role logic is added here.

// PREVIEW-ONLY FALLBACK: Vercel Preview deployments get a randomly generated
// *.vercel.app hostname each time, which is never registered as a Domain row
// (and never should be — Domain rows model real merchant storefront domains,
// not ephemeral deployment URLs). Without this, every Preview deployment's
// tenant-owned routes are permanently unreachable ("store not found"), even
// though the real pilot tenant's data is right there in the Preview
// database. Rather than fake a Domain row (which would misrepresent a real
// data model as owning a domain it doesn't) or duplicate the tenant, this
// resolves an explicitly configured tenant slug as the fallback, gated on
// BOTH:
//   - process.env.VERCEL_ENV === "preview" — set by the Vercel platform
//     itself per deployment target, not attacker/request-controlled, so a
//     spoofed Host header against the Production deployment can never
//     trigger this (VERCEL_ENV there is always "production").
//   - PREVIEW_DEFAULT_TENANT_SLUG being explicitly set — only ever added to
//     the Preview environment in Vercel, never Production. Its absence
//     (e.g. local dev, where VERCEL_ENV is unset anyway) is a no-op.
// A real Domain match, when one exists, is always tried first and always
// wins — this is a fallback for the "no Domain row matched" case only.
async function resolvePreviewFallbackTenant() {
  if (process.env.VERCEL_ENV !== "preview" || !process.env.PREVIEW_DEFAULT_TENANT_SLUG) {
    return null;
  }
  return prisma.tenant.findUnique({
    where: { slug: process.env.PREVIEW_DEFAULT_TENANT_SLUG },
    select: { id: true, status: true },
  });
}

export default clerkMiddleware(
  async (_auth, request: NextRequest) => {
    if (isPlatformRoute(request.nextUrl.pathname)) {
      return NextResponse.next();
    }

    const hostname = request.headers.get("host")?.split(":")[0] ?? "";

    const domain = await prisma.domain.findUnique({
      where: { hostname },
      select: {
        tenant: {
          select: { id: true, status: true },
        },
      },
    });

    const tenant = domain?.tenant ?? (await resolvePreviewFallbackTenant());

    if (!tenant) {
      return NextResponse.rewrite(new URL("/store-not-found", request.url));
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-tenant-id", tenant.id);
    requestHeaders.set("x-tenant-status", tenant.status);

    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  },
  { signInUrl: "/sign-in" },
);

export const config = {
  matcher: [
    /*
     * Match all request paths except for Next.js internals and static
     * assets, so the tenant lookup only runs for actual page/document
     * requests.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
