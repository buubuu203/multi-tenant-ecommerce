import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStoreDescription,
  buildStoreJsonLd,
  buildStoreOgTitle,
  type StoreSeoInput,
} from "../src/lib/seo/store-seo";

function input(overrides: Partial<StoreSeoInput> = {}): StoreSeoInput {
  return {
    storeName: "PoPrint",
    tagline: "In ấn theo yêu cầu, giao toàn quốc",
    ogDescription: null,
    origin: "https://poprint.store",
    logoUrl: "https://blob.example/logo.png",
    socialUrls: ["https://facebook.com/poprint", null, "https://instagram.com/poprint"],
    ...overrides,
  };
}

test("with no ogDescription, the description falls back to the merchant's own tagline", () => {
  assert.equal(buildStoreDescription(input()), "In ấn theo yêu cầu, giao toàn quốc");
});

test("ogDescription, when set, takes priority over tagline", () => {
  assert.equal(
    buildStoreDescription(input({ ogDescription: "Mô tả dài hơn cho Google và mạng xã hội." })),
    "Mô tả dài hơn cho Google và mạng xã hội.",
  );
});

test("neither ogDescription nor tagline falls back to a generic line naming the store", () => {
  assert.equal(buildStoreDescription(input({ tagline: null })), "PoPrint — cửa hàng trực tuyến");
  assert.equal(buildStoreDescription(input({ tagline: "   " })), "PoPrint — cửa hàng trực tuyến");
  assert.equal(
    buildStoreDescription(input({ tagline: null, ogDescription: "   " })),
    "PoPrint — cửa hàng trực tuyến",
  );
});

test("the social-share title combines store name and tagline; falls back to the bare store name", () => {
  assert.equal(buildStoreOgTitle(input()), "PoPrint — In ấn theo yêu cầu, giao toàn quốc");
  assert.equal(buildStoreOgTitle(input({ tagline: null })), "PoPrint");
});

test("Organization JSON-LD carries name, url and description", () => {
  const ld = buildStoreJsonLd(input());
  assert.equal(ld["@type"], "Organization");
  assert.equal(ld.name, "PoPrint");
  assert.equal(ld.url, "https://poprint.store");
  assert.equal(ld.description, "In ấn theo yêu cầu, giao toàn quốc");
});

test("TENANT ISOLATION — url is built from the origin the caller passed, never a hardcoded host", () => {
  const a = buildStoreJsonLd(input({ origin: "https://shop-a.example" }));
  const b = buildStoreJsonLd(input({ origin: "https://shop-b.example" }));
  assert.equal(a.url, "https://shop-a.example");
  assert.equal(b.url, "https://shop-b.example");
});

test("sameAs lists only the social URLs actually set, dropping nulls", () => {
  const ld = buildStoreJsonLd(input());
  assert.deepEqual(ld.sameAs, ["https://facebook.com/poprint", "https://instagram.com/poprint"]);
});

test("no social URLs at all omits sameAs rather than emitting an empty array", () => {
  const ld = buildStoreJsonLd(input({ socialUrls: [null, null] }));
  assert.equal(ld.sameAs, undefined);
});

test("no logo omits the field rather than inventing a placeholder", () => {
  const ld = buildStoreJsonLd(input({ logoUrl: null }));
  assert.equal(ld.logo, undefined);
  assert.ok(!JSON.stringify(ld).includes("logo.png"));
});
