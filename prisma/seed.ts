/**
 * Local development seed script — NOT for production use.
 * Creates two example tenants (Shop A, Shop B) to verify the schema and
 * tenant isolation manually. Safe to re-run: uses upsert, not fixed inserts.
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
}) {
  const tenant = await prisma.tenant.upsert({
    where: { slug: opts.slug },
    update: {},
    create: {
      slug: opts.slug,
      name: opts.name,
      status: "active",
    },
  });

  await prisma.domain.upsert({
    where: { hostname: opts.subdomain },
    update: {},
    create: {
      tenantId: tenant.id,
      hostname: opts.subdomain,
      type: "subdomain",
      isPrimary: true,
    },
  });

  await prisma.branding.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: {
      tenantId: tenant.id,
      storeName: opts.storeName,
      primaryColor: opts.primaryColor,
    },
  });

  return tenant;
}

async function main() {
  const shopA = await seedTenant({
    slug: "shop-a",
    name: "Shop A Co.",
    subdomain: "shop-a.yourplatform.com",
    storeName: "Shop A",
    primaryColor: "#2563eb",
  });

  const shopB = await seedTenant({
    slug: "shop-b",
    name: "Shop B Co.",
    subdomain: "shop-b.yourplatform.com",
    storeName: "Shop B",
    primaryColor: "#16a34a",
  });

  console.log("Seeded tenants:", { shopA: shopA.slug, shopB: shopB.slug });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
