import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { getScopedDb } from "@/lib/db/tenant-db";

// Deliberately minimal — this checkpoint only proves Tenant Admin
// authentication, authorization, and the getScopedDb() wiring. No CRUD.
export const dynamic = "force-dynamic";

export default async function TenantAdminHomePage() {
  // Independently re-verified here, not relying on the layout gate alone —
  // same defense-in-depth rule already applied to Platform Admin mutations.
  const { tenantId } = await requireTenantAdmin();

  // NOTE: getScopedDb() auto-scopes tenant-owned models (domain, branding)
  // via their `tenantId` foreign key. The Tenant model itself has no such
  // column — it IS the tenant, identified by `id` — so this call passes
  // through the extension unintercepted. It's safe only because `tenantId`
  // here was already independently verified above (Clerk metadata AND the
  // hostname-resolved tenant had to match). This is not blanket protection
  // from getScopedDb() for the Tenant model; documented here and in Notion.
  const db = getScopedDb(tenantId);
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });

  return (
    <main className="flex flex-1 flex-col gap-2 px-6 py-16">
      <h1 className="text-2xl font-semibold">Tenant Admin</h1>
      <p className="text-black/70 dark:text-white/70">
        You are managing {tenant?.name ?? "(unknown tenant)"}.
      </p>
    </main>
  );
}
