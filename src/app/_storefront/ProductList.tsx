"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { TenantProduct, TenantProductVariant } from "./get-tenant-products";
import { useCart } from "./cart-context";

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
      imageUrl: product.imageUrl ?? undefined,
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded border px-3 py-2 text-sm">
      {/* Step 44: externally-hosted image URL, rendered as-is — no upload,
          no optimization/CDN, no placeholder when absent. Plain <img>
          (not next/image) is deliberate: next/image requires configuring
          allowed remote hosts, which is exactly the kind of infrastructure
          this MVP is not building. */}
      {product.imageUrl &&
        (linkToDetail ? (
          <Link href={`/products/${product.id}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra in this MVP, see comment above */}
            <img src={product.imageUrl} alt={product.name} className="w-full rounded object-cover" />
          </Link>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra in this MVP, see comment above
          <img src={product.imageUrl} alt={product.name} className="w-full rounded object-cover" />
        ))}

      <div className="flex items-center justify-between">
        {linkToDetail ? (
          <Link href={`/products/${product.id}`} className="hover:underline">
            {product.name}
          </Link>
        ) : (
          <span>{product.name}</span>
        )}
        <span className="flex items-baseline gap-2">
          {lowStockHint && <span className="text-xs text-black/60 dark:text-white/60">{lowStockHint}</span>}
          <span className="font-mono">{priceDisplay}</span>
        </span>
      </div>

      {/* Step 43: plain-text only, rendered as-is — no Markdown/HTML. Only
          when a description is actually set; renders nothing otherwise. */}
      {product.description && (
        <p className="text-xs text-black/60 dark:text-white/60">{product.description}</p>
      )}

      {!simpleVariant && options.length > 0 && (
        <div className="flex flex-wrap gap-3 text-xs">
          {options.map((option) => {
            const annotatedValues = getAvailableValues(product.variants, option.variantOptionId, option.values, selection);
            return (
              <label key={option.variantOptionId} className="flex flex-col gap-1">
                {option.optionName}
                <select
                  className="rounded border px-2 py-1"
                  value={selection[option.variantOptionId] ?? ""}
                  onChange={(e) =>
                    setSelection((prev) => applySelection(product.variants, prev, option.variantOptionId, e.target.value))
                  }
                >
                  <option value="">Select {option.optionName}</option>
                  {annotatedValues.map((value) => (
                    <option
                      key={value.variantOptionValueId}
                      value={value.variantOptionValueId}
                      disabled={!value.selectable}
                    >
                      {value.valueLabel}
                      {value.selectable ? "" : " (unavailable)"}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={handleAddToCart}
          disabled={!resolvedVariant || outOfStock || atAvailableLimit}
          className="rounded bg-black px-3 py-1 text-xs text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {addToCartLabel}
        </button>
      </div>
    </li>
  );
}

export function ProductList({ products }: { products: TenantProduct[] }) {
  if (products.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3 px-6 py-12">
      <h2 className="text-lg font-medium">Products</h2>
      <ul className="flex flex-col gap-2">
        {products.map((product) => (
          <ProductRow key={product.id} product={product} />
        ))}
      </ul>
    </section>
  );
}
