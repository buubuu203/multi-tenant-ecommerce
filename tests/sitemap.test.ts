// DB-backed tests — LOCAL dev Postgres only. See tests/README.md.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { buildSitemapEntries } from "../src/lib/seo/sitemap-entries";

let tenantA: { id: string };
let tenantB: { id: string };
let activeProductA: { id: string };
let draftProductA: { id: string };
let productB: { id: string };
let unsellableProductA: { id: string };

const ORIGIN_A = "https://shop-a.example";

before(async () => {
  const suffix = randomUUID().slice(0, 8);
  tenantA = await prisma.tenant.create({
    data: { slug: `test-sitemap-a-${suffix}`, name: "Sitemap Tenant A", status: "active" },
  });
  tenantB = await prisma.tenant.create({
    data: { slug: `test-sitemap-b-${suffix}`, name: "Sitemap Tenant B", status: "active" },
  });

  activeProductA = await prisma.product.create({
    data: { tenantId: tenantA.id, name: "Active A", status: "active" },
  });
  draftProductA = await prisma.product.create({
    data: { tenantId: tenantA.id, name: "Draft A", status: "draft" },
  });
  productB = await prisma.product.create({
    data: { tenantId: tenantB.id, name: "Active B", status: "active" },
  });
  // Active, but every variant archived — renders a real 404, so it must not
  // be advertised in the sitemap either.
  unsellableProductA = await prisma.product.create({
    data: { tenantId: tenantA.id, name: "Unsellable A", status: "active" },
  });

  // A publicly renderable product needs at least one non-archived variant;
  // the sitemap now requires that too, so the fixtures carry one.
  for (const [tenantId, productId, variantStatus] of [
    [tenantA.id, activeProductA.id, "active"],
    [tenantB.id, productB.id, "active"],
    [tenantA.id, unsellableProductA.id, "archived"],
  ] as const) {
    await prisma.productVariant.create({
      data: {
        tenantId,
        productId,
        price: 100_000,
        sku: `SITEMAP-${productId.slice(0, 8)}`,
        combinationKey: "",
        status: variantStatus,
      },
    });
  }
});

after(async () => {
  await prisma.productVariant.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
  await prisma.product.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

test("sitemap: includes the tenant's own active products", async () => {
  const entries = await buildSitemapEntries(tenantA.id, ORIGIN_A);
  const urls = entries.map((e) => e.url);
  assert.ok(urls.includes(`${ORIGIN_A}/products/${activeProductA.id}`));
});

test("sitemap: always includes the storefront home", async () => {
  const entries = await buildSitemapEntries(tenantA.id, ORIGIN_A);
  assert.ok(entries.some((e) => e.url === `${ORIGIN_A}/`));
});

test("sitemap: excludes draft products (not publicly renderable)", async () => {
  const entries = await buildSitemapEntries(tenantA.id, ORIGIN_A);
  const urls = entries.map((e) => e.url);
  assert.ok(!urls.includes(`${ORIGIN_A}/products/${draftProductA.id}`));
});

test("sitemap: TENANT ISOLATION — never leaks another tenant's product URLs", async () => {
  const entries = await buildSitemapEntries(tenantA.id, ORIGIN_A);
  const urls = entries.map((e) => e.url);
  assert.ok(
    !urls.some((url) => url.includes(productB.id)),
    "tenant B's product must never appear in tenant A's sitemap",
  );
});

test("sitemap: a tenant with no products still returns only its own home page", async () => {
  const entries = await buildSitemapEntries(tenantB.id, "https://shop-b.example");
  const productUrls = entries.filter((e) => e.url.includes("/products/"));
  // Tenant B has exactly one active product of its own, and none of A's.
  assert.equal(productUrls.length, 1);
  assert.ok(productUrls[0].url.includes(productB.id));
});

test("sitemap: excludes an active product with no sellable variant", async () => {
  // It returns a real 404 (see product-visibility.test.ts), and a sitemap
  // that advertises a 404 is reported by crawlers as a submitted-URL error.
  const entries = await buildSitemapEntries(tenantA.id, ORIGIN_A);
  const urls = entries.map((e) => e.url);
  assert.ok(
    !urls.includes(`${ORIGIN_A}/products/${unsellableProductA.id}`),
    "a product the storefront 404s must not be advertised",
  );
  // The sellable one is still listed, so the filter is not over-broad.
  assert.ok(urls.includes(`${ORIGIN_A}/products/${activeProductA.id}`));
});

test("sitemap: never lists customer order URLs", async () => {
  const entries = await buildSitemapEntries(tenantA.id, ORIGIN_A);
  assert.ok(!entries.some((e) => e.url.includes("/orders")));
});
