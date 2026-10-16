import { prisma } from './prisma';
import { getScopedDb } from './db/tenant-db';
import { normalizedPhoneVariants } from './validation/phone';

/**
 * Tenant-scoped customer operations.
 *
 * Everything here is derived from orders that already exist. No metric is
 * invented, and two definitions are stated once so the UI, the export and
 * the tests cannot drift:
 *
 *   orderCount — EVERY order the customer has placed, cancelled ones
 *                included. It answers "how often has this person ordered",
 *                which cancellations are part of.
 *
 *   orderValue — items plus shipping, for orders NOT cancelled. This is
 *                the same rule getTenantKpis() already uses for its
 *                order-value figure, reused rather than re-decided. It is
 *                NOT revenue: it includes orders nobody has paid for yet,
 *                and this system never observes a payment settling.
 *
 * IDENTITY. Customer is unique on (tenantId, email), so a repeat buyer
 * using the same email reuses one row. Two rows can therefore share a
 * phone number while differing by email. They are shown separately and
 * flagged, never merged — merging is out of scope and would rewrite
 * history.
 *
 * NOT DERIVABLE, and therefore absent rather than guessed: delivery
 * confirmation, returns, refunds, COD settlement, marketing consent, and
 * any notion of a VIP or verified customer. None of those exists in the
 * schema.
 */

export const CUSTOMER_PAGE_SIZE = 25;

export type CustomerListRow = {
  /** Route key and list key. Already the admin-side identifier. */
  id: string;
  name: string;
  phone: string;
  email: string;
  /** All orders, cancelled included. */
  orderCount: number;
  /** Cancelled orders, shown so orderValue's exclusion is explicable. */
  cancelledCount: number;
  /** Items + shipping, excluding cancelled orders. Never called revenue. */
  orderValue: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  /** Status of the most recent order, or null when there are none. */
  latestOrderStatus: string | null;
  latestPaymentStatus: string | null;
  /**
   * True when another customer row in this tenant stores an equivalent
   * phone number. Deterministic — exact match after the same
   * normalisation order lookup uses. A flag only; nothing is merged.
   */
  possibleDuplicatePhone: boolean;
};

/**
 * Sort modes. A closed set, and the ONLY values that ever reach SQL — the
 * ORDER BY clause is chosen from this map by key, never built from input.
 */
export const CUSTOMER_SORTS = ['newest', 'last_order', 'order_count', 'order_value'] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

export const DEFAULT_CUSTOMER_SORT: CustomerSort = 'newest';

export function isCustomerSort(value: string | undefined): value is CustomerSort {
  return typeof value === 'string' && (CUSTOMER_SORTS as readonly string[]).includes(value);
}

export const CUSTOMER_SORT_LABEL: Record<CustomerSort, string> = {
  newest: 'Newest customers',
  last_order: 'Last order',
  order_count: 'Order count',
  order_value: 'Order value',
};

/**
 * The ORDER BY for each mode. Every one ends in `c.id DESC`, so a page is
 * reproducible even when the leading key ties.
 *
 * last_order uses NULLS LAST explicitly: PostgreSQL defaults a DESC sort
 * to NULLS FIRST, which would put customers who have never ordered at the
 * top of a "last order" list — the opposite of what it means.
 */
const ORDER_BY: Record<CustomerSort, string> = {
  newest: 'c."createdAt" DESC, c.id DESC',
  last_order: 'agg.last_order_at DESC NULLS LAST, c.id DESC',
  order_count: 'COALESCE(agg.order_count, 0) DESC, c.id DESC',
  order_value: 'COALESCE(agg.order_value, 0) DESC, c.id DESC',
};

export type CustomerFilters = {
  search?: string;
  page?: number;
  sort?: CustomerSort;
};

type OrderFacts = {
  orderCount: number;
  cancelledCount: number;
  orderValue: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  latestOrderStatus: string | null;
  latestPaymentStatus: string | null;
};

const EMPTY_FACTS: OrderFacts = {
  orderCount: 0,
  cancelledCount: 0,
  orderValue: 0,
  firstOrderAt: null,
  lastOrderAt: null,
  latestOrderStatus: null,
  latestPaymentStatus: null,
};

/**
 * Builds the search predicate.
 *
 * Phone uses the project's existing normalisation, so `0912…` and
 * `+84912…` find the same person exactly as order lookup already does.
 * Stored values are never rewritten. Name and email use `contains`,
 * which is what the admin orders search already does; nothing fuzzy.
 */
function searchWhere(search: string) {
  const phoneVariants = normalizedPhoneVariants(search);
  return {
    OR: [
      { name: { contains: search, mode: 'insensitive' as const } },
      { email: { contains: search, mode: 'insensitive' as const } },
      ...(phoneVariants.length > 0
        ? [{ phone: { in: phoneVariants } }]
        : [{ phone: { contains: search } }]),
    ],
  };
}

/**
 * Selects ONE PAGE of customer ids, already ordered.
 *
 * Why raw SQL: ordering by order value means summing
 * `price × quantity` across each customer's order items and excluding
 * cancelled orders. Prisma can order by a relation's `_count`, but not by
 * a computed sum over a nested relation, so the aggregate has to happen
 * in the database — doing it in JavaScript would mean loading every
 * customer in the tenant before paging, which is exactly what must not
 * happen.
 *
 * Safety, since this bypasses the Prisma tenant-scope extension (that
 * extension hooks model operations, not raw queries — the same reason
 * inventory-mutations states its tenantId explicitly):
 *
 *   - `c."tenantId" = $1` is always present, with the trusted tenantId
 *     from requireTenantAdmin(), so the result can only ever be this
 *     tenant's customers.
 *   - Every user-supplied value — search text, phone variants, limit,
 *     offset — is a bound parameter. None is interpolated.
 *   - The only interpolated fragment is the ORDER BY, and it is looked up
 *     from ORDER_BY by a key already narrowed to the CustomerSort union.
 *     An unknown sort cannot reach here; callers resolve it to the
 *     default first.
 */
async function orderedCustomerIds(
  tenantId: string,
  sort: CustomerSort,
  search: string | undefined,
  limit: number,
  offset: number,
): Promise<string[]> {
  const params: unknown[] = [tenantId];
  let searchClause = '';

  if (search) {
    const phoneVariants = normalizedPhoneVariants(search);
    params.push(`%${search}%`);
    const likeParam = `$${params.length}`;
    if (phoneVariants.length > 0) {
      params.push(phoneVariants);
      searchClause = `AND (c.name ILIKE ${likeParam} OR c.email ILIKE ${likeParam} OR c.phone = ANY($${params.length}))`;
    } else {
      params.push(`%${search}%`);
      searchClause = `AND (c.name ILIKE ${likeParam} OR c.email ILIKE ${likeParam} OR c.phone LIKE $${params.length})`;
    }
  }

  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const sql = `
    WITH order_totals AS (
      SELECT o.id,
             o."customerId",
             o.status::text AS status,
             o."createdAt",
             o."shippingAmount" + COALESCE(SUM(i.price * i.quantity), 0) AS total
      FROM orders o
      LEFT JOIN order_items i ON i."orderId" = o.id AND i."tenantId" = o."tenantId"
      WHERE o."tenantId" = $1
      GROUP BY o.id
    ),
    agg AS (
      SELECT "customerId",
             COUNT(*) AS order_count,
             MAX("createdAt") AS last_order_at,
             COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN total ELSE 0 END), 0) AS order_value
      FROM order_totals
      GROUP BY "customerId"
    )
    SELECT c.id
    FROM customers c
    LEFT JOIN agg ON agg."customerId" = c.id
    WHERE c."tenantId" = $1 ${searchClause}
    ORDER BY ${ORDER_BY[sort]}
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `;

  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(sql, ...params);
  return rows.map((row) => row.id);
}

/**
 * One page of customers with their order facts.
 *
 * Three queries regardless of page size: the customers, their count, and
 * one orders query scoped to exactly the page's customer ids. No per-row
 * follow-up, so no N+1.
 *
 * Ordering is (createdAt desc, id desc) — newest customer first, with id
 * breaking ties so pagination is stable. Sorting by last-order date is
 * deliberately not offered: it would need an aggregate across every
 * customer in the tenant before paging, and v1 keeps the query bounded.
 */
export async function listCustomers(
  tenantId: string,
  filters: CustomerFilters = {},
): Promise<{ rows: CustomerListRow[]; totalCount: number }> {
  const db = getScopedDb(tenantId);
  const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
  const search = filters.search?.trim();

  // Validated HERE, not only by the page. A library function must not
  // depend on its caller having checked: an unvalidated value would make
  // ORDER_BY[sort] undefined and splice "undefined" into the SQL.
  const sort = isCustomerSort(filters.sort) ? filters.sort : DEFAULT_CUSTOMER_SORT;
  const where = { tenantId, ...(search ? searchWhere(search) : {}) };

  // The ordering and the page are decided in the database, so sorting by
  // an order metric never means loading the tenant's whole customer list.
  // The count is of the filtered SET, not the page.
  const [customerIds, totalCount] = await Promise.all([
    orderedCustomerIds(tenantId, sort, search, CUSTOMER_PAGE_SIZE, (page - 1) * CUSTOMER_PAGE_SIZE),
    db.customer.count({ where }),
  ]);

  if (customerIds.length === 0) return { rows: [], totalCount };

  const unordered = await db.customer.findMany({
    where: { tenantId, id: { in: customerIds } },
    select: { id: true, name: true, phone: true, email: true },
  });
  // findMany does not preserve the `in` order, so restore the order the
  // database chose. Anything missing is dropped rather than guessed.
  const byId = new Map(unordered.map((customer) => [customer.id, customer]));
  const customers = customerIds
    .map((id) => byId.get(id))
    .filter((customer): customer is (typeof unordered)[number] => customer !== undefined);
  const orders = await db.order.findMany({
    where: { tenantId, customerId: { in: customerIds } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      customerId: true,
      status: true,
      shippingAmount: true,
      createdAt: true,
      payment: { select: { status: true } },
      items: { select: { price: true, quantity: true } },
    },
  });

  const factsByCustomer = new Map<string, OrderFacts>();
  for (const order of orders) {
    const current = factsByCustomer.get(order.customerId) ?? { ...EMPTY_FACTS };

    current.orderCount += 1;
    if (order.status === 'cancelled') {
      current.cancelledCount += 1;
    } else {
      const items = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      current.orderValue += items + order.shippingAmount;
    }

    // Orders arrive newest-first, so the first one seen is the latest.
    if (current.lastOrderAt === null) {
      current.lastOrderAt = order.createdAt;
      current.latestOrderStatus = order.status;
      current.latestPaymentStatus = order.payment?.status ?? null;
    }
    current.firstOrderAt = order.createdAt;

    factsByCustomer.set(order.customerId, current);
  }

  // Duplicate detection: exact phone equality after the same
  // normalisation search uses. Scoped to this tenant, and a flag only.
  const phoneCounts = await db.customer.groupBy({
    by: ['phone'],
    where: { tenantId, phone: { in: customers.map((customer) => customer.phone) } },
    _count: { _all: true },
  });
  const duplicatePhones = new Set(
    phoneCounts.filter((group) => group._count._all > 1).map((group) => group.phone),
  );

  const rows: CustomerListRow[] = customers.map((customer) => ({
    ...customer,
    ...(factsByCustomer.get(customer.id) ?? EMPTY_FACTS),
    possibleDuplicatePhone: duplicatePhones.has(customer.phone),
  }));

  return { rows, totalCount };
}

export type CustomerOrderSummary = {
  reference: string;
  placedAt: Date;
  status: string;
  paymentMethod: string;
  paymentStatus: string | null;
  shippingMethodName: string | null;
  total: number;
  cancelled: boolean;
};

export type CustomerDetail = CustomerListRow & {
  orders: CustomerOrderSummary[];
};

/**
 * One customer and their order history, scoped to this tenant.
 *
 * Returns null for a customer that does not exist OR belongs to another
 * tenant — the same answer for both, so existence cannot be probed.
 */
export async function getCustomerDetail(
  tenantId: string,
  customerId: string,
): Promise<CustomerDetail | null> {
  if (!tenantId.trim() || !customerId.trim()) return null;

  const db = getScopedDb(tenantId);
  const customer = await db.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { id: true, name: true, phone: true, email: true },
  });
  if (!customer) return null;

  const orders = await db.order.findMany({
    where: { tenantId, customerId: customer.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      status: true,
      paymentMethod: true,
      shippingAmount: true,
      shippingMethodName: true,
      createdAt: true,
      payment: { select: { status: true } },
      items: { select: { price: true, quantity: true } },
    },
  });

  let orderValue = 0;
  let cancelledCount = 0;
  const history: CustomerOrderSummary[] = orders.map((order) => {
    const items = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const total = items + order.shippingAmount;
    const cancelled = order.status === 'cancelled';
    if (cancelled) cancelledCount += 1;
    else orderValue += total;
    return {
      reference: order.id,
      placedAt: order.createdAt,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.payment?.status ?? null,
      shippingMethodName: order.shippingMethodName,
      total,
      cancelled,
    };
  });

  const duplicates = await db.customer.count({
    where: { tenantId, phone: customer.phone },
  });

  return {
    ...customer,
    orderCount: orders.length,
    cancelledCount,
    orderValue,
    firstOrderAt: orders.length > 0 ? orders[orders.length - 1].createdAt : null,
    lastOrderAt: orders.length > 0 ? orders[0].createdAt : null,
    latestOrderStatus: orders.length > 0 ? orders[0].status : null,
    latestPaymentStatus: orders.length > 0 ? (orders[0].payment?.status ?? null) : null,
    possibleDuplicatePhone: duplicates > 1,
    orders: history,
  };
}
