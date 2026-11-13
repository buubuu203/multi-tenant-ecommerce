import { getScopedDb } from "../db/tenant-db";
import { listDiscountsByProduct } from "../discount-mutations";
import { formatCsvAmount, formatCsvTimestamp } from "../csv";

export type ExportTable = {
  headers: readonly string[];
  rows: (string | number | null | undefined)[][];
};

/**
 * Catalog export rows for one tenant.
 *
 * Reads through getScopedDb(tenantId), which injects tenantId for product,
 * productVariant, inventory, variantOption and variantOptionValue — the
 * same reads the Tenant Admin catalog page already performs, so this
 * exposes nothing a merchant cannot already see on screen. `discount` is
 * NOT in that allowlist, so listDiscountsByProduct() carries tenantId
 * explicitly, exactly as the catalog page calls it.
 *
 * Unlike the storefront read, drafts and archived variants ARE included:
 * this is the merchant's own catalog, and a draft missing from their own
 * export would be a bug rather than privacy.
 *
 * One row per VARIANT, not per product: a variant is the purchasable unit
 * and the thing that owns a SKU, a price and stock, so a per-product row
 * would have to collapse those into something unusable in a spreadsheet.
 * A product with no variants still gets one row with the variant columns
 * blank, so it cannot silently vanish.
 *
 * IDs are included deliberately — product_id and variant_id are the only
 * stable handles a merchant has for reconciling an export against a later
 * re-import or against an order line. Both are tenant-scoped uuids that
 * the admin UI already displays, not internal secrets.
 */
export const PRODUCT_EXPORT_HEADERS = [
  "product_id",
  "product_name",
  "product_status",
  "description_excerpt",
  "variant_id",
  "variant_sku",
  "variant_label",
  "variant_status",
  "variant_price_vnd",
  "discount_percent",
  "discounted_price_vnd",
  "stock_on_hand",
  "stock_reserved",
  "stock_available",
  "product_created_at",
  "product_updated_at",
] as const;

export async function buildProductsExport(tenantId: string): Promise<ExportTable> {
  if (!tenantId.trim()) {
    return { headers: PRODUCT_EXPORT_HEADERS, rows: [] };
  }
  const db = getScopedDb(tenantId);

  const [products, variantOptions, variantOptionValues, inventoryRows, discountByProduct] =
    await Promise.all([
      db.product.findMany({
        // Deterministic ordering: name then id, so two exports of unchanged
        // data are byte-identical and diffable. createdAt is not unique
        // enough to be stable on its own.
        orderBy: [{ name: "asc" }, { id: "asc" }],
        include: { variants: { orderBy: { id: "asc" }, include: { optionValues: true } } },
      }),
      db.variantOption.findMany({ where: { tenantId } }),
      db.variantOptionValue.findMany({ where: { tenantId } }),
      db.inventory.findMany({ where: { tenantId } }),
      listDiscountsByProduct(tenantId),
    ]);

  const optionNameById = new Map(variantOptions.map((o) => [o.id, o.name]));
  const valueLabelById = new Map(variantOptionValues.map((v) => [v.id, v.value]));
  const inventoryByVariant = new Map(inventoryRows.map((inv) => [inv.productVariantId, inv]));

  const rows: ExportTable["rows"] = [];
  for (const product of products) {
    const discount = discountByProduct.get(product.id);
    const percentOff = discount?.percentOff ?? null;
    const descriptionExcerpt = product.description
      ? product.description.replace(/\s+/g, " ").trim().slice(0, 200)
      : "";

    const variants: (typeof product.variants[number] | null)[] =
      product.variants.length > 0 ? product.variants : [null];

    for (const variant of variants) {
      if (!variant) {
        rows.push([
          product.id,
          product.name,
          product.status,
          descriptionExcerpt,
          "",
          "",
          "",
          "",
          "",
          percentOff ?? "",
          "",
          "",
          "",
          "",
          formatCsvTimestamp(product.createdAt),
          formatCsvTimestamp(product.updatedAt),
        ]);
        continue;
      }

      const inv = inventoryByVariant.get(variant.id);
      const onHand = inv?.onHand ?? 0;
      const reserved = inv?.reserved ?? 0;
      const label = variant.optionValues
        .map((ov) => {
          const name = optionNameById.get(ov.variantOptionId);
          const value = valueLabelById.get(ov.variantOptionValueId);
          return name && value ? `${name}: ${value}` : null;
        })
        .filter((part): part is string => part !== null)
        .join(" / ");

      const discountedPrice =
        percentOff !== null
          ? Math.max(0, variant.price - Math.round((variant.price * percentOff) / 100))
          : null;

      rows.push([
        product.id,
        product.name,
        product.status,
        descriptionExcerpt,
        variant.id,
        variant.sku ?? "",
        label,
        variant.status,
        formatCsvAmount(variant.price),
        percentOff ?? "",
        discountedPrice !== null ? formatCsvAmount(discountedPrice) : "",
        onHand,
        reserved,
        onHand - reserved,
        formatCsvTimestamp(product.createdAt),
        formatCsvTimestamp(product.updatedAt),
      ]);
    }
  }

  return { headers: PRODUCT_EXPORT_HEADERS, rows };
}
