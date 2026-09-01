import { randomUUID } from "node:crypto";
import { getScopedDb } from "./db/tenant-db";
import type { ActionResult } from "./action-result";

type Combo = { variantOptionId: string; variantOptionValueId: string }[];

/**
 * A combo/pair-set is compared only via this in-memory, sorted-by-id key —
 * never persisted anywhere. The database's deferred trigger is the sole
 * owner of the real, persisted combinationKey; this function exists purely
 * to let generation detect "does an existing variant already represent
 * this combination" without duplicating the trigger's algorithm or
 * depending on the array order ProductOptions/values were loaded in.
 */
function comboIdentity(pairs: { variantOptionId: string; variantOptionValueId: string }[]): string {
  return pairs
    .map((p) => `${p.variantOptionId}:${p.variantOptionValueId}`)
    .sort()
    .join("|");
}

function cartesianProduct(valueGroups: Combo[]): Combo[] {
  return valueGroups.reduce<Combo[]>(
    (acc, group) => acc.flatMap((combo) => group.map((pair) => [...combo, pair])),
    [[]],
  );
}

export type GeneratedVariantSummary = {
  variantId: string;
  price: number;
};

export type GenerationResult = {
  created: GeneratedVariantSummary[];
  archived: string[];
  preserved: string[];
};

type ScopedDb = ReturnType<typeof getScopedDb>;
type ScopedTx = Parameters<Parameters<ScopedDb["$transaction"]>[0]>[0];

/**
 * A clean, expected generation failure (product not found, no default
 * location, no options assigned, an option with zero values). Thrown
 * rather than returned so this same logic can run either inside its own
 * transaction (generateProductVariants) or inside a caller's existing
 * transaction (e.g. product-mutations.ts creating a variant-bearing
 * product) — in both cases, throwing is what correctly aborts/rolls back
 * the enclosing `db.$transaction`.
 */
export class VariantGenerationError extends Error {}

/**
 * Core generation/reconciliation logic, parameterized on an already-open
 * transactional client (`tx`). Never opens its own transaction — callers
 * are responsible for the transaction boundary. This is what lets
 * product-mutations.ts fold "create Product" + "assign ProductOptions" +
 * "generate variants" into ONE flat, atomic transaction without nesting
 * Prisma transactions (which Prisma does not support) — it opens exactly
 * one `db.$transaction`, and passes that same `tx` into this function.
 *
 * See generateProductVariants() below for the full behavioral contract
 * (idempotency, price preservation, archival, combinationKey handling,
 * etc.) — identical whether called standalone or via this shared-tx path.
 */
export async function runVariantGeneration(
  tx: ScopedTx,
  tenantId: string,
  productId: string,
  defaultPrice: number,
): Promise<GenerationResult> {
  const product = await tx.product.findUnique({ where: { id: productId, tenantId } });
  if (!product) {
    throw new VariantGenerationError("Product not found.");
  }

  const defaultLocation = await tx.location.findFirst({ where: { tenantId, isDefault: true } });
  if (!defaultLocation) {
    throw new VariantGenerationError("No default location found for this tenant.");
  }

  const productOptions = await tx.productOption.findMany({
    where: { tenantId, productId },
    include: { variantOption: true },
  });
  if (productOptions.length === 0) {
    throw new VariantGenerationError("Product has no options assigned.");
  }

  const valueGroups: Combo[] = [];
  for (const po of productOptions) {
    // po.variantOption is already tenant-verified by the FK this row was
    // created under (product-option-mutations.ts, or the inline check in
    // product-mutations.ts's variant-bearing createProduct path); re-scoping
    // the values query by tenantId here keeps this function independently
    // safe even if that invariant were ever violated.
    const values = await tx.variantOptionValue.findMany({
      where: { tenantId, variantOptionId: po.variantOptionId },
      orderBy: { value: "asc" },
    });
    if (values.length === 0) {
      throw new VariantGenerationError("All assigned options must have at least one value.");
    }
    valueGroups.push(values.map((v) => ({ variantOptionId: po.variantOptionId, variantOptionValueId: v.id })));
  }

  const desiredCombos = cartesianProduct(valueGroups);
  const desiredByKey = new Map<string, Combo>();
  for (const combo of desiredCombos) {
    desiredByKey.set(comboIdentity(combo), combo);
  }

  const existingActiveVariants = await tx.productVariant.findMany({
    where: { tenantId, productId, status: { not: "archived" } },
    include: { optionValues: true },
  });

  const existingByKey = new Map<string, (typeof existingActiveVariants)[number]>();
  for (const variant of existingActiveVariants) {
    const key = comboIdentity(
      variant.optionValues.map((ov) => ({
        variantOptionId: ov.variantOptionId,
        variantOptionValueId: ov.variantOptionValueId,
      })),
    );
    existingByKey.set(key, variant);
  }

  const combosToCreate = [...desiredByKey.entries()].filter(([key]) => !existingByKey.has(key));
  const variantsToArchive = [...existingByKey.entries()].filter(([key]) => !desiredByKey.has(key));
  const preservedVariantIds = [...existingByKey.entries()]
    .filter(([key]) => desiredByKey.has(key))
    .map(([, variant]) => variant.id);

  const created: GeneratedVariantSummary[] = [];

  for (const [, combo] of combosToCreate) {
    const variant = await tx.productVariant.create({
      data: {
        tenantId,
        productId,
        price: defaultPrice,
        status: "active",
        sku: null,
        // Distinct-per-row placeholder only — never the real identity.
        // The deferred trigger overwrites this at commit once this
        // variant's PVOV rows exist.
        combinationKey: randomUUID(),
      },
    });

    for (const pair of combo) {
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
        locationId: defaultLocation.id,
        onHand: 0,
        reserved: 0,
      },
    });

    created.push({ variantId: variant.id, price: defaultPrice });
  }

  const archived: string[] = [];
  for (const [, variant] of variantsToArchive) {
    await tx.productVariant.update({ where: { id: variant.id }, data: { status: "archived" } });
    archived.push(variant.id);
  }

  return { created, archived, preserved: preservedVariantIds };
}

/**
 * Generates (or reconciles) a Product's real, multi-option ProductVariants
 * from its currently-assigned ProductOptions and their VariantOptionValues.
 *
 * Idempotent: running this twice with the same options creates nothing new
 * and preserves existing variant ids/prices/statuses. New combinations are
 * created active; existing active variants whose combination is no longer
 * represented are archived (never deleted, never their Inventory removed);
 * archived variants are never auto-reactivated — a reintroduced combination
 * gets a brand-new variant instead. The pre-existing simple-product variant
 * (combinationKey === "") has no ProductVariantOptionValue rows, so it
 * never matches a real (>=1-pair) combination and is archived by the same
 * generic logic on a product's first successful generation.
 *
 * Application code never computes or writes the real combinationKey — the
 * database's DEFERRABLE INITIALLY DEFERRED trigger is the sole owner of
 * that value. New ProductVariant rows are created with a random-UUID
 * placeholder (required only because the column is NOT NULL and the
 * unique index on (tenantId, productId, combinationKey) is checked
 * immediately per-statement, not deferred — so concurrently-inserted new
 * variants within this same transaction need distinct placeholders to
 * avoid colliding with each other before the trigger overwrites them at
 * commit). Existing-combination detection instead reconstructs each
 * variant's real (variantOptionId, variantOptionValueId) pairs from its
 * ProductVariantOptionValue rows and compares that set in memory — never
 * by reading or trusting combinationKey mid-transaction.
 *
 * tenantId must be the trusted value returned by requireTenantAdmin() —
 * never accepted from form input. Uses getScopedDb(tenantId) exclusively;
 * every id used to create a ProductVariantOptionValue row is sourced from
 * a prior tenant-scoped read, never trusted from a caller argument.
 *
 * This is a thin wrapper around runVariantGeneration() that owns its own
 * transaction — use this for standalone calls. product-mutations.ts's
 * variant-bearing createProduct() instead calls runVariantGeneration()
 * directly inside its own transaction, to fold product creation and
 * variant generation into one atomic unit without nesting transactions.
 */
export async function generateProductVariants(
  tenantId: string,
  productId: string,
  defaultPrice: number,
): Promise<ActionResult<GenerationResult>> {
  const db = getScopedDb(tenantId);

  try {
    const result = await db.$transaction((tx) => runVariantGeneration(tx, tenantId, productId, defaultPrice));
    return { success: true, data: result };
  } catch (e) {
    if (e instanceof VariantGenerationError) {
      return { success: false, error: e.message };
    }
    // Covers, among other things, the deferred trigger's own unique-index
    // check failing at COMMIT time (e.g. an unexpected combinationKey
    // collision) — the transaction above has already rolled back
    // everything by the time this runs; nothing partial persists.
    console.error("generateProductVariants failed:", e);
    return { success: false, error: "Something went wrong generating variants." };
  }
}
