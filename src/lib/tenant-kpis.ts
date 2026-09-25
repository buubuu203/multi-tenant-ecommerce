import { getScopedDb } from "./db/tenant-db";
import { prisma } from "./prisma";

export type TenantKpis = {
  windowDays: number;
  pendingOrders: number;
  ordersInWindow: number;
  revenueInWindow: number;
  activeProducts: number;
  lowStockVariants: number;
};

/** A variant at or below this available count is surfaced as "low stock". */
export const LOW_STOCK_THRESHOLD = 5;

const WINDOW_DAYS = 30;

/**
 * Read-only KPI aggregates for one tenant's admin overview.
 *
 * Scoping follows this codebase's existing split, not a new convention:
 * `product`/`inventory` go through getScopedDb() (the client extension
 * injects tenantId for those models), while `order`/`orderItem` are NOT
 * in that allowlist and therefore carry an explicit tenantId in every
 * where clause — the same rule order-queries.ts and banner-mutations.ts
 * already follow.
 *
 * Revenue is summed in application code rather than SQL because a line
 * total is price × quantity and Prisma's aggregate API can't express a
 * product of two columns. Bounded to the 30-day window, which keeps the
 * row count proportional to recent trading rather than to all history.
 * If a tenant's 30-day order volume ever outgrows that, this is the one
 * place to swap in a raw aggregate.
 */
export async function getTenantKpis(tenantId: string): Promise<TenantKpis> {
  const db = getScopedDb(tenantId);
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [pendingOrders, ordersInWindow, recentOrders, activeProducts, inventoryRows] = await Promise.all([
    prisma.order.count({ where: { tenantId, status: "pending" } }),
    prisma.order.count({ where: { tenantId, createdAt: { gte: since } } }),
    prisma.order.findMany({
      // Cancelled orders are excluded from revenue: they released their
      // inventory and were never collected on.
      where: { tenantId, createdAt: { gte: since }, status: { not: "cancelled" } },
      select: {
        shippingAmount: true,
        items: { select: { price: true, quantity: true } },
      },
    }),
    db.product.count({ where: { status: "active" } }),
    db.inventory.findMany({ select: { onHand: true, reserved: true } }),
  ]);

  const revenueInWindow = recentOrders.reduce((total, order) => {
    const itemsTotal = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    return total + itemsTotal + order.shippingAmount;
  }, 0);

  const lowStockVariants = inventoryRows.filter(
    (row) => row.onHand - row.reserved <= LOW_STOCK_THRESHOLD,
  ).length;

  return {
    windowDays: WINDOW_DAYS,
    pendingOrders,
    ordersInWindow,
    revenueInWindow,
    activeProducts,
    lowStockVariants,
  };
}
