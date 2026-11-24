import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStoreDescription,
  buildStoreJsonLd,
  type StoreSeoInput,
} from "../src/lib/seo/store-seo";

function input(overrides: Partial<StoreSeoInput> = {}): StoreSeoInput {
  return {
    storeName: "PoPrint",
    tagline: "In ấn theo yêu cầu, giao toàn quốc",
    origin: "https://poprint.store",
    logoUrl: "https://blob.example/logo.png",
    socialUrls: ["https://facebook.com/poprint", null, "https://instagram.com/poprint"],
    ...overrides,
  };
}

test("the description prefers the merchant's own tagline", () => {
  assert.equal(buildStoreDescription(input()), "In ấn theo yêu cầu, giao toàn quốc");
});

test("no tagline falls back to a generic line naming the store", () => {
  assert.equal(buildStoreDescription(input({ tagline: null })), "PoPrint — cửa hàng trực tuyến");
  assert.equal(buildStoreDescription(input({ tagline: "   " })), "PoPrint — cửa hàng trực tuyến");
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
