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

export type CustomerFilters = {
  search?: string;
  page?: number;
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

  const where = { tenantId, ...(search ? searchWhere(search) : {}) };

  const [customers, totalCount] = await Promise.all([
    db.customer.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * CUSTOMER_PAGE_SIZE,
      take: CUSTOMER_PAGE_SIZE,
      select: { id: true, name: true, phone: true, email: true },
    }),
    db.customer.count({ where }),
  ]);

  if (customers.length === 0) return { rows: [], totalCount };

  const customerIds = customers.map((customer) => customer.id);
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
