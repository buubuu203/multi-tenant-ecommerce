// Step 51: centralized so a future international-phone requirement swaps
// this one implementation without touching call sites. Vietnamese mobile
// prefixes only (03/05/07/08/09, with or without the +84 country code) —
// this platform's product scope is Vietnam-only today (see the vi-VN
// currency formatting used throughout the storefront/admin).
const VIETNAMESE_MOBILE_PATTERN = /^(0|\+84)[35789]\d{8}$/;

export function isValidVietnamesePhone(phone: string): boolean {
  return VIETNAMESE_MOBILE_PATTERN.test(phone.trim());
}

/**
 * Order Lookup by phone: checkout stores Customer.phone EXACTLY as the
 * customer typed it at checkout time (order-mutations.ts never
 * normalizes it) — so the SAME real phone number can be on file as either
 * `0912345678` or `+84912345678` depending on what the customer happened
 * to type. A lookup must match either stored form, not just whichever
 * form the customer re-types later. Returns both equivalent forms for a
 * valid Vietnamese mobile number (used as an `OR` in the lookup query,
 * never as a rewrite of stored data — no backfill/migration needed).
 * Returns an empty array for an invalid number, so a caller can treat
 * "no variants" as "nothing to search for."
 */
export function normalizedPhoneVariants(phone: string): string[] {
  const trimmed = phone.trim();
  if (!isValidVietnamesePhone(trimmed)) {
    return [];
  }
  const digits = trimmed.startsWith("+84") ? `0${trimmed.slice(3)}` : trimmed;
  const plus84 = `+84${digits.slice(1)}`;
  return [digits, plus84];
}
