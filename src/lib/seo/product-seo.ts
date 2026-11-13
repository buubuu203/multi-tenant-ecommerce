// Shared-link metadata for a product page: the Open Graph/Twitter values a
// social preview reads, and the schema.org Product JSON-LD a search engine
// reads. Both derive from the same already-loaded product, so they can
// never describe it differently.
//
// Why this matters for this product specifically: these storefronts are
// distributed by merchants pasting a link into Zalo, Facebook or a TikTok
// bio, where the preview card is the entire first impression. Before this,
// every product URL on every tenant previewed as just the store name with
// no product, price or image.
//
// Deliberately pure and DOM-free (same pattern as product-sort.ts and
// cart-reconcile.ts) so the truncation, fallback and pricing rules are
// unit-testable without a request context. It reads only values the caller
// already resolved for the current tenant; it performs no I/O and knows
// nothing about tenants, so it cannot reach across one.

/** Open Graph's own guidance is ~160 chars before clients truncate. */
const MAX_DESCRIPTION = 160;

export type ProductSeoInput = {
  productName: string;
  storeName: string;
  /** Plain-text excerpt (already tag-stripped upstream), or null. */
  descriptionExcerpt: string | null;
  /** Absolute origin of the CURRENT request, e.g. "https://shop-a.example". */
  origin: string;
  /** Root-relative path of this product page, e.g. "/products/abc". */
  productPath: string;
  /** Product image URLs in display order; may be absolute or root-relative. */
  imageUrls: string[];
  /** Tenant logo, used only as a social-preview fallback. */
  logoUrl: string | null;
  /** Effective (already-discounted) prices of the purchasable variants. */
  prices: number[];
  anyInStock: boolean;
};

/**
 * Absolute form of a possibly-relative URL. Already-absolute http(s) URLs
 * (Vercel Blob, external hosts) pass through untouched; anything else is
 * resolved against this request's origin, which is derived from the same
 * host header the tenant was resolved from.
 */
export function toAbsoluteUrl(origin: string, url: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  return `${origin.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
}

/**
 * The description a preview card shows. Prefers the product's own text and
 * truncates on a word boundary with an ellipsis; falls back to naming the
 * product and store, which is still far better than the generic storefront
 * description every product URL used to share.
 */
export function buildMetaDescription(input: {
  descriptionExcerpt: string | null;
  productName: string;
  storeName: string;
}): string {
  const excerpt = input.descriptionExcerpt?.trim();
  if (!excerpt) {
    return `${input.productName} — ${input.storeName}`;
  }
  if (excerpt.length <= MAX_DESCRIPTION) {
    return excerpt;
  }
  const clipped = excerpt.slice(0, MAX_DESCRIPTION);
  const lastSpace = clipped.lastIndexOf(" ");
  // Only break on a word boundary if one exists late enough to keep most
  // of the text; a single very long token falls back to a hard clip.
  const body = lastSpace > MAX_DESCRIPTION * 0.6 ? clipped.slice(0, lastSpace) : clipped;
  return `${body.trimEnd()}…`;
}

/**
 * The image a social preview should use: the product's first image when it
 * has one, otherwise the tenant's logo, otherwise nothing. Returns an
 * absolute URL, which Open Graph requires.
 */
export function buildSocialImageUrl(input: ProductSeoInput): string | null {
  const first = input.imageUrls.find((url) => url.trim().length > 0);
  if (first) {
    return toAbsoluteUrl(input.origin, first);
  }
  if (input.logoUrl?.trim()) {
    return toAbsoluteUrl(input.origin, input.logoUrl);
  }
  return null;
}

type Offer = {
  "@type": "Offer";
  price: number;
  priceCurrency: "VND";
  availability: string;
  url: string;
};

type AggregateOffer = {
  "@type": "AggregateOffer";
  lowPrice: number;
  highPrice: number;
  offerCount: number;
  priceCurrency: "VND";
  availability: string;
  url: string;
};

export type ProductJsonLd = {
  "@context": "https://schema.org";
  "@type": "Product";
  name: string;
  description: string;
  url: string;
  image?: string[];
  offers: Offer | AggregateOffer;
};

const IN_STOCK = "https://schema.org/InStock";
const OUT_OF_STOCK = "https://schema.org/OutOfStock";

/**
 * schema.org Product markup for this page, or null when the product has no
 * purchasable price — Google only shows merchant listings for a page a
 * shopper can actually buy on, so emitting a priceless Product would be
 * invalid markup rather than a missed opportunity.
 *
 * `image` is included ONLY when the product has real images. The logo
 * fallback above is fine for a social card but would misrepresent the
 * product in a merchant listing, so it is deliberately not reused here;
 * the consequence is that an image-less product is not listing-eligible,
 * which is accurate.
 *
 * One variant yields a plain Offer; several yield an AggregateOffer with
 * the real low/high range, so a range is never reported as a single price.
 */
export function buildProductJsonLd(input: ProductSeoInput): ProductJsonLd | null {
  const prices = input.prices.filter((p) => Number.isFinite(p));
  if (prices.length === 0) {
    return null;
  }

  const url = toAbsoluteUrl(input.origin, input.productPath);
  const availability = input.anyInStock ? IN_STOCK : OUT_OF_STOCK;
  const images = input.imageUrls
    .filter((u) => u.trim().length > 0)
    .map((u) => toAbsoluteUrl(input.origin, u));

  const low = Math.min(...prices);
  const high = Math.max(...prices);

  const offers: Offer | AggregateOffer =
    low === high
      ? { "@type": "Offer", price: low, priceCurrency: "VND", availability, url }
      : {
          "@type": "AggregateOffer",
          lowPrice: low,
          highPrice: high,
          offerCount: prices.length,
          priceCurrency: "VND",
          availability,
          url,
        };

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.productName,
    description: buildMetaDescription(input),
    url,
    ...(images.length > 0 ? { image: images } : {}),
    offers,
  };
}
