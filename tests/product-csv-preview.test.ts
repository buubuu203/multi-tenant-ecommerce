// End-to-end tests for the Catalog CSV import: parsing, planning, the
// read-only preview, and the atomic apply. Isolated test tenants only —
// the suite provisions and deletes its own records and never touches
// existing QA data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { prisma } from '../src/lib/prisma';
import { parseProductCsv, stripBom } from '../src/lib/product-csv-contract';
import { buildImportPlan, planIsImportable, type ExistingVariant } from '../src/lib/product-csv-plan';
import {
  planProductCsv,
  applyProductCsv,
  resolveExistingBySku,
} from '../src/lib/product-csv-apply';
import { csvFingerprint, toPreview } from '../src/lib/product-csv-preview';

let tenantA: { id: string };
let tenantB: { id: string };
let suffix: string;

async function provision(label: string) {
  const tenant = await prisma.tenant.create({
    data: { slug: `test-imp-${label}-${suffix}`, name: `Import ${label}`, status: 'active' },
  });
  await prisma.location.create({
    data: { tenantId: tenant.id, name: 'Main', isDefault: true },
  });
  return tenant;
}

before(async () => {
  suffix = randomUUID().slice(0, 8);
  tenantA = await provision('a');
  tenantB = await provision('b');
});

after(async () => {
  const ids = [tenantA.id, tenantB.id];
  await prisma.inventory.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.productVariant.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.product.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.location.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
});

async function snapshot(tenantId: string) {
  const [products, variants, inventory] = await Promise.all([
    prisma.product.count({ where: { tenantId } }),
    prisma.productVariant.count({ where: { tenantId } }),
    prisma.inventory.count({ where: { tenantId } }),
  ]);
  return { products, variants, inventory };
}

function parsed(csv: string) {
  const result = parseProductCsv(csv);
  assert.ok(!('error' in result), `expected a parse, got ${JSON.stringify(result)}`);
  return result;
}

function parseError(csv: string): string {
  const result = parseProductCsv(csv);
  assert.ok('error' in result, 'expected a file-level rejection');
  return result.error;
}

async function plan(tenantId: string, csv: string) {
  const result = await planProductCsv(tenantId, csv);
  assert.ok(!('error' in result), `expected a plan, got ${JSON.stringify(result)}`);
  return result.plan;
}

const EXT = 'sku,name,price,weight_grams,status';

// ---------- format detection and backward compatibility ----------

test('the historical name,price format still parses exactly as before', () => {
  const p = parsed('name,price\nAlpha,1000\n');
  assert.equal(p.format, 'v1-minimal');
  assert.equal(p.rows[0].name, 'Alpha');
  assert.equal(p.rows[0].price, 1000);
  assert.equal(p.rows[0].status, 'draft', 'omitted status still defaults to draft');
  assert.equal(p.rows[0].sku, null, 'v1 carries no identifier');
});

test('name,price,status is still accepted positionally', () => {
  const p = parsed('name,price,status\nAlpha,1000,active\n');
  assert.equal(p.format, 'v1-minimal');
  assert.equal(p.rows[0].status, 'active');
});

test('the extended format is detected by its named columns, in any order', () => {
  const p = parsed('price,sku,name\n1000,SKU-1,Alpha\n');
  assert.equal(p.format, 'v2-extended');
  assert.equal(p.rows[0].sku, 'SKU-1');
  assert.equal(p.rows[0].name, 'Alpha');
  assert.equal(p.rows[0].price, 1000);
});

// ---------- parsing and validation ----------

test('a UTF-8 BOM is stripped rather than corrupting the first header', () => {
  assert.equal(stripBom('﻿name,price'), 'name,price');
  const p = parsed('﻿name,price\nAlpha,1000\n');
  assert.equal(p.format, 'v1-minimal');
  assert.equal(p.rows.length, 1);
});

test('Vietnamese text survives intact', () => {
  const p = parsed(`${EXT}\nSKU-VN,Ghế gỗ óc chó,1500000,100,active\n`);
  assert.equal(p.rows[0].name, 'Ghế gỗ óc chó');
});

test('quoted commas and newlines are parsed, not split', () => {
  const p = parsed(`${EXT}\nSKU-Q,"Bàn, gỗ",1000,100,active\n`);
  assert.equal(p.rows[0].name, 'Bàn, gỗ');
  const multiline = parsed(`sku,name,price,description\nSKU-M,Alpha,1000,"line one\nline two"\n`);
  assert.match(multiline.rows[0].description ?? '', /line one\nline two/);
});

test('a formula-like value is data on import, never evaluated', () => {
  const p = parsed(`${EXT}\nSKU-F,"=SUM(A1:A9)",1000,100,active\n`);
  assert.equal(p.rows[0].name, '=SUM(A1:A9)');
});

test('invalid UTF-8 is rejected outright', () => {
  assert.match(parseError('name,price\nA�,1000\n'), /not valid UTF-8/);
});

test('file-level problems are rejected with a clear reason', () => {
  assert.match(parseError(''), /File is empty/);
  assert.match(parseError('name,price\n'), /no data rows/);
  assert.match(parseError('sku,sku,name,price\nA,B,C,1\n'), /Duplicate column/);
  assert.match(parseError('sku,name,price,nonsense\nA,B,1,x\n'), /Unrecognized column/);
  assert.match(parseError('sku,name\nA,B\n'), /requires sku, name, price/);
});

test("unsupported-but-expected columns say why, not just 'unknown'", () => {
  assert.match(parseError('sku,name,price,image_url\nA,B,1,x\n'), /Media cannot be imported/);
  assert.match(
    parseError('sku,name,price,discount_percent\nA,B,1,x\n'),
    /Discounts cannot be imported/,
  );
  assert.match(
    parseError('sku,name,price,variant_label\nA,B,1,x\n'),
    /Variant options cannot be imported/,
  );
  // option_value alone (no option_name) is a real, supported column pair
  // now — rejected as a row-level error instead, not a file-level one.
  const optionOnlyValue = parsed('sku,name,price,option_value\nA,B,1,x\n');
  assert.match(optionOnlyValue.errors[0]?.message ?? '', /must be given together/);
  assert.match(
    parseError('sku,name,price,stock_reserved\nA,B,1,x\n'),
    /Reserved stock is managed by orders/,
  );
});

test('row limits and oversized files are rejected', () => {
  const many = `name,price\n${Array.from({ length: 501 }, (_, i) => `P${i},100`).join('\n')}\n`;
  assert.match(parseError(many), /maximum is 500/);
  assert.match(parseError(`name,price\nA,${'9'.repeat(1024 * 1024)}\n`), /too large/);
});

test('row-level problems are reported per row, never dropped', () => {
  const p = parsed(
    `${EXT}\n` +
      `SKU-1,,1000,100,active\n` +
      `SKU-2,Beta,12.5,100,active\n` +
      `SKU-3,Gamma,1000,100,nope\n` +
      `,Delta,1000,100,active\n`,
  );
  assert.equal(p.rows.length, 0, 'no row survived');
  assert.equal(p.errors.length, 4);
  assert.match(p.errors[0].message, /Name is required/);
  assert.match(p.errors[1].message, /whole number/);
  assert.match(p.errors[2].message, /draft or active/);
  assert.match(p.errors[3].message, /sku is required/);
  assert.deepEqual(
    p.errors.map((e) => e.rowNumber),
    [2, 3, 4, 5],
  );
});

test('the sample product import includes a valid weight for every new product', () => {
  const sample = readFileSync(new URL('../import-products.csv', import.meta.url), 'utf8');
  const csv = parsed(sample);
  const plan = buildImportPlan(csv, new Map());

  assert.equal(csv.rows.length, csv.totalRows);
  assert.ok(csv.rows.every((row) => row.weightGrams !== null && row.weightGrams > 0));
  assert.equal(plan.counts.create, csv.totalRows);
  assert.equal(plan.counts.invalid, 0);
});

test('weight must be positive when supplied, and is required before creating a product', () => {
  const invalidWeight = parsed('sku,name,price,weight_grams\nSKU-W,Alpha,1000,0\n');
  assert.equal(invalidWeight.rows.length, 0);
  assert.match(invalidWeight.errors[0].message, /positive whole number of grams/);

  const missingWeight = buildImportPlan(parsed('sku,name,price\nSKU-N,Alpha,1000\n'), new Map());
  assert.equal(missingWeight.counts.invalid, 1);
  assert.match(missingWeight.rows[0].message ?? '', /weight_grams is required/);
});

test('an overlong field is rejected rather than silently truncated', () => {
  const p = parsed(`${EXT}\nSKU-L,${'x'.repeat(2001)},1000,100,active\n`);
  assert.equal(p.rows.length, 0);
  assert.match(p.errors[0].message, /maximum is 2000/);
});

test('a wrong column count is reported', () => {
  const p = parsed(`${EXT}\nSKU-1,Alpha,1000\n`);
  assert.match(p.errors[0].message, /Expected 5 columns, got 3/);
});

// ---------- inventory mode must be explicit ----------

test('on_hand without an explicit mode is rejected', () => {
  const p = parsed('sku,name,price,on_hand\nSKU-1,Alpha,1000,5\n');
  assert.match(p.errors[0].message, /inventory_mode is required/);
});

test('the two inventory modes are never conflated', () => {
  const set = parsed('sku,name,price,on_hand,inventory_mode\nSKU-1,Alpha,1000,5,set_on_hand\n');
  assert.equal(set.rows[0].inventoryMode, 'set_on_hand');
  assert.equal(set.rows[0].onHand, 5);

  const adjust = parsed(
    'sku,name,price,on_hand,inventory_mode\nSKU-1,Alpha,1000,-3,adjust_on_hand\n',
  );
  assert.equal(adjust.rows[0].inventoryMode, 'adjust_on_hand');
  assert.equal(adjust.rows[0].onHand, -3);

  const bogus = parsed('sku,name,price,on_hand,inventory_mode\nSKU-1,Alpha,1000,5,whatever\n');
  assert.match(bogus.errors[0].message, /set_on_hand or adjust_on_hand/);
});

test('invalid inventory values are rejected', () => {
  const negative = parsed('sku,name,price,on_hand,inventory_mode\nS,A,1,-5,set_on_hand\n');
  assert.match(negative.errors[0].message, /cannot be negative/);

  const zeroDelta = parsed('sku,name,price,on_hand,inventory_mode\nS,A,1,0,adjust_on_hand\n');
  assert.match(zeroDelta.errors[0].message, /does nothing/);

  const notNumber = parsed('sku,name,price,on_hand,inventory_mode\nS,A,1,many,set_on_hand\n');
  assert.match(notNumber.errors[0].message, /whole number/);

  const modeOnly = parsed('sku,name,price,on_hand,inventory_mode\nS,A,1,,set_on_hand\n');
  assert.match(modeOnly.errors[0].message, /without on_hand/);
});

// ---------- category column ----------

test('an empty or omitted category cell parses as null, not empty string', () => {
  const withColumn = parsed(`sku,name,price,category\nC-1,Alpha,1000,\n`);
  assert.equal(withColumn.rows[0].category, null);

  const withoutColumn = parsed(`${EXT}\nC-2,Beta,1000,100,active\n`);
  assert.equal(withoutColumn.rows[0].category, null);
});

test('a category name is trimmed', () => {
  const p = parsed(`sku,name,price,category\nC-3,Gamma,1000,  Toys  \n`);
  assert.equal(p.rows[0].category, 'Toys');
});

test('an overlong category name is rejected like any other field', () => {
  const p = parsed(`sku,name,price,category\nC-4,Delta,1000,${'x'.repeat(2001)}\n`);
  assert.equal(p.rows.length, 0);
  assert.match(p.errors[0].message, /maximum is 2000/);
});

// ---------- planning ----------

test('a duplicate SKU inside one file is a conflict, not a last-one-wins', () => {
  const p = buildImportPlan(
    parsed(`${EXT}\nDUP,Alpha,1000,100,active\nDUP,Beta,2000,100,active\n`),
    new Map(),
  );
  assert.equal(p.counts.create, 1);
  assert.equal(p.counts.conflict, 1);
  assert.match(p.rows[1].message ?? '', /also appears on row 2/);
  assert.equal(planIsImportable(p), false, 'a conflict blocks the whole import');
});

function existingVariant(overrides: Partial<ExistingVariant> = {}): ExistingVariant {
  return {
    variantId: 'variant-1',
    productId: 'product-1',
    productName: 'Alpha',
    price: 1000,
    weightGrams: 100,
    status: 'active' as const,
    description: null,
    category: null,
    onHand: 0,
    reserved: 0,
    ...overrides,
  };
}

test('a new row whose name matches an EXISTING product (different SKU) is rejected as a duplicate', () => {
  const existing = new Map([['EXIST-1', existingVariant({ productName: 'Alpha' })]]);
  // Same name, different case and surrounding whitespace — still the same product to a merchant.
  const p = buildImportPlan(parsed(`${EXT}\nNEW-1,  alpha  ,1000,100,active\n`), existing);
  assert.equal(p.counts.create, 0);
  assert.equal(p.counts.duplicate, 1);
  assert.equal(p.rows[0].action, 'duplicate');
  assert.match(p.rows[0].message ?? '', /already exists/);
  assert.match(p.rows[0].message ?? '', /EXIST-1/);
  assert.equal(planIsImportable(p), false, 'a duplicate blocks the whole import');
});

test('a product whose SKU already matches is an update, never a duplicate, even with the same name', () => {
  const existing = new Map([['EXIST-1', existingVariant({ productName: 'Alpha', price: 1000 })]]);
  const p = buildImportPlan(parsed(`${EXT}\nEXIST-1,Alpha,2000,100,active\n`), existing);
  assert.equal(p.counts.duplicate, 0);
  assert.equal(p.rows[0].action, 'update');
});

test('two new rows in the same file sharing a name: the first creates, the second is a duplicate', () => {
  const p = buildImportPlan(
    parsed(`${EXT}\nNEW-1,Gamma,1000,100,active\nNEW-2,Gamma,2000,100,active\n`),
    new Map(),
  );
  assert.equal(p.counts.create, 1);
  assert.equal(p.counts.duplicate, 1);
  assert.equal(p.rows[0].action, 'create');
  assert.equal(p.rows[1].action, 'duplicate');
  assert.match(p.rows[1].message ?? '', /also appears on row 2/);
  assert.equal(planIsImportable(p), false);
});

test('an invalid row blocks the import rather than being skipped', () => {
  const p = buildImportPlan(parsed(`${EXT}\nS1,Alpha,1000,100,active\nS2,,1000,100,active\n`), new Map());
  assert.equal(p.counts.invalid, 1);
  assert.equal(planIsImportable(p), false);
});

// ---------- read-only preview ----------

test('previewing writes nothing, whatever the file contains', async () => {
  const before_ = await snapshot(tenantA.id);
  await plan(tenantA.id, `${EXT}\nRO-1,Alpha,1000,100,active\nRO-2,,1,100,active\n`);
  assert.deepEqual(await snapshot(tenantA.id), before_);
});

test('the plan and preview modules hold no database client', () => {
  for (const file of ['../src/lib/product-csv-plan.ts', '../src/lib/product-csv-contract.ts']) {
    const code = readFileSync(new URL(file, import.meta.url), 'utf8')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(code, /getScopedDb|prisma|\$transaction/, `${file} must stay pure`);
  }
});

// ---------- apply: create, update, unchanged, idempotency ----------

test('a confirmed import creates products, variants and inventory together', async () => {
  const csv =
    'sku,name,price,weight_grams,status,on_hand,inventory_mode\n' +
    `CRE-1-${suffix},Alpha ${suffix},1000,100,active,7,set_on_hand\n`;
  const result = await applyProductCsv(tenantA.id, csv, csvFingerprint(csv));
  assert.ok(result.success, result.success ? '' : result.error);
  assert.equal(result.data.created, 1);
  assert.equal(result.data.atomic, true);

  const variant = await prisma.productVariant.findFirst({
    where: { tenantId: tenantA.id, sku: `CRE-1-${suffix}` },
    include: { product: true, inventory: true },
  });
  assert.ok(variant);
  assert.equal(variant.price, 1000);
  assert.equal(variant.product.name, `Alpha ${suffix}`);
  assert.equal(variant.product.status, 'active');
  assert.equal(variant.inventory[0].onHand, 7);
});

test('IDEMPOTENCY — re-importing the same file changes nothing', async () => {
  const csv =
    'sku,name,price,weight_grams,status,on_hand,inventory_mode\n' +
    `IDEM-${suffix},Beta ${suffix},2000,100,active,5,set_on_hand\n`;

  const first = await applyProductCsv(tenantA.id, csv, csvFingerprint(csv));
  assert.ok(first.success);
  assert.equal(first.data.created, 1);

  const after1 = await snapshot(tenantA.id);

  // The plan now says "unchanged", so the import refuses as a no-op.
  const replan = await plan(tenantA.id, csv);
  assert.equal(replan.counts.unchanged, 1);
  assert.equal(replan.counts.create, 0);
  assert.equal(planIsImportable(replan), false);

  const second = await applyProductCsv(tenantA.id, csv, csvFingerprint(csv));
  assert.ok(!second.success, 'a no-op import is refused rather than duplicating');
  assert.match(second.error, /already matches/);
  assert.deepEqual(await snapshot(tenantA.id), after1, 'nothing was duplicated');
});

// ---------- apply: multi-variant products (product_key + option_name/option_value) ----------

test('a product_key group creates ONE product with real, option-bearing variants', async () => {
  const key = `GRP-${suffix}`;
  const csv =
    'sku,name,price,weight_grams,status,product_key,option_name,option_value,on_hand,inventory_mode\n' +
    `VAR-RED-${suffix},Shirt ${suffix},100000,200,active,${key},Color,Red,10,set_on_hand\n` +
    `VAR-BLUE-${suffix},Shirt ${suffix},110000,200,active,${key},Color,Blue,20,set_on_hand\n`;

  const result = await applyProductCsv(tenantA.id, csv, csvFingerprint(csv));
  assert.ok(result.success, result.success ? '' : result.error);
  assert.equal(result.data.created, 2);

  const variants = await prisma.productVariant.findMany({
    where: { tenantId: tenantA.id, sku: { in: [`VAR-RED-${suffix}`, `VAR-BLUE-${suffix}`] } },
    include: { product: true, inventory: true, optionValues: { include: { variantOptionValueTenant: true } } },
  });
  assert.equal(variants.length, 2);
  // Both variants belong to the SAME product — not two separate products
  // sharing a name.
  assert.equal(variants[0].productId, variants[1].productId);
  assert.equal(variants[0].product.name, `Shirt ${suffix}`);
  assert.equal(variants[0].product.weightGrams, 200);

  // combinationKey was never computed by application code — it must be
  // real (non-placeholder) and distinct per variant once the deferred
  // trigger has run at commit.
  assert.notEqual(variants[0].combinationKey, variants[1].combinationKey);
  assert.notEqual(variants[0].combinationKey, '');

  const redVariant = variants.find((v) => v.sku === `VAR-RED-${suffix}`)!;
  assert.equal(redVariant.optionValues.length, 1);
  assert.equal(redVariant.optionValues[0].variantOptionValueTenant.value, 'Red');
  assert.equal(redVariant.inventory[0].onHand, 10);

  const productOptions = await prisma.productOption.findMany({
    where: { tenantId: tenantA.id, productId: variants[0].productId },
    include: { variantOption: true },
  });
  assert.equal(productOptions.length, 1);
  assert.equal(productOptions[0].variantOption.name, 'Color');
});

test('two option axes (option_name + option2_name) produce two ProductOptions and correct pairings', async () => {
  const key = `GRP2-${suffix}`;
  const csv =
    'sku,name,price,weight_grams,status,product_key,option_name,option_value,option2_name,option2_value\n' +
    `SHOE-RED-S-${suffix},Shoe ${suffix},200000,300,active,${key},Color,Red,Size,S\n` +
    `SHOE-RED-M-${suffix},Shoe ${suffix},200000,300,active,${key},Color,Red,Size,M\n`;

  const result = await applyProductCsv(tenantA.id, csv, csvFingerprint(csv));
  assert.ok(result.success, result.success ? '' : result.error);
  assert.equal(result.data.created, 2);

  const variants = await prisma.productVariant.findMany({
    where: { tenantId: tenantA.id, sku: { in: [`SHOE-RED-S-${suffix}`, `SHOE-RED-M-${suffix}`] } },
    include: { optionValues: { include: { variantOptionValueTenant: true } } },
  });
  for (const v of variants) {
    assert.equal(v.optionValues.length, 2, 'each variant has both axes attached');
  }
  const productOptions = await prisma.productOption.findMany({
    where: { tenantId: tenantA.id, productId: variants[0].productId },
  });
  assert.equal(productOptions.length, 2, 'Color and Size are both declared on the product, once each');
});

test('re-using a VariantOption name across two different products reuses the same tenant-global row', async () => {
  const keyA = `GA-${suffix}`;
  const keyB = `GB-${suffix}`;
  const csv =
    'sku,name,price,weight_grams,status,product_key,option_name,option_value\n' +
    `REUSE-A-RED-${suffix},Hat ${suffix},50000,80,active,${keyA},Color,Red\n` +
    `REUSE-A-BLUE-${suffix},Hat ${suffix},50000,80,active,${keyA},Color,Blue\n` +
    `REUSE-B-RED-${suffix},Scarf ${suffix},40000,60,active,${keyB},Color,Red\n` +
    `REUSE-B-BLUE-${suffix},Scarf ${suffix},40000,60,active,${keyB},Color,Blue\n`;

  const result = await applyProductCsv(tenantA.id, csv, csvFingerprint(csv));
  assert.ok(result.success, result.success ? '' : result.error);
  assert.equal(result.data.created, 4);

  const colorOptions = await prisma.variantOption.findMany({ where: { tenantId: tenantA.id, name: 'Color' } });
  assert.equal(colorOptions.length, 1, 'one tenant-global "Color" option, shared by both products');

  const redValues = await prisma.variantOptionValue.findMany({
    where: { tenantId: tenantA.id, variantOptionId: colorOptions[0].id, value: 'Red' },
  });
  assert.equal(redValues.length, 1, 'one "Red" value, shared by both products\' Red variants');
});

test('a new variant SKU for an existing multi-variant product is rejected, not silently created as a duplicate product', async () => {
  const key = `GEXIST-${suffix}`;
  const create =
    'sku,name,price,weight_grams,status,product_key,option_name,option_value\n' +
    `EXIST-S-${suffix},Hoodie ${suffix},150000,400,active,${key},Size,S\n`;
  assert.ok((await applyProductCsv(tenantA.id, create, csvFingerprint(create))).success);

  const addVariant =
    'sku,name,price,weight_grams,status,product_key,option_name,option_value\n' +
    `EXIST-S-${suffix},Hoodie ${suffix},150000,400,active,${key},Size,S\n` +
    `EXIST-M-${suffix},Hoodie ${suffix},150000,400,active,${key},Size,M\n`;
  const planned = await plan(tenantA.id, addVariant);
  assert.equal(planned.rows.find((r) => r.sku === `EXIST-S-${suffix}`)?.action, 'unchanged');
  assert.equal(planned.rows.find((r) => r.sku === `EXIST-M-${suffix}`)?.action, 'duplicate');
  assert.equal(planIsImportable(planned), false);

  const result = await applyProductCsv(tenantA.id, addVariant, csvFingerprint(addVariant));
  assert.ok(!result.success);
  const variantCount = await prisma.productVariant.count({ where: { tenantId: tenantA.id, sku: { startsWith: `EXIST-` } } });
  assert.equal(variantCount, 1, 'the blocked import changed nothing');
});

test('a changed row updates in place and preserves unrelated fields', async () => {
  const sku = `UPD-${suffix}`;
  const create = `sku,name,price,weight_grams,status,description\n${sku},Gamma ${suffix},3000,100,active,keep me\n`;
  assert.ok((await applyProductCsv(tenantA.id, create, csvFingerprint(create))).success);

  const before_ = await snapshot(tenantA.id);

  // Price changes; description column omitted entirely.
  const update = `sku,name,price,status\n${sku},Gamma ${suffix},4500,active\n`;
  const planned = await plan(tenantA.id, update);
  assert.equal(planned.counts.update, 1);
  assert.deepEqual(
    planned.rows[0].changes.map((c) => c.field),
    ['price'],
  );

  const result = await applyProductCsv(tenantA.id, update, csvFingerprint(update));
  assert.ok(result.success);
  assert.equal(result.data.updated, 1);
  assert.equal(result.data.created, 0);

  const variant = await prisma.productVariant.findFirst({
    where: { tenantId: tenantA.id, sku },
    include: { product: true },
  });
  assert.equal(variant?.price, 4500);
  assert.equal(variant?.product.description, 'keep me', 'an omitted column never blanks data');
  assert.deepEqual(await snapshot(tenantA.id), before_, 'update created no new rows');
});

test('a new category is created by name and reused across rows in the same file', async () => {
  const skuA = `CAT-A-${suffix}`;
  const skuB = `CAT-B-${suffix}`;
  const categoryName = `Decor ${suffix}`;
  const csv =
    'sku,name,price,weight_grams,category\n' +
    `${skuA},Alpha ${suffix},1000,100,${categoryName}\n` +
    `${skuB},Beta ${suffix},2000,100,${categoryName}\n`;

  const result = await applyProductCsv(tenantA.id, csv, csvFingerprint(csv));
  assert.ok(result.success, result.success ? '' : result.error);
  assert.equal(result.data.created, 2);

  const categories = await prisma.productCategory.findMany({
    where: { tenantId: tenantA.id, name: categoryName },
  });
  assert.equal(categories.length, 1, 'one file naming the same new category twice creates it once');

  const variants = await prisma.productVariant.findMany({
    where: { tenantId: tenantA.id, sku: { in: [skuA, skuB] } },
    include: { product: true },
  });
  assert.ok(variants.every((v) => v.product.categoryId === categories[0].id));
});

test('an existing category is matched by name, not duplicated', async () => {
  const sku = `CAT-EXIST-${suffix}`;
  const categoryName = `Jewelry ${suffix}`;
  const existing = await prisma.productCategory.create({
    data: { tenantId: tenantA.id, name: categoryName },
  });

  const csv = `sku,name,price,weight_grams,category\n${sku},Gamma ${suffix},1000,100,${categoryName}\n`;
  const result = await applyProductCsv(tenantA.id, csv, csvFingerprint(csv));
  assert.ok(result.success, result.success ? '' : result.error);

  const stillOne = await prisma.productCategory.count({
    where: { tenantId: tenantA.id, name: categoryName },
  });
  assert.equal(stillOne, 1);

  const variant = await prisma.productVariant.findFirst({
    where: { tenantId: tenantA.id, sku },
    include: { product: true },
  });
  assert.equal(variant?.product.categoryId, existing.id);
});

test('an omitted category column leaves an existing assignment untouched; a given one updates it, surfaced as a plan change', async () => {
  const sku = `CAT-UPD-${suffix}`;
  const firstCategory = `Lighting ${suffix}`;
  const create = `sku,name,price,weight_grams,category\n${sku},Delta ${suffix},1000,100,${firstCategory}\n`;
  assert.ok((await applyProductCsv(tenantA.id, create, csvFingerprint(create))).success);

  // Price changes; category column omitted entirely — must not clear it.
  const touchPrice = `sku,name,price\n${sku},Delta ${suffix},1500\n`;
  const touchPlan = await plan(tenantA.id, touchPrice);
  assert.deepEqual(touchPlan.rows[0].changes.map((c) => c.field), ['price']);
  assert.ok((await applyProductCsv(tenantA.id, touchPrice, csvFingerprint(touchPrice))).success);

  const afterPriceOnly = await prisma.productVariant.findFirst({
    where: { tenantId: tenantA.id, sku },
    include: { product: { include: { category: true } } },
  });
  assert.equal(afterPriceOnly?.product.category?.name, firstCategory, 'omitted category column left it alone');

  // Now re-category explicitly.
  const secondCategory = `Decor ${suffix}`;
  const recategorize = `sku,name,price,category\n${sku},Delta ${suffix},1500,${secondCategory}\n`;
  const recatPlan = await plan(tenantA.id, recategorize);
  const categoryChange = recatPlan.rows[0].changes.find((c) => c.field === 'category');
  assert.ok(categoryChange, 'the plan surfaces the category change');
  assert.equal(categoryChange?.from, firstCategory);
  assert.equal(categoryChange?.to, secondCategory);

  assert.ok((await applyProductCsv(tenantA.id, recategorize, csvFingerprint(recategorize))).success);
  const afterRecategorize = await prisma.productVariant.findFirst({
    where: { tenantId: tenantA.id, sku },
    include: { product: { include: { category: true } } },
  });
  assert.equal(afterRecategorize?.product.category?.name, secondCategory);
});

test('CATEGORY TENANT ISOLATION — same category name in two tenants stays two separate rows', async () => {
  const name = `Shared Name ${suffix}`;
  const skuA = `CAT-ISO-A-${suffix}`;
  const skuB = `CAT-ISO-B-${suffix}`;
  const csvA = `sku,name,price,weight_grams,category\n${skuA},Owned by A,1000,100,${name}\n`;
  const csvB = `sku,name,price,weight_grams,category\n${skuB},Owned by B,1000,100,${name}\n`;

  assert.ok((await applyProductCsv(tenantA.id, csvA, csvFingerprint(csvA))).success);
  assert.ok((await applyProductCsv(tenantB.id, csvB, csvFingerprint(csvB))).success);

  const categories = await prisma.productCategory.findMany({ where: { name } });
  assert.equal(categories.length, 2, 'each tenant gets its own category row for the same name');
  assert.notEqual(categories[0].tenantId, categories[1].tenantId);
});

test('set_on_hand and adjust_on_hand both go through the guarded helper', async () => {
  const sku = `INV-${suffix}`;
  const create = `sku,name,price,weight_grams,on_hand,inventory_mode\n${sku},Delta ${suffix},1000,100,10,set_on_hand\n`;
  assert.ok((await applyProductCsv(tenantA.id, create, csvFingerprint(create))).success);

  const adjust = `sku,name,price,on_hand,inventory_mode\n${sku},Delta ${suffix},1000,-4,adjust_on_hand\n`;
  const result = await applyProductCsv(tenantA.id, adjust, csvFingerprint(adjust));
  assert.ok(result.success, result.success ? '' : result.error);
  assert.equal(result.data.inventoryChanged, 1);

  const inv = await prisma.inventory.findFirst({
    where: { tenantId: tenantA.id, productVariant: { sku } },
  });
  assert.equal(inv?.onHand, 6);
});

// ---------- atomicity ----------

test('ATOMICITY — one bad row rolls the entire import back', async () => {
  // Row two drives onHand below zero, which the inventory guard refuses.
  // Row one must not survive.
  const before_ = await snapshot(tenantA.id);
  const csv =
    'sku,name,price,weight_grams,on_hand,inventory_mode\n' +
    `ATOM-OK-${suffix},Good ${suffix},1000,100,5,set_on_hand\n` +
    `ATOM-BAD-${suffix},Bad ${suffix},1000,100,-99,adjust_on_hand\n`;

  const result = await applyProductCsv(tenantA.id, csv, csvFingerprint(csv));
  assert.ok(!result.success, 'the import failed');
  assert.match(result.error, /No changes were saved/);

  assert.deepEqual(await snapshot(tenantA.id), before_, 'the good row was rolled back too');
  const survivor = await prisma.productVariant.findFirst({
    where: { tenantId: tenantA.id, sku: `ATOM-OK-${suffix}` },
  });
  assert.equal(survivor, null, 'nothing from the failed import remains');
});

test('an import with any invalid row refuses before touching the database', async () => {
  const before_ = await snapshot(tenantA.id);
  const csv = `${EXT}\nREF-1-${suffix},Alpha,1000,100,active\nREF-2-${suffix},,1000,100,active\n`;
  const result = await applyProductCsv(tenantA.id, csv, csvFingerprint(csv));
  assert.ok(!result.success);
  assert.match(result.error, /Nothing was imported/);
  assert.deepEqual(await snapshot(tenantA.id), before_);
});

// ---------- tenant isolation ----------

test('TENANT ISOLATION — a SKU in another tenant is invisible', async () => {
  const sku = `ISO-${suffix}`;
  const csv = `${EXT}\n${sku},Owned by B,1000,100,active\n`;
  assert.ok((await applyProductCsv(tenantB.id, csv, csvFingerprint(csv))).success);

  // Tenant A previewing the same SKU sees a CREATE, never B's record.
  const planned = await plan(tenantA.id, csv);
  assert.equal(planned.counts.update, 0);
  assert.equal(planned.counts.create, 1);

  const index = await resolveExistingBySku(tenantA.id, [sku]);
  assert.equal(index.size, 0, "A cannot resolve B's SKU");

  // And importing it creates A's own product, leaving B's untouched.
  const result = await applyProductCsv(tenantA.id, csv, csvFingerprint(csv));
  assert.ok(result.success);
  assert.equal(result.data.created, 1);

  const bProduct = await prisma.productVariant.findFirst({
    where: { tenantId: tenantB.id, sku },
    include: { product: true },
  });
  assert.equal(bProduct?.product.name, 'Owned by B', "B's record is unchanged");
});

// ---------- confirmation integrity ----------

test('the fingerprint identifies the exact bytes previewed', () => {
  const csv = `${EXT}\nFP,Alpha,1000,100,active\n`;
  assert.equal(csvFingerprint(csv), csvFingerprint(csv));
  assert.notEqual(csvFingerprint(csv), csvFingerprint(csv.replace('1000', '1001')));
});

test('the preview carries no authority into the import', () => {
  const code = readFileSync(new URL('../src/lib/product-csv-apply.ts', import.meta.url), 'utf8')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // applyProductCsv takes the TEXT and re-plans; it accepts no plan object.
  assert.match(code, /const replanned = await planProductCsv\(tenantId, csvText\)/);
  assert.doesNotMatch(code, /function applyProductCsv\([^)]*plan: ImportPlan/);
});

test('the preview shape exposes counts the UI cannot forge into authority', async () => {
  const csv = `${EXT}\nSHAPE-${suffix},Alpha,1000,100,active\n`;
  const p = await plan(tenantA.id, csv);
  const view = toPreview(p, csvFingerprint(csv));
  assert.equal(view.atomic, true);
  assert.equal(view.format, 'v2-extended');
  assert.equal(typeof view.importable, 'boolean');
  assert.equal(view.fingerprint, csvFingerprint(csv));
});

// ---------- client bundle boundary ----------

test('the import UI imports nothing server-only', () => {
  const src = readFileSync(
    new URL('../src/app/tenant-admin/ImportProductsForm.tsx', import.meta.url),
    'utf8',
  );
  for (const forbidden of [
    /from '@\/lib\/product-csv-preview'/,
    /from '@\/lib\/product-csv-apply'/,
    /from '@\/lib\/product-csv-plan'/,
    /from '@\/lib\/product-csv-contract'/,
  ]) {
    assert.doesNotMatch(src, forbidden, 'the client must use the types module only');
  }
  assert.match(src, /from '@\/lib\/product-csv-preview-types'/);

  const types = readFileSync(
    new URL('../src/lib/product-csv-preview-types.ts', import.meta.url),
    'utf8',
  )
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  for (const forbidden of [/node:crypto/, /product-mutations/, /prisma/, /import /]) {
    assert.doesNotMatch(types, forbidden, 'the types module must import nothing');
  }
});
