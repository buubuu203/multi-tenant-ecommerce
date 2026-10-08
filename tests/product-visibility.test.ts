// DB-backed tests — LOCAL dev Postgres only. See tests/README.md.
//
// These cover what the PDP route turns into a 404. getTenantProduct() reads
// the trusted x-tenant-id header and so needs a request context, which this
// runner has none of; getTenantProductForTenant() is the same decision with
// tenantId passed in explicitly, so the rules can be asserted directly
// against a real database rather than inferred from rendered page text.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { getTenantProductForTenant } from "../src/app/_storefront/get-tenant-products";

const PRICE = 150_000;

let tenantA: { id: string };
let tenantB: { id: string };
let activeProduct: { id: string };
let draftProduct: { id: string };
let allVariantsArchived: { id: string };
let tenantBProduct: { id: string };

// ProductStatus is only `draft | active` — there is no archived PRODUCT
// state in this schema; `archived` belongs to ProductVariantStatus. So
// "not publicly sellable" means draft at the product level, and archived
// at the variant level, and both are covered below.
async function seedProduct(
  tenantId: string,
  label: string,
  status: "draft" | "active",
  suffix: string,
  variantStatus: "active" | "archived" = "active",
) {
  const location = await prisma.location.findFirst({ where: { tenantId, isDefault: true } });
  const product = await prisma.product.create({
    data: { tenantId, name: `Túi ${label}`, status, description: "Túi vải canvas bền, may tại Việt Nam." },
  });
  const variant = await prisma.productVariant.create({
    data: {
      tenantId,
      productId: product.id,
      price: PRICE,
      sku: `VIS-${label}-${suffix}`,
      combinationKey: "",
      status: variantStatus,
    },
  });
  if (location) {
    await prisma.inventory.create({
      data: { tenantId, productVariantId: variant.id, locationId: location.id, onHand: 10 },
    });
  }
  return product;
}

before(async () => {
  const suffix = randomUUID().slice(0, 8);
  tenantA = await prisma.tenant.create({
    data: { slug: `test-vis-a-${suffix}`, name: "Visibility A", status: "active" },
  });
  tenantB = await prisma.tenant.create({
    data: { slug: `test-vis-b-${suffix}`, name: "Visibility B", status: "active" },
  });
  for (const t of [tenantA, tenantB]) {
    await prisma.location.create({ data: { tenantId: t.id, name: "Main", isDefault: true } });
  }
  activeProduct = await seedProduct(tenantA.id, "Active", "active", suffix);
  draftProduct = await seedProduct(tenantA.id, "Draft", "draft", suffix);
  allVariantsArchived = await seedProduct(tenantA.id, "ArchivedVariants", "active", suffix, "archived");
  tenantBProduct = await seedProduct(tenantB.id, "OtherTenant", "active", suffix);
});

after(async () => {
  const tenantIds = [tenantA.id, tenantB.id];
  await prisma.inventory.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.productVariant.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.product.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.location.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

test("a valid active product resolves, with its price and Vietnamese description", () => {
  return getTenantProductForTenant(tenantA.id, activeProduct.id).then((product) => {
    assert.ok(product, "an active product must resolve");
    assert.equal(product.id, activeProduct.id);
    assert.equal(product.name, "Túi Active");
    assert.equal(product.variants[0].price, PRICE);
    // Diacritics survive the excerpt derivation that feeds the meta description.
    assert.match(product.descriptionExcerpt ?? "", /Túi vải canvas bền, may tại Việt Nam\./);
  });
});

test("a nonexistent product id resolves to null → the route's 404", async () => {
  assert.equal(await getTenantProductForTenant(tenantA.id, randomUUID()), null);
});

test("a malformed product id resolves to null rather than throwing", async () => {
  // A non-uuid id must not surface a Prisma error as a 500; it is simply
  // not found, same as any other unknown id.
  assert.equal(await getTenantProductForTenant(tenantA.id, "not-a-uuid"), null);
  assert.equal(await getTenantProductForTenant(tenantA.id, "../../etc/passwd"), null);
  assert.equal(await getTenantProductForTenant(tenantA.id, ""), null);
  assert.equal(await getTenantProductForTenant(tenantA.id, "   "), null);
});

test("a draft product is not publicly visible", async () => {
  assert.equal(await getTenantProductForTenant(tenantA.id, draftProduct.id), null);
});

test("an active product whose only variant is archived resolves with nothing purchasable", async () => {
  // Documents real current behavior rather than asserting a wish: the
  // PRODUCT is active so it is not a 404, but every variant is archived and
  // therefore excluded, leaving no price. buildProductJsonLd() returns null
  // for exactly that case (see product-seo.test.ts), so such a page emits no
  // Product markup. Whether it should 404 instead is a product decision, not
  // part of this status-code fix.
  const product = await getTenantProductForTenant(tenantA.id, allVariantsArchived.id);
  assert.ok(product, "the product itself is active, so it still resolves");
  assert.equal(product.variants.length, 0, "archived variants are excluded");
});

test("TENANT ISOLATION — another tenant's product id behaves exactly like a nonexistent one", async () => {
  // Same null, no error, no partial object: the caller cannot distinguish
  // "exists but isn't yours" from "doesn't exist", so a 404 reveals nothing.
  const crossTenant = await getTenantProductForTenant(tenantA.id, tenantBProduct.id);
  const nonexistent = await getTenantProductForTenant(tenantA.id, randomUUID());
  assert.equal(crossTenant, null);
  assert.equal(crossTenant, nonexistent);

  // And the reverse direction, so the rule is not one-way.
  assert.equal(await getTenantProductForTenant(tenantB.id, activeProduct.id), null);
  // Each tenant still sees its own.
  assert.ok(await getTenantProductForTenant(tenantB.id, tenantBProduct.id));
});

test("a blank tenant id resolves to null, never a cross-tenant match", async () => {
  // Defensive: if tenant resolution ever yielded an empty string, this must
  // not degrade into an unscoped lookup that matches any tenant's product.
  assert.equal(await getTenantProductForTenant("", activeProduct.id), null);
  assert.equal(await getTenantProductForTenant("   ", activeProduct.id), null);
});

test("NO LEAKAGE — every invalid case yields null, so no name, price or image exists to render", async () => {
  // The route feeds this same null into both generateMetadata() and the
  // JSON-LD builder, so null here is what guarantees no OG tag, canonical
  // URL, price or image is emitted for an invalid product.
  const invalid = [
    await getTenantProductForTenant(tenantA.id, randomUUID()),
    await getTenantProductForTenant(tenantA.id, "not-a-uuid"),
    await getTenantProductForTenant(tenantA.id, draftProduct.id),
    await getTenantProductForTenant(tenantA.id, tenantBProduct.id),
  ];
  for (const result of invalid) {
    assert.equal(result, null);
  }
});
