import { auth, currentUser } from "@clerk/nextjs/server";
import { headers } from "next/headers";

export class NotTenantAdminError extends Error {}

export type TenantAdminMetadata = { role?: string; tenantId?: string } | undefined;

/**
 * The pure authorization DECISION, extracted from requireTenantAdmin() so
 * it's testable without a Clerk/Next.js request context — this is exactly
 * steps 3-4 of the doc comment below, with no I/O of its own. Behavior is
 * identical to what requireTenantAdmin() always did; this refactor changes
 * nothing about how a real request is authorized.
 */
// "tenant_admin" is the store OWNER — unrestricted. "tenant_staff" is a
// new, lower tier added on explicit request (2026-11-25): someone who
// needs day-to-day admin access (orders, catalog, customers...) but must
// NOT see or change sensitive store-level configuration — currently the
// Telegram bot token/chat id (see updateBrandingAction and
// sendTestTelegramNotificationAction in tenant-admin/actions.ts, the only
// two places that check for "tenant_admin" specifically rather than just
// "signed in as either role"). Assigning either role still only happens
// by hand in Clerk's dashboard metadata — there is no in-app user
// management UI to create or invite a staff account yet.
const TENANT_ROLES = ["tenant_admin", "tenant_staff"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export function resolveTenantAdminAuthorization(
  metadata: TenantAdminMetadata,
  resolvedTenantId: string | null,
): { authorized: true; tenantId: string; role: TenantRole } | { authorized: false; reason: string } {
  if (!resolvedTenantId) {
    return { authorized: false, reason: "No tenant resolved from request hostname" };
  }
  if (!metadata?.role || !TENANT_ROLES.includes(metadata.role as TenantRole) || !metadata.tenantId) {
    return { authorized: false, reason: "User is not a tenant admin" };
  }
  if (metadata.tenantId !== resolvedTenantId) {
    // The Clerk metadata tenantId alone is never trusted for tenant
    // selection — it must match the hostname-resolved tenant too.
    return { authorized: false, reason: "Tenant admin metadata does not match the requested tenant" };
  }
  return { authorized: true, tenantId: resolvedTenantId, role: metadata.role as TenantRole };
}

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
export async function requireTenantAdmin(): Promise<{ tenantId: string; userId: string | null; role: TenantRole }> {
  const { userId, redirectToSignIn } = await auth();
  const headerList = await headers();
  const resolvedTenantId = headerList.get("x-tenant-id");

  if (!userId) {
    const host = headerList.get("host") ?? "";
    const proto = headerList.get("x-forwarded-proto") ?? "http";
    redirectToSignIn({ returnBackUrl: `${proto}://${host}/tenant-admin` });
  }

  const user = await currentUser();
  const metadata = user?.publicMetadata as TenantAdminMetadata;

  const decision = resolveTenantAdminAuthorization(metadata, resolvedTenantId);
  if (!decision.authorized) {
    throw new NotTenantAdminError(decision.reason);
  }

  // userId is returned alongside tenantId purely so callers can attribute
  // an audit event to the acting admin. It is the same identifier
  // requirePlatformAdmin() already returns, it is never a token or a
  // session id, and no authorization decision reads it — the decision
  // above is unchanged.
  //
  // Typed nullable rather than asserted non-null: the !userId branch above
  // relies on redirectToSignIn() throwing at runtime, which TypeScript
  // cannot narrow, and restructuring that branch would mean touching live
  // authorization control flow for a field only the audit trail uses. An
  // authorized admin always has an id in practice; a null simply records
  // the event without an actor id rather than blocking the mutation.
  return { tenantId: decision.tenantId, userId: user?.id ?? null, role: decision.role };
}
