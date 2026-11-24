import { getScopedDb } from "../db/tenant-db";
import { buildOrderNotificationMessage, sendTelegramMessage } from "./telegram";

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
  customerName: string;
  paymentMethod: string;
  itemCount: number;
  totalAmount: number;
  /** Absolute origin of the request that created this order, for the "view order" link. Null when unresolvable. */
  origin: string | null;
};

/**
 * Fires a Telegram alert for a newly-created order, if (and only if) this
 * tenant has configured telegramBotToken + telegramChatId in Branding.
 * Never throws — a misconfigured or unreachable Telegram integration must
 * never fail the order it's reporting on. Callers should invoke this
 * fire-and-forget (`void notifyNewOrder(...).catch(...)`) AFTER the order
 * transaction has committed, never from inside it: this makes an outbound
 * network call, which has no place inside a database transaction.
 */
export async function notifyNewOrder(input: NewOrderNotificationInput): Promise<void> {
  try {
    const branding = await getScopedDb(input.tenantId).branding.findUnique({
      where: { tenantId: input.tenantId },
      select: { storeName: true, telegramBotToken: true, telegramChatId: true },
    });
    if (!branding?.telegramBotToken || !branding?.telegramChatId) {
      return;
    }

    const message = buildOrderNotificationMessage({
      storeName: branding.storeName ?? "Cửa hàng",
      orderReference: `#${input.orderId.slice(0, 8).toUpperCase()}`,
      totalDisplay: `${input.totalAmount.toLocaleString("vi-VN")} ₫`,
      customerName: input.customerName,
      paymentMethodLabel: PAYMENT_METHOD_LABELS[input.paymentMethod] ?? input.paymentMethod,
      itemCount: input.itemCount,
      adminOrderUrl: input.origin ? `${input.origin}/tenant-admin/orders/${input.orderId}` : null,
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
