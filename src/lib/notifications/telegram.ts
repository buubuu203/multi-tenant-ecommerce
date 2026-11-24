// New-order alerts via Telegram. Deliberately the cheapest reliable
// channel available: the Telegram Bot API is free with no tier/limit
// that matters at this app's volume (see 2026-11-24 research — Zalo's
// equivalent, ZNS, is paid per-message and gated behind Official Account
// approval; email needs a verified sending domain). A tenant opts in by
// creating a bot via @BotFather and pasting the token + their chat id
// into Branding (see branding-mutations.ts) — both null means the
// feature is simply off for that tenant, not an error state.

const TELEGRAM_API_BASE = "https://api.telegram.org";

export type TelegramSendResult = { success: true } | { success: false; error: string };

/**
 * Posts one message to a Telegram chat via the Bot API's sendMessage
 * endpoint. Pure I/O wrapper — all content/formatting decisions live in
 * buildOrderNotificationMessage below, which is what's actually
 * unit-tested; this function only needs to be trusted to send what it's
 * given and report failure without throwing.
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<TelegramSendResult> {
  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!response.ok) {
      // Telegram's error body (e.g. "chat not found", "bot was blocked by
      // the user") is the single most useful diagnostic an admin gets
      // when their notification setup is wrong — worth surfacing as-is
      // rather than a generic "failed".
      const body = await response.text().catch(() => "");
      return { success: false, error: `Telegram API error (${response.status}): ${body.slice(0, 300)}` };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Unknown network error" };
  }
}

export type OrderItemLine = {
  productName: string;
  /** e.g. "Đỏ, L" built from the variant's option values, or null for a simple (single-variant) product. */
  variantLabel: string | null;
  quantity: number;
  /** Already-formatted display line total (price × quantity), e.g. "200.000 ₫". */
  lineTotalDisplay: string;
};

export type OrderNotificationInput = {
  storeName: string;
  orderReference: string;
  /** Already-formatted display total, e.g. "123.000 ₫" — this module does no currency formatting of its own. */
  totalDisplay: string;
  customerName: string;
  /** Phone collected at checkout — included so the merchant can call back without opening tenant-admin first. */
  customerPhone: string;
  paymentMethodLabel: string;
  /** Every line item on the order, in order. */
  items: OrderItemLine[];
  /** Snapshot shipping method name, or null for a historical order that predates the field — see Order.shippingMethodName's own doc comment. */
  shippingMethodLabel: string | null;
  /** Full delivery address, already joined (street, ward, district, city) — this module does no address formatting of its own. */
  shippingAddressLine: string;
  /** Absolute URL to the order in tenant-admin, or null if it can't be resolved for this request. */
  adminOrderUrl: string | null;
  /**
   * True when this order was placed in a non-production environment
   * (local dev, a preview deploy). A merchant who reuses the same bot/
   * chat for testing and production (a reasonable thing to do — see
   * notify-new-order.ts) needs an unmissable way to tell a real order
   * from a test one at a glance, so this prepends a loud marker rather
   * than a subtle one.
   */
  isTestEnvironment?: boolean;
};

/**
 * HTML-escapes the handful of characters Telegram's HTML parse_mode
 * treats specially. Needed because every value here (customer name,
 * store name) is merchant/customer-supplied text, not a trusted literal.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * The message body for a new-order alert. Pure and DOM-free (same
 * pattern as product-seo.ts/store-seo.ts) so the copy and escaping are
 * unit-testable without a request context or a real Telegram call.
 */
export function buildOrderNotificationMessage(input: OrderNotificationInput): string {
  const itemLines = input.items.map((item) => {
    const variantSuffix = item.variantLabel ? ` (${escapeHtml(item.variantLabel)})` : "";
    return `• ${escapeHtml(item.productName)}${variantSuffix} ×${item.quantity} — ${escapeHtml(item.lineTotalDisplay)}`;
  });

  const lines = [
    input.isTestEnvironment
      ? `🧪 <b>ĐƠN TEST (không phải đơn thật) — ${escapeHtml(input.storeName)}</b>`
      : `🛎️ <b>Đơn hàng mới — ${escapeHtml(input.storeName)}</b>`,
    `Mã đơn: <b>${escapeHtml(input.orderReference)}</b>`,
    "",
    "Sản phẩm:",
    ...itemLines,
    "",
    `Khách hàng: ${escapeHtml(input.customerName)} — ${escapeHtml(input.customerPhone)}`,
    `Giao tới: ${escapeHtml(input.shippingAddressLine)}`,
    ...(input.shippingMethodLabel ? [`Vận chuyển: ${escapeHtml(input.shippingMethodLabel)}`] : []),
    `Thanh toán: ${escapeHtml(input.paymentMethodLabel)}`,
    `Tổng tiền: <b>${escapeHtml(input.totalDisplay)}</b>`,
  ];
  if (input.adminOrderUrl) {
    lines.push("", `<a href="${escapeHtml(input.adminOrderUrl)}">Xem đơn hàng</a>`);
  }
  return lines.join("\n");
}
