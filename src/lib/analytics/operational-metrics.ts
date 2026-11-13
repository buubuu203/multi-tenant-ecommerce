import { prisma } from '../prisma';
import { LOW_STOCK_THRESHOLD } from '../inventory-availability';
import type { AnalyticsRange } from './date-range';

/**
 * Operational analytics for one tenant: facts this application actually
 * stores, counted exactly, and nothing else.
 *
 * WHAT THIS IS NOT, stated once here and repeated in the UI because the
 * temptation to read these numbers as something stronger is the whole
 * risk of the page:
 *
 *   - Order value is NOT revenue. It counts orders nobody has paid for.
 *   - A succeeded payment is NOT settlement. It means this application's
 *     own validation accepted a provider confirmation; no bank account
 *     is ever observed.
 *   - A pending COD payment is NOT a failure and NOT collected cash.
 *     Cash is settled with the courier and this system never learns the
 *     outcome, so a COD payment stays pending forever by design.
 *   - Rejection evidence is NOT reconciliation. A recorded rejection
 *     means a webhook was refused, not that anything was recovered.
 *   - A fulfilled order is NOT delivered. See docs/carrier-readiness.md.
 *
 * QUERY SHAPE. Every figure below comes from an aggregate — groupBy,
 * count, or a SUM in SQL. Nothing loads a tenant's rows to count them in
 * JavaScript, which is the one thing that would make this page degrade
 * as a tenant grows. The number of queries is fixed; it does not scale
 * with orders, products, customers or the width of the date range.
 *
 * SCOPING. Every query here states `tenantId` explicitly, and this
 * module deliberately does NOT use getScopedDb(). That is not a
 * departure from the codebase's convention — it is what the convention
 * actually requires for these operations:
 *
 *   - `scopeArgsForOperation()` handles find/count/create/update/delete.
 *     It has NO `groupBy` case, so a groupBy falls through its `default`
 *     and is returned UNCHANGED. The extension's own doc comment says
 *     so: "aggregate/groupBy are not covered yet". Most figures on this
 *     page are groupBys.
 *   - `payment`, `customer`, `paymentRejection` and `order` are not in
 *     the extension's model allowlist at all.
 *   - Raw SQL bypasses the extension entirely, by design.
 *
 * Relying on `getScopedDb()` here would therefore mean relying on a
 * mechanism that does not apply to the operations being used, while
 * reading as though it did. One explicit rule for the whole module is
 * safer than per-call reasoning about which half is covered.
 */

export type StatusCount = { key: string; count: number };

export type OperationalMetrics = {
  /** Date-scoped: orders created within [start, end). */
  ordersByStatus: StatusCount[];
  ordersTotal: number;
  /**
   * Items plus shipping, for orders in range that are NOT cancelled.
   * The same definition getTenantKpis() and customer-queries.ts use,
   * reused rather than re-decided. Never called revenue.
   */
  orderValue: number;
  /** Orders counted in `orderValue` — its denominator, so the average is explicable. */
  orderValueOrderCount: number;
  /** Date-scoped: payments whose own createdAt falls within the range. */
  paymentsByStatus: StatusCount[];
  paymentsTotal: number;
  /**
   * Date-scoped, tenant-attributed rejections only. Distinct rejections
   * FIRST SEEN in the range, not provider retry attempts.
   */
  rejectionsByReason: StatusCount[];
  rejectionsTotal: number;
  /** Date-scoped: customers first stored in the range. */
  customersCreated: number;

  /** Point-in-time, NOT date-scoped. Counted as of now. */
  snapshot: {
    customersTotal: number;
    customersWithOrders: number;
    /** Customers with at least two stored orders. A count, not a segment. */
    customersWithRepeatOrders: number;
    activeProducts: number;
    draftProducts: number;
    activeVariants: number;
    /** onHand - reserved <= 0 */
    variantsOutOfStock: number;
    /** 0 < onHand - reserved <= LOW_STOCK_THRESHOLD */
    variantsLowStock: number;
    lowStockThreshold: number;
    onHandUnits: number;
    reservedUnits: number;
  };
};

/** Every order status, so a status with no orders still shows as zero. */
const ORDER_STATUSES = ['pending', 'fulfilled', 'cancelled'] as const;
const PAYMENT_STATUSES = ['pending', 'succeeded', 'failed', 'expired', 'cancelled'] as const;
// Exactly the three values PaymentRejectionReason declares. Not a
// superset: a reason this schema cannot record must not appear as a
// permanent zero, which would imply the system watches for it.
const REJECTION_REASONS = ['amount_mismatch', 'unknown_payment', 'invalid_payload'] as const;

/** Fills in the zero rows, so the UI never has to decide what absence means. */
function withZeroes(known: readonly string[], rows: Map<string, number>): StatusCount[] {
  return known.map((key) => ({ key, count: rows.get(key) ?? 0 }));
}

export async function getOperationalMetrics(
  tenantId: string,
  range: AnalyticsRange,
): Promise<OperationalMetrics> {
  const createdInRange = { gte: range.start, lt: range.end };

  const [
    orderGroups,
    valueRows,
    paymentGroups,
    rejectionGroups,
    customersCreated,
    customersTotal,
    customerOrderRows,
    activeProducts,
    draftProducts,
    activeVariants,
    inventoryRows,
  ] = await Promise.all([
    prisma.order.groupBy({
      by: ['status'],
      where: { tenantId, createdAt: createdInRange },
      _count: { _all: true },
    }),

    // A line total is price × quantity, which Prisma's aggregate API
    // cannot express, so this is the one raw aggregate. It returns a
    // SINGLE row regardless of how many orders are in range — the sum
    // happens in Postgres, never in JavaScript.
    //
    // The join is on (orderId, tenantId) so an item can only ever
    // contribute to an order of the same tenant, matching the composite
    // foreign key the schema already enforces.
    prisma.$queryRawUnsafe<{ total: bigint | null; orders: bigint }[]>(
      `SELECT COALESCE(SUM(o."shippingAmount" + o.items_total), 0) AS total,
              COUNT(*)                                            AS orders
       FROM (
         SELECT o.id,
                o."shippingAmount",
                COALESCE(SUM(i.price * i.quantity), 0) AS items_total
         FROM orders o
         LEFT JOIN order_items i
                ON i."orderId" = o.id AND i."tenantId" = o."tenantId"
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

    prisma.payment.groupBy({
      by: ['status'],
      where: { tenantId, createdAt: createdInRange },
      _count: { _all: true },
    }),

    // Tenant-attributed rejections only. A rejection whose tenant could
    // not be resolved from the provider's correlation key carries a null
    // tenantId and is platform-level evidence; attributing it to whoever
    // is looking would be a guess. See payment-rejection.ts.
    //
    // Filtered on firstSeenAt, and counting ROWS rather than summing
    // `occurrences`. A rejection row is upserted: repeat deliveries of
    // the same refused webhook increment `occurrences` and move
    // `lastSeenAt` without creating a row. So this counts DISTINCT
    // rejections first seen in the range, which is the figure a merchant
    // can act on — not how many times a provider retried one of them.
    // (tenantId, firstSeenAt) is indexed.
    prisma.paymentRejection.groupBy({
      by: ['reason'],
      where: { tenantId, firstSeenAt: createdInRange },
      _count: { _all: true },
    }),

    prisma.customer.count({ where: { tenantId, createdAt: createdInRange } }),
    prisma.customer.count({ where: { tenantId } }),

    // One grouped row per distinct order-count, not one per customer:
    // the result is bounded by how many DIFFERENT order counts exist,
    // which is tiny, rather than by the customer table. That is what
    // lets "has orders" and "has at least two" both be answered without
    // loading customers.
    prisma.$queryRawUnsafe<{ orders: bigint; customers: bigint }[]>(
      `SELECT orders, COUNT(*) AS customers
       FROM (
         SELECT "customerId", COUNT(*) AS orders
         FROM orders
         WHERE "tenantId" = $1
         GROUP BY "customerId"
       ) per_customer
       GROUP BY orders`,
      tenantId,
    ),

    prisma.product.count({ where: { tenantId, status: 'active' } }),
    prisma.product.count({ where: { tenantId, status: 'draft' } }),
    prisma.productVariant.count({ where: { tenantId, status: 'active' } }),

    // Inventory reduced to four numbers in SQL. getTenantKpis() loads
    // every inventory row for the tenant and filters in JavaScript;
    // this deliberately does not, because that pattern is the one this
    // page must not repeat.
    prisma.$queryRawUnsafe<
      {
        out_of_stock: bigint;
        low_stock: bigint;
        on_hand: bigint | null;
        reserved: bigint | null;
      }[]
    >(
      `SELECT COUNT(*) FILTER (WHERE "onHand" - reserved <= 0)              AS out_of_stock,
              COUNT(*) FILTER (WHERE "onHand" - reserved > 0
                                 AND "onHand" - reserved <= $2)             AS low_stock,
              COALESCE(SUM("onHand"), 0)                                    AS on_hand,
              COALESCE(SUM(reserved), 0)                                    AS reserved
       FROM inventory
       WHERE "tenantId" = $1`,
      tenantId,
      LOW_STOCK_THRESHOLD,
    ),
  ]);

  const orderCounts = new Map(orderGroups.map((g) => [String(g.status), g._count._all]));
  const paymentCounts = new Map(paymentGroups.map((g) => [String(g.status), g._count._all]));
  const rejectionCounts = new Map(rejectionGroups.map((g) => [String(g.reason), g._count._all]));

  const ordersByStatus = withZeroes(ORDER_STATUSES, orderCounts);
  const paymentsByStatus = withZeroes(PAYMENT_STATUSES, paymentCounts);
  const rejectionsByReason = withZeroes(REJECTION_REASONS, rejectionCounts);

  // Summing a handful of status buckets is not row-by-row aggregation:
  // these arrays have a fixed length set by the enums above.
  const sum = (rows: StatusCount[]) => rows.reduce((total, row) => total + row.count, 0);

  // At most a few dozen rows — one per distinct order count in the
  // tenant — so this is bounded by the enum-like shape of the data, not
  // by the customer table.
  let customersWithOrders = 0;
  let customersWithRepeatOrders = 0;
  for (const row of customerOrderRows) {
    const orders = Number(row.orders);
    const customers = Number(row.customers);
    if (orders >= 1) customersWithOrders += customers;
    if (orders >= 2) customersWithRepeatOrders += customers;
  }

  const inventory = inventoryRows[0];

  return {
    ordersByStatus,
    ordersTotal: sum(ordersByStatus),
    orderValue: Number(valueRows[0]?.total ?? 0),
    orderValueOrderCount: Number(valueRows[0]?.orders ?? 0),
    paymentsByStatus,
    paymentsTotal: sum(paymentsByStatus),
    rejectionsByReason,
    rejectionsTotal: sum(rejectionsByReason),
    customersCreated,
    snapshot: {
      customersTotal,
      customersWithOrders,
      customersWithRepeatOrders,
      activeProducts,
      draftProducts,
      activeVariants,
      variantsOutOfStock: Number(inventory?.out_of_stock ?? 0),
      variantsLowStock: Number(inventory?.low_stock ?? 0),
      lowStockThreshold: LOW_STOCK_THRESHOLD,
      onHandUnits: Number(inventory?.on_hand ?? 0),
      reservedUnits: Number(inventory?.reserved ?? 0),
    },
  };
}
