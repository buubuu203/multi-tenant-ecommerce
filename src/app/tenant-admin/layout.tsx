import type { ReactNode } from "react";
import { requireTenantAdmin, NotTenantAdminError } from "@/lib/auth/require-tenant-admin";
import { getScopedDb } from "@/lib/db/tenant-db";
import { resolveBranding } from "../_storefront/resolve-branding";
import { TenantTheme } from "@/components/TenantTheme";
import { Toaster } from "@/components/Toast";
import { AdminTabs } from "./AdminTabs";
import { AdminAccountBar } from "@/components/AdminAccountBar";
import { AdminDenied } from "@/components/AdminDenied";

// Phase 1 of the admin route split: this layout now owns the chrome
// (theme, header, tab nav) that used to live inside the single giant
// page.tsx — every section is its own route under /tenant-admin/* and
// only fetches its own data; this layout fetches only what the CHROME
// itself needs (tenant name, branding for TenantTheme, the primary
// domain for "View storefront"), once, shared across every section.
export default async function TenantAdminLayout({ children }: { children: ReactNode }) {
  let tenantId: string;
  try {
    ({ tenantId } = await requireTenantAdmin());
  } catch (e) {
    if (e instanceof NotTenantAdminError) {
      // The shared denied shell, so a signed-in user refused this store's
      // admin still sees who they are and can sign out. Deliberately
      // rendered BEFORE getScopedDb() is ever reached below — no tenant
      // data, branding included, is read on the unauthorized path.
      return <AdminDenied surface="Store Admin" />;
    }
    throw e; // e.g. Next.js's internal redirect signal from redirectToSignIn()
  }

  const db = getScopedDb(tenantId);
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  const branding = await db.branding.findUnique({ where: { tenantId } });
  const themeBranding = resolveBranding(tenant ?? { name: "Store" }, branding);
  const primaryDomain = await db.domain.findFirst({ where: { tenantId, isPrimary: true } });

  return (
    <TenantTheme branding={themeBranding} className="admin-chrome flex flex-1 flex-col">
      <Toaster />
      {/* <main>, not <div>: see the same change in platform-admin's
          layout — admin surfaces need one landmark to skip to. */}
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12 sm:py-16">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Tenant Admin</h1>
          <p className="text-sm text-muted-foreground">
            You are managing {tenant?.name ?? "(unknown tenant)"}.
          </p>
          {primaryDomain && (
            <a
              href={`http://${primaryDomain.hostname}:3000/`}
              target="_blank"
              rel="noreferrer"
              className="w-fit text-sm text-muted-foreground underline transition-colors hover:text-foreground"
            >
              View storefront ↗
            </a>
          )}
          <AdminAccountBar />
        </div>

        <AdminTabs />

        {children}
      </main>
    </TenantTheme>
  );
}
