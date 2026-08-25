import { auth, currentUser } from "@clerk/nextjs/server";
import { headers } from "next/headers";

export class NotTenantAdminError extends Error {}

/**
 * The Tenant Admin equivalent of requirePlatformAdmin(). Every Tenant
 * Admin route/action must call this independently (the layout gate is
 * necessary but not sufficient on its own — same rule as Platform Admin).
 *
 * SECURITY: the tenantId in Clerk's publicMetadata must NEVER by itself
 * determine which tenant is being accessed. It is only trusted once it is
 * shown to match the tenant resolved from the verified request hostname
 * (src/proxy.ts -> x-tenant-id header, the same trusted mechanism the
 * storefront already uses via get-current-tenant.ts). Both must agree.
 *
 * Steps:
 *   1. auth()              -> is there a signed-in Clerk session?
 *   2. currentUser()       -> does the user have role "tenant_admin"?
 *   3. metadata.tenantId exists
 *   4. metadata.tenantId === the hostname-resolved tenantId
 *   5. only then return the trusted tenantId for getScopedDb(tenantId)
 *
 * Unauthenticated users are redirected to sign-in with a returnBackUrl
 * pointing back to the exact originating hostname + /tenant-admin, so the
 * tenant context is not lost across the sign-in flow (Tenant Admin is
 * reached via shop-a.localhost/tenant-admin, shop-b.localhost/tenant-admin,
 * etc. — not a single fixed platform URL, unlike Platform Admin).
 */
export async function requireTenantAdmin(): Promise<{ tenantId: string }> {
  const { userId, redirectToSignIn } = await auth();
  const headerList = await headers();
  const resolvedTenantId = headerList.get("x-tenant-id");

  if (!userId) {
    const host = headerList.get("host") ?? "";
    const proto = headerList.get("x-forwarded-proto") ?? "http";
    redirectToSignIn({ returnBackUrl: `${proto}://${host}/tenant-admin` });
  }

  if (!resolvedTenantId) {
    // /tenant-admin is not a platform route, so proxy.ts already 404s any
    // hostname it can't resolve before this code ever runs. This is a
    // defensive guard for that invariant, not an expected runtime path.
    throw new NotTenantAdminError("No tenant resolved from request hostname");
  }

  const user = await currentUser();
  const metadata = user?.publicMetadata as { role?: string; tenantId?: string } | undefined;

  if (metadata?.role !== "tenant_admin" || !metadata.tenantId) {
    throw new NotTenantAdminError("User is not a tenant admin");
  }

  if (metadata.tenantId !== resolvedTenantId) {
    // The Clerk metadata tenantId alone is never trusted for tenant
    // selection — it must match the hostname-resolved tenant too.
    throw new NotTenantAdminError("Tenant admin metadata does not match the requested tenant");
  }

  return { tenantId: resolvedTenantId };
}
