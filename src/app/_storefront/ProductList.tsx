'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { TenantProduct, TenantProductVariant } from './get-tenant-products';
import { useCart } from './cart-context';
import { ProductMediaCarousel } from './ProductMediaCarousel';
import { compareByStartingPrice } from '@/lib/product-sort';
import { filterCatalogProducts, STOREFRONT_PAGE_SIZE } from '@/lib/product-catalog';
import { isLowStock } from '@/lib/inventory-availability';
import { useDictionary } from '@/lib/i18n/use-dictionary';
import { Icon } from './Icon';
import { iconForCategory } from './category-icon';

function formatVnd(price: number): string {
  return `${price.toLocaleString('vi-VN')} ₫`;
}

// Step 40: a fixed, non-configurable threshold for the lightweight
// "Only N left" hint — deliberately not a database field, admin setting,
// or prop; this is a small presentation rule, not a merchant-facing
// feature.

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
  const otherSelections = Object.entries(selection).filter(
    ([optionId]) => optionId !== targetOptionId,
  );
  return variants.some((variant) => {
    const hasTarget = variant.options.some(
      (ov) => ov.variantOptionId === targetOptionId && ov.variantOptionValueId === targetValueId,
    );
    if (!hasTarget) {
      return false;
    }
    return otherSelections.every(([optionId, valueId]) =>
      variant.options.some(
        (ov) => ov.variantOptionId === optionId && ov.variantOptionValueId === valueId,
      ),
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
export function MediaThumbnail({
  media,
  alt,
}: {
  media: { type: 'image' | 'video'; url: string };
  alt: string;
}) {
  if (media.type === 'image') {
    // eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra in this MVP
    return (
      <img src={media.url} alt={alt} className="aspect-square w-full rounded-md object-cover" />
    );
  }
  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-md">
      <video src={media.url} muted className="h-full w-full object-cover" />
      <span className="absolute inset-0 flex items-center justify-center bg-black/10 text-2xl text-white">
        ▶
      </span>
    </div>
  );
}

export function ProductRow({
  product,
  linkToDetail = true,
}: {
  product: TenantProduct;
  linkToDetail?: boolean;
}) {
  // Simple-product path: unchanged from before this step — a product with
  // exactly one variant carrying the combinationKey === "" sentinel (the
  // same convention product-mutations.ts and Tenant Admin already use)
  // renders exactly as it did before variant selection existed.
  const simpleVariant =
    product.variants.length === 1 && product.variants[0].combinationKey === ''
      ? product.variants[0]
      : null;

  // Derived purely from this product's own already-loaded variant data —
  // no extra fetch, one pass over variants/options.
  const options = useMemo(() => {
    if (simpleVariant) {
      return [];
    }
    const byOption = new Map<string, { optionName: string; values: Map<string, string> }>();
    for (const variant of product.variants) {
      for (const ov of variant.options) {
        const entry = byOption.get(ov.variantOptionId) ?? {
          optionName: ov.optionName,
          values: new Map<string, string>(),
        };
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
  const [showAddedFeedback, setShowAddedFeedback] = useState(false);
  // Board 6: a 1–99 quantity stepper on the PDP only — the grid card has
  // no equivalent (it adds exactly 1, same as before).
  const [pdpQuantity, setPdpQuantity] = useState(1);
  const { items, addItem, requestCheckout } = useCart();
  const dict = useDictionary();

  useEffect(() => {
    if (!showAddedFeedback) return;
    const timeout = window.setTimeout(() => setShowAddedFeedback(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [showAddedFeedback]);

  const resolvedVariant = simpleVariant ?? resolveVariant(product.variants, selection, optionIds);
  const hasCompleteSelection = optionIds.length > 0 && optionIds.every((id) => selection[id]);
  // Step 50: sortOrder 0 IS the primary media everywhere the app needs
  // one — media is already returned pre-sorted by get-tenant-products.ts.
  const primaryMedia = product.media[0];
  const hasMedia = product.media.length > 0;

  // Step 39: stock unavailability is a SEPARATE concept from combination
  // unavailability (Step 25) — the variant genuinely exists here
  // (resolvedVariant is non-null), it just has no available stock. Never
  // folded into isValueSelectable()/"(unavailable)", which remain about
  // combination EXISTENCE only, unchanged.
  const cartQuantity = resolvedVariant
    ? (items.find((i) => i.productVariantId === resolvedVariant.id)?.quantity ?? 0)
    : 0;
  const outOfStock = resolvedVariant ? resolvedVariant.available <= 0 : false;
  // Card-level (grid) "Hết hàng" badge: unlike `outOfStock` above (which
  // only knows about the currently-selected variant), the grid card has
  // no selection at all — so this asks the stronger question "is every
  // variant unavailable," using the exact same real availability data.
  const productOutOfStock = product.variants.every((v) => v.available <= 0);
  const atAvailableLimit = resolvedVariant ? cartQuantity >= resolvedVariant.available : false;

  // Step 40: a third, separate concept from combination-existence (Step 25)
  // and out-of-stock (Step 39) — the variant exists AND has stock, just not
  // much of it. Only ever shown alongside the normal in-stock price/button
  // state below, never in place of "Out of stock" or "(unavailable)".
  const lowStockHint =
    resolvedVariant && !outOfStock && isLowStock(resolvedVariant.available)
      ? dict.products.onlyNLeft.replace("{count}", String(resolvedVariant.available))
      : null;

  // Product Discount (V1): resolvedVariant.price is ALREADY the discounted
  // price (see get-tenant-products.ts's applyDiscount() call) — this is
  // purely a display addition (strikethrough original + a "-X%" badge),
  // never a second price calculation. originalPrice/discountPercent are
  // only ever non-null together, when a discount is currently active.
  const showDiscount = Boolean(
    resolvedVariant && !outOfStock && (resolvedVariant.discountPercent !== null || resolvedVariant.discountAmount > 0),
  );
  const originalPriceDisplay =
    resolvedVariant?.originalPrice != null ? formatVnd(resolvedVariant.originalPrice) : null;

  let priceDisplay: string;
  let addToCartLabel: string;
  if (resolvedVariant && outOfStock) {
    // Keep showing the real price. Overwriting it with "Out of stock"
    // printed the same words twice in one small card (the disabled
    // button below already says it) AND destroyed the one piece of
    // information a shopper still wants from an unavailable item — what
    // it costs, for deciding whether to come back for it.
    priceDisplay = formatVnd(resolvedVariant.price);
    addToCartLabel = dict.products.outOfStock;
  } else if (resolvedVariant) {
    priceDisplay = formatVnd(resolvedVariant.price);
    addToCartLabel = atAvailableLimit ? dict.products.maxInCart : dict.products.addToCart;
  } else if (hasCompleteSelection) {
    priceDisplay = dict.products.combinationUnavailable;
    addToCartLabel = dict.products.combinationUnavailable;
  } else {
    priceDisplay = dict.products.selectOptions;
    addToCartLabel = dict.products.selectOptions;
  }

  function handleAddToCart(options?: { quantity?: number; buyNow?: boolean }) {
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
          .join(' / ')
      : '';
    addItem(
      {
        productVariantId: resolvedVariant.id,
        productId: product.id,
        productName: product.name,
        variantLabel,
        price: resolvedVariant.price,
        ...(resolvedVariant.originalPrice != null
          ? {
              originalPrice: resolvedVariant.originalPrice,
              discountPercent: resolvedVariant.discountPercent ?? undefined,
              discountAmount: resolvedVariant.discountAmount || undefined,
            }
          : {}),
        imageUrl: primaryMedia?.url,
      },
      options?.quantity ?? 1,
    );
    if (options?.buyNow) {
      // "Mua ngay" (Board 6): the item is already in the cart by the time
      // this fires — requestCheckout() only tells CartWidget to open
      // itself at the shipping step, it never adds anything itself.
      requestCheckout();
    } else {
      setShowAddedFeedback(true);
    }
  }

  // Step 50 (revised): variant options get their own labeled block on the
  // detail page (larger, one-per-line) so a product with several options
  // stays legible as more get added — the card view keeps the original
  // compact wrapped-row layout, since a list card has no room to spare.
  const optionsBlock = !simpleVariant && options.length > 0 && (
    <div className={linkToDetail ? 'flex flex-wrap gap-3 text-xs' : 'flex flex-col gap-3 text-sm'}>
      {options.map((option) => {
        const annotatedValues = getAvailableValues(
          product.variants,
          option.variantOptionId,
          option.values,
          selection,
        );
        return (
          <label key={option.variantOptionId} className="flex flex-col gap-1">
            <span
              className={linkToDetail ? 'kicker' : 'kicker'}
              style={linkToDetail ? { fontSize: '11px', textTransform: 'none' } : undefined}
            >
              {option.optionName}
            </span>
            <select
              className={linkToDetail ? 'field-glass' : 'field-glass w-full max-w-xs'}
              style={linkToDetail ? { padding: '6px 10px', fontSize: '13px', minHeight: '32px' } : undefined}
              value={selection[option.variantOptionId] ?? ''}
              onChange={(e) =>
                setSelection((prev) =>
                  applySelection(product.variants, prev, option.variantOptionId, e.target.value),
                )
              }
            >
              <option value="">{dict.products.select.replace("{option}", option.optionName)}</option>
              {annotatedValues.map((value) => (
                <option
                  key={value.variantOptionValueId}
                  value={value.variantOptionValueId}
                  disabled={!value.selectable}
                >
                  {value.valueLabel}
                  {value.selectable ? '' : ` ${dict.products.unavailable}`}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
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
      <li
        className={
          // Only reserve a media column when there IS media.
          // ProductMediaCarousel renders null for an empty gallery, so the
          // two-column layout used to leave a bordered box collapsed to a
          // ~1px line beside a squeezed text column — a product without
          // images looked broken rather than simply image-less.
          hasMedia
            ? 'grid gap-8 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] sm:items-start lg:gap-12'
            : 'grid gap-8'
        }
      >
        {hasMedia && <ProductMediaCarousel media={product.media} productName={product.name} />}
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-col gap-2">
            {product.category && <span className="kicker">{product.category}</span>}
            <h1 className="title-card" style={{ fontSize: '38px', margin: 0 }}>
              {product.name}
            </h1>
            <div className="flex flex-wrap items-baseline gap-2">
              {showDiscount && originalPriceDisplay && (
                <span className="money text-sm line-through" style={{ color: 'var(--ink-2)' }}>
                  {originalPriceDisplay}
                </span>
              )}
              <span className="money" style={{ fontSize: '20px', fontWeight: 700 }}>
                {priceDisplay}
              </span>
              {showDiscount && resolvedVariant && (
                <span className="off-pill">
                  {resolvedVariant.discountPercent != null
                    ? `−${resolvedVariant.discountPercent}%`
                    : `−${formatVnd(resolvedVariant.discountAmount)}`}
                </span>
              )}
              {lowStockHint && (
                <span className="text-xs" style={{ color: 'var(--ink-2)' }}>
                  {lowStockHint}
                </span>
              )}
            </div>
          </div>

          {/* Product Description Rich Text: descriptionHtml is ALREADY
              sanitized server-side (get-tenant-products.ts, via
              renderDescriptionMarkdown()) — this is the one deliberate
              dangerouslySetInnerHTML in the app, and only ever renders
              output that has already passed through that pipeline, never
              the raw Product.description Markdown/any other string. */}
          {product.descriptionHtml && (
            <div
              style={{ fontSize: '15px', lineHeight: 1.45, color: 'var(--ink-2)' }}
              className="max-w-prose [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic"
              dangerouslySetInnerHTML={{ __html: product.descriptionHtml }}
            />
          )}

          {optionsBlock}

          {/* SKU (Board 6 decision): only when the product actually has
              ≥2 variants to tell apart — a single-variant product's SKU
              (if it even set one) is never shown, since there's no
              "which one" question for it to answer. Real field
              (ProductVariant.sku), never invented. */}
          {product.variants.length > 1 && resolvedVariant?.sku && (
            <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
              SKU: {resolvedVariant.sku}
            </p>
          )}

          <div className="flex flex-col gap-3 pt-1">
            <div className="flex items-center gap-4">
              <span className="field-label" style={{ margin: 0 }}>{dict.products.quantity}</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPdpQuantity((q) => Math.max(1, q - 1))}
                  disabled={pdpQuantity <= 1}
                  className="btn-ghost disabled:opacity-40"
                  style={{ width: '44px', height: '44px', padding: 0, minHeight: '44px' }}
                  aria-label="−"
                >
                  −
                </button>
                <span className="w-8 text-center text-sm">{pdpQuantity}</span>
                <button
                  type="button"
                  onClick={() => setPdpQuantity((q) => Math.min(99, q + 1))}
                  disabled={pdpQuantity >= 99 || (typeof resolvedVariant?.available === 'number' && pdpQuantity >= resolvedVariant.available)}
                  className="btn-ghost disabled:opacity-40"
                  style={{ width: '44px', height: '44px', padding: 0, minHeight: '44px' }}
                  aria-label="+"
                >
                  +
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleAddToCart({ quantity: pdpQuantity })}
                disabled={!resolvedVariant || outOfStock || atAvailableLimit}
                className="btn-ghost"
                style={{ minHeight: '52px', padding: '12px 20px', flex: 1 }}
              >
                <Icon name={showAddedFeedback ? 'check' : 'cart'} size={16} />
                {showAddedFeedback ? dict.products.addedToCart : addToCartLabel}
              </button>
              <button
                type="button"
                onClick={() => handleAddToCart({ quantity: pdpQuantity, buyNow: true })}
                disabled={!resolvedVariant || outOfStock || atAvailableLimit}
                className="justify-center"
                style={{
                  flex: 1.2,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  minHeight: '52px',
                  borderRadius: 'var(--radius-pill)',
                  // The single bold CTA on this page: same light-surface/
                  // dark-text tokens as the grid card's "+ Giỏ" button —
                  // --ink/--on-ink flip correctly in dark mode (ink
                  // becomes the light color there), unlike the tenant
                  // --accent token this used before, which could render
                  // as a flat grey.
                  background: 'var(--ink)',
                  color: 'var(--on-ink)',
                  fontWeight: 600,
                  border: 0,
                  cursor: 'pointer',
                  opacity: !resolvedVariant || outOfStock || atAvailableLimit ? 0.4 : 1,
                }}
              >
                {resolvedVariant
                  ? dict.products.buyNowWithAmount.replace('{amount}', formatVnd(resolvedVariant.price * pdpQuantity))
                  : addToCartLabel}
              </button>
            </div>
          </div>

          {/* Board 6: trust block lives IN the info column, right under
              the buy row — not a full-width section under the gallery
              (that left the right column ~400px of empty space below the
              buttons). One glass block, 3 rows stacked, divider between
              each, small 20px icon box on the left of each row. */}
          <div className="glass flex flex-col" style={{ borderRadius: '28px' }}>
            <div className="flex items-center gap-3" style={{ padding: '6px 18px' }}>
              <span className="ibox" style={{ width: '20px', height: '20px', borderRadius: '7px' }}>
                <Icon name="truck" size={12} />
              </span>
              <div>
                <b className="block text-[15px]">{dict.pdpTrust.shippingTitle}</b>
                <div className="text-xs" style={{ color: 'var(--ink-2)' }}>{dict.pdpTrust.shippingHint}</div>
              </div>
            </div>
            <div className="flex items-center gap-3" style={{ padding: '6px 18px', borderTop: '1px solid var(--divider)' }}>
              <span className="ibox" style={{ width: '20px', height: '20px', borderRadius: '7px' }}>
                <Icon name="info" size={12} />
              </span>
              <div>
                <b className="block text-[15px]">{dict.pdpTrust.policyTitle}</b>
                <Link href="/policy" className="text-xs underline" style={{ color: 'var(--ink-2)' }}>
                  {dict.pdpTrust.policyLink}
                </Link>
              </div>
            </div>
            <div className="flex items-center gap-3" style={{ padding: '6px 18px', borderTop: '1px solid var(--divider)' }}>
              <span className="ibox" style={{ width: '20px', height: '20px', borderRadius: '7px' }}>
                <Icon name="wallet" size={12} />
              </span>
              <div>
                <b className="block text-[15px]">{dict.pdpTrust.paymentTitle}</b>
                <div className="text-xs" style={{ color: 'var(--ink-2)' }}>{dict.pdpTrust.paymentHint}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Board 6 / Buyer-Mobile: sticky bottom buy bar, <768px only —
            the full quantity/add-to-cart/trust block above still renders
            in the normal flow on mobile too; this is purely an always-
            reachable shortcut to "Mua ngay" while scrolling, same price
            logic, no separate state. safe-area-inset-bottom so it never
            sits under a phone's home-indicator gesture area. */}
        <div
          // display lives in the className (hidden/flex), never inline —
          // an inline `style.display` would out-specificity `sm:hidden`
          // and this bar would show at every width regardless (that
          // exact bug, caught in the 1710px screenshot, is why this
          // comment exists).
          className="hidden items-center gap-3 glass max-sm:flex"
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 30,
            borderRadius: '24px 24px 0 0',
            padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
          }}
        >
          <span className="money font-semibold" style={{ fontSize: '18px' }}>
            {resolvedVariant ? formatVnd(resolvedVariant.price * pdpQuantity) : priceDisplay}
          </span>
          <button
            type="button"
            onClick={() => handleAddToCart({ quantity: pdpQuantity, buyNow: true })}
            disabled={!resolvedVariant || outOfStock || atAvailableLimit}
            className="justify-center"
            style={{
              flex: 1,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              minHeight: '48px',
              borderRadius: 'var(--radius-pill)',
              background: 'var(--ink)',
              color: 'var(--on-ink)',
              fontWeight: 600,
              border: 0,
              cursor: 'pointer',
              opacity: !resolvedVariant || outOfStock || atAvailableLimit ? 0.4 : 1,
            }}
          >
            {dict.products.buyNow}
          </button>
        </div>
      </li>
    );
  }

  return (
    <li
      className="glass group flex flex-col gap-3 p-3 text-sm"
      style={{ borderRadius: 'var(--radius-tile)' }}
    >
      {/* Step 50: on the product list card show only the primary (first)
          media item as a thumbnail, linked to the detail page — the full
          carousel belongs on the detail page itself, where every media
          item is reachable. Deliberately the ONLY inventory-adjacent
          number never duplicated here: this reads product.media directly,
          not a separate "primary image" field. */}
      {/* Always reserve the media slot. A product imported by CSV may
          carry no media at all, and rendering nothing made those cards a
          different height and shape from their neighbours — the grid
          looked broken rather than the product looking image-less. The
          placeholder says which it is. */}
      <div className="relative" style={{ opacity: productOutOfStock ? 0.55 : 1 }}>
        <Link
          href={`/products/${product.id}`}
          className="block overflow-hidden"
          style={{ borderRadius: 'var(--radius-list)' }}
        >
          {primaryMedia ? (
            <MediaThumbnail media={primaryMedia} alt={product.name} />
          ) : (
            <div
              className="flex aspect-square w-full flex-col items-center justify-center gap-1 text-center text-xs"
              style={{
                color: 'var(--ink-3)',
                background: 'repeating-linear-gradient(135deg, var(--chip-fill) 0 10px, var(--field-fill) 10px 20px)',
                border: '1.5px dashed var(--chip-border)',
                borderRadius: 'var(--radius-list)',
              }}
            >
              <span>{dict.products.noImage}</span>
              {product.category && <span>{product.category}</span>}
            </div>
          )}
        </Link>
        {productOutOfStock ? (
          <span className="badge-corner out">{dict.products.outOfStock}</span>
        ) : showDiscount && resolvedVariant ? (
          <span className="badge-corner sale">
            {resolvedVariant.discountPercent != null
              ? `-${resolvedVariant.discountPercent}%`
              : `-${formatVnd(resolvedVariant.discountAmount)}`}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        {product.category && (
          <span className="kicker flex items-center gap-1">
            <Icon name={iconForCategory(product.category)} size={13} />
            {product.category}
          </span>
        )}
        <Link
          href={`/products/${product.id}`}
          className="title-card line-clamp-2 transition-opacity group-hover:opacity-70"
          style={{ fontSize: '16px', minHeight: '44px' }}
        >
          {product.name}
        </Link>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {/* flex-wrap + min-w-0: at 375px a discounted product has three
              things on this row (old price, new price, the −N% pill) and
              without wrapping the pill was clipped by the card edge.
              whitespace-nowrap keeps "250.000 ₫" from breaking before its
              currency symbol. */}
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1">
            {showDiscount && originalPriceDisplay && (
              <span
                className="money text-xs whitespace-nowrap line-through"
                style={{ color: 'var(--ink-2)' }}
              >
                {originalPriceDisplay}
              </span>
            )}
            <span className="money ui-text whitespace-nowrap">{priceDisplay}</span>
            {showDiscount && resolvedVariant && (
              <span className="off-pill">
                {resolvedVariant.discountPercent != null
                  ? `−${resolvedVariant.discountPercent}%`
                  : `−${formatVnd(resolvedVariant.discountAmount)}`}
              </span>
            )}
          </div>
          {lowStockHint && (
            <span className="text-xs" style={{ color: 'var(--ink-2)' }}>
              {lowStockHint}
            </span>
          )}
        </div>
      </div>

      {/* Board 5 card redesign: just category/name/price + one CTA, no
          description and no separate "Xem chi tiết" — the image and name
          above are the way into the PDP now. A single-variant product
          adds straight to cart (tick feedback via showAddedFeedback,
          same as the PDP's own button); a multi-variant product has
          nothing to add yet, so this is a plain link to the PDP to pick
          one — never a disabled dead-end button. Solid ink, not the
          tenant accent — a deliberate board decision for this control. */}
      <div className="mt-1 flex justify-end">
        {simpleVariant ? (
          <button
            type="button"
            onClick={() => handleAddToCart()}
            disabled={outOfStock || atAvailableLimit}
            aria-label={dict.products.addToCart}
            className="justify-center"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              minHeight: '40px',
              padding: '8px 14px',
              borderRadius: 'var(--radius-pill)',
              background: 'var(--ink)',
              color: 'var(--on-ink)',
              fontSize: '13px',
              fontWeight: 600,
              border: 0,
              cursor: 'pointer',
              opacity: outOfStock || atAvailableLimit ? 0.4 : 1,
            }}
          >
            <Icon name={showAddedFeedback ? 'check' : 'plus'} size={16} />
            {dict.products.addToCartShort}
          </button>
        ) : (
          <Link
            href={`/products/${product.id}`}
            className="justify-center"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              minHeight: '40px',
              padding: '8px 14px',
              borderRadius: 'var(--radius-pill)',
              background: 'var(--ink)',
              color: 'var(--on-ink)',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            <Icon name="plus" size={16} />
            {dict.products.addToCartShort}
          </Link>
        )}
      </div>
    </li>
  );
}

type SortOption = 'featured' | 'price_asc' | 'price_desc';

// useSearchParams() (reading the header's ?q= search) requires a Suspense
// boundary somewhere above it in the App Router — this wrapper is that
// boundary, not a loading-state design choice; the fallback is null
// because every caller already renders this inside a page that's
// force-dynamic, so there's no meaningfully different "loading" look.
export function ProductList(props: { products: TenantProduct[] }) {
  return (
    <Suspense fallback={null}>
      <ProductListInner {...props} />
    </Suspense>
  );
}

function ProductListInner({ products }: { products: TenantProduct[] }) {
  const [sort, setSort] = useState<SortOption>('featured');
  const [category, setCategory] = useState('');
  // Board 5: "Xem thêm N sản phẩm" / "Đang xem X trong Y" — a load-more
  // pattern, not classic prev/next pagination. visibleCount accumulates;
  // it never shrinks except when the filtered set itself changes (a new
  // search/category/search-term query is a new result set, not "more of
  // the old one").
  const [visibleState, setVisibleState] = useState({ resultsKey: '', count: STOREFRONT_PAGE_SIZE });
  const [sortOpen, setSortOpen] = useState(false);
  const dict = useDictionary();
  // Board 5: search now lives in the header (SearchBox.tsx), driving the
  // `?q=` URL param — this reads it rather than owning its own input, so
  // there's exactly one search box on the page, not two.
  const searchParams = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const sortLabels: Record<SortOption, string> = {
    featured: dict.products.sortFeatured,
    price_asc: dict.products.sortPriceLowHigh,
    price_desc: dict.products.sortPriceHighLow,
  };

  const categories = useMemo(
    () =>
      [...new Set(products.flatMap((product) => (product.category ? [product.category] : [])))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [products],
  );

  const filteredProducts = useMemo(
    () => filterCatalogProducts(products, query, category),
    [products, query, category],
  );

  const sortedProducts = useMemo(() => {
    if (sort === 'featured') return filteredProducts;
    const withDirection: 1 | -1 = sort === 'price_asc' ? 1 : -1;
    return [...filteredProducts].sort((a, b) => compareByStartingPrice(a, b, withDirection));
  }, [filteredProducts, sort]);

  // A new result set (different query/category/sort) always starts back
  // at the first page's worth — otherwise switching category chips could
  // leave visibleCount at, say, 60 and dump 60 cards of a totally
  // different filtered set on screen at once. Reset-during-render (the
  // resultsKey mismatch below), not an effect: this is "adjusting state
  // when a prop changes," which React's own docs single out as the one
  // case that belongs in render, not in an effect.
  const resultsKey = `${query}\u0000${category}\u0000${sort}`;
  const visibleCount = visibleState.resultsKey === resultsKey ? visibleState.count : STOREFRONT_PAGE_SIZE;
  if (visibleState.resultsKey !== resultsKey) {
    setVisibleState({ resultsKey, count: STOREFRONT_PAGE_SIZE });
  }

  const visibleProducts = sortedProducts.slice(0, visibleCount);
  const hasMore = visibleCount < sortedProducts.length;

  if (products.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-5 py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">{dict.products.shopTheCollection}</span>
          <h2 className="display-section" style={{ fontSize: 'clamp(26px, 4vw, 36px)', margin: 0 }}>
            {dict.products.products}
          </h2>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="hint text-sm" style={{ color: 'var(--ink-2)' }}>
            {dict.products.productCount.replace('{count}', String(sortedProducts.length))}
          </span>
          <div className="relative">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setSortOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={sortOpen}
            >
              <Icon name="sort" size={16} />
              {dict.products.sortBy}: {sortLabels[sort]}
            </button>
            {sortOpen && (
              <ul
                role="listbox"
                className="glass absolute right-0 z-10 mt-1 flex flex-col gap-1 p-1.5"
                style={{ borderRadius: 'var(--radius-field)', minWidth: '200px' }}
              >
                {(Object.entries(sortLabels) as [SortOption, string][]).map(([value, label]) => (
                  <li key={value} role="option" aria-selected={sort === value}>
                    <button
                      type="button"
                      onClick={() => {
                        setSort(value);
                        setSortOpen(false);
                      }}
                      className="option-row w-full text-left"
                      style={{ border: 0, background: sort === value ? 'var(--field-fill-focus)' : 'transparent' }}
                    >
                      {label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div
        className="glass flex flex-col gap-3 p-4"
        style={{ borderRadius: 'var(--radius-card)' }}
      >
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={dict.products.filterByCategory}>
          <button
            type="button"
            onClick={() => setCategory('')}
            className={category === '' ? 'chip chip-solid' : 'chip'}
            style={{ minHeight: '44px' }}
          >
            <Icon name="tag" size={15} />
            {dict.products.allCategories}
          </button>
          {categories.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setCategory(option)}
              className={category === option ? 'chip chip-solid' : 'chip'}
              style={{ minHeight: '44px' }}
            >
              <Icon name={iconForCategory(option)} size={15} />
              {option}
            </button>
          ))}
        </div>
      </div>

      {sortedProducts.length === 0 ? (
        <p className="py-8 text-center text-sm" style={{ color: 'var(--ink-2)' }}>
          {dict.products.noMatchingProducts}
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
            {visibleProducts.map((product) => (
              <ProductRow key={product.id} product={product} />
            ))}
          </ul>
          {hasMore && (
            <nav aria-label={dict.products.pagination} className="flex flex-col items-center gap-2 py-2">
              <button
                type="button"
                className="btn-ghost"
                style={{ padding: '12px 28px' }}
                onClick={() => setVisibleState({ resultsKey, count: visibleCount + STOREFRONT_PAGE_SIZE })}
              >
                {dict.products.showMore.replace('{count}', String(sortedProducts.length - visibleCount))}
              </button>
              <span className="text-xs" style={{ color: 'var(--ink-2)' }}>
                {dict.products.showingProducts
                  .replace('{start}', '1')
                  .replace('{end}', String(visibleProducts.length))
                  .replace('{total}', String(sortedProducts.length))}
              </span>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
