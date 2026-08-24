import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

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

export async function proxy(request: NextRequest) {
  const hostname = request.headers.get("host")?.split(":")[0] ?? "";

  const domain = await prisma.domain.findUnique({
    where: { hostname },
    select: {
      tenant: {
        select: { id: true, status: true },
      },
    },
  });

  if (!domain) {
    return NextResponse.rewrite(new URL("/store-not-found", request.url));
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-tenant-id", domain.tenant.id);
  requestHeaders.set("x-tenant-status", domain.tenant.status);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

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
