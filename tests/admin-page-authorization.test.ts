import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * A layout's early return does NOT stop a child page segment from being
 * rendered and streamed. /platform-admin shipped with authorization only
 * in layout.tsx, and an unauthenticated request received an RSC payload
 * containing every tenant's name and slug plus the create and status
 * forms — the browser showed nothing, but the data was on the wire.
 *
 * So every admin page must authorize itself, and must do so before it
 * touches a database. There is no DOM in this suite, so that rule is
 * enforced structurally, at the one place it can be: the source.
 */

const root = fileURLToPath(new URL('../', import.meta.url));

/** Source with comments stripped, so prose cannot satisfy these checks. */
function readCode(relativePath: string): string {
  // Line comments FIRST: a // comment mentioning a path such as
  // "/tenant-admin/*" otherwise reads as an opening /* and swallows the
  // code under test up to the next */ in the file.
  return readFileSync(join(root, relativePath), 'utf8')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function adminFiles(dir: string, filename: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) {
      out.push(...adminFiles(rel, filename));
    } else if (entry === filename) {
      out.push(rel);
    }
  }
  return out;
}

function adminPages(dir: string): string[] {
  return adminFiles(dir, 'page.tsx');
}

/**
 * Route handlers are admin surfaces too, and the page walk above never
 * saw them: /tenant-admin/exports/[dataset] streams a tenant's whole
 * catalog or customer list and is a route.ts, not a page.tsx.
 */
function adminRouteHandlers(dir: string): string[] {
  return adminFiles(dir, 'route.ts');
}

const PLATFORM_PAGES = adminPages('src/app/platform-admin');
const TENANT_PAGES = adminPages('src/app/tenant-admin');
const ADMIN_ROUTES = [
  ...adminRouteHandlers('src/app/platform-admin'),
  ...adminRouteHandlers('src/app/tenant-admin'),
];

test('there are admin pages to check', () => {
  // Guards the guard: a glob that silently matches nothing would make
  // every assertion below vacuously pass.
  assert.ok(PLATFORM_PAGES.length > 0, 'found no platform-admin pages');
  assert.ok(TENANT_PAGES.length > 0, 'found no tenant-admin pages');
});

test('every Platform Admin page authorizes itself, not just its layout', () => {
  for (const page of PLATFORM_PAGES) {
    assert.match(
      readCode(page),
      /requirePlatformAdmin\(/,
      `${page} must call requirePlatformAdmin() itself — the layout gate does not protect this segment's payload`,
    );
  }
});

test('every Tenant Admin page authorizes itself', () => {
  for (const page of TENANT_PAGES) {
    assert.match(
      readCode(page),
      /requireTenantAdmin\(/,
      `${page} must call requireTenantAdmin() itself`,
    );
  }
});

test('no admin page reads the database before authorizing', () => {
  for (const page of [...PLATFORM_PAGES, ...TENANT_PAGES]) {
    const src = readCode(page);
    const guard = Math.min(
      ...[src.indexOf('requirePlatformAdmin('), src.indexOf('requireTenantAdmin(')]
        .filter((i) => i > -1)
        .concat(Number.MAX_SAFE_INTEGER),
    );

    // Every db entry point used by the admin surfaces.
    for (const accessor of ['platformDb.', 'getScopedDb(', 'prisma.']) {
      const read = src.indexOf(accessor);
      if (read > -1) {
        assert.ok(read > guard, `${page} reaches ${accessor} before its authorization check`);
      }
    }
  }
});

test('every admin route handler authorizes itself', () => {
  // Guards the guard: if this list is ever empty the assertions below
  // pass vacuously, and the export route would go unchecked.
  assert.ok(ADMIN_ROUTES.length > 0, 'found no admin route handlers');

  for (const handler of ADMIN_ROUTES) {
    const src = readCode(handler);
    assert.match(
      src,
      /requireTenantAdmin\(|requirePlatformAdmin\(/,
      `${handler} must authorize itself`,
    );
  }
});

test('no admin route handler reads the database before authorizing', () => {
  for (const handler of ADMIN_ROUTES) {
    const src = readCode(handler);
    const guard = Math.min(
      ...[src.indexOf('requirePlatformAdmin('), src.indexOf('requireTenantAdmin(')]
        .filter((i) => i > -1)
        .concat(Number.MAX_SAFE_INTEGER),
    );

    // Direct database access, plus the export builders, which each run a
    // tenant-scoped query of their own.
    for (const accessor of [
      'platformDb.',
      'getScopedDb(',
      'prisma.',
      'buildProductsExport(',
      'buildOrdersExport(',
      'buildCustomersExport(',
    ]) {
      const read = src.indexOf(accessor);
      if (read > -1) {
        assert.ok(read > guard, `${handler} reaches ${accessor} before authorizing`);
      }
    }
  }
});

test('the export route resolves its dataset only after authorizing', () => {
  // Otherwise an unauthorized caller could learn which datasets exist by
  // comparing an unknown-dataset response with a known one.
  const src = readCode('src/app/tenant-admin/exports/[dataset]/route.ts');
  const guard = src.indexOf('await requireTenantAdmin(');
  // The CALL site, not the type-guard's own definition further up.
  const resolve = src.indexOf('isDataset(dataset)');
  assert.ok(guard > -1 && resolve > -1, 'both the guard and the call site were found');
  assert.ok(guard < resolve, 'authorization must precede dataset resolution');
});
