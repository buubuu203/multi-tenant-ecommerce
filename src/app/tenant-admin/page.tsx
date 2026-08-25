import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { getScopedDb } from "@/lib/db/tenant-db";
import { ActionForm } from "@/components/ActionForm";
import { updateBrandingAction } from "./actions";

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
  const branding = await db.branding.findUnique({ where: { tenantId } });
  const primaryDomain = await db.domain.findFirst({ where: { tenantId, isPrimary: true } });

  return (
    <main className="flex flex-1 flex-col gap-8 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold">Tenant Admin</h1>
        <p className="text-black/70 dark:text-white/70">
          You are managing {tenant?.name ?? "(unknown tenant)"}.
        </p>
        {primaryDomain && (
          <a
            href={`http://${primaryDomain.hostname}:3000/`}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline"
          >
            View storefront ↗
          </a>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Branding</h2>
        <ActionForm
          action={updateBrandingAction}
          submitLabel="Save branding"
          className="flex max-w-md flex-col gap-2"
        >
          <label className="flex flex-col gap-1 text-sm">
            Store name
            <input
              name="storeName"
              defaultValue={branding?.storeName ?? ""}
              placeholder={tenant?.name}
              className="rounded border px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Logo URL
            <input
              name="logoUrl"
              defaultValue={branding?.logoUrl ?? ""}
              placeholder="https://..."
              className="rounded border px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Favicon URL
            <input
              name="faviconUrl"
              defaultValue={branding?.faviconUrl ?? ""}
              placeholder="https://..."
              className="rounded border px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Primary color
            <input
              name="primaryColor"
              defaultValue={branding?.primaryColor ?? ""}
              placeholder="#3b3b3b"
              className="rounded border px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Secondary color
            <input
              name="secondaryColor"
              defaultValue={branding?.secondaryColor ?? ""}
              placeholder="#8a8a8a"
              className="rounded border px-2 py-1"
            />
          </label>
        </ActionForm>
      </section>
    </main>
  );
}
