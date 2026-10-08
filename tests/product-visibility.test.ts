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
let variantlessProduct: { id: string };
let outOfStockProduct: { id: string };
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
  onHand = 10,
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
      data: { tenantId, productVariantId: variant.id, locationId: location.id, onHand },
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
  // A product with no variant row at all.
  variantlessProduct = await prisma.product.create({
    data: { tenantId: tenantA.id, name: "Túi NoVariants", status: "active" },
  });
  outOfStockProduct = await seedProduct(tenantA.id, "OutOfStock", "active", suffix, "active", 0);
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

test("an active product whose every variant is archived is NOT publicly visible", async () => {
  // The confirmed product decision: nothing purchasable means no public
  // product page. Must be the same null as a nonexistent id, so the 404
  // cannot be used to distinguish "exists but unsellable" from "no such
  // product".
  const unsellable = await getTenantProductForTenant(tenantA.id, allVariantsArchived.id);
  const nonexistent = await getTenantProductForTenant(tenantA.id, randomUUID());
  assert.equal(unsellable, null);
  assert.equal(unsellable, nonexistent);
});

test("an active product with no variant rows at all is NOT publicly visible", async () => {
  // The other way to have nothing to sell: a product that never had a
  // variant. Same rule, same null — not a special case.
  assert.equal(await getTenantProductForTenant(tenantA.id, variantlessProduct.id), null);
});

test("an out-of-stock variant still resolves — stock does not drive the status code", async () => {
  // Deliberate boundary on the rule above. The variant exists and has a
  // price, and the storefront shows it with an "Out of stock" button; if
  // stock drove visibility, a product URL would flap between 200 and 404 as
  // inventory moved, which is worse for crawlers and for customers.
  const product = await getTenantProductForTenant(tenantA.id, outOfStockProduct.id);
  assert.ok(product, "an out-of-stock product is still a real product page");
  assert.equal(product.variants.length, 1);
  assert.equal(product.variants[0].available, 0, "genuinely out of stock");
  assert.equal(product.variants[0].price, PRICE, "and still has a price to show");
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
    await getTenantProductForTenant(tenantA.id, allVariantsArchived.id),
    await getTenantProductForTenant(tenantA.id, variantlessProduct.id),
  ];
  for (const result of invalid) {
    assert.equal(result, null);
  }
});
