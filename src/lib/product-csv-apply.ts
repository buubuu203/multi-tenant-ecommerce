import { randomUUID } from 'node:crypto';
import { getScopedDb } from './db/tenant-db';
import { adjustInventoryOnHandInTx, InventoryError } from './inventory-mutations';
import { parseProductCsv, type ParsedCsv } from './product-csv-contract';
import {
  buildImportPlan,
  planIsImportable,
  type ExistingIndex,
  type ExistingVariant,
  type ImportPlan,
} from './product-csv-plan';

/**
 * Resolving and applying a product CSV.
 *
 * The resolve step is read-only and shared by the preview and the import,
 * so both see the same records and produce the same plan from the same
 * file. The apply step runs the whole plan inside ONE transaction: every
 * product, variant and inventory change commits together or none does.
 *
 * ATOMICITY, precisely. Prisma's interactive transaction maps to a single
 * PostgreSQL transaction, so a throw anywhere rolls back everything
 * written so far. This is a real change from the V1 importer, which
 * created one product per row with no transaction and left earlier rows
 * behind on failure. V1-format files now get the same all-or-nothing
 * treatment — the format is unchanged, the failure behaviour is strictly
 * safer, and that is documented rather than silent.
 */

/** Upper bound on one import, so a transaction cannot be held open forever. */
export const IMPORT_TIMEOUT_MS = 120_000;

export type ImportOutcome = {
  created: number;
  updated: number;
  unchanged: number;
  inventoryChanged: number;
  /** True only because the whole run is one transaction. */
  atomic: true;
  rolledBack: boolean;
  fileHash: string;
};

/**
 * Reads the tenant's variants that carry a SKU, keyed by SKU.
 *
 * Only SKU-bearing variants can be matched: the unique constraint is
 * (tenantId, sku), and PostgreSQL allows many NULLs, so a null-SKU variant
 * identifies nothing. Products created by the V1 format have no SKU and
 * are therefore never updated — only added to.
 */
export async function resolveExistingBySku(
  tenantId: string,
  skus: readonly string[],
): Promise<ExistingIndex> {
  if (skus.length === 0) return new Map();

  const db = getScopedDb(tenantId);
  const variants = await db.productVariant.findMany({
    where: { tenantId, sku: { in: [...new Set(skus)] } },
    select: {
      id: true,
      sku: true,
      price: true,
      productId: true,
      product: {
        select: {
          name: true,
          status: true,
          weightGrams: true,
          description: true,
          category: { select: { name: true } },
        },
      },
      inventory: { select: { onHand: true, reserved: true } },
    },
  });

  const index = new Map<string, ExistingVariant>();
  for (const variant of variants) {
    if (!variant.sku) continue;
    const stock = variant.inventory[0];
    index.set(variant.sku, {
      variantId: variant.id,
      productId: variant.productId,
      productName: variant.product.name,
      price: variant.price,
      weightGrams: variant.product.weightGrams,
      status: variant.product.status === 'active' ? 'active' : 'draft',
      description: variant.product.description,
      category: variant.product.category?.name ?? null,
      onHand: stock?.onHand ?? 0,
      reserved: stock?.reserved ?? 0,
    });
  }
  return index;
}

/** Parse + resolve + plan. Read-only; used by preview and by import alike. */
export async function planProductCsv(
  tenantId: string,
  csvText: string,
): Promise<{ plan: ImportPlan; parsed: ParsedCsv } | { error: string }> {
  const parsed = parseProductCsv(csvText);
  if ('error' in parsed) return { error: parsed.error };

  const skus = parsed.rows
    .map((row) => row.sku)
    .filter((sku): sku is string => typeof sku === 'string');

  const existing = await resolveExistingBySku(tenantId, skus);
  return { plan: buildImportPlan(parsed, existing), parsed };
}

class ImportAbort extends Error {}

/**
 * Finds-or-creates a ProductCategory for every distinct category name the
 * file mentions, inside the same transaction as the rest of the import —
 * so a brand-new category and the products that reference it commit (or
 * roll back) together. Sequential, not parallel: two rows naming the same
 * new category must not race each other into the unique index.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tx type is the interactive-transaction client, structurally compatible with productCategory
async function resolveCategoryIds(tx: any, tenantId: string, names: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const name of new Set(names)) {
    const existing = await tx.productCategory.findUnique({ where: { tenantId_name: { tenantId, name } } });
    if (existing) {
      map.set(name, existing.id);
      continue;
    }
    const created = await tx.productCategory.create({ data: { tenantId, name } });
    map.set(name, created.id);
  }
  return map;
}

/**
 * Finds-or-creates a tenant-global VariantOption by name (e.g. "Color").
 * Cached per import call — two new products in the same file sharing an
 * axis name (or re-using one that already exists tenant-wide) resolve to
 * the same row, never a second "Color" with a different id.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tx type is the interactive-transaction client, structurally compatible with variantOption
async function resolveVariantOptionId(
  tx: any,
  tenantId: string,
  cache: Map<string, string>,
  name: string,
): Promise<string> {
  const cached = cache.get(name);
  if (cached) return cached;
  const existingOption = await tx.variantOption.findUnique({ where: { tenantId_name: { tenantId, name } } });
  if (existingOption) {
    cache.set(name, existingOption.id);
    return existingOption.id;
  }
  const created = await tx.variantOption.create({ data: { tenantId, name } });
  cache.set(name, created.id);
  return created.id;
}

/** Finds-or-creates a VariantOptionValue (e.g. "Red") under an already-resolved VariantOption. Cached the same way as resolveVariantOptionId. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tx type is the interactive-transaction client, structurally compatible with variantOptionValue
async function resolveVariantOptionValueId(
  tx: any,
  tenantId: string,
  cache: Map<string, string>,
  variantOptionId: string,
  value: string,
): Promise<string> {
  const key = `${variantOptionId}\u0000${value}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const existingValue = await tx.variantOptionValue.findUnique({
    where: { tenantId_variantOptionId_value: { tenantId, variantOptionId, value } },
  });
  if (existingValue) {
    cache.set(key, existingValue.id);
    return existingValue.id;
  }
  const created = await tx.variantOptionValue.create({ data: { tenantId, variantOptionId, value } });
  cache.set(key, created.id);
  return created.id;
}

/**
 * Applies a plan in one transaction, re-deriving it from the file text
 * rather than trusting anything a caller passes in.
 */
export async function applyProductCsv(
  tenantId: string,
  csvText: string,
  fileHash: string,
): Promise<{ success: true; data: ImportOutcome } | { success: false; error: string }> {
  // Re-parse, re-resolve, re-plan. The preview's conclusions are never
  // carried into the mutation; they are recomputed from the source here.
  const replanned = await planProductCsv(tenantId, csvText);
  if ('error' in replanned) return { success: false, error: replanned.error };

  const { plan } = replanned;

  if (plan.counts.invalid > 0 || plan.counts.conflict > 0 || plan.counts.duplicate > 0) {
    return {
      success: false,
      error:
        `This file has ${plan.counts.invalid} invalid, ${plan.counts.conflict} conflicting and ` +
        `${plan.counts.duplicate} duplicate row(s). Nothing was imported — fix the file and preview it again.`,
    };
  }
  if (plan.mutatingRows === 0) {
    return { success: false, error: 'Nothing to import: every row already matches this file.' };
  }

  const db = getScopedDb(tenantId);

  let created = 0;
  let updated = 0;
  let inventoryChanged = 0;

  try {
    await db.$transaction(
      async (tx) => {
        const location = await tx.location.findFirst({ where: { tenantId, isDefault: true } });
        if (!location) {
          throw new ImportAbort('This store has no default stock location. Nothing was imported.');
        }

        const categoryNames = plan.rows
          .map((planned) => planned.row?.category ?? planned.groupPrimary?.category)
          .filter((name): name is string => typeof name === 'string');
        const categoryIdByName = await resolveCategoryIds(tx, tenantId, categoryNames);

        // Multi-variant product state, scoped to this one import call: a
        // group's Product is created once (on the first row of that group
        // this loop reaches — plan.rows is sorted by rowNumber, so that is
        // always the group's lowest-numbered row), then every row in the
        // group — including that first one — adds its own ProductVariant.
        // VariantOption/VariantOptionValue are tenant-global, so their
        // caches are shared across every group in this same file.
        const groupProductId = new Map<string, string>();
        const variantOptionIdByName = new Map<string, string>();
        const variantOptionValueIdByKey = new Map<string, string>();

        for (const planned of plan.rows) {
          if (planned.action !== 'create' && planned.action !== 'update') continue;
          const row = planned.row;
          if (!row) continue;

          if (planned.action === 'create' && planned.groupPrimary && planned.groupKey !== null) {
            const primary = planned.groupPrimary;
            let productId = groupProductId.get(planned.groupKey);
            if (productId === undefined) {
              const product = await tx.product.create({
                data: {
                  tenantId,
                  name: primary.name,
                  status: primary.status,
                  weightGrams: primary.weightGrams,
                  description: primary.description,
                  categoryId: primary.category ? categoryIdByName.get(primary.category) : null,
                },
              });
              productId = product.id;
              groupProductId.set(planned.groupKey, productId);

              // Declare this product's support for every axis the group
              // uses. buildImportPlan already verified every row in the
              // group shares the same axis NAMEs, so this row's own
              // option1/option2 names are the whole group's.
              for (const axis of [row.option1, row.option2]) {
                if (!axis) continue;
                const variantOptionId = await resolveVariantOptionId(
                  tx,
                  tenantId,
                  variantOptionIdByName,
                  axis.name,
                );
                await tx.productOption.create({ data: { tenantId, productId, variantOptionId } });
              }
            }

            const pairs: { variantOptionId: string; variantOptionValueId: string }[] = [];
            for (const axis of [row.option1, row.option2]) {
              if (!axis) continue;
              const variantOptionId = await resolveVariantOptionId(tx, tenantId, variantOptionIdByName, axis.name);
              const variantOptionValueId = await resolveVariantOptionValueId(
                tx,
                tenantId,
                variantOptionValueIdByKey,
                variantOptionId,
                axis.value,
              );
              pairs.push({ variantOptionId, variantOptionValueId });
            }

            const variant = await tx.productVariant.create({
              data: {
                tenantId,
                productId,
                price: row.price,
                sku: row.sku,
                status: 'active',
                // Placeholder only — the database's deferred trigger
                // overwrites this with the real, option-derived key at
                // commit (see variant-generation.ts's doc comment; this
                // mirrors its exact create pattern).
                combinationKey: randomUUID(),
              },
            });
            for (const pair of pairs) {
              await tx.productVariantOptionValue.create({
                data: {
                  tenantId,
                  productId,
                  productVariantId: variant.id,
                  variantOptionId: pair.variantOptionId,
                  variantOptionValueId: pair.variantOptionValueId,
                },
              });
            }
            await tx.inventory.create({
              data: {
                tenantId,
                productVariantId: variant.id,
                locationId: location.id,
                onHand: row.inventoryMode === 'set_on_hand' ? (row.onHand ?? 0) : 0,
              },
            });
            if (row.inventoryMode === 'adjust_on_hand' && row.onHand !== null) {
              await adjustInventoryOnHandInTx(tx, tenantId, variant.id, row.onHand);
            }
            if (row.onHand !== null) inventoryChanged += 1;
            created += 1;
            continue;
          }

          if (planned.action === 'create') {
            if (row.weightGrams === null) {
              throw new ImportAbort(`Row ${planned.rowNumber} is missing weight_grams.`);
            }
            const product = await tx.product.create({
              data: {
                tenantId,
                name: row.name,
                status: row.status,
                weightGrams: row.weightGrams,
                description: row.description,
                categoryId: row.category ? categoryIdByName.get(row.category) : null,
              },
            });
            const variant = await tx.productVariant.create({
              data: {
                tenantId,
                productId: product.id,
                price: row.price,
                sku: row.sku,
                status: 'active',
                combinationKey: '',
              },
            });
            await tx.inventory.create({
              data: {
                tenantId,
                productVariantId: variant.id,
                locationId: location.id,
                onHand: row.inventoryMode === 'set_on_hand' ? (row.onHand ?? 0) : 0,
              },
            });
            // A delta on a brand-new variant goes through the guarded
            // helper too, so the reserved/negative rules are identical.
            if (row.inventoryMode === 'adjust_on_hand' && row.onHand !== null) {
              await adjustInventoryOnHandInTx(tx, tenantId, variant.id, row.onHand);
            }
            if (row.onHand !== null) inventoryChanged += 1;
            created += 1;
            continue;
          }

          const target = planned.target;
          if (!target) throw new ImportAbort(`Row ${planned.rowNumber} lost its target.`);

          await tx.product.update({
            where: { id: target.productId, tenantId },
            data: {
              name: row.name,
              status: row.status,
              ...(row.weightGrams !== null ? { weightGrams: row.weightGrams } : {}),
              // Omitted description leaves existing text alone.
              ...(row.description !== null ? { description: row.description } : {}),
              // Same rule for category — see product-csv-contract.ts.
              ...(row.category !== null ? { categoryId: categoryIdByName.get(row.category) } : {}),
            },
          });
          await tx.productVariant.update({
            where: { id: target.variantId, tenantId },
            data: { price: row.price },
          });

          if (row.onHand !== null && row.inventoryMode !== null) {
            const current = await tx.inventory.findFirst({
              where: { tenantId, productVariantId: target.variantId },
              select: { onHand: true },
            });
            const delta =
              row.inventoryMode === 'set_on_hand'
                ? row.onHand - (current?.onHand ?? 0)
                : row.onHand;
            if (delta !== 0) {
              // The existing guarded helper: it refuses to take onHand
              // below what orders have reserved, or below zero.
              await adjustInventoryOnHandInTx(tx, tenantId, target.variantId, delta);
              inventoryChanged += 1;
            }
          }

          updated += 1;
        }
      },
      { timeout: IMPORT_TIMEOUT_MS },
    );
  } catch (error) {
    // Everything written inside the transaction is already rolled back by
    // PostgreSQL. No partial catalog is left behind.
    if (error instanceof ImportAbort || error instanceof InventoryError) {
      return { success: false, error: `${error.message} No changes were saved.` };
    }
    if (error instanceof Error && /Unique constraint|unique constraint/.test(error.message)) {
      return {
        success: false,
        error:
          'A SKU in this file is already used by another product in your catalog. No changes were saved.',
      };
    }
    console.error('applyProductCsv failed:', error);
    return {
      success: false,
      error: 'Something went wrong importing this file. No changes were saved.',
    };
  }

  return {
    success: true,
    data: {
      created,
      updated,
      unchanged: plan.counts.unchanged,
      inventoryChanged,
      atomic: true,
      rolledBack: false,
      fileHash,
    },
  };
}

export { planIsImportable };
