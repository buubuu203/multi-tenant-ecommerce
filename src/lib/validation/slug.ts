const MAX_SLUG_LENGTH = 63; // DNS label limit — slug becomes part of a hostname

/**
 * Deterministic slug normalization. Documented in Notion (Development Log,
 * Checkpoint 3C) before implementation — this function IS that policy, not
 * a separate "validation" step. The only failure case downstream is an
 * empty result (caller must check for that).
 *
 *   " Shop C! " -> "shop-c"
 *   "SHOP C"    -> "shop-c"
 *   "shop_c"    -> "shop-c"
 *   "shop--c"   -> "shop-c"
 */
export function normalizeSlug(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  if (normalized.length <= MAX_SLUG_LENGTH) {
    return normalized;
  }
  return normalized.slice(0, MAX_SLUG_LENGTH).replace(/-$/, "");
}
