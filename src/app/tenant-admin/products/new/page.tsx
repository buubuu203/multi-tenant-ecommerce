import Link from "next/link";
import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { getScopedDb } from "@/lib/db/tenant-db";
import { CreateProductForm } from "../../CreateProductForm";
import { resolveBranding } from "../../../_storefront/resolve-branding";
import { TenantTheme } from "@/components/TenantTheme";

export const dynamic = "force-dynamic";

// Add Product, split out of the main Tenant Admin dashboard onto its own
// page — the dashboard's inline version was cramped (one compact card
// among many other sections); this gets the room a form this central to
// daily merchant use deserves. Auth is already enforced by
// tenant-admin/layout.tsx for every route under /tenant-admin/*, so no
// separate requireTenantAdmin() re-check would be needed for THAT
// purpose — it's called again here only to get tenantId for the branding
// lookup, same as every other Tenant Admin page/action in this codebase.
export default async function NewProductPage() {
  const { tenantId } = await requireTenantAdmin();
  const db = getScopedDb(tenantId);
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  const branding = await db.branding.findUnique({ where: { tenantId } });
  const themeBranding = resolveBranding(tenant ?? { name: "Store" }, branding);

  return (
    <TenantTheme branding={themeBranding} className="flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12 sm:py-16">
        <div className="flex flex-col gap-1">
          <Link
            href="/tenant-admin"
            className="w-fit text-sm text-muted-foreground underline transition-colors hover:text-foreground"
          >
            ← Back to dashboard
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Add a product</h1>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6 sm:p-8">
          <CreateProductForm />
        </div>
      </main>
    </TenantTheme>
  );
}
