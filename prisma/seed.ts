/**
 * Local development seed script — NOT for production use.
 * Creates two example tenants (Shop A, Shop B) with distinct branding, to
 * manually verify tenant resolution, isolation, and branding rendering.
 * Safe to re-run: upserts rather than fixed inserts.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function seedTenant(opts: {
  slug: string;
  name: string;
  subdomain: string;
  storeName: string;
  primaryColor: string;
  secondaryColor: string;
  productName: string;
  productPrice: number;
}) {
  const tenant = await prisma.tenant.upsert({
    where: { slug: opts.slug },
    update: { name: opts.name },
    create: {
      slug: opts.slug,
      name: opts.name,
      status: "active",
    },
  });

  // Replace this tenant's subdomain (rather than upserting by hostname
  // directly) so re-running the seed after changing `subdomain` doesn't
  // leave a stale, orphaned domain row behind.
  await prisma.domain.deleteMany({
    where: { tenantId: tenant.id, type: "subdomain" },
  });
  await prisma.domain.create({
    data: {
      tenantId: tenant.id,
      hostname: opts.subdomain,
      type: "subdomain",
      isPrimary: true,
    },
  });

  await prisma.branding.upsert({
    where: { tenantId: tenant.id },
    update: {
      storeName: opts.storeName,
      primaryColor: opts.primaryColor,
      secondaryColor: opts.secondaryColor,
    },
    create: {
      tenantId: tenant.id,
      storeName: opts.storeName,
      primaryColor: opts.primaryColor,
      secondaryColor: opts.secondaryColor,
    },
  });

  // Verification-only product: exactly one active product per tenant, so
  // the storefront read path has something real to render end-to-end.
  // Not a Product management feature — delete-then-create keeps this
  // idempotent, same pattern already used for the seeded Domain above.
  // Deleting the Product cascades to its ProductVariant(s) and, in turn,
  // their Inventory row(s) (both onDelete: Cascade), so no separate
  // variant/inventory cleanup is needed here.
  await prisma.product.deleteMany({ where: { tenantId: tenant.id } });

  // Architecture v4.1: price now lives on ProductVariant, not Product.
  // Every product here is a simple/no-options product, so it gets exactly
  // one variant with combinationKey === "" — same sentinel used by
  // product-mutations.ts and the v4.1 migration's own backfill.
  const product = await prisma.product.create({
    data: {
      tenantId: tenant.id,
      name: opts.productName,
      status: "active",
    },
  });

  const variant = await prisma.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      price: opts.productPrice,
      status: "active",
      combinationKey: "",
    },
  });

  // The default Location is provisioned by the v4.1 migration's own
  // backfill (one per tenant, enforced unique by the partial index
  // locations_one_default_per_tenant) — seed.ts does not create one.
  const defaultLocation = await prisma.location.findFirst({
    where: { tenantId: tenant.id, isDefault: true },
  });
  if (!defaultLocation) {
    throw new Error(`seed: no default Location found for tenant ${tenant.slug} — has the v4.1 migration been applied?`);
  }

  await prisma.inventory.create({
    data: {
      tenantId: tenant.id,
      productVariantId: variant.id,
      locationId: defaultLocation.id,
      onHand: 0,
      reserved: 0,
    },
  });

  return tenant;
}

async function main() {
  const shopA = await seedTenant({
    slug: "shop-a",
    name: "Shop A Co.",
    subdomain: "shop-a.localhost",
    storeName: "Sunrise Goods",
    primaryColor: "#e0562b",
    secondaryColor: "#2f1b12",
    productName: "Sunrise Tote Bag",
    productPrice: 250000,
  });

  const shopB = await seedTenant({
    slug: "shop-b",
    name: "Shop B Co.",
    subdomain: "shop-b.localhost",
    storeName: "Northwind Supply",
    primaryColor: "#1d4ed8",
    secondaryColor: "#0f172a",
    productName: "Northwind Camp Mug",
    productPrice: 180000,
  });

  console.log("Seeded tenants:", { shopA: shopA.slug, shopB: shopB.slug });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
