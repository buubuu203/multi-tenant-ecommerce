// Order Lookup abuse protection (V1). Fixed-window-ish sliding counter,
// in-process module state — deliberately NOT a distributed store (no
// Redis/Upstash is configured for this project, and adding one is an
// infrastructure decision, not something to introduce silently inside a
// lookup helper).
//
// KNOWN LIMITATION, stated plainly rather than implied: on Vercel's
// serverless platform, each warm Lambda instance holds its own copy of
// this Map. A high-volume attacker whose requests land across many cold/
// concurrent instances is NOT fully blocked by this alone — it raises the
// cost of casual/scripted abuse from a single warm connection (the common
// case for an automated brute-force attempt hitting one instance
// repeatedly) without requiring new paid infrastructure. A fully
// distributed limiter would need an external store (e.g. Upstash Redis)
// and is a deliberate follow-up, not V1 scope — see the roadmap doc.
//
// This never weakens the actual verification requirement (order id +
// phone/email, or name + phone together) — it only throttles how many
// attempts a given key gets in a time window, on top of that.

type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

// Periodic cleanup so this Map can't grow unbounded over a long-lived warm
// instance — buckets untouched for 10 minutes are dropped.
const STALE_BUCKET_MS = 10 * 60 * 1000;
let lastSweep = Date.now();

function sweepIfDue(now: number) {
  if (now - lastSweep < STALE_BUCKET_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    const newest = bucket.timestamps[bucket.timestamps.length - 1];
    if (newest === undefined || now - newest > STALE_BUCKET_MS) {
      buckets.delete(key);
    }
  }
}

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number };

/**
 * Records one attempt for `key` and reports whether it's allowed under
 * `maxAttempts` per `windowMs`. Call this ONCE per real lookup attempt
 * (not per keystroke) — typically keyed as
 * `${tenantId}:${action}:${normalizedIdentifier}` so a burst against one
 * specific order/customer is throttled without penalizing unrelated
 * customers on the same tenant searching for their own, different order.
 */
export function checkRateLimit(key: string, maxAttempts: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweepIfDue(now);

  const bucket = buckets.get(key) ?? { timestamps: [] };
  const windowStart = now - windowMs;
  bucket.timestamps = bucket.timestamps.filter((t) => t > windowStart);

  if (bucket.timestamps.length >= maxAttempts) {
    const retryAfterMs = bucket.timestamps[0] + windowMs - now;
    buckets.set(key, bucket);
    return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return { allowed: true };
}

/** Test-only: clears all rate-limit state between test runs. */
export function __resetRateLimitStateForTests() {
  buckets.clear();
}
