import type { ReactNode } from "react";
import { requireTenantAdmin, NotTenantAdminError } from "@/lib/auth/require-tenant-admin";
import { getScopedDb } from "@/lib/db/tenant-db";
import { resolveBranding } from "../_storefront/resolve-branding";
import { TenantTheme } from "@/components/TenantTheme";
import { Toaster } from "@/components/Toast";
import { AdminTabs } from "./AdminTabs";
import {
  adminContainerClassName,
  adminEyebrowClassName,
  adminButtonSecondaryClassName,
} from "./styles";
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
      {/* A real <header> landmark, separated from <main> by a border and a
          surface change, so the chrome reads as chrome and the page body
          starts at an obvious edge. */}
      <header className="border-b border-border bg-surface">
        <div className={`${adminContainerClassName} flex flex-col gap-4 py-4`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-0.5">
              {/* The STORE is the h1, not "Tenant Admin". The operator
                  knows which tool they are in; what they need confirmed at
                  a glance — especially when they run more than one shop —
                  is which shop they are about to change. "Tenant Admin" is
                  demoted to an eyebrow, which is what it actually is. */}
              <p className={adminEyebrowClassName}>Tenant Admin</p>
              <h1 className="truncate text-xl font-semibold tracking-tight">
                {tenant?.name ?? "(unknown tenant)"}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {primaryDomain && (
                <a
                  href={`http://${primaryDomain.hostname}:3000/`}
                  target="_blank"
                  rel="noreferrer"
                  className={adminButtonSecondaryClassName}
                >
                  View storefront
                  {/* Marked decorative: the link text already says where it
                      goes, and "↗" announced as a character is noise. The
                      new-tab behaviour is named for screen readers below. */}
                  <span aria-hidden="true">↗</span>
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              )}
              <AdminAccountBar />
            </div>
          </div>
          <AdminTabs />
        </div>
      </header>

      {/* <main>, not <div>: admin surfaces need one landmark to skip to. */}
      <main className={`${adminContainerClassName} flex flex-1 flex-col gap-6 py-6 sm:py-8`}>
        {children}
      </main>
    </TenantTheme>
  );
}
