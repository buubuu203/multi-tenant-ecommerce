import { getScopedDb } from './db/tenant-db';
import { formatCombination } from './order-queries';

/**
 * The read-only projection behind the Order Print Center.
 *
 * One tenant-scoped query, one explicit shape. Prisma rows never leave
 * this module: everything the documents render is copied field by field,
 * so nothing can leak by being incidentally present on an object.
 *
 * Deliberately ABSENT, and this is the point of a hand-written
 * projection rather than passing the row through:
 *
 *   - Payment.providerMetadata — raw provider/webhook payload;
 *   - Payment.providerOrderId / providerTransactionId / failureReason;
 *   - tenantId, customerId, productVariantId and every other internal id;
 *   - OrderEvent and its `sequence` ordering key;
 *   - row timestamps other than the order date.
 *
 * The order id IS included: it is already the customer-facing reference
 * (order lookup asks for it by that name), so it is not an internal id
 * being exposed here.
 */

export const PRINT_DOCUMENTS = ['order-summary', 'packing-slip', 'shipping-note'] as const;
export type PrintDocument = (typeof PRINT_DOCUMENTS)[number];

export function isPrintDocument(value: string | undefined): value is PrintDocument {
  return typeof value === 'string' && (PRINT_DOCUMENTS as readonly string[]).includes(value);
}

export const DOCUMENT_TITLE: Record<PrintDocument, string> = {
  'order-summary': 'Order summary',
  'packing-slip': 'Packing slip',
  'shipping-note': 'Shipping note',
};

export type PrintLineItem = {
  productName: string;
  /** "Color: Red / Size: S", or null for a simple product. */
  combinationLabel: string | null;
  /** The merchant's own SKU. Null when the variant has none. */
  sku: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type PrintableOrder = {
  /** Already customer-facing: this is what order lookup asks for. */
  reference: string;
  placedAt: Date;
  status: string;
  paymentMethod: string;
  /** Null for orders placed before every order got a Payment row. */
  paymentStatus: string | null;
  store: {
    name: string;
    logoUrl: string | null;
  };
  customer: { name: string; email: string; phone: string };
  shipping: {
    address: string;
    ward: string;
    district: string;
    city: string;
    note: string | null;
    methodName: string | null;
    amount: number;
  };
  items: PrintLineItem[];
  totals: {
    subtotal: number;
    shipping: number;
    total: number;
    /** No currency column exists; this market is VND-only. */
    currency: 'VND';
  };
  /** Sum of quantities, for the packing slip and the handoff note. */
  totalUnits: number;
  /**
   * The amount a courier collects on delivery, or null when this order is
   * not cash on delivery. Derived from the order's own payment method and
   * totals — never invented, and never shown for a prepaid order.
   */
  codAmount: number | null;
};

/**
 * Loads one order for printing, scoped to the calling tenant.
 *
 * Returns null for an order that does not exist OR belongs to another
 * tenant — the same answer for both, so a tenant cannot probe for the
 * existence of another tenant's order id. Read-only: no write, and no
 * audit event, because viewing a document is not an order event.
 */
export async function getOrderForPrint(
  tenantId: string,
  orderId: string,
): Promise<PrintableOrder | null> {
  if (!tenantId.trim() || !orderId.trim()) return null;

  const db = getScopedDb(tenantId);

  const order = await db.order.findFirst({
    where: { id: orderId, tenantId },
    select: {
      id: true,
      status: true,
      paymentMethod: true,
      shippingAddress: true,
      shippingWard: true,
      shippingDistrict: true,
      shippingCity: true,
      shippingNote: true,
      shippingAmount: true,
      shippingMethodName: true,
      createdAt: true,
      customer: { select: { name: true, email: true, phone: true } },
      payment: { select: { status: true } },
      items: {
        select: {
          quantity: true,
          price: true,
          productVariant: {
            select: {
              sku: true,
              product: { select: { name: true } },
              optionValues: { select: { variantOptionId: true, variantOptionValueId: true } },
            },
          },
        },
      },
    },
  });

  if (!order) return null;

  // Option labels, scoped to this tenant like every other read here.
  const [options, values, branding] = await Promise.all([
    db.variantOption.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    db.variantOptionValue.findMany({ where: { tenantId }, select: { id: true, value: true } }),
    db.branding.findUnique({
      where: { tenantId },
      select: { storeName: true, logoUrl: true },
    }),
  ]);
  const optionNameById = new Map(options.map((option) => [option.id, option.name]));
  const valueLabelById = new Map(values.map((value) => [value.id, value.value]));

  const items: PrintLineItem[] = order.items.map((item) => ({
    productName: item.productVariant.product.name,
    combinationLabel: formatCombination(
      item.productVariant.optionValues,
      optionNameById,
      valueLabelById,
    ),
    sku: item.productVariant.sku,
    quantity: item.quantity,
    unitPrice: item.price,
    lineTotal: item.price * item.quantity,
  }));

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const shipping = order.shippingAmount;
  const total = subtotal + shipping;

  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true },
  });

  return {
    reference: order.id,
    placedAt: order.createdAt,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.payment?.status ?? null,
    store: {
      // Branding's store name wins; the tenant's own name is the fallback,
      // so a document always has a heading even with no branding set.
      name: branding?.storeName?.trim() || tenant?.name || 'Store',
      logoUrl: branding?.logoUrl ?? null,
    },
    customer: order.customer,
    shipping: {
      address: order.shippingAddress,
      ward: order.shippingWard,
      district: order.shippingDistrict,
      city: order.shippingCity,
      note: order.shippingNote,
      methodName: order.shippingMethodName,
      amount: shipping,
    },
    items,
    totals: { subtotal, shipping, total, currency: 'VND' },
    totalUnits: items.reduce((sum, item) => sum + item.quantity, 0),
    // Only COD collects on delivery. Anything else is already paid for, or
    // settled by transfer, so printing an amount to collect would be wrong.
    codAmount: order.paymentMethod === 'cod' ? total : null,
  };
}

/** One line, in the order a Vietnamese address is normally written. */
export function formatAddress(shipping: PrintableOrder['shipping']): string {
  return [shipping.address, shipping.ward, shipping.district, shipping.city]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(', ');
}
