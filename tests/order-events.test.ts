// Integration tests for Order Audit History against the real transaction
// on local dev Postgres — not mocks — because the properties that matter
// (one event per mutation, atomicity with inventory, idempotency under
// retry, tenant isolation) are emergent from how the transaction runs.
//
// LOCAL dev Postgres only. See tests/README.md.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { createOrder, updateOrderStatus } from "../src/lib/order-mutations";
import { markManualPaymentReceived, createPaymentForOrder } from "../src/lib/payments/payment-service";
import { getOrderTimeline } from "../src/lib/order-events";

const UNIT_PRICE = 100_000;
const SHIPPING_AMOUNT = 20_000;
// Generous on purpose: every test below places a real order against the
// same variant, so reservations accumulate across the file. The assertions
// are written relative to each test's own starting point rather than to
// absolute numbers, so they stay order-independent.
const ON_HAND = 100;

let tenantA: { id: string };
let tenantB: { id: string };
let variantA: { id: string };
let variantB: { id: string };
let shippingMethodA: { id: string };
let shippingMethodB: { id: string };
let tenantC: { id: string };
let variantC: { id: string };
let shippingMethodC: { id: string };

const shipping = { address: "123 Test St", ward: "Ward", district: "", city: "City" };
let emailSuffix: string;

function customerFor(label: string) {
  return { name: "Nguyen Van A", email: `evt-${label}-${emailSuffix}@example.com`, phone: "0912345678" };
}

async function provisionTenant(label: string, suffix: string, provider: "cod" | "bank_transfer_manual") {
  const tenant = await prisma.tenant.create({
    data: { slug: `test-evt-${label}-${suffix}`, name: `Event Tenant ${label}`, status: "active" },
  });
  const location = await prisma.location.create({
    data: { tenantId: tenant.id, name: "Main", isDefault: true },
  });
  const product = await prisma.product.create({
    data: { tenantId: tenant.id, name: `Product ${label}`, status: "active" },
  });
  const variant = await prisma.productVariant.create({
    data: { tenantId: tenant.id, productId: product.id, price: UNIT_PRICE, sku: `EVT-${label}-${suffix}`, combinationKey: "" },
  });
  await prisma.inventory.create({
    data: { tenantId: tenant.id, productVariantId: variant.id, locationId: location.id, onHand: ON_HAND },
  });
  const shippingMethod = await prisma.tenantShippingMethod.create({
    data: { tenantId: tenant.id, name: "Standard", amount: SHIPPING_AMOUNT, enabled: true, isDefault: true },
  });
  await prisma.tenantPaymentMethod.create({
    data: {
      tenantId: tenant.id,
      method: provider === "cod" ? "cod" : "bank_transfer",
      provider,
      enabled: true,
      // The manual provider is only "available" once all three bank fields
      // are set (see isAvailable() in payment-service.ts), so the fixture
      // supplies them. The account number is deliberately a long digit run
      // so the "no account number in the audit summary" assertion has
      // something real to catch.
      config:
        provider === "bank_transfer_manual"
          ? { bankName: "Test Bank", accountNumber: "19001234567890", accountHolder: "TEST STORE" }
          : undefined,
    },
  });
  return { tenant, variant, shippingMethod };
}

async function placeOrder(tenantId: string, variantId: string, shippingMethodId: string, label: string, method = "cod") {
  const result = await createOrder(
    tenantId,
    [{ productVariantId: variantId, quantity: 1 }],
    method,
    customerFor(label),
    shipping,
    shippingMethodId,
  );
  assert.ok(result.success, `createOrder failed: ${result.success ? "" : result.error}`);
  return result.data.orderId;
}

/**
 * Mirrors what checkoutAction() does: createOrder() alone does not create a
 * Payment row — the real flow calls createPaymentForOrder() straight after
 * it. The manual-payment tests need that row, so they go through both.
 */
async function placeOrderWithPayment(
  tenantId: string,
  variantId: string,
  shippingMethodId: string,
  label: string,
) {
  const orderId = await placeOrder(tenantId, variantId, shippingMethodId, label, "bank_transfer");
  const payment = await createPaymentForOrder(
    tenantId,
    orderId,
    "bank_transfer",
    UNIT_PRICE + SHIPPING_AMOUNT,
    `Order ${orderId}`,
  );
  assert.ok(payment.success, "the manual bank transfer payment is created");
  return orderId;
}

before(async () => {
  const suffix = randomUUID().slice(0, 8);
  emailSuffix = suffix;
  const a = await provisionTenant("a", suffix, "cod");
  const b = await provisionTenant("b", suffix, "cod");
  tenantA = a.tenant;
  tenantB = b.tenant;
  variantA = a.variant;
  variantB = b.variant;
  shippingMethodA = a.shippingMethod;
  shippingMethodB = b.shippingMethod;
  // A third tenant on manual bank transfer, the one payment method whose
  // status THIS application records (everything else is provider-driven and
  // already covered by PaymentEvent).
  const c = await provisionTenant("c", suffix, "bank_transfer_manual");
  tenantC = c.tenant;
  variantC = c.variant;
  shippingMethodC = c.shippingMethod;
});

after(async () => {
  const tenantIds = [tenantA.id, tenantB.id, tenantC.id];
  await prisma.orderEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.orderItem.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.order.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.inventory.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.productVariant.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.product.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.location.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenantShippingMethod.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenantPaymentMethod.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

test("order creation writes exactly one order_created event", async () => {
  const orderId = await placeOrder(tenantA.id, variantA.id, shippingMethodA.id, "create");
  const timeline = await getOrderTimeline(tenantA.id, orderId);

  assert.equal(timeline.length, 1, "exactly one event, not zero and not two");
  assert.equal(timeline[0].type, "order_created");
  assert.equal(timeline[0].newValue, "pending");
  assert.equal(timeline[0].previousValue, null, "creation has no previous value");
  // Guest checkout has no signed-in user, so it must not claim an admin did it.
  assert.equal(timeline[0].actorType, "system");
  assert.match(timeline[0].summary, /Order placed with 1 item\(s\)/);
});

test("a summary carries no customer PII", async () => {
  // The summary is composed server-side from the transition only. A
  // merchant-facing timeline has no reason to repeat the buyer's identity,
  // and an audit store is the wrong place to duplicate it.
  const orderId = await placeOrder(tenantA.id, variantA.id, shippingMethodA.id, "pii");
  const timeline = await getOrderTimeline(tenantA.id, orderId);
  const joined = timeline.map((e) => `${e.summary} ${e.previousValue} ${e.newValue}`).join(" ");

  for (const pii of ["Nguyen Van A", "0912345678", "@example.com", "123 Test St", "Ward", "City"]) {
    assert.ok(!joined.includes(pii), `summary must not contain ${pii}`);
  }
});

test("fulfilling writes exactly one order_status_changed event with the real transition", async () => {
  const orderId = await placeOrder(tenantA.id, variantA.id, shippingMethodA.id, "fulfil");
  const result = await updateOrderStatus(tenantA.id, orderId, "fulfilled", { type: "tenant_admin", id: "user_test" });
  assert.ok(result.success);

  const timeline = await getOrderTimeline(tenantA.id, orderId);
  assert.equal(timeline.length, 2, "creation + one status change");
  const change = timeline[1];
  assert.equal(change.type, "order_status_changed");
  assert.equal(change.previousValue, "pending");
  assert.equal(change.newValue, "fulfilled");
  assert.equal(change.actorType, "tenant_admin");
  // Fulfilment consumes stock rather than releasing it, so no release event.
  assert.equal(timeline.filter((e) => e.type === "inventory_released").length, 0);
});

test("cancelling writes the status change AND the inventory release, atomically", async () => {
  const orderId = await placeOrder(tenantA.id, variantA.id, shippingMethodA.id, "cancel");
  const before = await prisma.inventory.findFirst({ where: { tenantId: tenantA.id, productVariantId: variantA.id } });
  assert.ok(before, "inventory row exists");
  assert.ok(before.reserved >= 1, "this order holds a reservation");

  const result = await updateOrderStatus(tenantA.id, orderId, "cancelled", { type: "tenant_admin", id: "user_test" });
  assert.ok(result.success);

  const timeline = await getOrderTimeline(tenantA.id, orderId);
  const types = timeline.map((e) => e.type);
  assert.deepEqual(types, ["order_created", "order_status_changed", "inventory_released"]);

  // The release event and the actual stock movement are in one transaction,
  // so the timeline cannot claim a release that did not happen. Asserted as
  // a delta, so the result does not depend on what other tests reserved.
  const after = await prisma.inventory.findFirst({ where: { tenantId: tenantA.id, productVariantId: variantA.id } });
  assert.equal(after?.reserved, before.reserved - 1, "exactly this order's reservation was released");
  assert.equal(after?.onHand, before.onHand, "cancellation releases, it does not consume");
  assert.match(timeline[2].summary, /Released reserved stock for 1 item\(s\)/);
});

test("an invalid transition writes no event", async () => {
  const orderId = await placeOrder(tenantA.id, variantA.id, shippingMethodA.id, "invalid");
  const before = await getOrderTimeline(tenantA.id, orderId);

  const bogus = await updateOrderStatus(tenantA.id, orderId, "refunded");
  assert.equal(bogus.success, false, "not a permitted transition");

  const after = await getOrderTimeline(tenantA.id, orderId);
  assert.deepEqual(after.map((e) => e.id), before.map((e) => e.id), "timeline unchanged");
});

test("a failed transaction leaves no audit event behind", async () => {
  // Transitioning an order that is already terminal throws inside the
  // transaction, so the whole thing — including the event insert — rolls back.
  const orderId = await placeOrder(tenantA.id, variantA.id, shippingMethodA.id, "rollback");
  const ok = await updateOrderStatus(tenantA.id, orderId, "fulfilled");
  assert.ok(ok.success);
  const afterFirst = await getOrderTimeline(tenantA.id, orderId);

  const second = await updateOrderStatus(tenantA.id, orderId, "cancelled");
  assert.equal(second.success, false, "already terminal");

  const afterSecond = await getOrderTimeline(tenantA.id, orderId);
  assert.deepEqual(afterSecond.map((e) => e.id), afterFirst.map((e) => e.id), "no partial event written");
});

test("IDEMPOTENCY — a duplicate retry of the same transition writes no second event", async () => {
  const orderId = await placeOrder(tenantA.id, variantA.id, shippingMethodA.id, "retry");
  const first = await updateOrderStatus(tenantA.id, orderId, "fulfilled");
  assert.ok(first.success);

  const retry = await updateOrderStatus(tenantA.id, orderId, "fulfilled");
  assert.equal(retry.success, false, "the status guard rejects the replay");

  const timeline = await getOrderTimeline(tenantA.id, orderId);
  assert.equal(timeline.filter((e) => e.type === "order_status_changed").length, 1, "exactly one status event");
});

test("events are returned oldest first", async () => {
  const orderId = await placeOrder(tenantA.id, variantA.id, shippingMethodA.id, "order");
  await updateOrderStatus(tenantA.id, orderId, "cancelled");
  const timeline = await getOrderTimeline(tenantA.id, orderId);

  assert.ok(timeline.length >= 3);
  for (let i = 1; i < timeline.length; i++) {
    assert.ok(
      timeline[i].createdAt.getTime() >= timeline[i - 1].createdAt.getTime(),
      "timestamps must be non-decreasing",
    );
  }
  assert.equal(timeline[0].type, "order_created", "creation is always first");
});

test("TENANT ISOLATION — a tenant never sees another tenant's order timeline", async () => {
  const orderA = await placeOrder(tenantA.id, variantA.id, shippingMethodA.id, "isoA");
  const orderB = await placeOrder(tenantB.id, variantB.id, shippingMethodB.id, "isoB");

  assert.ok((await getOrderTimeline(tenantA.id, orderA)).length > 0);
  assert.ok((await getOrderTimeline(tenantB.id, orderB)).length > 0);

  // Each tenant's own order id is the only one it can read.
  assert.deepEqual(await getOrderTimeline(tenantA.id, orderB), [], "A must not read B's timeline");
  assert.deepEqual(await getOrderTimeline(tenantB.id, orderA), [], "B must not read A's timeline");
});

test("a cross-tenant or unknown order id is indistinguishable: both empty, no error", async () => {
  const orderB = await placeOrder(tenantB.id, variantB.id, shippingMethodB.id, "indist");
  const crossTenant = await getOrderTimeline(tenantA.id, orderB);
  const unknown = await getOrderTimeline(tenantA.id, randomUUID());

  assert.deepEqual(crossTenant, []);
  assert.deepEqual(unknown, []);
  assert.deepEqual(crossTenant, unknown, "the caller cannot tell the two apart");
});

test("blank tenant or order id returns empty rather than an unscoped read", async () => {
  const orderA = await placeOrder(tenantA.id, variantA.id, shippingMethodA.id, "blank");
  assert.deepEqual(await getOrderTimeline("", orderA), []);
  assert.deepEqual(await getOrderTimeline("   ", orderA), []);
  assert.deepEqual(await getOrderTimeline(tenantA.id, ""), []);
});

test("events are written against the order's own tenant, never another", async () => {
  const orderA = await placeOrder(tenantA.id, variantA.id, shippingMethodA.id, "fk");
  const rows = await prisma.orderEvent.findMany({ where: { orderId: orderA } });
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(row.tenantId, tenantA.id, "composite FK binds the event to the order's tenant");
  }
});

test("the timeline read exposes no actorId", async () => {
  // Stored for operational lookup, deliberately not surfaced: a Clerk user
  // id on a merchant's screen is noise, and the UI shows a role label.
  const orderId = await placeOrder(tenantA.id, variantA.id, shippingMethodA.id, "actor");
  await updateOrderStatus(tenantA.id, orderId, "fulfilled", { type: "tenant_admin", id: "user_secret" });
  const timeline = await getOrderTimeline(tenantA.id, orderId);

  for (const entry of timeline) {
    assert.ok(!("actorId" in entry), "actorId must not be part of the read shape");
    assert.ok(!JSON.stringify(entry).includes("user_secret"));
  }
  // It IS persisted, for operational lookup.
  const stored = await prisma.orderEvent.findFirst({
    where: { tenantId: tenantA.id, orderId, type: "order_status_changed" },
  });
  assert.equal(stored?.actorId, "user_secret");
});

test("APPEND-ONLY — the event module exposes no update or delete", async () => {
  const mod = await import("../src/lib/order-events");
  const names = Object.keys(mod);
  for (const name of names) {
    assert.ok(
      !/update|delete|remove|edit|destroy/i.test(name),
      `order-events must not export a mutating helper, found ${name}`,
    );
  }
  assert.ok(names.includes("recordOrderEventInTx"), "append is the only write path");
});

test("confirming a manual bank transfer writes one payment_status_changed event", async () => {
  const orderId = await placeOrderWithPayment(tenantC.id, variantC.id, shippingMethodC.id, "pay");

  const result = await markManualPaymentReceived(tenantC.id, orderId, { type: "tenant_admin", id: "user_pay" });
  assert.ok(result.success, "the pending manual payment can be confirmed");

  const timeline = await getOrderTimeline(tenantC.id, orderId);
  const payEvents = timeline.filter((e) => e.type === "payment_status_changed");
  assert.equal(payEvents.length, 1);
  assert.equal(payEvents[0].previousValue, "pending");
  assert.equal(payEvents[0].newValue, "succeeded");
  assert.equal(payEvents[0].actorType, "tenant_admin");
  // No account number, reference or raw payload in the summary.
  assert.match(payEvents[0].summary, /Manual bank transfer confirmed/);
  assert.ok(!/\d{6,}/.test(payEvents[0].summary), "no long digit run that could be an account number");
});

test("IDEMPOTENCY — re-confirming a manual payment writes no second event", async () => {
  const orderId = await placeOrderWithPayment(tenantC.id, variantC.id, shippingMethodC.id, "payretry");
  assert.ok((await markManualPaymentReceived(tenantC.id, orderId, { type: "tenant_admin" })).success);

  const retry = await markManualPaymentReceived(tenantC.id, orderId, { type: "tenant_admin" });
  assert.equal(retry.success, false, "the status guard rejects the replay");

  const timeline = await getOrderTimeline(tenantC.id, orderId);
  assert.equal(timeline.filter((e) => e.type === "payment_status_changed").length, 1);
});

test("a manual-payment confirmation for another tenant's order writes nothing", async () => {
  const orderC = await placeOrderWithPayment(tenantC.id, variantC.id, shippingMethodC.id, "paycross");
  const result = await markManualPaymentReceived(tenantA.id, orderC, { type: "tenant_admin" });
  assert.equal(result.success, false, "tenant A has no such payment");

  const timeline = await getOrderTimeline(tenantC.id, orderC);
  assert.equal(timeline.filter((e) => e.type === "payment_status_changed").length, 0, "no event written");
});

test("a system-initiated transition is recorded as system, not as an admin", async () => {
  const orderId = await placeOrder(tenantA.id, variantA.id, shippingMethodA.id, "system");
  await updateOrderStatus(tenantA.id, orderId, "cancelled");
  const timeline = await getOrderTimeline(tenantA.id, orderId);

  const change = timeline.find((e) => e.type === "order_status_changed");
  assert.equal(change?.actorType, "system", "default actor is honest about who acted");
});
