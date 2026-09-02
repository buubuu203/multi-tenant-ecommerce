import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

export type TenantProductVariantOption = {
  variantOptionId: string;
  optionName: string;
  variantOptionValueId: string;
  valueLabel: string;
};

export type TenantProductVariant = {
  id: string;
  price: number;
  sku: string | null;
  // Only ever used to detect the pre-existing simple-product sentinel
  // (combinationKey === ""), the same convention already established in
  // product-mutations.ts and the Tenant Admin UI — never used to resolve a
  // customer's option selection to a variant. See resolveVariant() in
  // ProductList.tsx, which matches purely on `options` (real
  // ProductVariantOptionValue relationships), never on this field.
  combinationKey: string;
  options: TenantProductVariantOption[];
  // Step 39: derived stock availability (onHand - reserved) for this
  // variant's Inventory row, at read time. Deliberately the ONLY inventory
  // number exposed to the storefront — raw onHand/reserved are Tenant
  // Admin-only concepts (see tenant-admin/page.tsx's StockControl) and
  // must never reach customer-facing code. 0 if no Inventory row exists
  // for this variant (should not happen in practice — every variant gets
  // one at creation time — but treated as "nothing available" rather than
  // throwing, since this is a read path serving a public page).
  available: number;
};

export type TenantProductMedia = {
  id: string;
  type: "image" | "video";
  url: string;
  sortOrder: number;
};

export type TenantProduct = {
  id: string;
  name: string;
  // Step 43: optional plain-text description, rendered as-is (no
  // Markdown/HTML). null means the merchant hasn't set one.
  description: string | null;
  // Step 50: ordered media gallery (replaces Step 44's single imageUrl
  // field — there is no separate "primary image" field: the first item
  // (sortOrder 0) IS the primary media everywhere the app needs one, per
  // the approved design's "don't duplicate the URL into multiple places"
  // rule. Empty array means no media set.
  media: TenantProductMedia[];
  variants: TenantProductVariant[];
};

// Same pattern as get-current-tenant.ts: reads the trusted x-tenant-id
// header (resolved by src/proxy.ts from the verified request hostname) and
// queries the plain prisma client with an explicit tenantId filter. Not
// getScopedDb() — the storefront only ever handles the single
// hostname-resolved tenant, so there is no "other tenant" reachable from
// this code path in the first place (same reasoning as get-current-tenant.ts).
//
// Loads products with their non-archived variants and each variant's
// option-value pairs, then resolves option/value display names via two
// tenant-scoped lookups (not per-product/per-variant — a flat, constant
// number of extra queries regardless of how many products/variants exist,
// so this does not introduce an N+1 pattern). combinationKey is fetched
// only to preserve the existing simple-product detection convention; it is
// never used for selection resolution.
export async function getTenantProducts(): Promise<TenantProduct[]> {
  const headerList = await headers();
  const tenantId = headerList.get("x-tenant-id");

  if (!tenantId) {
    return [];
  }

  const [products, variantOptions, variantOptionValues] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId, status: "active" },
      orderBy: { createdAt: "asc" },
      include: {
        variants: {
          where: { status: { not: "archived" } },
          include: { optionValues: true },
        },
        media: { orderBy: { sortOrder: "asc" } },
      },
    }),
    prisma.variantOption.findMany({ where: { tenantId } }),
    prisma.variantOptionValue.findMany({ where: { tenantId } }),
  ]);

  const optionNameById = new Map(variantOptions.map((o) => [o.id, o.name]));
  const valueLabelById = new Map(variantOptionValues.map((v) => [v.id, v.value]));

  // Step 39: one flat, tenant-scoped Inventory read alongside the two
  // option/value lookups above — same "constant number of extra queries,
  // not per-product/per-variant" N+1-avoidance reasoning already
  // documented for variantOptions/variantOptionValues. Explicit tenantId
  // filter, same trust boundary as the rest of this function (plain
  // prisma client, not getScopedDb() — see this function's own doc
  // comment for why).
  const inventoryRows = await prisma.inventory.findMany({ where: { tenantId } });
  const availableByVariant = new Map(inventoryRows.map((inv) => [inv.productVariantId, inv.onHand - inv.reserved]));

  return products.map((product) => mapTenantProduct(product, optionNameById, valueLabelById, availableByVariant));
}

// Raw shape shared by both getTenantProducts()'s and getTenantProduct()'s
// underlying Prisma queries (same `include`) — factored out purely to
// avoid duplicating the option/value/availability mapping logic between
// the two, not a new abstraction over anything else.
type RawTenantProduct = {
  id: string;
  name: string;
  description: string | null;
  media: { id: string; type: string; url: string; sortOrder: number }[];
  variants: {
    id: string;
    price: number;
    sku: string | null;
    combinationKey: string;
    optionValues: { variantOptionId: string; variantOptionValueId: string }[];
  }[];
};

function mapTenantProduct(
  product: RawTenantProduct,
  optionNameById: Map<string, string>,
  valueLabelById: Map<string, string>,
  availableByVariant: Map<string, number>,
): TenantProduct {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    media: product.media.map((m) => ({ id: m.id, type: m.type as "image" | "video", url: m.url, sortOrder: m.sortOrder })),
    variants: product.variants.map((variant) => ({
      id: variant.id,
      price: variant.price,
      sku: variant.sku,
      combinationKey: variant.combinationKey,
      options: variant.optionValues.map((ov) => ({
        variantOptionId: ov.variantOptionId,
        optionName: optionNameById.get(ov.variantOptionId) ?? "?",
        variantOptionValueId: ov.variantOptionValueId,
        valueLabel: valueLabelById.get(ov.variantOptionValueId) ?? "?",
      })),
      available: availableByVariant.get(variant.id) ?? 0,
    })),
  };
}

/**
 * Step 46: single-product lookup for the product detail page
 * (/products/[productId]). Same tenant trust boundary and query shape as
 * getTenantProducts() (plain prisma client + explicit tenantId filter,
 * trusted x-tenant-id header) — just scoped to one product id instead of
 * every active product. Returns null for: nonexistent id, a product
 * belonging to another tenant, or a `draft` product — all three
 * indistinguishable to the caller, same "don't leak which reason" posture
 * already used by getOrderForCustomer() (Step 42). Archived variants are
 * excluded from the result exactly as in getTenantProducts().
 */
export async function getTenantProduct(productId: string): Promise<TenantProduct | null> {
  const headerList = await headers();
  const tenantId = headerList.get("x-tenant-id");

  if (!tenantId || !productId.trim()) {
    return null;
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId, status: "active" },
    include: {
      variants: {
        where: { status: { not: "archived" } },
        include: { optionValues: true },
      },
      media: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!product) {
    return null;
  }

  const variantOptionIds = new Set<string>();
  const variantOptionValueIds = new Set<string>();
  for (const variant of product.variants) {
    for (const ov of variant.optionValues) {
      variantOptionIds.add(ov.variantOptionId);
      variantOptionValueIds.add(ov.variantOptionValueId);
    }
  }

  const [variantOptions, variantOptionValues, inventoryRows] = await Promise.all([
    variantOptionIds.size > 0
      ? prisma.variantOption.findMany({ where: { tenantId, id: { in: [...variantOptionIds] } } })
      : Promise.resolve([]),
    variantOptionValueIds.size > 0
      ? prisma.variantOptionValue.findMany({ where: { tenantId, id: { in: [...variantOptionValueIds] } } })
      : Promise.resolve([]),
    prisma.inventory.findMany({ where: { tenantId, productVariantId: { in: product.variants.map((v) => v.id) } } }),
  ]);

  const optionNameById = new Map(variantOptions.map((o) => [o.id, o.name]));
  const valueLabelById = new Map(variantOptionValues.map((v) => [v.id, v.value]));
  const availableByVariant = new Map(inventoryRows.map((inv) => [inv.productVariantId, inv.onHand - inv.reserved]));

  return mapTenantProduct(product, optionNameById, valueLabelById, availableByVariant);
}
