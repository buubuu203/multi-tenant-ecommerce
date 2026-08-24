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
  });

  const shopB = await seedTenant({
    slug: "shop-b",
    name: "Shop B Co.",
    subdomain: "shop-b.localhost",
    storeName: "Northwind Supply",
    primaryColor: "#1d4ed8",
    secondaryColor: "#0f172a",
  });

  console.log("Seeded tenants:", { shopA: shopA.slug, shopB: shopB.slug });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
