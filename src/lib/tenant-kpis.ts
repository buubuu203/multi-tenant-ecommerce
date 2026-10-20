import { prisma } from './prisma';
import { LOW_STOCK_THRESHOLD } from './inventory-availability';
import { resolveAnalyticsRange, type AnalyticsRange } from './analytics/date-range';

export type TenantKpis = {
  /** Days the window covers, for the card labels. */
  windowDays: number;
  /** `YYYY-MM-DD` in the analytics timezone, inclusive at both ends. */
  fromDate: string;
  toDate: string;
  /** Not window-scoped: everything still waiting, however old. */
  pendingOrders: number;
  ordersInWindow: number;
  /**
   * Total ORDER VALUE in the window, not settled revenue: items plus
   * shipping for every order that has not been cancelled, which includes
   * pending orders that have not been paid for. Surfaced in the UI as
   * "Order value" for exactly that reason. The field name is historical.
   */
  revenueInWindow: number;
  /** Orders in the window by status, so the headline count is explicable. */
  ordersByStatus: { status: string; count: number }[];
  /** Point-in-time, never window-scoped. */
  activeProducts: number;
  lowStockVariants: number;
};

const ORDER_STATUSES = ['pending', 'fulfilled', 'cancelled'] as const;

/**
 * Read-only KPI aggregates for one tenant's admin overview.
 *
 * `range` is optional and defaults to the last 30 whole local days, the
 * window this page has always shown. Callers that let a merchant pick a
 * period pass their own resolved range, so the boundary rules —
 * inclusive days, Asia/Ho_Chi_Minh, half-open, malformed input narrowing
 * rather than widening — are defined once in date-range.ts and never
 * re-decided here.
 *
 * EVERY FIGURE IS AN AGGREGATE. This previously loaded every order in
 * the window with its items and summed them in JavaScript, and loaded
 * every inventory row for the tenant with no bound at all, filtering in
 * memory. Both were correct and both got slower with the store. The sums
 * now happen in Postgres and the row count returned is fixed.
 *
 * `order` is not in getScopedDb()'s allowlist and raw SQL bypasses the
 * extension entirely, so tenantId is stated explicitly in every
 * predicate — the rule order-queries.ts already follows.
 */
export async function getTenantKpis(
  tenantId: string,
  range: AnalyticsRange = resolveAnalyticsRange({}),
): Promise<TenantKpis> {
  const createdInRange = { gte: range.start, lt: range.end };

  const [pendingOrders, statusGroups, valueRows, activeProducts, inventoryRows] = await Promise.all(
    [
      // Deliberately NOT window-scoped: an order placed two months ago and
      // still pending is exactly what this card exists to surface.
      prisma.order.count({ where: { tenantId, status: 'pending' } }),

      prisma.order.groupBy({
        by: ['status'],
        where: { tenantId, createdAt: createdInRange },
        _count: { _all: true },
      }),

      // A line total is price × quantity, which Prisma's aggregate API
      // cannot express. Returns ONE row however many orders are in range.
      prisma.$queryRawUnsafe<{ total: bigint | null }[]>(
        `SELECT COALESCE(SUM(o."shippingAmount" + o.items_total), 0) AS total
       FROM (
         SELECT o.id,
                o."shippingAmount",
                COALESCE(SUM(i.price * i.quantity), 0) AS items_total
         FROM orders o
         LEFT JOIN order_items i ON i."orderId" = o.id AND i."tenantId" = o."tenantId"
         WHERE o."tenantId" = $1
           AND o."createdAt" >= $2
           AND o."createdAt" <  $3
           AND o.status <> 'cancelled'
         GROUP BY o.id
       ) o`,
        tenantId,
        range.start,
        range.end,
      ),

      prisma.product.count({ where: { tenantId, status: 'active' } }),

      // Four numbers out of Postgres instead of every inventory row out of
      // the database and into memory.
      prisma.$queryRawUnsafe<{ low_stock: bigint }[]>(
        `SELECT COUNT(*) FILTER (WHERE "onHand" - reserved <= $2) AS low_stock
       FROM inventory
       WHERE "tenantId" = $1`,
        tenantId,
        LOW_STOCK_THRESHOLD,
      ),
    ],
  );

  const counts = new Map(statusGroups.map((g) => [String(g.status), g._count._all]));
  // Every status, so a status with no orders reads as zero rather than
  // being absent and leaving the reader to guess.
  const ordersByStatus = ORDER_STATUSES.map((status) => ({
    status,
    count: counts.get(status) ?? 0,
  }));

  return {
    windowDays: range.days,
    fromDate: range.fromDate,
    toDate: range.toDate,
    pendingOrders,
    ordersInWindow: ordersByStatus.reduce((sum, row) => sum + row.count, 0),
    revenueInWindow: Number(valueRows[0]?.total ?? 0),
    ordersByStatus,
    activeProducts,
    lowStockVariants: Number(inventoryRows[0]?.low_stock ?? 0),
  };
}
