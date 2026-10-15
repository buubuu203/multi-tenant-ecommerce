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
import { buildImportPlan, planIsImportable } from '../src/lib/product-csv-plan';
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

const EXT = 'sku,name,price,status';

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
  const p = parsed(`${EXT}\nSKU-VN,Ghế gỗ óc chó,1500000,active\n`);
  assert.equal(p.rows[0].name, 'Ghế gỗ óc chó');
});

test('quoted commas and newlines are parsed, not split', () => {
  const p = parsed(`${EXT}\nSKU-Q,"Bàn, gỗ",1000,active\n`);
  assert.equal(p.rows[0].name, 'Bàn, gỗ');
  const multiline = parsed(`sku,name,price,description\nSKU-M,Alpha,1000,"line one\nline two"\n`);
  assert.match(multiline.rows[0].description ?? '', /line one\nline two/);
});

test('a formula-like value is data on import, never evaluated', () => {
  const p = parsed(`${EXT}\nSKU-F,"=SUM(A1:A9)",1000,active\n`);
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
    parseError('sku,name,price,option_value\nA,B,1,x\n'),
    /Variant options cannot be imported/,
  );
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
      `SKU-1,,1000,active\n` +
      `SKU-2,Beta,12.5,active\n` +
      `SKU-3,Gamma,1000,nope\n` +
      `,Delta,1000,active\n`,
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

test('an overlong field is rejected rather than silently truncated', () => {
  const p = parsed(`${EXT}\nSKU-L,${'x'.repeat(2001)},1000,active\n`);
  assert.equal(p.rows.length, 0);
  assert.match(p.errors[0].message, /maximum is 2000/);
});

test('a wrong column count is reported', () => {
  const p = parsed(`${EXT}\nSKU-1,Alpha,1000\n`);
  assert.match(p.errors[0].message, /Expected 4 columns, got 3/);
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

// ---------- planning ----------

test('a duplicate SKU inside one file is a conflict, not a last-one-wins', () => {
  const p = buildImportPlan(
    parsed(`${EXT}\nDUP,Alpha,1000,active\nDUP,Beta,2000,active\n`),
    new Map(),
  );
  assert.equal(p.counts.create, 1);
  assert.equal(p.counts.conflict, 1);
  assert.match(p.rows[1].message ?? '', /also appears on row 2/);
  assert.equal(planIsImportable(p), false, 'a conflict blocks the whole import');
});

test('an invalid row blocks the import rather than being skipped', () => {
  const p = buildImportPlan(parsed(`${EXT}\nS1,Alpha,1000,active\nS2,,1000,active\n`), new Map());
  assert.equal(p.counts.invalid, 1);
  assert.equal(planIsImportable(p), false);
});

// ---------- read-only preview ----------

test('previewing writes nothing, whatever the file contains', async () => {
  const before_ = await snapshot(tenantA.id);
  await plan(tenantA.id, `${EXT}\nRO-1,Alpha,1000,active\nRO-2,,1,active\n`);
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
    'sku,name,price,status,on_hand,inventory_mode\n' +
    `CRE-1-${suffix},Alpha ${suffix},1000,active,7,set_on_hand\n`;
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
    'sku,name,price,status,on_hand,inventory_mode\n' +
    `IDEM-${suffix},Beta ${suffix},2000,active,5,set_on_hand\n`;

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

test('a changed row updates in place and preserves unrelated fields', async () => {
  const sku = `UPD-${suffix}`;
  const create = `sku,name,price,status,description\n${sku},Gamma ${suffix},3000,active,keep me\n`;
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

test('set_on_hand and adjust_on_hand both go through the guarded helper', async () => {
  const sku = `INV-${suffix}`;
  const create = `sku,name,price,on_hand,inventory_mode\n${sku},Delta ${suffix},1000,10,set_on_hand\n`;
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
    'sku,name,price,on_hand,inventory_mode\n' +
    `ATOM-OK-${suffix},Good ${suffix},1000,5,set_on_hand\n` +
    `ATOM-BAD-${suffix},Bad ${suffix},1000,-99,adjust_on_hand\n`;

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
  const csv = `${EXT}\nREF-1-${suffix},Alpha,1000,active\nREF-2-${suffix},,1000,active\n`;
  const result = await applyProductCsv(tenantA.id, csv, csvFingerprint(csv));
  assert.ok(!result.success);
  assert.match(result.error, /Nothing was imported/);
  assert.deepEqual(await snapshot(tenantA.id), before_);
});

// ---------- tenant isolation ----------

test('TENANT ISOLATION — a SKU in another tenant is invisible', async () => {
  const sku = `ISO-${suffix}`;
  const csv = `${EXT}\n${sku},Owned by B,1000,active\n`;
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
  const csv = `${EXT}\nFP,Alpha,1000,active\n`;
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
  const csv = `${EXT}\nSHAPE-${suffix},Alpha,1000,active\n`;
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
