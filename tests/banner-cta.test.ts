import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCtaUrl } from "../src/lib/banner-mutations";

test("CTA: rejects javascript: URLs", () => {
  const result = validateCtaUrl("javascript:alert(1)");
  assert.ok("error" in result);
});

test("CTA: rejects data: URLs", () => {
  const result = validateCtaUrl("data:text/html,<script>alert(1)</script>");
  assert.ok("error" in result);
});

test("CTA: rejects protocol-relative //evil.com URLs", () => {
  const result = validateCtaUrl("//evil.com");
  assert.ok("error" in result);
});

test("CTA: accepts a same-site relative path", () => {
  const result = validateCtaUrl("/products/abc123");
  assert.deepEqual(result, { url: "/products/abc123" });
});

test("CTA: accepts a full https:// URL", () => {
  const result = validateCtaUrl("https://example.com/promo");
  assert.deepEqual(result, { url: "https://example.com/promo" });
});

test("CTA: accepts a full http:// URL", () => {
  const result = validateCtaUrl("http://example.com/promo");
  assert.deepEqual(result, { url: "http://example.com/promo" });
});

test("CTA: an empty string is valid (means 'no CTA URL')", () => {
  const result = validateCtaUrl("   ");
  assert.deepEqual(result, { url: "" });
});

test("CTA: rejects a bare domain with no scheme", () => {
  const result = validateCtaUrl("evil.com");
  assert.ok("error" in result);
});
