// DB-backed tests — LOCAL dev Postgres only, no Preview/Production
// credentials. See tests/order-lookup.test.ts for the same convention.
// Env loading happens in tests/env-setup.ts, preloaded via the npm test
// script's `--import` flag — see that file's comment for why it can't
// happen here (ESM module-evaluation ordering).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { createBanner, updateBanner, deleteBanner, listBanners } from "../src/lib/banner-mutations";

let tenantA: { id: string };
let tenantB: { id: string };

const baseInput = { ctaLabel: "", ctaUrl: "", enabled: true, sortOrder: "0" };

before(async () => {
  const suffix = randomUUID().slice(0, 8);
  tenantA = await prisma.tenant.create({
    data: { slug: `test-banner-a-${suffix}`, name: "Test Banner Tenant A", status: "active" },
  });
  tenantB = await prisma.tenant.create({
    data: { slug: `test-banner-b-${suffix}`, name: "Test Banner Tenant B", status: "active" },
  });
});

after(async () => {
  await prisma.banner.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

test("mobile fallback: null mobileImageUrl is accepted and stored as null", async () => {
  const result = await createBanner(tenantA.id, "https://blob.example/a/d.jpg", null, baseInput);
  assert.equal(result.success, true);
  const [banner] = await listBanners(tenantA.id);
  assert.equal(banner.mobileImageUrl, null);
});

test("tenant isolation: tenant B cannot see tenant A's banners", async () => {
  const banners = await listBanners(tenantB.id);
  assert.equal(banners.length, 0);
});

test("tenant isolation: tenant B cannot update tenant A's banner by id", async () => {
  const [bannerA] = await listBanners(tenantA.id);
  const result = await updateBanner(tenantB.id, bannerA.id, null, null, baseInput);
  assert.equal(result.success, false);
  const stillThere = await prisma.banner.findUnique({ where: { id: bannerA.id } });
  assert.equal(stillThere?.tenantId, tenantA.id);
});

test("tenant isolation: tenant B cannot delete tenant A's banner by id", async () => {
  const [bannerA] = await listBanners(tenantA.id);
  const result = await deleteBanner(tenantB.id, bannerA.id);
  assert.equal(result.success, false);
  const stillThere = await prisma.banner.findUnique({ where: { id: bannerA.id } });
  assert.ok(stillThere);
});

test("replace: updateBanner returns the previous image URLs for safe blob cleanup", async () => {
  await createBanner(tenantB.id, "https://blob.example/b/old-d.jpg", "https://blob.example/b/old-m.jpg", baseInput);
  const [banner] = await listBanners(tenantB.id);
  const updated = await updateBanner(
    tenantB.id,
    banner.id,
    "https://blob.example/b/new-d.jpg",
    "https://blob.example/b/new-m.jpg",
    baseInput,
  );
  assert.equal(updated.success, true);
  if (updated.success) {
    assert.equal(updated.data.previousImageUrl, "https://blob.example/b/old-d.jpg");
    assert.equal(updated.data.previousMobileImageUrl, "https://blob.example/b/old-m.jpg");
  }
});

test("delete: returns both image URLs, null when no mobile image existed", async () => {
  const created = await createBanner(tenantB.id, "https://blob.example/b/solo.jpg", null, baseInput);
  assert.equal(created.success, true);
  const banners = await listBanners(tenantB.id);
  const target = banners.find((b) => b.imageUrl === "https://blob.example/b/solo.jpg")!;
  const deleted = await deleteBanner(tenantB.id, target.id);
  assert.equal(deleted.success, true);
  if (deleted.success) {
    assert.equal(deleted.data.mobileImageUrl, null);
  }
});

test("safe CTA: javascript: URL is rejected at the mutation layer too", async () => {
  const result = await createBanner(tenantA.id, "https://blob.example/a/x.jpg", null, {
    ...baseInput,
    ctaLabel: "Click",
    ctaUrl: "javascript:alert(1)",
  });
  assert.equal(result.success, false);
});

test("safe CTA: a label without a URL is stored as no-CTA", async () => {
  const result = await createBanner(tenantA.id, "https://blob.example/a/y.jpg", null, {
    ...baseInput,
    ctaLabel: "Only a label",
    ctaUrl: "",
  });
  assert.equal(result.success, true);
  const banners = await listBanners(tenantA.id);
  const banner = banners.find((b) => b.imageUrl === "https://blob.example/a/y.jpg");
  assert.equal(banner?.ctaLabel, null);
  assert.equal(banner?.ctaUrl, null);
});
