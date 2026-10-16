import { prisma } from './prisma';
import { getScopedDb } from './db/tenant-db';

/**
 * The fulfillment workspace: which orders need attention, derived from
 * facts the database already holds.
 *
 * THIS IS AN INTERNAL OPERATIONAL QUEUE, NOT A SHIPMENT SYSTEM. There is
 * no shipment model, no carrier integration and no tracking column in
 * this schema, so nothing here reports pickup, transit, delivery,
 * failed delivery, returns, refunds, COD collection or settlement. The
 * application's own vocabulary is kept: an order is pending, fulfilled or
 * cancelled, and "fulfilled" is never renamed to shipped or delivered.
 *
 * INVENTORY IS DELIBERATELY NOT A BLOCKER. createOrder() reserves stock
 * inside the order's own transaction (order-mutations.ts), so an existing
 * order's units are already held. Re-checking availability would either
 * repeat a guarantee the reservation already gives, or — worse — report a
 * shortage for stock that is in fact reserved for this very order. It is
 * omitted because it would be misleading, not because it is expensive.
 */

export const FULFILLMENT_CATEGORIES = [
  'ready_to_fulfill',
  'needs_payment',
  'needs_review',
  'fulfilled',
  'cancelled',
] as const;
export type FulfillmentCategory = (typeof FULFILLMENT_CATEGORIES)[number];

export function isFulfillmentCategory(value: string | undefined): value is FulfillmentCategory {
  return typeof value === 'string' && (FULFILLMENT_CATEGORIES as readonly string[]).includes(value);
}

export const CATEGORY_LABEL: Record<FulfillmentCategory, string> = {
  ready_to_fulfill: 'Ready to prepare',
  needs_payment: 'Awaiting payment',
  needs_review: 'Needs review',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
};

/** Why an order cannot simply be prepared. Text, never colour alone. */
export type BlockerReason =
  'no_shipping_method' | 'payment_failed' | 'payment_expired' | 'payment_cancelled';

export const BLOCKER_LABEL: Record<BlockerReason, string> = {
  no_shipping_method: 'No shipping method recorded on this order',
  payment_failed: 'Payment failed',
  payment_expired: 'Payment window expired',
  payment_cancelled: 'Payment was cancelled',
};

export const BLOCKER_ACTION: Record<BlockerReason, string> = {
  no_shipping_method:
    'This order predates configurable shipping, or was placed without one. Confirm how it will be sent before preparing it.',
  payment_failed: 'Ask the customer to pay again, or cancel the order.',
  payment_expired: 'The provider window closed. Ask the customer to pay again, or cancel.',
  payment_cancelled: 'The payment was cancelled. Confirm with the customer before preparing.',
};

/** The inputs a classification needs — all stored columns. */
export type ClassifiableOrder = {
  orderStatus: string;
  paymentMethod: string;
  /** Null for orders placed before every order got a Payment row. */
  paymentStatus: string | null;
  hasShippingMethod: boolean;
};

const DEAD_PAYMENT: Record<string, BlockerReason> = {
  failed: 'payment_failed',
  expired: 'payment_expired',
  cancelled: 'payment_cancelled',
};

/**
 * The single source of truth for categorisation. Pure, so the queue, the
 * summary counts and the tests all run exactly the same rules.
 *
 * COD is the case worth stating: its payment row stays `pending` by
 * design, because cash is settled with the courier and this system never
 * records that. A pending COD payment is therefore NOT a payment blocker
 * and such an order can be ready to prepare. Treating it as awaiting
 * payment would park every COD order in the wrong bucket.
 */
export function classifyOrder(order: ClassifiableOrder): {
  category: FulfillmentCategory;
  blockers: BlockerReason[];
} {
  // The application's own terminal states win outright.
  if (order.orderStatus === 'cancelled') return { category: 'cancelled', blockers: [] };
  if (order.orderStatus === 'fulfilled') return { category: 'fulfilled', blockers: [] };

  const blockers: BlockerReason[] = [];

  if (!order.hasShippingMethod) blockers.push('no_shipping_method');

  const deadPayment = order.paymentStatus ? DEAD_PAYMENT[order.paymentStatus] : undefined;
  if (deadPayment) blockers.push(deadPayment);

  if (blockers.length > 0) return { category: 'needs_review', blockers };

  // Prepaid methods must actually be paid before preparing. COD must not.
  const paidOrCod = order.paymentMethod === 'cod' || order.paymentStatus === 'succeeded';
  if (!paidOrCod) return { category: 'needs_payment', blockers: [] };

  return { category: 'ready_to_fulfill', blockers: [] };
}

export const FULFILLMENT_PAGE_SIZE = 25;

export type FulfillmentRow = {
  /** Already the customer-facing reference. */
  reference: string;
  placedAt: Date;
  category: FulfillmentCategory;
  blockers: BlockerReason[];
  orderStatus: string;
  paymentMethod: string;
  paymentStatus: string | null;
  shippingMethodName: string | null;
  /** Coarse destination only — never the street address. */
  destination: string;
  customerName: string;
  customerPhone: string;
  /** Items + shipping, the same total every other surface computes. */
  total: number;
};

export type FulfillmentSummary = Record<FulfillmentCategory, number>;

export type FulfillmentFilters = {
  category?: FulfillmentCategory;
  search?: string;
  page?: number;
};

/**
 * Summary counts across the WHOLE tenant, not the page.
 *
 * One grouped query over the small set of distinct state combinations —
 * order status × payment method × payment status × whether a shipping
 * method was recorded — then the SAME classifier is applied to each
 * combination. That keeps one definition of a category instead of
 * re-expressing it as SQL predicates that could drift, and the row count
 * is bounded by the enums regardless of how many orders exist.
 */
export async function getFulfillmentSummary(tenantId: string): Promise<FulfillmentSummary> {
  const combos = await prisma.$queryRawUnsafe<
    {
      order_status: string;
      payment_method: string;
      payment_status: string | null;
      has_shipping: boolean;
      n: bigint;
    }[]
  >(
    `SELECT o.status::text        AS order_status,
            o."paymentMethod"::text AS payment_method,
            p.status::text        AS payment_status,
            (o."shippingMethodName" IS NOT NULL) AS has_shipping,
            COUNT(*)              AS n
     FROM orders o
     LEFT JOIN payments p ON p."orderId" = o.id AND p."tenantId" = o."tenantId"
     WHERE o."tenantId" = $1
     GROUP BY 1, 2, 3, 4`,
    tenantId,
  );

  const summary: FulfillmentSummary = {
    ready_to_fulfill: 0,
    needs_payment: 0,
    needs_review: 0,
    fulfilled: 0,
    cancelled: 0,
  };

  for (const combo of combos) {
    const { category } = classifyOrder({
      orderStatus: combo.order_status,
      paymentMethod: combo.payment_method,
      paymentStatus: combo.payment_status,
      hasShippingMethod: combo.has_shipping,
    });
    summary[category] += Number(combo.n);
  }

  return summary;
}

/**
 * One page of the queue.
 *
 * Ordering is the orders page's own (createdAt desc, id desc). Sorting
 * blockers to the top would mean re-expressing classifyOrder() as a SQL
 * CASE, and two copies of that rule would eventually disagree — the
 * category FILTER does that job instead, without the duplication.
 *
 * Category filtering is applied after classification, which is why the
 * page is fetched first and the authoritative counts come from
 * getFulfillmentSummary() rather than from this query.
 */
export async function listFulfillmentQueue(
  tenantId: string,
  filters: FulfillmentFilters = {},
): Promise<{ rows: FulfillmentRow[]; totalCount: number; summary: FulfillmentSummary }> {
  const db = getScopedDb(tenantId);
  const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
  const search = filters.search?.trim();

  const where = {
    tenantId,
    ...(search
      ? {
          OR: [
            { id: { contains: search, mode: 'insensitive' as const } },
            { customer: { phone: { contains: search } } },
            { customer: { name: { contains: search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };

  const [orders, totalCount, summary] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * FULFILLMENT_PAGE_SIZE,
      take: FULFILLMENT_PAGE_SIZE,
      select: {
        id: true,
        status: true,
        paymentMethod: true,
        shippingMethodName: true,
        shippingAmount: true,
        shippingDistrict: true,
        shippingCity: true,
        createdAt: true,
        customer: { select: { name: true, phone: true } },
        payment: { select: { status: true } },
        items: { select: { price: true, quantity: true } },
      },
    }),
    db.order.count({ where }),
    getFulfillmentSummary(tenantId),
  ]);

  const rows = orders
    .map((order): FulfillmentRow => {
      const { category, blockers } = classifyOrder({
        orderStatus: order.status,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.payment?.status ?? null,
        hasShippingMethod: order.shippingMethodName !== null,
      });
      const items = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      return {
        reference: order.id,
        placedAt: order.createdAt,
        category,
        blockers,
        orderStatus: order.status,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.payment?.status ?? null,
        shippingMethodName: order.shippingMethodName,
        // District and city only. The full street address belongs on the
        // packing slip, not in a list rendered at a glance.
        destination: [order.shippingDistrict, order.shippingCity]
          .map((part) => part.trim())
          .filter((part) => part !== '')
          .join(', '),
        customerName: order.customer.name,
        customerPhone: order.customer.phone,
        total: items + order.shippingAmount,
      };
    })
    .filter((row) => (filters.category ? row.category === filters.category : true));

  return { rows, totalCount, summary };
}
