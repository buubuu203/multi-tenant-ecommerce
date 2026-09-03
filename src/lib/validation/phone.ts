// Step 51: centralized so a future international-phone requirement swaps
// this one implementation without touching call sites. Vietnamese mobile
// prefixes only (03/05/07/08/09, with or without the +84 country code) —
// this platform's product scope is Vietnam-only today (see the vi-VN
// currency formatting used throughout the storefront/admin).
const VIETNAMESE_MOBILE_PATTERN = /^(0|\+84)[35789]\d{8}$/;

export function isValidVietnamesePhone(phone: string): boolean {
  return VIETNAMESE_MOBILE_PATTERN.test(phone.trim());
}
