import Link from "next/link";
import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { getTenantKpis, LOW_STOCK_THRESHOLD } from "@/lib/tenant-kpis";
import { formatVnd } from "./format";
import { adminSectionClassName } from "./styles";

export const dynamic = "force-dynamic";

// Phase 1 of the admin route split left this route as a bare redirect to
// Branding, because every section had become its own route and there was
// nothing for the index itself to show. It now earns its place: a
// read-only overview of the numbers a merchant opens the admin to check.
//
// requireTenantAdmin() is called here independently — the layout's own
// call is necessary but never sufficient on its own, the same rule every
// other admin route and Server Action in this codebase follows.
export default async function TenantAdminOverviewPage() {
  const { tenantId } = await requireTenantAdmin();
  const kpis = await getTenantKpis(tenantId);

  const cards: { label: string; value: string; hint: string; href: string }[] = [
    {
      label: "Pending orders",
      value: String(kpis.pendingOrders),
      hint: "Awaiting fulfilment",
      href: "/tenant-admin/orders?status=pending",
    },
    {
      label: `Orders (${kpis.windowDays}d)`,
      value: String(kpis.ordersInWindow),
      hint: "Placed in the last 30 days",
      href: "/tenant-admin/orders",
    },
    {
      label: `Revenue (${kpis.windowDays}d)`,
      value: formatVnd(kpis.revenueInWindow),
      hint: "Items + shipping, excluding cancelled",
      href: "/tenant-admin/orders",
    },
    {
      label: "Active products",
      value: String(kpis.activeProducts),
      hint: "Visible on the storefront",
      href: "/tenant-admin/catalog",
    },
    {
      label: "Low stock",
      value: String(kpis.lowStockVariants),
      hint: `Variants with ${LOW_STOCK_THRESHOLD} or fewer available`,
      href: "/tenant-admin/catalog",
    },
  ];

  return (
    <section className={adminSectionClassName}>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium tracking-tight">Overview</h2>
        <p className="text-xs text-muted-foreground">
          A read-only snapshot of this store. Nothing on this page changes any data.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="flex flex-col gap-1 rounded-lg border border-border bg-surface-muted p-4 transition-colors hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            <span className="text-xs font-medium text-muted-foreground">{card.label}</span>
            <span className="font-mono text-2xl font-semibold tabular-nums">{card.value}</span>
            <span className="text-xs text-muted-foreground">{card.hint}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
