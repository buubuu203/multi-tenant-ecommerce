import type { ReactNode } from "react";
import { requireTenantAdmin, NotTenantAdminError } from "@/lib/auth/require-tenant-admin";
import { getScopedDb } from "@/lib/db/tenant-db";
import { resolveBranding } from "../_storefront/resolve-branding";
import { TenantTheme } from "@/components/TenantTheme";
import { Toaster } from "@/components/Toast";
import { AdminNav } from "./AdminNav";
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

      {/* Top bar: global context — which store, who is signed in, how to
          leave. Deliberately separate from the sidebar, which answers
          "where can I go": the two layers do different jobs, and letting
          them share one space is what made the old header crowded. */}
      <header className="border-b border-border bg-surface">
        <div className={`${adminContainerClassName} flex flex-wrap items-center justify-between gap-3 py-3`}>
          <div className="flex min-w-0 flex-col gap-0.5">
            {/* The STORE is the h1, not "Tenant Admin". The operator knows
                which tool they are in; what they need confirmed before
                changing anything — especially running more than one shop —
                is which shop this is. */}
            <p className={adminEyebrowClassName}>Tenant Admin</p>
            <h1 className="truncate text-lg font-semibold tracking-tight">
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
                <span aria-hidden="true">↗</span>
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            )}
            <AdminAccountBar />
          </div>
        </div>
      </header>

      {/* One grid owns the whole body, so the sidebar and the content
          column cannot drift apart or overlap. Single column below lg,
          where a fixed sidebar would eat most of a 375px screen. */}
      <div
        className={`${adminContainerClassName} grid flex-1 grid-cols-1 items-start gap-6 py-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8`}
      >
        {/* Sticky on desktop so navigation stays reachable down a long
            orders list, and never focus-trapped: it is always-visible
            page furniture, not an overlay. */}
        <aside className="lg:sticky lg:top-6">
          <AdminNav />
        </aside>

        {/* minmax(0,1fr) above is load-bearing: without it a wide child
            (a table, a long order id) would force the grid column wider
            than the viewport and reintroduce horizontal scrolling. */}
        <main className="flex min-w-0 flex-col gap-6">{children}</main>
      </div>
    </TenantTheme>
  );
}
