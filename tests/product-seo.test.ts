import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toAbsoluteUrl,
  buildMetaDescription,
  buildSocialImageUrl,
  buildProductJsonLd,
  type ProductSeoInput,
} from "../src/lib/seo/product-seo";

function input(overrides: Partial<ProductSeoInput> = {}): ProductSeoInput {
  return {
    productName: "Túi Tote Sunrise",
    storeName: "Sunrise Goods",
    descriptionExcerpt: "Túi vải canvas bền, may tại Việt Nam.",
    origin: "https://shop-a.example",
    productPath: "/products/abc123",
    imageUrls: ["https://blob.example/banners/t/img.jpg"],
    logoUrl: "https://blob.example/logo.png",
    prices: [200_000],
    anyInStock: true,
    ...overrides,
  };
}

test("absolute URLs pass through; relative ones resolve against this request's origin", () => {
  assert.equal(
    toAbsoluteUrl("https://shop-a.example", "https://blob.example/x.jpg"),
    "https://blob.example/x.jpg",
  );
  assert.equal(toAbsoluteUrl("https://shop-a.example", "/products/abc"), "https://shop-a.example/products/abc");
  // Duplicate slashes on either side must not produce "//".
  assert.equal(toAbsoluteUrl("https://shop-a.example/", "/products/abc"), "https://shop-a.example/products/abc");
  assert.equal(toAbsoluteUrl("https://shop-a.example", "products/abc"), "https://shop-a.example/products/abc");
});

test("TENANT ISOLATION — every URL is built from the origin the caller passed, never a hardcoded host", () => {
  // The origin comes from the request's own host header, the same one the
  // tenant was resolved from. Two tenants must produce two disjoint URL sets.
  const a = buildProductJsonLd(input({ origin: "https://shop-a.example" }))!;
  const b = buildProductJsonLd(input({ origin: "https://shop-b.example" }))!;

  assert.equal(a.url, "https://shop-a.example/products/abc123");
  assert.equal(b.url, "https://shop-b.example/products/abc123");
  assert.ok(!JSON.stringify(a).includes("shop-b"), "tenant A markup must not mention tenant B's host");
  assert.ok(!JSON.stringify(b).includes("shop-a"), "tenant B markup must not mention tenant A's host");
});

test("the description prefers the product's own text, diacritics intact", () => {
  assert.equal(buildMetaDescription(input()), "Túi vải canvas bền, may tại Việt Nam.");
});

test("a missing description falls back to naming the product and store", () => {
  // Better than the generic storefront description every product URL used
  // to share, which named no product at all.
  assert.equal(
    buildMetaDescription(input({ descriptionExcerpt: null })),
    "Túi Tote Sunrise — Sunrise Goods",
  );
  assert.equal(
    buildMetaDescription(input({ descriptionExcerpt: "   " })),
    "Túi Tote Sunrise — Sunrise Goods",
  );
});

test("a long description truncates on a word boundary with an ellipsis", () => {
  const long = "a".padEnd(40, "a") + " " + "chiếc túi rất đẹp".repeat(20);
  const out = buildMetaDescription(input({ descriptionExcerpt: long }));
  assert.ok(out.length <= 161, `expected <=161 chars, got ${out.length}`);
  assert.ok(out.endsWith("…"));
  assert.ok(!out.includes("  "), "must not leave trailing whitespace before the ellipsis");
});

test("a single unbroken token still truncates rather than overflowing", () => {
  const out = buildMetaDescription(input({ descriptionExcerpt: "x".repeat(400) }));
  assert.ok(out.length <= 161, `expected <=161 chars, got ${out.length}`);
  assert.ok(out.endsWith("…"));
});

test("the social image is the product's first image, made absolute", () => {
  assert.equal(buildSocialImageUrl(input()), "https://blob.example/banners/t/img.jpg");
});

test("with no product image the social card falls back to the tenant logo", () => {
  assert.equal(buildSocialImageUrl(input({ imageUrls: [] })), "https://blob.example/logo.png");
});

test("with neither image nor logo there is no social image at all", () => {
  // Omitted rather than invented — a wrong preview image is worse than none.
  assert.equal(buildSocialImageUrl(input({ imageUrls: [], logoUrl: null })), null);
});

test("a single-price product yields a plain Offer in VND", () => {
  const ld = buildProductJsonLd(input())!;
  assert.equal(ld["@type"], "Product");
  assert.equal(ld.name, "Túi Tote Sunrise");
  assert.deepEqual(ld.offers, {
    "@type": "Offer",
    price: 200_000,
    priceCurrency: "VND",
    availability: "https://schema.org/InStock",
    url: "https://shop-a.example/products/abc123",
  });
});

test("the advertised price is the discounted one the page shows", () => {
  // prices are the already-discounted effective prices, so a preview can
  // never advertise a price the store will not honour.
  const ld = buildProductJsonLd(input({ prices: [200_000] }))!;
  assert.equal((ld.offers as { price: number }).price, 200_000);
});

test("several variant prices yield an AggregateOffer with the real range", () => {
  const ld = buildProductJsonLd(input({ prices: [60_000, 320_000, 200_000] }))!;
  assert.deepEqual(ld.offers, {
    "@type": "AggregateOffer",
    lowPrice: 60_000,
    highPrice: 320_000,
    offerCount: 3,
    priceCurrency: "VND",
    availability: "https://schema.org/InStock",
    url: "https://shop-a.example/products/abc123",
  });
});

test("out of stock is reported as OutOfStock, not omitted", () => {
  const ld = buildProductJsonLd(input({ anyInStock: false }))!;
  assert.equal((ld.offers as { availability: string }).availability, "https://schema.org/OutOfStock");
});

test("FAILURE PATH — a product with no price emits no markup at all", () => {
  // Google only shows merchant listings for a page a shopper can buy on,
  // so a priceless Product would be invalid markup rather than a missed
  // opportunity. Explicit null, not a partial object.
  assert.equal(buildProductJsonLd(input({ prices: [] })), null);
  assert.equal(buildProductJsonLd(input({ prices: [Number.NaN] })), null);
});

test("the logo is NOT reused as a merchant-listing image", () => {
  // Fine for a social card, but it would misrepresent the product in a
  // listing. An image-less product is simply not listing-eligible.
  const ld = buildProductJsonLd(input({ imageUrls: [], logoUrl: "https://blob.example/logo.png" }))!;
  assert.equal(ld.image, undefined);
  assert.ok(!JSON.stringify(ld).includes("logo.png"));
});

test("all product images are included, in order, absolute", () => {
  const ld = buildProductJsonLd(input({ imageUrls: ["/a.jpg", "https://blob.example/b.jpg"] }))!;
  assert.deepEqual(ld.image, ["https://shop-a.example/a.jpg", "https://blob.example/b.jpg"]);
});

test("blank image URLs are skipped rather than emitted as the origin", () => {
  const ld = buildProductJsonLd(input({ imageUrls: ["", "  ", "/real.jpg"] }))!;
  assert.deepEqual(ld.image, ["https://shop-a.example/real.jpg"]);
});
