import {
  withReadOnlyConnection,
  withWritableConnection,
  UsageError,
  usage,
  fail,
  asNumber,
  asString,
  scalar,
  line,
  EXIT_OK,
} from './release-db';

/**
 * Deletes a WHOLE tenant's product catalog — every product, and (via the
 * database's own ON DELETE CASCADE, not this script) every variant,
 * inventory row, media item, option declaration and discount slot that
 * hangs off those products.
 *
 * Same safety posture as every other script in this directory: the target
 * is RELEASE_CHECK_DATABASE_URL, never DATABASE_URL, chosen deliberately
 * by whoever runs this — there is no "nonprod" detection here, because a
 * connection string cannot be trusted to self-report what it points at.
 * Dry run is the default and reports counts only; nothing is deleted
 * without --apply.
 *
 * Tenant-scoped and SKU-restricted on purpose. A product whose variant has
 * ever been ordered is NOT deletable: OrderItem -> ProductVariant is
 * ON DELETE RESTRICT in the schema, so Postgres itself refuses the whole
 * delete rather than silently dropping some products and keeping others.
 * This script never works around that — it reports the blocker and exits
 * instead.
 */

function flag(name: string): string | undefined {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return match?.split('=')[1];
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const apply = has('apply');
  const slug = flag('tenant');

  if (!slug || slug.trim() === '') {
    usage(
      'Usage: --tenant=<slug> is required, e.g.\n' +
        `  RELEASE_CHECK_DATABASE_URL="postgresql://..." npm run release:wipe:tenant-catalog -- --tenant=poprint\n` +
        'Add --apply to actually delete. Without it, this only reports what would happen.',
    );
  }

  const out: string[] = [];
  out.push(`\nTenant catalog wipe  —  ${apply ? 'APPLY' : 'DRY RUN'}`);
  out.push(line('Tenant slug', slug));

  // ---- dry run: read-only, always rolled back, never deletes ----
  const { target, result: tenant } = await withReadOnlyConnection(async (query) => {
    const row = await query('SELECT id, name, status FROM tenants WHERE slug = $1', [slug]);
    if (row.length === 0) return null;
    return { id: asString(row[0].id)!, name: asString(row[0].name), status: asString(row[0].status) };
  });

  out.push(line('Target', target));

  if (!tenant) {
    out.push(`\nNo tenant found with slug "${slug}". Nothing to do.`);
    process.stdout.write(out.join('\n') + '\n');
    fail(`Unknown tenant slug "${slug}".`);
  }

  out.push(line('Tenant', `${tenant.name} (${tenant.status})`));

  const { result: counts } = await withReadOnlyConnection(async (query) => {
    const products = asNumber(
      scalar(await query('SELECT count(*)::bigint AS n FROM products WHERE "tenantId" = $1', [tenant.id]), 'n'),
    );
    const variants = asNumber(
      scalar(
        await query('SELECT count(*)::bigint AS n FROM product_variants WHERE "tenantId" = $1', [tenant.id]),
        'n',
      ),
    );
    const blockedSkus = await query(
      `SELECT DISTINCT pv.sku
       FROM product_variants pv
       JOIN order_items oi ON oi."productVariantId" = pv.id
       WHERE pv."tenantId" = $1`,
      [tenant.id],
    );
    return { products, variants, blockedSkus: blockedSkus.map((r) => asString(r.sku) ?? '(no sku)') };
  });

  out.push(line('Products', String(counts.products ?? 0)));
  out.push(line('Variants', String(counts.variants ?? 0)));
  out.push(line('Variants with order history', String(counts.blockedSkus.length)));
  if (counts.blockedSkus.length > 0) {
    out.push(line('  (blocking SKUs)', counts.blockedSkus.join(', ')));
  }

  if ((counts.products ?? 0) === 0) {
    out.push('\nNothing to delete.');
    process.stdout.write(out.join('\n') + '\n');
    process.exit(EXIT_OK);
  }

  if (!apply) {
    out.push(
      counts.blockedSkus.length > 0
        ? '\nThis tenant has order history. DELETE would be refused by the database (ON DELETE RESTRICT) — nothing to fix here, by design.'
        : '\nNothing was deleted. Re-run with --apply to delete every product above.',
    );
    process.stdout.write(out.join('\n') + '\n');
    process.exit(EXIT_OK);
  }

  const { result: deleted } = await withWritableConnection(async (query) => {
    // One statement. If ANY variant under this tenant has order history,
    // Postgres refuses the WHOLE statement (foreign_key_violation) — there
    // is no partial state to clean up on failure.
    const rows = await query('DELETE FROM products WHERE "tenantId" = $1 RETURNING id', [tenant.id]);
    return rows.length;
  });

  out.push(line('Products deleted', String(deleted)));
  out.push('\nOnly this tenant\'s catalog was touched. Categories were left in place (now unused) so a re-import matches them by name instead of duplicating them.');
  process.stdout.write(out.join('\n') + '\n');
  process.exit(EXIT_OK);
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) usage(error.message);
  process.stderr.write(
    `\nWipe failed: ${error instanceof Error ? error.message : 'unknown'}\n` +
      (error instanceof Error && /foreign key/i.test(error.message)
        ? 'This usually means a variant under this tenant has order history (ON DELETE RESTRICT). Nothing was deleted.\n'
        : ''),
  );
  process.exit(1);
});
