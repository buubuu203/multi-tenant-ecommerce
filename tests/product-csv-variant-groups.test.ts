// Multi-variant CSV import (product_key + option_name/option_value,
// option2_name/option2_value) — the Shopee/TikTok-style bulk-upload
// extension. Pure planning tests only (buildImportPlan takes no database
// client); product-csv-preview.test.ts covers the end-to-end DB-backed
// apply path for the pre-existing single-SKU format.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProductCsv } from '../src/lib/product-csv-contract';
import { buildImportPlan, planIsImportable, type ExistingVariant } from '../src/lib/product-csv-plan';

function parsed(csv: string) {
  const result = parseProductCsv(csv);
  assert.ok(!('error' in result), `expected a parse, got ${JSON.stringify(result)}`);
  return result;
}

function existingVariant(overrides: Partial<ExistingVariant> = {}): ExistingVariant {
  return {
    variantId: 'variant-1',
    productId: 'product-1',
    productName: 'Áo thun',
    price: 1000,
    weightGrams: 100,
    status: 'active',
    description: null,
    category: null,
    onHand: 0,
    reserved: 0,
    ...overrides,
  };
}

const HEADER =
  'sku,name,price,weight_grams,status,product_key,option_name,option_value,option2_name,option2_value';

test('a brand-new product_key group creates one product with one variant per row', () => {
  const csv =
    `${HEADER}\n` +
    'SHIRT-RED,Áo thun,100000,200,active,G1,Color,Red,,\n' +
    'SHIRT-BLUE,Áo thun,100000,200,active,G1,Color,Blue,,\n';
  const p = buildImportPlan(parsed(csv), new Map());

  assert.equal(p.counts.create, 2);
  assert.equal(planIsImportable(p), true);
  for (const row of p.rows) {
    assert.equal(row.action, 'create');
    assert.equal(row.groupKey, 'G1');
    assert.ok(row.groupPrimary);
    assert.equal(row.groupPrimary?.name, 'Áo thun');
    assert.equal(row.groupPrimary?.weightGrams, 200);
  }
});

test('two option axes (option_name + option2_name) both create correctly', () => {
  const csv =
    `${HEADER}\n` +
    'SHOE-RED-S,Giày,200000,300,active,G1,Color,Red,Size,S\n' +
    'SHOE-RED-M,Giày,200000,300,active,G1,Color,Red,Size,M\n' +
    'SHOE-BLUE-S,Giày,200000,300,active,G1,Color,Blue,Size,S\n';
  const p = buildImportPlan(parsed(csv), new Map());
  assert.equal(p.counts.create, 3);
  assert.equal(planIsImportable(p), true);
});

test('a lone row (no product_key) with option_name set still creates via the variant-aware path', () => {
  const csv = `${HEADER}\nSOLO-RED,Ốp lưng,50000,50,active,,Color,Red,,\n`;
  const p = buildImportPlan(parsed(csv), new Map());
  assert.equal(p.rows[0].action, 'create');
  assert.ok(p.rows[0].groupPrimary);
  assert.equal(p.rows[0].groupKey, null, 'no product_key was given, so the group key stays null');
});

test('rows in a group disagreeing on option_name are rejected', () => {
  const csv =
    `${HEADER}\n` +
    'A1,P,1000,100,active,G1,Color,Red,,\n' +
    'A2,P,1000,100,active,G1,Size,M,,\n';
  const p = buildImportPlan(parsed(csv), new Map());
  assert.equal(p.counts.invalid, 2);
  assert.match(p.rows[0].message ?? '', /disagree on option_name/);
});

test('rows in a group with a duplicate option combination are rejected', () => {
  const csv =
    `${HEADER}\n` +
    'A1,P,1000,100,active,G1,Color,Red,,\n' +
    'A2,P,2000,100,active,G1,Color,Red,,\n';
  const p = buildImportPlan(parsed(csv), new Map());
  assert.equal(p.counts.invalid, 2);
  assert.match(p.rows[0].message ?? '', /identical option combination/);
});

test('rows in a group disagreeing on name (the shared product field) are rejected', () => {
  const csv =
    `${HEADER}\n` +
    'A1,Alpha,1000,100,active,G1,Color,Red,,\n' +
    'A2,Beta,1000,100,active,G1,Color,Blue,,\n';
  const p = buildImportPlan(parsed(csv), new Map());
  assert.equal(p.counts.invalid, 2);
  assert.match(p.rows[0].message ?? '', /disagree on name/);
});

test('option2 must be all-or-nothing across a group', () => {
  const csv =
    `${HEADER}\n` +
    'A1,P,1000,100,active,G1,Color,Red,Size,S\n' +
    'A2,P,1000,100,active,G1,Color,Blue,,\n';
  const p = buildImportPlan(parsed(csv), new Map());
  assert.equal(p.counts.invalid, 2);
  assert.match(p.rows[0].message ?? '', /option2_name\/option2_value must be given on every row/);
});

test('a new group whose resolved name matches an EXISTING product is rejected as a duplicate', () => {
  const existing = new Map([['EXIST-1', existingVariant({ productName: 'Áo thun' })]]);
  const csv =
    `${HEADER}\n` +
    'NEW-RED,Áo thun,100000,200,active,G1,Color,Red,,\n' +
    'NEW-BLUE,Áo thun,100000,200,active,G1,Color,Blue,,\n';
  const p = buildImportPlan(parsed(csv), existing);
  assert.equal(p.counts.duplicate, 2);
  assert.equal(planIsImportable(p), false);
});

test('a group spanning two DIFFERENT existing products is a conflict', () => {
  const existing = new Map([
    ['SKU-A', existingVariant({ productId: 'product-A', productName: 'Alpha' })],
    ['SKU-B', existingVariant({ productId: 'product-B', productName: 'Beta' })],
  ]);
  const csv =
    `${HEADER}\n` +
    'SKU-A,Alpha,1000,100,active,G1,Color,Red,,\n' +
    'SKU-B,Alpha,1000,100,active,G1,Color,Blue,,\n';
  const p = buildImportPlan(parsed(csv), existing);
  assert.equal(p.counts.conflict, 2);
  assert.match(p.rows[0].message ?? '', /different existing products/);
});

test('mixing an existing SKU with a brand-new SKU in one group: the matched row updates, the new one is a blocked duplicate (adding a variant to an existing product is not supported via CSV yet)', () => {
  const existing = new Map([['SHIRT-S', existingVariant({ productId: 'product-shirt', productName: 'Áo thun', price: 100000 })]]);
  const csv =
    `${HEADER}\n` +
    'SHIRT-S,Áo thun,120000,100,active,G1,Color,Red,,\n' +
    'SHIRT-L,Áo thun,120000,100,active,G1,Color,Blue,,\n';
  const p = buildImportPlan(parsed(csv), existing);
  assert.equal(p.rows[0].action, 'update');
  assert.equal(p.rows[1].action, 'duplicate');
  assert.match(p.rows[1].message ?? '', /not supported via CSV import yet/);
  assert.equal(planIsImportable(p), false);
});

test('a group missing weight_grams on every row is invalid', () => {
  const csv =
    'sku,name,price,status,product_key,option_name,option_value\n' +
    'A1,P,1000,active,G1,Color,Red\n' +
    'A2,P,1000,active,G1,Color,Blue\n';
  const p = buildImportPlan(parsed(csv), new Map());
  assert.equal(p.counts.invalid, 2);
  assert.match(p.rows[0].message ?? '', /weight_grams is required/);
});
