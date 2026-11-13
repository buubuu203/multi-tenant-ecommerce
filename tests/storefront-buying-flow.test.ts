// Where a shopper can commit to buying, and what they see before they do.
//
// The product card used to carry its own add-to-cart button, so a shopper
// could buy from the grid before seeing the images, the description or
// which variants were actually in stock. These tests keep the decision on
// the detail page, and keep an image-less product from rendering as a
// hole in the layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = (relative: string) => readFileSync(join(root, relative), 'utf8');

/** Source with comments stripped, so a doc comment never satisfies a check. */
function code(relative: string): string {
  return source(relative)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

const LIST = 'src/app/_storefront/ProductList.tsx';
const CART = 'src/app/_storefront/CartWidget.tsx';

/**
 * ProductRow renders two different things from one component: the grid
 * card when `linkToDetail` is true, and the product detail page when it
 * is false. The card branch is everything after the detail branch's own
 * `return`, which is guarded by `if (!linkToDetail)`.
 */
function productRowSource(): string {
  const src = code(LIST);
  const start = src.indexOf('export function ProductRow(');
  // ProductList is declared after ProductRow and has its own return, so
  // the search has to stop at the end of ProductRow or it picks up the
  // wrong component entirely.
  const end = src.indexOf('type SortOption');
  assert.ok(start > 0 && end > start, 'ProductRow must still be its own component');
  return src.slice(start, end);
}

function cardBranch(): string {
  const row = productRowSource();
  const guard = row.indexOf('if (!linkToDetail) {');
  assert.ok(guard > 0, 'the detail-page branch guard must still exist');
  const finalReturn = row.lastIndexOf('return (');
  assert.ok(finalReturn > guard, 'the card branch must come after the detail branch');
  return row.slice(finalReturn);
}

// ---------- buying happens on the detail page ----------

test('the product card does NOT offer add to cart', () => {
  const card = cardBranch();
  assert.ok(
    !card.includes('addToCartButton'),
    'the grid card must not render the add-to-cart button',
  );
  assert.ok(
    !/onClick=\{handleAddToCart\}/.test(card),
    'the grid card must not wire up handleAddToCart',
  );
});

test('the product card does NOT offer variant selection', () => {
  const card = cardBranch();
  // Choosing a variant from a cramped select, with no picture of what is
  // being chosen, is the thing the detail page exists to do properly.
  assert.ok(!card.includes('optionsBlock'), 'variant selects belong on the detail page');
});

test('the product card sends the shopper to the detail page', () => {
  const card = cardBranch();
  assert.match(card, /href=\{`\/products\/\$\{product\.id\}`\}/, 'the card must link to the PDP');
  assert.match(card, /Xem chi tiết/, 'and say so in the shopper’s language');
});

test('the detail page still owns add to cart and variant selection', () => {
  const row = productRowSource();
  const detail = row.slice(row.indexOf('if (!linkToDetail) {'), row.lastIndexOf('return ('));

  assert.ok(detail.includes('addToCartButton'), 'the PDP must keep add to cart');
  assert.ok(detail.includes('optionsBlock'), 'the PDP must keep variant selection');
});

test('add to cart is still gated on a resolved, in-stock variant', () => {
  // Moving the button must not have loosened what it refuses to add.
  const src = code(LIST);
  assert.match(src, /disabled=\{!resolvedVariant \|\| outOfStock \|\| atAvailableLimit\}/);
  assert.match(src, /if \(!resolvedVariant \|\| outOfStock \|\| atAvailableLimit\)/);
});

// ---------- an image-less product still renders as a product ----------

test('the card always reserves its media slot', () => {
  const card = cardBranch();
  // Previously `{primaryMedia && (...)}` meant a product with no media
  // rendered no media block at all, so those cards were a different
  // height from their neighbours.
  assert.ok(
    !/\{primaryMedia && \(/.test(card),
    'the media block must not be conditionally omitted entirely',
  );
  assert.match(card, /primaryMedia \?/, 'it must choose between a thumbnail and a placeholder');
  assert.match(card, /Chưa có ảnh/, 'and name the empty state');
});

test('the cart falls back to a placeholder instead of dropping the thumbnail', () => {
  const cart = code(CART);
  assert.ok(
    !/\{item\.imageUrl && \(/.test(cart),
    'a missing image must not silently remove the thumbnail and shift the row',
  );
  assert.match(cart, /item\.imageUrl \?/);
  assert.match(cart, /Chưa có ảnh/);
});

test('the placeholder is decorative, not announced as an image', () => {
  const cart = source(CART);
  const index = cart.indexOf('Chưa có ảnh');
  assert.ok(index > 0);
  const block = cart.slice(Math.max(0, index - 400), index);
  assert.match(block, /aria-hidden="true"/, 'a screen reader already has the product name');
});

// ---------- the merchant can find image-less products ----------

test('the catalog flags a product with no media', () => {
  const catalog = source('src/app/tenant-admin/catalog/page.tsx');
  assert.match(catalog, /product\.media\.length === 0/, 'it must test for zero media');
  assert.match(catalog, /Thiếu ảnh/, 'and label it');
  // A warning, not an error: CSV import allows zero media by design, so
  // such a product is incomplete rather than invalid.
  const index = catalog.indexOf('Thiếu ảnh');
  const block = catalog.slice(Math.max(0, index - 200), index + 80);
  assert.match(block, /tone="warning"/);
});

test('nothing claims a product without an image cannot be sold', () => {
  // The flag is informational. Blocking activation would break CSV
  // import, which is explicitly allowed to create products with no
  // media — so the application must not pretend otherwise.
  const catalog = source('src/app/tenant-admin/catalog/page.tsx');
  for (const forbidden of [/cannot be sold/i, /không thể bán/i, /blocked from sale/i]) {
    assert.ok(!forbidden.test(catalog), `${forbidden} is a claim nothing enforces`);
  }
});
