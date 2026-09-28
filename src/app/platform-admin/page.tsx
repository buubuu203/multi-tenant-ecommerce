import { platformDb } from "@/lib/db/platform-db";
import { createTenantAction, updateTenantNameAction, updateTenantStatusAction } from "./actions";
import { ActionForm } from "@/components/ActionForm";
import { ConfirmActionForm } from "@/components/ConfirmActionForm";
import { adminInputClassName, adminLabelClassName, adminSectionClassName } from "../tenant-admin/styles";

export const dynamic = "force-dynamic";

const STATUSES = ["pending", "active", "suspended", "archived"] as const;
type TenantStatusValue = (typeof STATUSES)[number];

// Same per-file badge-map convention Tenant Admin already uses for order
// and payment status — colour carries the meaning at a glance rather than
// making an operator read four near-identical words.
const STATUS_BADGE: Record<string, string> = {
  active:
    "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-400",
  pending:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400",
  suspended:
    "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400",
  archived: "border-border bg-surface-muted text-muted-foreground",
};

// Which transitions take a live storefront offline. These get a
// confirm() before they fire; the harmless ones stay a single click.
const DISRUPTIVE_STATUSES = new Set<TenantStatusValue>(["suspended", "archived"]);

function statusHelpText(status: string): string {
  switch (status) {
    case "active":
      return "Storefront is live";
    case "pending":
      return "Storefront shows “coming soon”";
    case "suspended":
      return "Storefront shows “unavailable”";
    case "archived":
      return "Storefront shows “unavailable”";
    default:
      return "";
  }
}

export default async function PlatformAdminHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";

  const tenants = await platformDb.tenant.findMany({
    // Platform Admin is the one surface that legitimately sees every
    // tenant — platformDb, not getScopedDb, is correct here. Search is
    // applied in the query rather than in memory so this keeps working
    // as the tenant count grows.
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { slug: { contains: q, mode: "insensitive" } },
          ],
        }
      : {},
    include: { domains: { where: { isPrimary: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <section className={adminSectionClassName}>
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-medium tracking-tight">Create tenant</h2>
          <p className="text-xs text-muted-foreground">
            The slug becomes the storefront subdomain. It is created automatically and cannot be
            changed afterwards.
          </p>
        </div>
        <ActionForm
          action={createTenantAction}
          submitLabel="Create tenant"
          successMessage="Tenant created."
          className="flex flex-col gap-3 sm:max-w-md"
        >
          <label className={adminLabelClassName}>
            Name
            <input name="name" placeholder="Acme Store" required className={adminInputClassName} />
          </label>
          <label className={adminLabelClassName}>
            Slug
            <input name="slug" placeholder="acme" required className={adminInputClassName} />
          </label>
        </ActionForm>
      </section>

      <section className={adminSectionClassName}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-medium tracking-tight">
            Tenants{" "}
            <span className="text-sm font-normal text-muted-foreground">({tenants.length})</span>
          </h2>
          <form method="get" className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="sr-only">Search tenants</span>
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search name or slug"
                className={`w-56 ${adminInputClassName}`}
              />
            </label>
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
            >
              Search
            </button>
          </form>
        </div>

        {tenants.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            {q ? `No tenants match “${q}”.` : "No tenants yet — create the first one above."}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {tenants.map((tenant) => (
              <li
                key={tenant.id}
                className="flex flex-col gap-4 rounded-lg border border-border bg-surface-muted p-4"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{tenant.name}</h3>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${
                        STATUS_BADGE[tenant.status] ?? "border-border"
                      }`}
                    >
                      {tenant.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {statusHelpText(tenant.status)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-mono">{tenant.slug}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono break-all">
                      {tenant.domains[0]?.hostname ?? "no primary domain"}
                    </span>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <ActionForm
                    action={updateTenantNameAction}
                    submitLabel="Save name"
                    successMessage="Tenant name saved."
                    className="flex flex-col gap-2"
                  >
                    <input type="hidden" name="tenantId" value={tenant.id} />
                    <label className={adminLabelClassName}>
                      Display name
                      <input name="name" defaultValue={tenant.name} className={adminInputClassName} />
                    </label>
                  </ActionForm>

                  {/* Status changes can take a live storefront offline, so
                      this uses the confirming variant rather than a plain
                      one-click save. The server action's own authorization
                      and validation are unchanged. */}
                  <ConfirmActionForm
                    action={updateTenantStatusAction}
                    submitLabel="Save status"
                    successMessage="Tenant status saved."
                    confirmMessage={`Change “${tenant.name}” status? Suspending or archiving takes its storefront offline for customers immediately.`}
                    className="flex flex-col gap-2"
                  >
                    <input type="hidden" name="tenantId" value={tenant.id} />
                    <label className={adminLabelClassName}>
                      Status
                      <select
                        name="status"
                        defaultValue={tenant.status}
                        className={adminInputClassName}
                      >
                        {STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status}
                            {DISRUPTIVE_STATUSES.has(status) ? " — takes storefront offline" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </ConfirmActionForm>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
