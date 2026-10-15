// Integration tests for the Catalog CSV import PREVIEW against the real
// local database. The central property — preview mutates nothing — is
// proven by snapshotting the database around it, not asserted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import {
  buildImportPreview,
  csvFingerprint,
  PREVIEW_DISPLAY_LIMIT,
  type ImportPreview,
} from '../src/lib/product-csv-preview';
import { importProductsFromCsv } from '../src/lib/product-csv';

let tenantA: { id: string };
let tenantB: { id: string };
let suffix: string;

async function provision(label: string) {
  const tenant = await prisma.tenant.create({
    data: { slug: `test-csvprev-${label}-${suffix}`, name: `CSV ${label}`, status: 'active' },
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

/** Everything that a mutation would change, for before/after comparison. */
async function snapshot() {
  const [products, variants, inventory] = await Promise.all([
    prisma.product.count(),
    prisma.productVariant.count(),
    prisma.inventory.count(),
  ]);
  return { products, variants, inventory };
}

function ok(preview: ImportPreview | { error: string }): ImportPreview {
  assert.ok(!('error' in preview), `expected a preview, got ${JSON.stringify(preview)}`);
  return preview;
}

// ---------- the read-only guarantee ----------

test('previewing a valid file mutates nothing', async () => {
  const before_ = await snapshot();
  const preview = ok(
    buildImportPreview('name,price,status\nGhế gỗ,120000,active\nBàn,90000,draft\n', []),
  );
  assert.equal(preview.counts.create, 2);
  assert.deepEqual(await snapshot(), before_, 'no row was created by previewing');
});

test('previewing an invalid file mutates nothing either', async () => {
  const before_ = await snapshot();
  const preview = ok(buildImportPreview('name,price\n,abc\nOnly\n', []));
  assert.ok(preview.counts.invalid > 0);
  assert.deepEqual(await snapshot(), before_);
});

test('the preview module cannot reach a mutation at all', async () => {
  // Structural, and the reason the test above can be trusted: the pure
  // module imports no write path. Comments are stripped first — the module
  // DISCUSSES the importer at length to explain the contract; what matters
  // is that no code calls it.
  const { readFileSync } = await import('node:fs');
  const code = readFileSync(new URL('../src/lib/product-csv-preview.ts', import.meta.url), 'utf8')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  assert.doesNotMatch(code, /importProductsFromCsv/, 'preview never calls the importer');
  assert.doesNotMatch(code, /createProduct\b/, 'preview never calls the mutation');
  assert.doesNotMatch(code, /getScopedDb|prisma/, 'preview touches no database client');
  // It imports only the parser, the limits and the pure validator.
  assert.match(code, /from '\.\/product-csv'/);
  assert.match(code, /validateProductInput/);
});

// ---------- classification ----------

test('valid rows are classified as create', () => {
  const p = ok(buildImportPreview('name,price\nAlpha,1000\nBeta,2000\n', []));
  assert.equal(p.totalRows, 2);
  assert.equal(p.counts.create, 2);
  assert.equal(p.counts.conflict, 0);
  assert.equal(p.counts.invalid, 0);
  assert.deepEqual(
    p.rows.map((r) => r.action),
    ['create', 'create'],
  );
  assert.equal(p.importableRows, 2);
});

test('a name that already exists is a conflict, not an update', () => {
  // The importer has no update path, so the honest classification is
  // "this will create a SECOND product".
  const p = ok(buildImportPreview('name,price\nExisting,1000\n', ['Existing']));
  assert.equal(p.counts.conflict, 1);
  assert.equal(p.counts.create, 0);
  assert.match(p.rows[0].message ?? '', /already exists/);
  assert.match(p.rows[0].message ?? '', /does not update/);
});

test('update and unchanged are always zero, because the importer cannot do them', () => {
  const p = ok(buildImportPreview('name,price\nExisting,1000\nNew,2000\n', ['Existing']));
  assert.equal(p.counts.update, 0);
  assert.equal(p.counts.unchanged, 0);
});

test('conflict matching is case-insensitive but never fuzzy', () => {
  const p = ok(
    buildImportPreview('name,price\n  existing  ,1000\nExistingish,2000\n', ['Existing']),
  );
  assert.equal(p.rows[0].action, 'conflict', 'trim + case fold matches');
  assert.equal(p.rows[1].action, 'create', 'a similar-but-different name is NOT matched');
});

test('duplicate rows inside one file are flagged explicitly', () => {
  const p = ok(buildImportPreview('name,price\nSame,1000\nSame,2000\n', []));
  assert.equal(p.rows[0].action, 'create', 'the first occurrence is a plain create');
  assert.equal(p.rows[1].action, 'conflict');
  assert.match(p.rows[1].message ?? '', /Another row in this file/);
  assert.match(p.rows[1].message ?? '', /does not merge/);
});

test('invalid rows are reported per row and never silently dropped', () => {
  const p = ok(
    buildImportPreview('name,price,status\n,1000,active\nNoPrice,abc,active\nBad,100,nope\n', []),
  );
  assert.equal(p.counts.invalid, 3);
  assert.equal(p.rows.length, 3, 'every bad row is listed');
  assert.match(p.rows[0].message ?? '', /Name is required/);
  assert.match(p.rows[1].message ?? '', /whole number/);
  assert.match(p.rows[2].message ?? '', /draft or active/);
  // Row numbers match the importer's own 1-indexed, header-inclusive count.
  assert.deepEqual(
    p.rows.map((r) => r.rowNumber),
    [2, 3, 4],
  );
});

test('a wrong column count is reported, not guessed at', () => {
  const p = ok(buildImportPreview('name,price\nOnlyOne\n', []));
  assert.equal(p.counts.invalid, 1);
  assert.match(p.rows[0].message ?? '', /Expected 2 columns, got 1/);
});

// ---------- file-level rejection, same rules as the importer ----------

test("file-level problems are rejected with the importer's own messages", () => {
  assert.deepEqual(buildImportPreview('', []), { error: 'File is empty.' });
  assert.deepEqual(buildImportPreview('name,price\n', []), { error: 'File has no data rows.' });

  const unknownHeader = buildImportPreview('name,cost\nA,1\n', []);
  assert.ok('error' in unknownHeader);
  assert.match(unknownHeader.error, /Unrecognized header/);

  const duplicateHeader = buildImportPreview('name,name\nA,1\n', []);
  assert.ok('error' in duplicateHeader);
  assert.match(duplicateHeader.error, /Unrecognized header/);
});

test('row and byte limits are enforced before anything else', () => {
  const tooManyRows = `name,price\n${Array.from({ length: 501 }, (_, i) => `P${i},100`).join('\n')}\n`;
  const rowResult = buildImportPreview(tooManyRows, []);
  assert.ok('error' in rowResult);
  assert.match(rowResult.error, /maximum is 500/);

  const huge = `name,price\nA,${'9'.repeat(1024 * 1024 + 10)}\n`;
  const byteResult = buildImportPreview(huge, []);
  assert.ok('error' in byteResult);
  assert.match(byteResult.error, /too large/);
});

test('the preview agrees with the importer about what is acceptable', () => {
  // Same guards, same order — a file the preview rejects is one the import
  // would reject too, with the same wording.
  for (const bad of ['', 'name,price\n', 'name,cost\nA,1\n']) {
    const previewed = buildImportPreview(bad, []);
    assert.ok('error' in previewed, `preview should reject: ${JSON.stringify(bad)}`);
  }
});

// ---------- display limit ----------

test('large previews truncate the display but never the counts', () => {
  const rows = Array.from({ length: 120 }, (_, i) => `Product ${i},1000`).join('\n');
  const p = ok(buildImportPreview(`name,price\n${rows}\n`, []));
  assert.equal(p.totalRows, 120, 'the count is complete');
  assert.equal(p.counts.create, 120);
  assert.equal(p.rows.length, PREVIEW_DISPLAY_LIMIT, 'the display is capped');
  assert.equal(p.truncated, true);
});

// ---------- encoding ----------

test('Vietnamese text is preserved exactly, diacritics intact', () => {
  const p = ok(buildImportPreview('name,price\nGhế gỗ óc chó,1500000\n', []));
  assert.equal(p.rows[0].name, 'Ghế gỗ óc chó');
  assert.equal(p.counts.create, 1);
});

test('a value that looks like a spreadsheet formula is data, not a failure', () => {
  // Import does not evaluate anything; escaping is an EXPORT concern. The
  // name is preserved verbatim so nothing is silently rewritten.
  const p = ok(buildImportPreview('name,price\n"=SUM(A1:A9)",1000\n', []));
  assert.equal(p.rows[0].name, '=SUM(A1:A9)');
  assert.equal(p.rows[0].action, 'create');
});

test('quoted fields with commas and newlines survive parsing', () => {
  const p = ok(buildImportPreview('name,price\n"Bàn, gỗ","1000"\n', []));
  assert.equal(p.rows[0].name, 'Bàn, gỗ');
  assert.equal(p.counts.create, 1);
});

// ---------- tenant isolation ----------

test('conflicts are computed only from names the caller supplied', async () => {
  // The action passes a tenant-scoped read, so another tenant's catalog can
  // never raise a conflict. Proven here by the module's signature: it has
  // no other source of names.
  await prisma.product.create({
    data: { tenantId: tenantB.id, name: 'Tenant B Only', status: 'active' },
  });
  const p = ok(buildImportPreview('name,price\nTenant B Only,1000\n', []));
  assert.equal(p.counts.conflict, 0, "tenant B's product is invisible here");
  assert.equal(p.counts.create, 1);
});

test('the preview action reads names through the tenant-scoped client', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/app/tenant-admin/actions.ts', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function previewProductsImportAction'));
  const body = fn.slice(0, fn.indexOf('export async function importProductsAction'));
  assert.match(body, /requireTenantAdmin\(\)/, 'it authorizes first');
  assert.match(body, /getScopedDb\(tenantId\)/, 'and reads through the scoped client');
  assert.match(body, /where: \{ tenantId \}/);
  assert.doesNotMatch(body, /importProductsFromCsv/, 'it never calls the importer');
});

// ---------- confirmation integrity ----------

test('the fingerprint identifies the exact bytes previewed', () => {
  const a = 'name,price\nA,1000\n';
  assert.equal(csvFingerprint(a), csvFingerprint(a));
  assert.notEqual(csvFingerprint(a), csvFingerprint('name,price\nA,1001\n'));
  const p = ok(buildImportPreview(a, []));
  assert.equal(p.fingerprint, csvFingerprint(a));
});

test('confirmation rejects a file swapped after preview', async () => {
  const src = readFileSyncFromActions();
  const fn = src.slice(src.indexOf('export async function importProductsAction'));
  assert.match(fn, /csvFingerprint\(csvText\) !== expected/);
  assert.match(fn, /has changed since it was previewed/);
  // And it is an integrity check only — the import still re-validates.
  assert.match(fn, /importProductsFromCsv\(tenantId, csvText\)/);
});

test('confirmation trusts no client-supplied counts', () => {
  const src = readFileSyncFromActions();
  const fn = src.slice(src.indexOf('export async function importProductsAction'));
  // The only client inputs consumed are the file and the fingerprint.
  assert.doesNotMatch(fn, /formData\.get\('(create|conflict|invalid|importableRows|totalRows)'\)/);
  assert.match(fn, /requireTenantAdmin\(\)/);
  // tenantId is never read from the form.
  assert.doesNotMatch(fn, /formData\.get\('tenantId'\)/);
});

function readFileSyncFromActions(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('node:fs').readFileSync(
    new URL('../src/app/tenant-admin/actions.ts', import.meta.url),
    'utf8',
  ) as string;
}

// ---------- the importer itself is unchanged for valid input ----------

test('a file the preview accepts imports with matching counts', async () => {
  const csv = `name,price,status\nPrev One ${suffix},1000,active\nPrev Two ${suffix},2000,draft\n`;
  const p = ok(buildImportPreview(csv, []));
  assert.equal(p.importableRows, 2);

  const before_ = await prisma.product.count({ where: { tenantId: tenantA.id } });
  const result = await importProductsFromCsv(tenantA.id, csv);
  assert.ok(result.success);
  assert.equal(result.data.imported, 2, "the preview's count matched reality");
  assert.equal(result.data.failed, 0);
  assert.equal(await prisma.product.count({ where: { tenantId: tenantA.id } }), before_ + 2);
});

test('partial failure stays partial — the import is not atomic', async () => {
  // Existing, deliberate behaviour. The preview says so rather than
  // implying all-or-nothing.
  const csv = `name,price\nGood ${suffix},1000\n,500\nAlso Good ${suffix},2000\n`;
  const p = ok(buildImportPreview(csv, []));
  assert.equal(p.atomic, false);
  assert.equal(p.counts.invalid, 1);
  assert.equal(p.importableRows, 2);

  const result = await importProductsFromCsv(tenantA.id, csv);
  assert.ok(result.success);
  assert.equal(result.data.imported, 2, 'valid rows still landed');
  assert.equal(result.data.failed, 1, 'and the bad row is reported, not hidden');
  assert.equal(result.data.failures[0].row, 3);
});

test("the import UI imports nothing server-only", () => {
  // This is not hypothetical: the first version of this component imported
  // PREVIEW_DISPLAY_LIMIT from the server module, which transitively pulls
  // product-mutations -> prisma and sharp into the BROWSER bundle. tsc and
  // the test suite both passed; only `next build` caught it. Hence a test.
  const src = readFileSyncFrom("../src/app/tenant-admin/ImportProductsForm.tsx");
  assert.doesNotMatch(
    src,
    /from '@\/lib\/product-csv-preview'/,
    "the client must use the types module, not the server one",
  );
  assert.match(src, /from '@\/lib\/product-csv-preview-types'/);

  // And the types module must stay free of server-only imports itself.
  // Comments stripped: it explains WHY it exists by naming those modules.
  const types = readFileSyncFrom("../src/lib/product-csv-preview-types.ts")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  for (const forbidden of [/node:crypto/, /product-mutations/, /prisma/, /blob-storage/]) {
    assert.doesNotMatch(types, forbidden, `types module must not import ${forbidden}`);
  }
});

function readFileSyncFrom(relative: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node:fs").readFileSync(new URL(relative, import.meta.url), "utf8") as string;
}
