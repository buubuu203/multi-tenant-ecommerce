import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrderNotificationMessage, type OrderNotificationInput } from "../src/lib/notifications/telegram";

function input(overrides: Partial<OrderNotificationInput> = {}): OrderNotificationInput {
  return {
    storeName: "PoPrint",
    orderReference: "#AB12CD34",
    totalDisplay: "150.000 ₫",
    customerName: "Nguyễn Văn A",
    customerPhone: "0912345678",
    paymentMethodLabel: "Thanh toán khi nhận hàng",
    items: [
      { productName: "Áo thun", variantLabel: "Đỏ, L", quantity: 2, lineTotalDisplay: "200.000 ₫" },
      { productName: "Ốp lưng", variantLabel: null, quantity: 1, lineTotalDisplay: "50.000 ₫" },
    ],
    shippingMethodLabel: "Giao hàng tiêu chuẩn",
    shippingAddressLine: "123 Đường ABC, Phường X, Quận Y, TP.HCM",
    adminOrderUrl: null,
    ...overrides,
  };
}

test("the message carries the store name, order reference, customer, payment method and total", () => {
  const message = buildOrderNotificationMessage(input());
  assert.match(message, /PoPrint/);
  assert.match(message, /#AB12CD34/);
  assert.match(message, /Nguyễn Văn A/);
  assert.match(message, /0912345678/);
  assert.match(message, /Thanh toán khi nhận hàng/);
  assert.match(message, /150\.000 ₫/);
});

test("every item line shows product name, variant (when any), quantity and line total", () => {
  const message = buildOrderNotificationMessage(input());
  assert.match(message, /• Áo thun \(Đỏ, L\) ×2 — 200\.000 ₫/);
  assert.match(message, /• Ốp lưng ×1 — 50\.000 ₫/);
  // A simple product with no variant never shows an empty "()" suffix.
  assert.doesNotMatch(message, /Ốp lưng \(/);
});

test("shipping address and method are both included; method is omitted when null", () => {
  const withMethod = buildOrderNotificationMessage(input());
  assert.match(withMethod, /Giao tới: 123 Đường ABC, Phường X, Quận Y, TP\.HCM/);
  assert.match(withMethod, /Vận chuyển: Giao hàng tiêu chuẩn/);

  const withoutMethod = buildOrderNotificationMessage(input({ shippingMethodLabel: null }));
  assert.doesNotMatch(withoutMethod, /Vận chuyển:/);
});

test("the admin order link is included only when a URL is provided", () => {
  const withUrl = buildOrderNotificationMessage(
    input({ adminOrderUrl: "https://poprint.store/tenant-admin/orders/abc123" }),
  );
  assert.match(withUrl, /href="https:\/\/poprint\.store\/tenant-admin\/orders\/abc123"/);

  const withoutUrl = buildOrderNotificationMessage(input({ adminOrderUrl: null }));
  assert.doesNotMatch(withoutUrl, /href=/);
});

test("HTML-significant characters in merchant/customer/product text are escaped", () => {
  const message = buildOrderNotificationMessage(
    input({
      storeName: "A & B <Shop>",
      customerName: "Trần <script>x</script>",
      items: [{ productName: "Áo <b>Fake</b>", variantLabel: "<i>Đỏ</i>", quantity: 1, lineTotalDisplay: "1 ₫" }],
    }),
  );
  assert.match(message, /A &amp; B &lt;Shop&gt;/);
  assert.match(message, /Trần &lt;script&gt;x&lt;\/script&gt;/);
  assert.match(message, /Áo &lt;b&gt;Fake&lt;\/b&gt;/);
  assert.match(message, /\(&lt;i&gt;Đỏ&lt;\/i&gt;\)/);
  assert.doesNotMatch(message, /<script>|<b>Fake<\/b>|<i>Đỏ<\/i>/);
});

test("a test-environment order is marked unmistakably, so it can never be mistaken for a real one", () => {
  const real = buildOrderNotificationMessage(input({ isTestEnvironment: false }));
  assert.match(real, /Đơn hàng mới/);
  assert.doesNotMatch(real, /ĐƠN TEST/);

  const test_ = buildOrderNotificationMessage(input({ isTestEnvironment: true }));
  assert.match(test_, /ĐƠN TEST \(không phải đơn thật\)/);
  assert.doesNotMatch(test_, /Đơn hàng mới/);
});

test("TENANT ISOLATION — every value comes from the input, never a hardcoded store", () => {
  const a = buildOrderNotificationMessage(input({ storeName: "Shop A" }));
  const b = buildOrderNotificationMessage(input({ storeName: "Shop B" }));
  assert.match(a, /Shop A/);
  assert.doesNotMatch(a, /Shop B/);
  assert.match(b, /Shop B/);
  assert.doesNotMatch(b, /Shop A/);
});
