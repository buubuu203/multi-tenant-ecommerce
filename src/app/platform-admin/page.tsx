import { platformDb } from "@/lib/db/platform-db";
import { createTenantAction, updateTenantNameAction, updateTenantStatusAction } from "./actions";
import { ActionForm } from "@/components/ActionForm";

export const dynamic = "force-dynamic";

const STATUSES = ["pending", "active", "suspended", "archived"] as const;

export default async function PlatformAdminHomePage() {
  const tenants = await platformDb.tenant.findMany({
    include: { domains: { where: { isPrimary: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main className="flex flex-1 flex-col gap-8 px-6 py-16">
      <h1 className="text-2xl font-semibold">Platform Admin</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Create tenant</h2>
        <ActionForm action={createTenantAction} submitLabel="Create" className="flex flex-wrap items-start gap-2">
          <input name="name" placeholder="Name" required className="rounded border px-2 py-1 text-sm" />
          <input name="slug" placeholder="Slug" required className="rounded border px-2 py-1 text-sm" />
        </ActionForm>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Tenants ({tenants.length})</h2>
        <div className="flex flex-col gap-4">
          {tenants.map((tenant) => (
            <div key={tenant.id} className="flex flex-col gap-2 rounded border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-xs text-black/50 dark:text-white/50">{tenant.slug}</span>
                <span>{tenant.domains[0]?.hostname ?? "(no primary domain)"}</span>
                <span className="rounded bg-black/10 px-2 py-0.5 text-xs dark:bg-white/10">{tenant.status}</span>
              </div>

              <ActionForm action={updateTenantNameAction} submitLabel="Save name" className="flex items-center gap-2">
                <input type="hidden" name="tenantId" value={tenant.id} />
                <input name="name" defaultValue={tenant.name} className="rounded border px-2 py-1 text-sm" />
              </ActionForm>

              <ActionForm action={updateTenantStatusAction} submitLabel="Save status" className="flex items-center gap-2">
                <input type="hidden" name="tenantId" value={tenant.id} />
                <select name="status" defaultValue={tenant.status} className="rounded border px-2 py-1 text-sm">
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </ActionForm>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
