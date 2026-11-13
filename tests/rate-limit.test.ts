import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, __resetRateLimitStateForTests } from "../src/lib/rate-limit";

test("rate limit: allows attempts up to the max within the window", () => {
  __resetRateLimitStateForTests();
  const key = "test:allow-up-to-max";
  for (let i = 0; i < 3; i++) {
    const result = checkRateLimit(key, 3, 60_000);
    assert.equal(result.allowed, true, `attempt ${i + 1} should be allowed`);
  }
});

test("rate limit: blocks the attempt after the max is reached", () => {
  __resetRateLimitStateForTests();
  const key = "test:block-after-max";
  for (let i = 0; i < 3; i++) {
    checkRateLimit(key, 3, 60_000);
  }
  const blocked = checkRateLimit(key, 3, 60_000);
  assert.equal(blocked.allowed, false);
  if (!blocked.allowed) {
    assert.ok(blocked.retryAfterMs > 0);
  }
});

test("rate limit: different keys have independent buckets (one tenant's abuse never throttles another)", () => {
  __resetRateLimitStateForTests();
  for (let i = 0; i < 3; i++) {
    checkRateLimit("tenant-a:order-phone", 3, 60_000);
  }
  const blockedA = checkRateLimit("tenant-a:order-phone", 3, 60_000);
  const allowedB = checkRateLimit("tenant-b:order-phone", 3, 60_000);
  assert.equal(blockedA.allowed, false);
  assert.equal(allowedB.allowed, true);
});

test("rate limit: attempts outside the window no longer count", async () => {
  __resetRateLimitStateForTests();
  const key = "test:window-expiry";
  const windowMs = 50;
  checkRateLimit(key, 1, windowMs);
  const blocked = checkRateLimit(key, 1, windowMs);
  assert.equal(blocked.allowed, false);
  await new Promise((resolve) => setTimeout(resolve, windowMs + 20));
  const allowedAgain = checkRateLimit(key, 1, windowMs);
  assert.equal(allowedAgain.allowed, true);
});
