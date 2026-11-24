import { getScopedDb } from "../db/tenant-db";
import { buildOrderNotificationMessage, sendTelegramMessage, type OrderItemLine } from "./telegram";

// Vietnamese labels for the payment methods PAYMENT_METHODS (order-mutations.ts)
// accepts — this module is backend-only (fires after an order is already
// committed), so it has no request/locale context to read a dictionary
// from; these mirror the vi dictionary's payment.* labels directly.
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cod: "Thanh toán khi nhận hàng",
  momo: "MoMo",
  bank_transfer: "Chuyển khoản ngân hàng",
};

export type NewOrderNotificationInput = {
  tenantId: string;
  orderId: string;
  /** Absolute origin of the request that created this order, for the "view order" link. Null when unresolvable. */
  origin: string | null;
};

function formatVnd(amount: number): string {
  return `${amount.toLocaleString("vi-VN")} ₫`;
}

/** Builds "Đỏ, L" from a variant's option values, or null for a plain single-variant product with none. */
function buildVariantLabel(
  optionValues: { variantOptionValueTenant: { value: string } }[],
): string | null {
  if (optionValues.length === 0) return null;
  return optionValues.map((ov) => ov.variantOptionValueTenant.value).join(", ");
}

/**
 * Fires a Telegram alert for a newly-created order, if (and only if) this
 * tenant has configured telegramBotToken + telegramChatId in Branding.
 * Never throws — a misconfigured or unreachable Telegram integration must
 * never fail the order it's reporting on. Callers should invoke this
 * fire-and-forget (`void notifyNewOrder(...).catch(...)`) AFTER the order
 * transaction has committed, never from inside it: this makes an outbound
 * network call, which has no place inside a database transaction.
 *
 * Reads the order back from the database rather than taking its details
 * as parameters — the order's own committed rows (shipping snapshot,
 * item prices, customer) are the authoritative record of what was
 * actually charged and where it ships, the same snapshots the admin UI
 * and any receipt would show, never the client's submitted cart again.
 */
export async function notifyNewOrder(input: NewOrderNotificationInput): Promise<void> {
  try {
    const db = getScopedDb(input.tenantId);
    const branding = await db.branding.findUnique({
      where: { tenantId: input.tenantId },
      select: { storeName: true, telegramBotToken: true, telegramChatId: true },
    });
    if (!branding?.telegramBotToken || !branding?.telegramChatId) {
      return;
    }

    const order = await db.order.findUnique({
      where: { id: input.orderId, tenantId: input.tenantId },
      include: {
        customer: { select: { name: true, phone: true } },
        items: {
          include: {
            productVariant: {
              include: {
                product: { select: { name: true } },
                optionValues: { include: { variantOptionValueTenant: { select: { value: true } } } },
              },
            },
          },
        },
      },
    });
    if (!order) return;

    const items: OrderItemLine[] = order.items.map((item) => ({
      productName: item.productVariant.product.name,
      variantLabel: buildVariantLabel(item.productVariant.optionValues),
      quantity: item.quantity,
      lineTotalDisplay: formatVnd(item.price * item.quantity),
    }));
    const subtotal = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const total = subtotal + order.shippingAmount - order.voucherDiscount;

    const message = buildOrderNotificationMessage({
      storeName: branding.storeName ?? "Cửa hàng",
      orderReference: `#${order.id.slice(0, 8).toUpperCase()}`,
      totalDisplay: formatVnd(total),
      customerName: order.customer.name,
      customerPhone: order.customer.phone,
      paymentMethodLabel: PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod,
      items,
      shippingMethodLabel: order.shippingMethodName,
      shippingAddressLine: [order.shippingAddress, order.shippingWard, order.shippingDistrict, order.shippingCity]
        .filter((part) => part.trim().length > 0)
        .join(", "),
      adminOrderUrl: input.origin ? `${input.origin}/tenant-admin/orders/${order.id}` : null,
      // NODE_ENV is "production" for every deployed build (including
      // Vercel preview deploys — only `next build` sets it, regardless of
      // target) and "development" for local `next dev`. That's exactly
      // the distinction a merchant testing locally with their real bot
      // needs; it is NOT a provider configuration (no new env var is
      // introduced), just a label on an already-built message.
      isTestEnvironment: process.env.NODE_ENV !== "production",
    });

    const result = await sendTelegramMessage(branding.telegramBotToken, branding.telegramChatId, message);
    if (!result.success) {
      console.error(`notifyNewOrder: Telegram send failed for tenant ${input.tenantId}: ${result.error}`);
    }
  } catch (e) {
    console.error("notifyNewOrder failed:", e);
  }
}
