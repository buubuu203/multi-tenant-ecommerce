import Link from "next/link";
import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { getTenantKpis } from "@/lib/tenant-kpis";
import { LOW_STOCK_THRESHOLD } from "@/lib/inventory-availability";
import { formatVnd } from "./format";
import {
  adminPageClassName,
  adminPanelClassName,
  adminPanelTitleClassName,
  adminButtonSecondaryClassName,
} from "./styles";
import { AdminPageHeader } from "./AdminPageHeader";

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

  // `needsAttention` drives a text note, never colour alone — a merchant
  // scanning this row should be able to tell which number wants action
  // from a greyscale screenshot.
  const cards: {
    label: string;
    value: string;
    hint: string;
    href: string;
    needsAttention?: boolean;
  }[] = [
    {
      label: "Pending orders",
      value: String(kpis.pendingOrders),
      hint: "Awaiting fulfilment",
      href: "/tenant-admin/orders?status=pending",
      needsAttention: kpis.pendingOrders > 0,
    },
    {
      label: `Orders (${kpis.windowDays}d)`,
      value: String(kpis.ordersInWindow),
      hint: "Placed in the last 30 days",
      href: "/tenant-admin/orders",
    },
    {
      // "Order value", not "Revenue": this figure counts every order that
      // has not been cancelled, which includes pending ones nobody has
      // paid for yet. Calling that revenue would tell a merchant they had
      // earned money they may never collect.
      label: `Order value (${kpis.windowDays}d)`,
      value: formatVnd(kpis.revenueInWindow),
      hint: "Items + shipping, including unpaid orders",
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
      needsAttention: kpis.lowStockVariants > 0,
    },
  ];

  return (
    <div className={adminPageClassName}>
      <AdminPageHeader
        title="Overview"
        description="A read-only snapshot of this store. Nothing on this page changes any data."
      />

      {/* KPIs sit directly on the page canvas as their own cards rather
          than inside an outer page card — a card within a card reads as
          one slab, which is what flattened this screen. */}
      <section aria-labelledby="kpi-heading" className="flex flex-col gap-3">
        <h3 id="kpi-heading" className={adminPanelTitleClassName}>
          This store at a glance
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <Link
              key={card.label}
              href={card.href}
              className={`group flex flex-col gap-1 rounded-lg border bg-surface p-4 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground ${
                card.needsAttention
                  ? "border-amber-300 dark:border-amber-800"
                  : "border-border hover:border-foreground/20"
              }`}
            >
              <span className="text-xs font-medium text-muted-foreground">{card.label}</span>
              {/* One number treatment across the row: same size, same
                  weight, tabular figures, so five cards read as one set
                  rather than five unrelated readouts. */}
              <span className="money text-2xl font-semibold tabular-nums">{card.value}</span>
              <span className="text-xs text-muted-foreground">{card.hint}</span>
              {card.needsAttention && (
                // Text, not just a border colour — the attention state has
                // to survive greyscale.
                <span className="text-xs font-medium text-amber-700 dark:text-amber-500">
                  Needs attention
                </span>
              )}
            </Link>
          ))}
        </div>
      </section>

      {/* Quick actions: the four things a merchant most often arrives
          wanting to do. Links to routes that already exist — no new
          destinations invented. */}
      <section aria-labelledby="quick-actions-heading" className={adminPanelClassName}>
        <div className="flex flex-col gap-1">
          <h3 id="quick-actions-heading" className={adminPanelTitleClassName}>
            Quick actions
          </h3>
          <p className="text-xs text-muted-foreground">
            The tasks merchants reach for most often.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/tenant-admin/orders" className={adminButtonSecondaryClassName}>
            View orders
          </Link>
          <Link href="/tenant-admin/products/new" className={adminButtonSecondaryClassName}>
            Add a product
          </Link>
          <Link href="/tenant-admin/shipping" className={adminButtonSecondaryClassName}>
            Configure shipping
          </Link>
          <Link href="/tenant-admin/payments" className={adminButtonSecondaryClassName}>
            Manage payments
          </Link>
        </div>
      </section>
    </div>
  );
}
