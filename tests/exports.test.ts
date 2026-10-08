// Integration tests for tenant-scoped CSV exports against local dev
// Postgres. The property that matters most — a tenant can never export
// another tenant's rows — is emergent from the real queries, so these run
// against the real database rather than mocks.
//
// LOCAL dev Postgres only. See tests/README.md.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { createOrder } from "../src/lib/order-mutations";
import { buildProductsExport, PRODUCT_EXPORT_HEADERS } from "../src/lib/exports/products-export";
import { buildOrdersExport, ORDER_EXPORT_HEADERS } from "../src/lib/exports/orders-export";
import { toCsv } from "../src/lib/csv";

const PRICE = 250_000;
const SHIPPING = 30_000;

let tenantA: { id: string };
let tenantB: { id: string };
let tenantEmpty: { id: string };
let variantA: { id: string };
let shipA: { id: string };
let shipB: { id: string };
let variantB: { id: string };
let suffix: string;

async function provision(label: string, sfx: string) {
  const tenant = await prisma.tenant.create({
    data: { slug: `test-exp-${label}-${sfx}`, name: `Export Tenant ${label}`, status: "active" },
  });
  const location = await prisma.location.create({
    data: { tenantId: tenant.id, name: "Main", isDefault: true },
  });
  const product = await prisma.product.create({
    // Deliberately hostile and Vietnamese at once: a formula trigger, a
    // comma, a quote and diacritics in one product name.
    data: {
      tenantId: tenant.id,
      name: `=Túi "đặc biệt", ${label}`,
      status: "active",
      description: "Túi vải canvas bền,\nmay tại Việt Nam.",
    },
  });
  const variant = await prisma.productVariant.create({
    data: { tenantId: tenant.id, productId: product.id, price: PRICE, sku: `EXP-${label}-${sfx}`, combinationKey: "" },
  });
  await prisma.inventory.create({
    data: { tenantId: tenant.id, productVariantId: variant.id, locationId: location.id, onHand: 40 },
  });
  const shippingMethod = await prisma.tenantShippingMethod.create({
    data: { tenantId: tenant.id, name: "Standard", amount: SHIPPING, enabled: true, isDefault: true },
  });
  await prisma.tenantPaymentMethod.create({
    data: { tenantId: tenant.id, method: "cod", provider: "cod", enabled: true },
  });
  return { tenant, product, variant, shippingMethod };
}

before(async () => {
  suffix = randomUUID().slice(0, 8);
  const a = await provision("a", suffix);
  const b = await provision("b", suffix);
  tenantA = a.tenant;
  tenantB = b.tenant;
  variantA = a.variant;
  variantB = b.variant;
  shipA = a.shippingMethod;
  shipB = b.shippingMethod;
  tenantEmpty = await prisma.tenant.create({
    data: { slug: `test-exp-empty-${suffix}`, name: "Export Tenant Empty", status: "active" },
  });

  // A discount on A only, so the discount columns are exercised and
  // isolation on discounts is covered too.
  await prisma.discount.create({
    data: { tenantId: tenantA.id, productId: a.product.id, percentOff: 20, enabled: true },
  });

  // Several orders per tenant, enough to exercise ordering.
  for (let i = 0; i < 3; i++) {
    const r = await createOrder(
      tenantA.id,
      [{ productVariantId: variantA.id, quantity: i + 1 }],
      "cod",
      { name: `Nguyễn Văn A${i}`, email: `exp-a${i}-${suffix}@example.com`, phone: "0912345678" },
      { address: `=1 Đường "Số", ${i}`, ward: "Phường Hoàn Kiếm", district: "", city: "Hà Nội" },
      shipA.id,
    );
    assert.ok(r.success, "tenant A order created");
  }
  const rb = await createOrder(
    tenantB.id,
    [{ productVariantId: variantB.id, quantity: 1 }],
    "cod",
    { name: "Tenant B Buyer", email: `exp-b-${suffix}@example.com`, phone: "0987654321" },
    { address: "9 B Street", ward: "W", district: "", city: "C" },
    shipB.id,
  );
  assert.ok(rb.success, "tenant B order created");
});

after(async () => {
  const ids = [tenantA.id, tenantB.id, tenantEmpty.id];
  await prisma.orderEvent.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.orderItem.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.payment.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.order.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.discount.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.inventory.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.productVariant.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.product.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.location.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantShippingMethod.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenantPaymentMethod.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

// ---------- products ----------

test("products export has the documented headers in a stable order", async () => {
  const table = await buildProductsExport(tenantA.id);
  assert.deepEqual(table.headers, PRODUCT_EXPORT_HEADERS);
  // Every row has exactly one cell per header, or the CSV would be ragged.
  for (const row of table.rows) {
    assert.equal(row.length, PRODUCT_EXPORT_HEADERS.length);
  }
});

test("products export includes this tenant's variant, price, stock and discount", async () => {
  const table = await buildProductsExport(tenantA.id);
  assert.ok(table.rows.length > 0);
  const row = table.rows.find((r) => String(r[5]).includes(`EXP-a-${suffix}`));
  assert.ok(row, "tenant A's own SKU is present");
  const col = (name: string) => row[PRODUCT_EXPORT_HEADERS.indexOf(name as never)];
  assert.equal(col("variant_price_vnd"), "250000");
  assert.equal(col("discount_percent"), 20);
  assert.equal(col("discounted_price_vnd"), "200000");
  assert.equal(col("stock_on_hand"), 40);
  assert.equal(col("product_status"), "active");
});

test("TENANT ISOLATION — a products export never contains another tenant's rows", async () => {
  const a = await buildProductsExport(tenantA.id);
  const b = await buildProductsExport(tenantB.id);
  const aText = JSON.stringify(a.rows);
  const bText = JSON.stringify(b.rows);

  assert.ok(aText.includes(`EXP-a-${suffix}`));
  assert.ok(!aText.includes(`EXP-b-${suffix}`), "A must not see B's SKU");
  assert.ok(bText.includes(`EXP-b-${suffix}`));
  assert.ok(!bText.includes(`EXP-a-${suffix}`), "B must not see A's SKU");
  // B has no discount, so A's discount must not bleed across either.
  assert.ok(!bText.includes('"discount"'));
});

test("a tenant with no catalog exports headers and zero rows", async () => {
  const table = await buildProductsExport(tenantEmpty.id);
  assert.equal(table.rows.length, 0);
  const csv = toCsv(table.headers, table.rows);
  assert.ok(csv.includes("product_id,product_name"));
});

test("a blank tenant id exports nothing rather than everything", async () => {
  assert.equal((await buildProductsExport("")).rows.length, 0);
  assert.equal((await buildProductsExport("   ")).rows.length, 0);
  assert.equal((await buildOrdersExport("")).rows.length, 0);
});

test("products export ordering is deterministic across runs", async () => {
  const first = await buildProductsExport(tenantA.id);
  const second = await buildProductsExport(tenantA.id);
  assert.deepEqual(first.rows, second.rows);
});

// ---------- orders ----------

test("orders export has the documented headers in a stable order", async () => {
  const table = await buildOrdersExport(tenantA.id);
  assert.deepEqual(table.headers, ORDER_EXPORT_HEADERS);
  for (const row of table.rows) {
    assert.equal(row.length, ORDER_EXPORT_HEADERS.length);
  }
});

test("orders export carries operational totals and the item summary", async () => {
  const table = await buildOrdersExport(tenantA.id);
  assert.equal(table.rows.length, 3, "all three of A's orders, not one page");
  const col = (row: (typeof table.rows)[number], name: string) =>
    row[ORDER_EXPORT_HEADERS.indexOf(name as never)];

  for (const row of table.rows) {
    assert.equal(col(row, "order_status"), "pending");
    assert.equal(col(row, "payment_method"), "cod");
    assert.equal(col(row, "shipping_amount_vnd"), String(SHIPPING));
    // total = subtotal + shipping, taken from the same query the UI uses.
    const subtotal = Number(col(row, "subtotal_vnd"));
    const total = Number(col(row, "total_vnd"));
    assert.equal(total, subtotal + SHIPPING);
    assert.match(String(col(row, "items")), / x =Túi/);
  }
});

test("TENANT ISOLATION — an orders export never contains another tenant's orders", async () => {
  const a = await buildOrdersExport(tenantA.id);
  const b = await buildOrdersExport(tenantB.id);
  const aText = JSON.stringify(a.rows);
  const bText = JSON.stringify(b.rows);

  assert.equal(b.rows.length, 1, "B has exactly its own one order");
  assert.ok(!aText.includes("Tenant B Buyer"), "A must not see B's customer");
  assert.ok(!aText.includes("0987654321"), "A must not see B's phone");
  assert.ok(!bText.includes(`exp-a0-${suffix}@example.com`), "B must not see A's customer email");
  assert.ok(!bText.includes("Nguyễn Văn A0"));
});

test("a tenant with no orders exports headers and zero rows", async () => {
  const table = await buildOrdersExport(tenantEmpty.id);
  assert.equal(table.rows.length, 0);
});

test("orders export ordering is deterministic across runs", async () => {
  // listOrders() now sorts by (createdAt desc, id desc); without the id
  // tiebreaker, orders created in the same millisecond could reorder
  // between runs or repeat across pages.
  const first = await buildOrdersExport(tenantA.id);
  const second = await buildOrdersExport(tenantA.id);
  assert.deepEqual(first.rows, second.rows);

  const ids = first.rows.map((r) => String(r[0]));
  assert.equal(new Set(ids).size, ids.length, "no order appears twice");
});

test("NO SECRETS — an orders export carries no provider or payment internals", async () => {
  const table = await buildOrdersExport(tenantA.id);
  const text = JSON.stringify(table.rows).toLowerCase();
  for (const forbidden of [
    "providerorderid",
    "providertransactionid",
    "providermetadata",
    "rawpayload",
    "signature",
    "accountnumber",
    "accountholder",
    "secret",
    "token",
    "clerk",
    "publicmetadata",
  ]) {
    assert.ok(!text.includes(forbidden), `export must not contain ${forbidden}`);
  }
  // And no column is named after one either.
  const headers = ORDER_EXPORT_HEADERS.join(",").toLowerCase();
  assert.ok(!headers.includes("provider_order"));
  assert.ok(!headers.includes("account"));
  assert.ok(!headers.includes("payload"));
});

// ---------- serialization end to end ----------

test("the rendered CSV escapes hostile and Vietnamese content from real rows", async () => {
  const table = await buildProductsExport(tenantA.id);
  const csv = toCsv(table.headers, table.rows);

  // The product name starts with '=' in the database; it must be neutralised.
  assert.ok(!csv.includes("\n=Túi"), "a cell must never begin a line with =");
  assert.ok(csv.includes(`"'=Túi ""đặc biệt""`), "formula-guarded and quote-doubled");
  // Diacritics survive intact.
  assert.ok(csv.includes("Việt Nam"));
  // The multi-line description is quoted rather than breaking the row.
  const dataLines = csv.split("\r\n").filter(Boolean).length;
  assert.ok(dataLines >= 2);
});

test("a hostile shipping address is neutralised in the orders CSV", async () => {
  const table = await buildOrdersExport(tenantA.id);
  const csv = toCsv(table.headers, table.rows);
  assert.ok(csv.includes(`"'=1 Đường ""Số""`), "address formula-guarded and quoted");
});

// ---------- read-only guarantee ----------

test("exports mutate nothing: no orders, payments, inventory, products or events change", async () => {
  const snapshot = async () => ({
    orders: await prisma.order.count({ where: { tenantId: tenantA.id } }),
    items: await prisma.orderItem.count({ where: { tenantId: tenantA.id } }),
    payments: await prisma.payment.count({ where: { tenantId: tenantA.id } }),
    products: await prisma.product.count({ where: { tenantId: tenantA.id } }),
    variants: await prisma.productVariant.count({ where: { tenantId: tenantA.id } }),
    events: await prisma.orderEvent.count({ where: { tenantId: tenantA.id } }),
    inventory: await prisma.inventory.findMany({
      where: { tenantId: tenantA.id },
      select: { onHand: true, reserved: true },
      orderBy: { productVariantId: "asc" },
    }),
  });

  const before = await snapshot();
  await buildProductsExport(tenantA.id);
  await buildOrdersExport(tenantA.id);
  const after = await snapshot();

  // Exporting writes no audit event either: an export is a read, and one
  // event per export would bury the lifecycle entries that matter.
  assert.deepEqual(after, before);
});

// ---------- download cleanup timing ----------

test("the download helper revokes its object URL on a later task, not inline", () => {
  // There is no DOM in this runner, so the component cannot be rendered.
  // This is asserted structurally instead, which is where the bug actually
  // lives: revoking in the same task as anchor.click() aborts the download
  // in Firefox and older Safari while appearing to succeed in Chrome, and
  // the regression would be someone moving the call back inline.
  //
  // Line comments are stripped BEFORE block comments on purpose — a //
  // comment mentioning a path like "/tenant-admin/*" otherwise reads as an
  // opening /* and swallows the code under test.
  const source = readFileSync(
    new URL("../src/app/tenant-admin/ExportCsvButton.tsx", import.meta.url),
    "utf8",
  )
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const click = source.indexOf("anchor.click()");
  const revoke = source.indexOf("revokeObjectURL");
  assert.ok(click > -1, "the helper still triggers the download by clicking an anchor");
  assert.ok(revoke > -1, "the object URL is still revoked somewhere — otherwise it leaks");
  assert.ok(revoke > click, "revocation must come after the click");

  // The revoke must sit inside a deferred callback rather than running in
  // the click's own task.
  assert.match(
    source,
    /setTimeout\(\s*\(\)\s*=>\s*URL\.revokeObjectURL\([^)]*\)/,
    "revokeObjectURL must be deferred via setTimeout, not called inline",
  );
});

test("the orders export UI warns that the file contains customer personal data", () => {
  // The warning belongs on the screen that starts the download, so it is
  // asserted where a future redesign would be most likely to drop it.
  const page = readFileSync(
    new URL("../src/app/tenant-admin/orders/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /Contains customer personal data/);
  for (const field of ["name", "email", "phone", "shipping address"]) {
    assert.ok(page.includes(field), `the warning must name ${field}`);
  }
  assert.match(page, /no longer protected by/, "must say the file leaves the app's protection");
});
