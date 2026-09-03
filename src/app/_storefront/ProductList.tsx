"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { TenantProduct, TenantProductVariant } from "./get-tenant-products";
import { useCart } from "./cart-context";
import { ProductMediaCarousel } from "./ProductMediaCarousel";

function formatVnd(price: number): string {
  return `${price.toLocaleString("vi-VN")} ₫`;
}

// Step 40: a fixed, non-configurable threshold for the lightweight
// "Only N left" hint — deliberately not a database field, admin setting,
// or prop; this is a small presentation rule, not a merchant-facing
// feature.
const LOW_STOCK_THRESHOLD = 5;

// Resolves a customer's selection (one VariantOptionValue id per option) to
// the exact ProductVariant whose full set of option/value pairs matches the
// selection exactly — using only the real ProductVariantOptionValue
// relationships already loaded from Prisma (see get-tenant-products.ts).
// Never reads or reconstructs combinationKey.
export function resolveVariant(
  variants: TenantProductVariant[],
  selection: Record<string, string>,
  optionIds: string[],
): TenantProductVariant | null {
  if (optionIds.length === 0 || optionIds.some((id) => !selection[id])) {
    return null; // no options to select, or an incomplete selection
  }
  return (
    variants.find(
      (variant) =>
        variant.options.length === optionIds.length &&
        variant.options.every((ov) => selection[ov.variantOptionId] === ov.variantOptionValueId),
    ) ?? null
  );
}

// A value is selectable if at least one active (already-loaded) variant
// carries it AND matches every OTHER currently-selected option's value.
// The target option's own current selection is deliberately excluded from
// the "must match" set — that's what lets a value of the option being
// evaluated stay selectable (or not) independent of what's presently
// chosen for that same option. Pure, synchronous, no DB access, no
// combinationKey involved — only the real ProductVariantOptionValue pairs
// already loaded onto each variant.
export function isValueSelectable(
  variants: TenantProductVariant[],
  selection: Record<string, string>,
  targetOptionId: string,
  targetValueId: string,
): boolean {
  const otherSelections = Object.entries(selection).filter(([optionId]) => optionId !== targetOptionId);
  return variants.some((variant) => {
    const hasTarget = variant.options.some(
      (ov) => ov.variantOptionId === targetOptionId && ov.variantOptionValueId === targetValueId,
    );
    if (!hasTarget) {
      return false;
    }
    return otherSelections.every(([optionId, valueId]) =>
      variant.options.some((ov) => ov.variantOptionId === optionId && ov.variantOptionValueId === valueId),
    );
  });
}

// Annotates every value of one option with whether it's currently
// selectable, given the rest of the selection. Used to render disabled
// <option> entries without hiding them.
export function getAvailableValues(
  variants: TenantProductVariant[],
  targetOptionId: string,
  values: { variantOptionValueId: string; valueLabel: string }[],
  selection: Record<string, string>,
): { variantOptionValueId: string; valueLabel: string; selectable: boolean }[] {
  return values.map((value) => ({
    ...value,
    selectable: isValueSelectable(variants, selection, targetOptionId, value.variantOptionValueId),
  }));
}

// After changing `changedOptionId` to `changedValueId` (or clearing it),
// drops any OTHER currently-selected value that is no longer selectable
// given the updated selection — a single deterministic pass, not a
// recursive fixpoint search (sufficient for the option counts this
// storefront deals with, and avoids ambiguous multi-step resolution order).
export function applySelection(
  variants: TenantProductVariant[],
  previous: Record<string, string>,
  changedOptionId: string,
  changedValueId: string,
): Record<string, string> {
  const next: Record<string, string> = { ...previous };
  if (changedValueId) {
    next[changedOptionId] = changedValueId;
  } else {
    delete next[changedOptionId];
  }

  for (const optionId of Object.keys(next)) {
    if (optionId === changedOptionId) {
      continue;
    }
    if (!isValueSelectable(variants, next, optionId, next[optionId])) {
      delete next[optionId];
    }
  }

  return next;
}

// Step 46: exported so the product detail page (/products/[productId])
// can reuse this exact component — same variant-selection/cart logic, no
// second implementation. `linkToDetail` defaults to true (used by the
// list); the detail page passes false so the product isn't linked to
// itself.
// Step 50: a plain thumbnail for the list-card context — the full
// carousel (ProductMediaCarousel) is reserved for the detail page. A
// video's thumbnail is the video element itself (muted, no controls,
// paused) with a play-indicator overlay, matching the same convention
// used in Tenant Admin's ProductMediaGallery previews.
export function MediaThumbnail({ media, alt }: { media: { type: "image" | "video"; url: string }; alt: string }) {
  if (media.type === "image") {
    // eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra in this MVP
    return <img src={media.url} alt={alt} className="aspect-square w-full rounded-md object-cover" />;
  }
  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-md">
      <video src={media.url} muted className="h-full w-full object-cover" />
      <span className="absolute inset-0 flex items-center justify-center bg-black/10 text-2xl text-white">▶</span>
    </div>
  );
}

export function ProductRow({ product, linkToDetail = true }: { product: TenantProduct; linkToDetail?: boolean }) {
  // Simple-product path: unchanged from before this step — a product with
  // exactly one variant carrying the combinationKey === "" sentinel (the
  // same convention product-mutations.ts and Tenant Admin already use)
  // renders exactly as it did before variant selection existed.
  const simpleVariant =
    product.variants.length === 1 && product.variants[0].combinationKey === "" ? product.variants[0] : null;

  // Derived purely from this product's own already-loaded variant data —
  // no extra fetch, one pass over variants/options.
  const options = useMemo(() => {
    if (simpleVariant) {
      return [];
    }
    const byOption = new Map<string, { optionName: string; values: Map<string, string> }>();
    for (const variant of product.variants) {
      for (const ov of variant.options) {
        const entry = byOption.get(ov.variantOptionId) ?? { optionName: ov.optionName, values: new Map<string, string>() };
        entry.values.set(ov.variantOptionValueId, ov.valueLabel);
        byOption.set(ov.variantOptionId, entry);
      }
    }
    return [...byOption.entries()]
      .map(([variantOptionId, { optionName, values }]) => ({
        variantOptionId,
        optionName,
        values: [...values.entries()]
          .map(([variantOptionValueId, valueLabel]) => ({ variantOptionValueId, valueLabel }))
          .sort((a, b) => a.valueLabel.localeCompare(b.valueLabel)),
      }))
      .sort((a, b) => a.optionName.localeCompare(b.optionName));
  }, [product, simpleVariant]);

  const optionIds = useMemo(() => options.map((o) => o.variantOptionId), [options]);
  const [selection, setSelection] = useState<Record<string, string>>({});
  const { items, addItem } = useCart();

  const resolvedVariant = simpleVariant ?? resolveVariant(product.variants, selection, optionIds);
  const hasCompleteSelection = optionIds.length > 0 && optionIds.every((id) => selection[id]);
  // Step 50: sortOrder 0 IS the primary media everywhere the app needs
  // one — media is already returned pre-sorted by get-tenant-products.ts.
  const primaryMedia = product.media[0];

  // Step 39: stock unavailability is a SEPARATE concept from combination
  // unavailability (Step 25) — the variant genuinely exists here
  // (resolvedVariant is non-null), it just has no available stock. Never
  // folded into isValueSelectable()/"(unavailable)", which remain about
  // combination EXISTENCE only, unchanged.
  const cartQuantity = resolvedVariant
    ? (items.find((i) => i.productVariantId === resolvedVariant.id)?.quantity ?? 0)
    : 0;
  const outOfStock = resolvedVariant ? resolvedVariant.available <= 0 : false;
  const atAvailableLimit = resolvedVariant ? cartQuantity >= resolvedVariant.available : false;

  // Step 40: a third, separate concept from combination-existence (Step 25)
  // and out-of-stock (Step 39) — the variant exists AND has stock, just not
  // much of it. Only ever shown alongside the normal in-stock price/button
  // state below, never in place of "Out of stock" or "(unavailable)".
  const lowStockHint =
    resolvedVariant && !outOfStock && resolvedVariant.available <= LOW_STOCK_THRESHOLD
      ? `Only ${resolvedVariant.available} left`
      : null;

  let priceDisplay: string;
  let addToCartLabel: string;
  if (resolvedVariant && outOfStock) {
    priceDisplay = "Out of stock";
    addToCartLabel = "Out of stock";
  } else if (resolvedVariant) {
    // Covers both the simple-product case (resolvedVariant === simpleVariant,
    // unchanged price behavior from before Step 24) and a fully-resolved
    // variant-bearing selection.
    priceDisplay = formatVnd(resolvedVariant.price);
    addToCartLabel = atAvailableLimit ? "Max in cart" : "Add to cart";
  } else if (hasCompleteSelection) {
    priceDisplay = "Combination unavailable";
    addToCartLabel = "Combination unavailable";
  } else {
    priceDisplay = "Select options";
    addToCartLabel = "Select options";
  }

  function handleAddToCart() {
    if (!resolvedVariant || outOfStock || atAvailableLimit) {
      // incomplete selection, unavailable combination, out of stock, or
      // already holding as much of this variant as is available — nothing
      // to add. The server-side reservation in createOrder() remains the
      // authoritative check regardless; this only prevents the obvious
      // over-selection case client-side (see this file's Step 39 doc
      // comments and CartWidget.tsx for the stale-availability posture).
      return;
    }
    // variantLabel is display-only (deterministically sorted by option
    // name, same convention as Tenant Admin's variant table) — never
    // combinationKey, and never used as the cart item's identity.
    const variantLabel = resolvedVariant.options.length
      ? [...resolvedVariant.options]
          .sort((a, b) => a.optionName.localeCompare(b.optionName))
          .map((o) => `${o.optionName}: ${o.valueLabel}`)
          .join(" / ")
      : "";
    addItem({
      productVariantId: resolvedVariant.id,
      productId: product.id,
      productName: product.name,
      variantLabel,
      price: resolvedVariant.price,
      imageUrl: primaryMedia?.url,
    });
  }

  // Step 50 (revised): variant options get their own labeled block on the
  // detail page (larger, one-per-line) so a product with several options
  // stays legible as more get added — the card view keeps the original
  // compact wrapped-row layout, since a list card has no room to spare.
  const optionsBlock = !simpleVariant && options.length > 0 && (
    <div className={linkToDetail ? "flex flex-wrap gap-3 text-xs" : "flex flex-col gap-3 text-sm"}>
      {options.map((option) => {
        const annotatedValues = getAvailableValues(product.variants, option.variantOptionId, option.values, selection);
        return (
          <label key={option.variantOptionId} className="flex flex-col gap-1">
            <span className={linkToDetail ? "text-muted-foreground" : "text-xs font-medium tracking-wide text-muted-foreground uppercase"}>
              {option.optionName}
            </span>
            <select
              className={
                linkToDetail
                  ? "rounded-md border border-border bg-background px-2 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                  : "w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
              }
              value={selection[option.variantOptionId] ?? ""}
              onChange={(e) =>
                setSelection((prev) => applySelection(product.variants, prev, option.variantOptionId, e.target.value))
              }
            >
              <option value="">Select {option.optionName}</option>
              {annotatedValues.map((value) => (
                <option key={value.variantOptionValueId} value={value.variantOptionValueId} disabled={!value.selectable}>
                  {value.valueLabel}
                  {value.selectable ? "" : " (unavailable)"}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );

  const addToCartButton = (
    <button
      type="button"
      onClick={handleAddToCart}
      disabled={!resolvedVariant || outOfStock || atAvailableLimit}
      className={
        linkToDetail
          ? "w-full rounded-md bg-foreground px-3 py-2 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          : "w-full max-w-xs rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
      }
    >
      {addToCartLabel}
    </button>
  );

  if (!linkToDetail) {
    // Step 50 (revised): a real two-column product detail layout — media
    // on the left (or stacked above on narrow screens), a clear
    // typographic hierarchy for name/price, then description, options,
    // and the add-to-cart action, each its own visually separated block.
    // Deliberately more spacious than the card layout: this is the ONLY
    // context where the customer sees every media item, the full
    // description, and every variant option at once, so it needs room to
    // grow as products carry more of that information — not visual polish
    // for its own sake.
    return (
      <li className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <div className="sm:w-[420px] sm:flex-shrink-0">
          <ProductMediaCarousel media={product.media} productName={product.name} />
        </div>
        <div className="flex flex-1 flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{product.name}</h1>
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-xl font-semibold">{priceDisplay}</span>
              {lowStockHint && <span className="text-xs text-muted-foreground">{lowStockHint}</span>}
            </div>
          </div>

          {/* Step 43: plain-text only, rendered as-is — no Markdown/HTML.
              whitespace-pre-line preserves the merchant's own line breaks
              (still no Markdown/HTML rendering — just literal newlines). */}
          {product.description && (
            <p className="max-w-prose text-sm leading-relaxed whitespace-pre-line text-foreground/80">
              {product.description}
            </p>
          )}

          {optionsBlock}

          <div className="pt-1">{addToCartButton}</div>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 text-sm transition-shadow hover:shadow-sm">
      {/* Step 50: on the product list card show only the primary (first)
          media item as a thumbnail, linked to the detail page — the full
          carousel belongs on the detail page itself, where every media
          item is reachable. Deliberately the ONLY inventory-adjacent
          number never duplicated here: this reads product.media directly,
          not a separate "primary image" field. */}
      {primaryMedia && (
        <Link href={`/products/${product.id}`} className="block overflow-hidden rounded-md bg-surface-muted">
          <MediaThumbnail media={primaryMedia} alt={product.name} />
        </Link>
      )}

      <div className="flex flex-col gap-1">
        <Link href={`/products/${product.id}`} className="line-clamp-2 font-medium hover:underline">
          {product.name}
        </Link>
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-base font-semibold whitespace-nowrap">{priceDisplay}</span>
          {lowStockHint && <span className="text-xs text-muted-foreground">{lowStockHint}</span>}
        </div>
      </div>

      {/* Step 43: plain-text only, rendered as-is — no Markdown/HTML. Only
          when a description is actually set; renders nothing otherwise. */}
      {product.description && (
        <p className="line-clamp-2 text-xs text-muted-foreground">{product.description}</p>
      )}

      {optionsBlock}

      <div className="mt-1">{addToCartButton}</div>
    </li>
  );
}

export function ProductList({ products }: { products: TenantProduct[] }) {
  if (products.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-4 px-6 py-12 sm:py-16">
      <h2 className="text-lg font-medium tracking-tight">Products</h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {products.map((product) => (
          <ProductRow key={product.id} product={product} />
        ))}
      </ul>
    </section>
  );
}
