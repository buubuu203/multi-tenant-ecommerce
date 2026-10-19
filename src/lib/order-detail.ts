import { prisma } from './prisma';
import { getOrderTimeline, type OrderTimelineEntry } from './order-events';

/**
 * One order, everything an operator needs on a page of its own.
 *
 * SEPARATE FROM order-print.ts ON PURPOSE. PrintableOrder is deliberately
 * minimal — it feeds three paper documents whose whole discipline is
 * showing nothing that cannot be backed by stored data, and tests pin
 * that shape. The detail page needs things paper does not: product ids
 * to link into the catalog, and the audit timeline. Widening
 * PrintableOrder would push both onto the printed page, so this is its
 * own read model using the same arithmetic.
 *
 * Totals follow the one definition the rest of the codebase already
 * shares: line total is the SNAPSHOT price × quantity, and the order
 * total adds the snapshot shipping amount. Nothing is recomputed from
 * the live catalog, so a later price change cannot rewrite history.
 *
 * NOT CLAIMED HERE, because the application cannot observe it: delivery,
 * carrier, tracking, refund, return, or that any money settled. A
 * succeeded payment means this system accepted a provider confirmation.
 */

export type OrderDetailLine = {
  /** For the catalog link. The variant's product, not the variant. */
  productId: string;
  productName: string;
  /** "Màu sắc: Đen", or null for a simple product. */
  combinationLabel: string | null;
  sku: string | null;
  quantity: number;
  /** Snapshot unit price actually charged, discounts already applied. */
  unitPrice: number;
  lineTotal: number;
};

export type OrderDetail = {
  id: string;
  placedAt: Date;
  updatedAt: Date;
  status: string;
  paymentMethod: string;
  payment: {
    status: string;
    provider: string;
    amount: number;
    failureReason: string | null;
    expiresAt: Date | null;
  } | null;
  customer: {
    id: string;
    name: string;
    email: string;
    phone: string;
  };
  shipping: {
    address: string;
    ward: string;
    district: string;
    city: string;
    note: string | null;
    methodName: string | null;
    amount: number;
  };
  items: OrderDetailLine[];
  totals: { subtotal: number; shipping: number; total: number; currency: 'VND' };
  totalUnits: number;
  timeline: OrderTimelineEntry[];
};

/**
 * Scoped by tenantId AND orderId together, so another tenant's order id
 * returns null exactly as an unknown id does — the caller cannot tell the
 * two apart. The same posture getOrderForCustomer() and getOrderTimeline()
 * already take.
 *
 * `order` is not in getScopedDb()'s allowlist, so tenantId is explicit
 * here — the rule order-queries.ts already follows.
 */
export async function getOrderDetail(
  tenantId: string,
  orderId: string,
): Promise<OrderDetail | null> {
  if (!tenantId.trim() || !orderId.trim()) return null;

  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      status: true,
      paymentMethod: true,
      shippingAddress: true,
      shippingWard: true,
      shippingDistrict: true,
      shippingCity: true,
      shippingNote: true,
      shippingMethodName: true,
      shippingAmount: true,
      customer: { select: { id: true, name: true, email: true, phone: true } },
      payment: {
        select: {
          status: true,
          provider: true,
          amount: true,
          failureReason: true,
          expiresAt: true,
        },
      },
      items: {
        select: {
          quantity: true,
          price: true,
          productVariant: {
            select: {
              sku: true,
              productId: true,
              product: { select: { name: true } },
              // Ids only, then resolved through the lookup maps below —
              // the same two-step order-print.ts uses, because the
              // nested relation is not selectable in this client.
              optionValues: { select: { variantOptionId: true, variantOptionValueId: true } },
            },
          },
        },
      },
    },
  });

  if (!order) return null;

  // Option labels, tenant-scoped like every other read here.
  const [options, values] = await Promise.all([
    prisma.variantOption.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    prisma.variantOptionValue.findMany({ where: { tenantId }, select: { id: true, value: true } }),
  ]);
  const optionNameById = new Map(options.map((option) => [option.id, option.name]));
  const valueLabelById = new Map(values.map((value) => [value.id, value.value]));

  const items: OrderDetailLine[] = order.items.map((item) => {
    const parts = item.productVariant.optionValues
      .map((link) => {
        const name = optionNameById.get(link.variantOptionId);
        const value = valueLabelById.get(link.variantOptionValueId);
        return name && value ? `${name}: ${value}` : null;
      })
      .filter((part): part is string => part !== null);
    return {
      productId: item.productVariant.productId,
      productName: item.productVariant.product.name,
      combinationLabel: parts.length > 0 ? parts.join(' / ') : null,
      sku: item.productVariant.sku,
      quantity: item.quantity,
      unitPrice: item.price,
      lineTotal: item.price * item.quantity,
    };
  });

  const subtotal = items.reduce((sum, line) => sum + line.lineTotal, 0);

  return {
    id: order.id,
    placedAt: order.createdAt,
    updatedAt: order.updatedAt,
    status: order.status,
    paymentMethod: order.paymentMethod,
    payment: order.payment,
    customer: order.customer,
    shipping: {
      address: order.shippingAddress,
      ward: order.shippingWard,
      district: order.shippingDistrict,
      city: order.shippingCity,
      note: order.shippingNote,
      methodName: order.shippingMethodName,
      amount: order.shippingAmount,
    },
    items,
    totals: {
      subtotal,
      shipping: order.shippingAmount,
      total: subtotal + order.shippingAmount,
      currency: 'VND',
    },
    totalUnits: items.reduce((sum, line) => sum + line.quantity, 0),
    timeline: await getOrderTimeline(tenantId, order.id),
  };
}
