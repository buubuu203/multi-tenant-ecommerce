import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterCatalogProducts,
  paginateCatalogProducts,
  STOREFRONT_PAGE_SIZE,
} from '../src/lib/product-catalog';
import { validateProductInput } from '../src/lib/product-mutations';

const products = [
  { name: 'Walnut table', descriptionExcerpt: 'Solid wood dining table', category: 'Furniture' },
  { name: 'Ceramic mug', descriptionExcerpt: 'Handmade cup', category: 'Homeware' },
  { name: 'Wooden chair', descriptionExcerpt: null, category: 'Furniture' },
];

test('catalog search matches names, descriptions, and categories with combined category filters', () => {
  assert.deepEqual(
    filterCatalogProducts(products, 'WOOD', 'Furniture').map((product) => product.name),
    ['Walnut table', 'Wooden chair'],
  );
  assert.deepEqual(
    filterCatalogProducts(products, 'handmade', '').map((product) => product.name),
    ['Ceramic mug'],
  );
});

test('storefront catalog pagination displays 20 items and clamps stale page numbers', () => {
  const manyProducts = Array.from({ length: 21 }, (_, index) => ({ index }));
  const secondPage = paginateCatalogProducts(manyProducts, 2, STOREFRONT_PAGE_SIZE);

  assert.equal(STOREFRONT_PAGE_SIZE, 20);
  assert.equal(secondPage.items.length, 1);
  assert.equal(secondPage.items[0].index, 20);
  assert.equal(secondPage.start, 21);
  assert.equal(secondPage.end, 21);
  assert.equal(paginateCatalogProducts(manyProducts, 99, STOREFRONT_PAGE_SIZE).page, 2);
});

test('category selection ids are trimmed and blank values are stored as unset', () => {
  const input = { name: 'Chair', price: '1000', weightGrams: '100', status: 'draft' };
  const assigned = validateProductInput({ ...input, categoryId: '  category-id  ' });
  const unset = validateProductInput({ ...input, categoryId: '   ' });

  assert.ok(!('error' in assigned));
  assert.ok(!('error' in unset));
  if ('error' in assigned || 'error' in unset) return;
  assert.equal(assigned.categoryId, 'category-id');
  assert.equal(unset.categoryId, null);
  assert.ok('error' in validateProductInput({ ...input, weightGrams: '' }));
  assert.ok('error' in validateProductInput({ ...input, weightGrams: '0' }));
});
