import { prisma } from '../prisma';
import { ANALYTICS_UTC_OFFSET_HOURS, type AnalyticsRange } from './date-range';

/**
 * Orders and order value per day, for the Overview trend.
 *
 * WHY A SEPARATE QUERY. operational-metrics.ts answers "how much, in
 * total, over this range". This answers "which way is it moving", which
 * needs one row per day rather than one row per range. Bolting a day
 * dimension onto the totals query would make every tile pay for a
 * grouping only the chart uses.
 *
 * BUCKETING. `createdAt` is `timestamp without time zone` holding a UTC
 * instant, so a day boundary is applied by shifting into the analytics
 * timezone before truncating — the same fixed Asia/Ho_Chi_Minh offset
 * date-range.ts uses, imported rather than repeated. Nothing here reads
 * the session timezone, so the buckets do not change with whatever
 * connection the query runs on.
 *
 * BOUNDED. One row per day that actually has orders, so at most as many
 * rows as the range has days, and the range is capped at 366. The series
 * returned is filled to every day in the range so the chart has no gaps
 * to guess at.
 *
 * Order value follows the definition the rest of the codebase shares:
 * items plus shipping, cancelled orders excluded. It is not revenue.
 */

export type TrendPoint = {
  /** `YYYY-MM-DD` in the analytics timezone. */
  date: string;
  /** Orders created that day, cancelled ones included. */
  orders: number;
  /** Items + shipping for that day's non-cancelled orders. */
  orderValue: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function getDailyOrderTrend(
  tenantId: string,
  range: AnalyticsRange,
): Promise<TrendPoint[]> {
  const rows = await prisma.$queryRawUnsafe<
    { day: string; orders: bigint; value: bigint | null }[]
  >(
    `SELECT to_char(date_trunc('day', o."createdAt" + make_interval(hours => $4)), 'YYYY-MM-DD') AS day,
            COUNT(*)                                                               AS orders,
            COALESCE(SUM(CASE WHEN o.status <> 'cancelled' THEN o.total ELSE 0 END), 0) AS value
     FROM (
       SELECT o.id,
              o."createdAt",
              o.status,
              o."shippingAmount" + COALESCE(SUM(i.price * i.quantity), 0) AS total
       FROM orders o
       LEFT JOIN order_items i ON i."orderId" = o.id AND i."tenantId" = o."tenantId"
       WHERE o."tenantId" = $1
         AND o."createdAt" >= $2
         AND o."createdAt" <  $3
       GROUP BY o.id
     ) o
     GROUP BY 1
     ORDER BY 1`,
    tenantId,
    range.start,
    range.end,
    ANALYTICS_UTC_OFFSET_HOURS,
  );

  const byDay = new Map(
    rows.map((row) => [
      row.day,
      { orders: Number(row.orders), orderValue: Number(row.value ?? 0) },
    ]),
  );

  // Fill every day in the range. A chart that silently skips empty days
  // compresses a quiet week into a point and overstates the trend.
  const series: TrendPoint[] = [];
  for (let offset = 0; offset < range.days; offset += 1) {
    const dayStart = new Date(range.start.getTime() + offset * MS_PER_DAY);
    const shifted = new Date(dayStart.getTime() + ANALYTICS_UTC_OFFSET_HOURS * 60 * 60 * 1000);
    const date = shifted.toISOString().slice(0, 10);
    const found = byDay.get(date);
    series.push({ date, orders: found?.orders ?? 0, orderValue: found?.orderValue ?? 0 });
  }
  return series;
}
