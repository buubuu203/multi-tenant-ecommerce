import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrderNotificationMessage, type OrderNotificationInput } from "../src/lib/notifications/telegram";

function input(overrides: Partial<OrderNotificationInput> = {}): OrderNotificationInput {
  return {
    storeName: "PoPrint",
    orderReference: "#AB12CD34",
    totalDisplay: "150.000 ₫",
    customerName: "Nguyễn Văn A",
    paymentMethodLabel: "Thanh toán khi nhận hàng",
    itemCount: 2,
    adminOrderUrl: null,
    ...overrides,
  };
}

test("the message carries the store name, order reference, customer, payment method and total", () => {
  const message = buildOrderNotificationMessage(input());
  assert.match(message, /PoPrint/);
  assert.match(message, /#AB12CD34/);
  assert.match(message, /Nguyễn Văn A/);
  assert.match(message, /Thanh toán khi nhận hàng/);
  assert.match(message, /150\.000 ₫/);
  assert.match(message, /2 sản phẩm/);
});

test("the admin order link is included only when a URL is provided", () => {
  const withUrl = buildOrderNotificationMessage(
    input({ adminOrderUrl: "https://poprint.store/tenant-admin/orders/abc123" }),
  );
  assert.match(withUrl, /href="https:\/\/poprint\.store\/tenant-admin\/orders\/abc123"/);

  const withoutUrl = buildOrderNotificationMessage(input({ adminOrderUrl: null }));
  assert.doesNotMatch(withoutUrl, /href=/);
});

test("HTML-significant characters in merchant/customer text are escaped", () => {
  const message = buildOrderNotificationMessage(
    input({ storeName: "A & B <Shop>", customerName: "Trần <script>x</script>" }),
  );
  assert.match(message, /A &amp; B &lt;Shop&gt;/);
  assert.match(message, /Trần &lt;script&gt;x&lt;\/script&gt;/);
  assert.doesNotMatch(message, /<script>/);
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
