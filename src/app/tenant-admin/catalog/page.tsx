import Link from "next/link";
import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { getScopedDb } from "@/lib/db/tenant-db";
import { ActionForm } from "@/components/ActionForm";
import {
  updateProductAction,
  importProductsAction,
  createVariantOptionAction,
  createVariantOptionValueAction,
  deleteVariantOptionValueAction,
  assignProductOptionAction,
  removeProductOptionAction,
  generateVariantsAction,
  updateProductVariantAction,
  adjustInventoryOnHandAction,
  upsertProductDiscountAction,
  deleteProductDiscountAction,
} from "../actions";
import { listDiscountsByProduct } from "@/lib/discount-mutations";
import { ImportProductsForm } from "../ImportProductsForm";
import { ProductMediaGallery } from "../ProductMediaGallery";
import { DescriptionEditor } from "../DescriptionEditor";
import { Pagination } from "../Pagination";
import { PRODUCT_STATUSES } from "../product-status";
import { formatVnd } from "../format";
import {
  adminInputClassName,
  adminLabelClassName,
  adminSectionClassName,
  productInputClassName,
  productLabelClassName,
  productFieldGroupClassName,
  productSectionHeadingClassName,
} from "../styles";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

// Resolves ProductVariantOptionValue -> VariantOption / VariantOptionValue
// into a human-readable, deterministically-ordered label (sorted by option
// name, not by combinationKey — combinationKey is never read or displayed
// here, it is not a user-facing value).
// Formats a Date for a <input type="datetime-local"> defaultValue —
// that input requires "YYYY-MM-DDTHH:mm" in LOCAL time, not toISOString()
// (which is UTC and includes seconds/milliseconds/Z).
function toDatetimeLocalValue(date: Date | null | undefined): string {
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatCombination(
  variant: { optionValues: { variantOptionId: string; variantOptionValueId: string }[] },
  optionNameById: Map<string, string>,
  valueLabelById: Map<string, string>,
): string {
  if (variant.optionValues.length === 0) {
    return "(no options)";
  }
  return variant.optionValues
    .map((ov) => ({
      optionName: optionNameById.get(ov.variantOptionId) ?? "?",
      valueLabel: valueLabelById.get(ov.variantOptionValueId) ?? "?",
    }))
    .sort((a, b) => a.optionName.localeCompare(b.optionName))
    .map((pair) => `${pair.optionName}: ${pair.valueLabel}`)
    .join(" / ");
}

// Step 38: renders the on-hand/reserved/available display plus the
// adjust-by-signed-amount form for one variant's Inventory row. Reused for
// both the simple-product path and the variant-bearing table below —
// neither the shape nor the mutation differs between the two, only where
// it's placed in the surrounding markup.
function StockControl({
  productVariantId,
  inventory,
}: {
  productVariantId: string;
  inventory: { onHand: number; reserved: number } | undefined;
}) {
  if (!inventory) {
    return <span className="text-xs text-red-600">No inventory row found.</span>;
  }
  const available = inventory.onHand - inventory.reserved;
  return (
    <ActionForm
      action={adjustInventoryOnHandAction}
      submitLabel="Adjust"
      className="flex flex-wrap items-end gap-2"
    >
      <input type="hidden" name="productVariantId" value={productVariantId} />
      <span className="pb-1.5 text-xs text-muted-foreground">
        On hand: {inventory.onHand} · Reserved: {inventory.reserved} · Available: {available}
      </span>
      <label className={adminLabelClassName}>
        Adjust by
        <input
          name="adjustment"
          inputMode="numeric"
          placeholder="+10 or -3"
          className={`w-24 ${adminInputClassName}`}
        />
      </label>
    </ActionForm>
  );
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId } = await requireTenantAdmin();
  const db = getScopedDb(tenantId);

  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const status = typeof params.status === "string" ? params.status : "";
  const page = Number(params.page) > 0 ? Math.floor(Number(params.page)) : 1;

  // Phase 2 (Catalog at scale): name search + status filter + pagination,
  // all applied at the query level — a growing catalog costs the same
  // page-load regardless of how many products a tenant has in total.
  const productWhere = {
    tenantId,
    ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
    ...(status && PRODUCT_STATUSES.includes(status as (typeof PRODUCT_STATUSES)[number])
      ? { status: status as (typeof PRODUCT_STATUSES)[number] }
      : {}),
  };

  const [products, productCount] = await Promise.all([
    db.product.findMany({
      where: productWhere,
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        variants: { include: { optionValues: true } },
        media: { orderBy: { sortOrder: "asc" } },
      },
    }),
    db.product.count({ where: productWhere }),
  ]);

  // Fetched once here (not via a UI-side loop) purely to avoid an N+1
  // query pattern across products/options in a single page render. All
  // writes still go exclusively through the existing mutation functions
  // via server actions below — this page never writes through `db`
  // directly.
  const variantOptions = await db.variantOption.findMany({
    where: { tenantId },
    orderBy: { name: "asc" },
  });
  const variantOptionValues = await db.variantOptionValue.findMany({
    where: { tenantId },
    orderBy: { value: "asc" },
  });
  const allProductOptions = await db.productOption.findMany({ where: { tenantId } });
  // Product Discount (V1): fetched once for the current page's products,
  // same N+1-avoidance reasoning as variantOptions/inventoryRows above.
  const discountByProduct = await listDiscountsByProduct(tenantId);

  // Step 38: one Inventory row per variant at the tenant's single default
  // Location — fetched once here for the same N+1-avoidance reason above.
  const inventoryRows = await db.inventory.findMany({ where: { tenantId } });
  const inventoryByVariant = new Map(inventoryRows.map((inv) => [inv.productVariantId, inv]));

  const valuesByOption = new Map<string, typeof variantOptionValues>();
  for (const v of variantOptionValues) {
    valuesByOption.set(v.variantOptionId, [...(valuesByOption.get(v.variantOptionId) ?? []), v]);
  }
  const optionNameById = new Map(variantOptions.map((o) => [o.id, o.name]));
  const valueLabelById = new Map(variantOptionValues.map((v) => [v.id, v.value]));
  const productOptionsByProduct = new Map<string, typeof allProductOptions>();
  for (const po of allProductOptions) {
    productOptionsByProduct.set(po.productId, [
      ...(productOptionsByProduct.get(po.productId) ?? []),
      po,
    ]);
  }
  const archivedVariantsByProduct = new Map<string, (typeof products)[number]["variants"]>();
  for (const product of products) {
    const archived = product.variants.filter((v) => v.status === "archived");
    if (archived.length > 0) {
      archivedVariantsByProduct.set(product.id, archived);
    }
  }

  return (
    <>
      <section className={adminSectionClassName}>
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-medium tracking-tight">Variant Options</h2>
          <p className="text-xs text-muted-foreground">
            Reusable option types (e.g. Color, Size) shared across every product for this store.
          </p>
        </div>

        <ActionForm
          action={createVariantOptionAction}
          submitLabel="Add option"
          className="flex max-w-md flex-col gap-3"
        >
          <label className={adminLabelClassName}>
            Option name
            <input name="name" placeholder="Color" className={adminInputClassName} />
          </label>
        </ActionForm>

        <div className="flex flex-col gap-3">
          {variantOptions.map((option) => {
            const values = valuesByOption.get(option.id) ?? [];
            return (
              <div key={option.id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-3 text-sm">
                <h3 className="font-medium">{option.name}</h3>
                <div className="flex flex-col gap-1">
                  {values.map((value) => (
                    <div
                      key={value.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5"
                    >
                      <span>{value.value}</span>
                      <ActionForm action={deleteVariantOptionValueAction} submitLabel="Delete">
                        <input type="hidden" name="variantOptionValueId" value={value.id} />
                      </ActionForm>
                    </div>
                  ))}
                  {values.length === 0 && (
                    <p className="text-xs text-muted-foreground">No values yet.</p>
                  )}
                </div>
                {values.length > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-500">
                    Deleting a value also removes it from any product variants that used it.
                  </p>
                )}
                <ActionForm
                  action={createVariantOptionValueAction}
                  submitLabel="Add value"
                  className="flex items-end gap-2"
                >
                  <input type="hidden" name="variantOptionId" value={option.id} />
                  <label className={adminLabelClassName}>
                    Value
                    <input name="value" placeholder="White" className={adminInputClassName} />
                  </label>
                </ActionForm>
              </div>
            );
          })}
          {variantOptions.length === 0 && (
            <p className="text-sm text-muted-foreground">No variant options yet.</p>
          )}
        </div>
      </section>

      <section className={adminSectionClassName}>
        <h2 className="text-lg font-medium tracking-tight">Products</h2>

        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-muted p-4">
          <h3 className="text-sm font-medium">Import Products (CSV)</h3>
          <p className="text-xs text-muted-foreground">
            CSV import supports: name, price, status (optional, defaults to draft). Max 500 rows,
            1 MB. Media can be added after import from the product editor below.
          </p>
          <ImportProductsForm action={importProductsAction} />
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <Link
            href="/tenant-admin/products/new"
            className="w-fit rounded-md bg-foreground px-3.5 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            + Add a product
          </Link>

          {/* Phase 2: name search + status filter, plain GET form — no
            client JS, no state to lose on refresh, shareable URL. */}
          <form className="flex flex-wrap items-end gap-2" method="get">
            <label className="flex flex-col gap-1 text-xs">
              Search
              <input
                type="text"
                name="q"
                defaultValue={q}
                placeholder="Product name"
                className={`w-56 ${adminInputClassName}`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Status
              <select name="status" defaultValue={status} className={adminInputClassName}>
                <option value="">All</option>
                {PRODUCT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-muted"
            >
              Filter
            </button>
          </form>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Variants</th>
                <th className="px-3 py-2 font-medium">Price</th>
                <th className="px-3 py-2 font-medium">Editor</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const activeVariants = product.variants.filter((v) => v.status !== "archived");
                const simpleVariant =
                  activeVariants.length === 1 && activeVariants[0].combinationKey === ""
                    ? activeVariants[0]
                    : null;
                return (
                  <tr key={product.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{product.name}</td>
                    <td className="px-3 py-2 capitalize">{product.status}</td>
                    <td className="px-3 py-2">{activeVariants.length}</td>
                    <td className="px-3 py-2 font-mono">
                      {simpleVariant ? formatVnd(simpleVariant.price) : "Multiple"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">Open below</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Pagination
          basePath="/tenant-admin/catalog"
          searchParams={params}
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={productCount}
        />

        <h3 className="text-sm font-medium text-muted-foreground">Product editors</h3>
        <div className="flex flex-col gap-3">
          {products.map((product) => {
            const activeVariants = product.variants.filter((v) => v.status !== "archived");
            const simpleVariant =
              activeVariants.length === 1 && activeVariants[0].combinationKey === ""
                ? activeVariants[0]
                : null;

            const assignedOptions = productOptionsByProduct.get(product.id) ?? [];
            const assignedOptionIds = new Set(assignedOptions.map((po) => po.variantOptionId));
            const availableOptions = variantOptions.filter((o) => !assignedOptionIds.has(o.id));

            const primaryMedia = product.media[0];
            const summaryPrice = simpleVariant
              ? formatVnd(simpleVariant.price)
              : `${activeVariants.length} variant${activeVariants.length === 1 ? "" : "s"}`;

            return (
              <details
                key={product.id}
                className="group rounded-lg border border-border bg-surface text-sm"
              >
                <summary className="flex cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-muted">
                    {primaryMedia ? (
                      primaryMedia.type === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra, see storefront ProductList.tsx
                        <img src={primaryMedia.url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <video src={primaryMedia.url} muted className="h-full w-full object-cover" />
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{product.name}</span>
                  <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                    {summaryPrice}
                  </span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs capitalize">
                    {product.status}
                  </span>
                  <span className="text-muted-foreground transition-transform group-open:rotate-90">
                    ›
                  </span>
                </summary>

                <div className="flex flex-col gap-6 border-t border-border p-6">
                  <ActionForm
                    action={updateProductAction}
                    submitLabel="Save"
                    className="flex max-w-2xl flex-col gap-8"
                  >
                    <input type="hidden" name="productId" value={product.id} />
                    <div className={productFieldGroupClassName}>
                      <h4 className={productSectionHeadingClassName}>Basic info</h4>
                      <label className={productLabelClassName}>
                        Name
                        <input
                          name="name"
                          defaultValue={product.name}
                          className={productInputClassName}
                        />
                      </label>
                      {simpleVariant ? (
                        <label className={productLabelClassName}>
                          Price (VND)
                          <input
                            name="price"
                            inputMode="numeric"
                            defaultValue={String(simpleVariant.price)}
                            className={productInputClassName}
                          />
                        </label>
                      ) : (
                        <input type="hidden" name="price" value="0" />
                      )}
                      <label className={productLabelClassName}>
                        Status
                        <select
                          name="status"
                          defaultValue={product.status}
                          className={productInputClassName}
                        >
                          {PRODUCT_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className={productFieldGroupClassName}>
                      <h4 className={productSectionHeadingClassName}>Description</h4>
                      <label className={productLabelClassName}>
                        Optional — supports Markdown formatting
                        <DescriptionEditor defaultValue={product.description ?? ""} />
                      </label>
                    </div>
                  </ActionForm>

                  {(() => {
                    const discount = discountByProduct.get(product.id);
                    return (
                      <div className="flex flex-col gap-2 border-t border-border pt-3">
                        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                          Discount
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          One discount per product — saving again replaces the current one, never stacks.
                        </p>
                        <ActionForm
                          action={upsertProductDiscountAction}
                          submitLabel={discount ? "Save discount" : "Add discount"}
                          className="flex flex-wrap items-end gap-2"
                        >
                          <input type="hidden" name="productId" value={product.id} />
                          <label className={adminLabelClassName}>
                            Percent off
                            <input
                              name="percentOff"
                              inputMode="numeric"
                              placeholder="10"
                              defaultValue={discount ? String(discount.percentOff) : ""}
                              className={`w-24 ${adminInputClassName}`}
                            />
                          </label>
                          <label className={adminLabelClassName}>
                            Starts (optional)
                            <input
                              type="datetime-local"
                              name="startsAt"
                              defaultValue={toDatetimeLocalValue(discount?.startsAt)}
                              className={adminInputClassName}
                            />
                          </label>
                          <label className={adminLabelClassName}>
                            Ends (optional)
                            <input
                              type="datetime-local"
                              name="endsAt"
                              defaultValue={toDatetimeLocalValue(discount?.endsAt)}
                              className={adminInputClassName}
                            />
                          </label>
                          <label className="flex items-center gap-2 pb-1.5 text-xs">
                            <input type="checkbox" name="enabled" defaultChecked={discount?.enabled ?? true} />
                            Enabled
                          </label>
                        </ActionForm>
                        {discount && (
                          <ActionForm action={deleteProductDiscountAction} submitLabel="Remove discount">
                            <input type="hidden" name="productId" value={product.id} />
                          </ActionForm>
                        )}
                      </div>
                    );
                  })()}

                  <div className="border-t border-border pt-3">
                    <ProductMediaGallery
                      productId={product.id}
                      initialMedia={product.media.map((m) => ({
                        id: m.id,
                        type: m.type,
                        url: m.url,
                      }))}
                    />
                  </div>

                  {simpleVariant && (
                    <div className="border-t border-border pt-3">
                      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        Stock
                      </h4>
                      <StockControl
                        productVariantId={simpleVariant.id}
                        inventory={inventoryByVariant.get(simpleVariant.id)}
                      />
                    </div>
                  )}

                  <div className="flex flex-col gap-2 border-t border-border pt-3">
                    <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      Options
                    </h4>
                    {assignedOptions.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No options assigned — simple product.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {assignedOptions.map((po) => (
                          <div
                            key={po.id}
                            className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5"
                          >
                            <span>{optionNameById.get(po.variantOptionId) ?? "(unknown option)"}</span>
                            <ActionForm action={removeProductOptionAction} submitLabel="Remove">
                              <input type="hidden" name="productOptionId" value={po.id} />
                            </ActionForm>
                          </div>
                        ))}
                        <p className="text-xs text-amber-700 dark:text-amber-500">
                          Removing an option also removes any variant associations built from it.
                        </p>
                      </div>
                    )}
                    {availableOptions.length > 0 && (
                      <ActionForm
                        action={assignProductOptionAction}
                        submitLabel="Assign option"
                        className="flex items-end gap-2"
                      >
                        <input type="hidden" name="productId" value={product.id} />
                        <label className={adminLabelClassName}>
                          Option
                          <select name="variantOptionId" className={adminInputClassName}>
                            {availableOptions.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </ActionForm>
                    )}
                  </div>

                  {assignedOptions.length > 0 && (
                    <div className="flex flex-col gap-2 border-t border-border pt-3">
                      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        Variants
                      </h4>
                      <ActionForm
                        action={generateVariantsAction}
                        submitLabel="Generate variants"
                        className="flex items-end gap-2"
                      >
                        <input type="hidden" name="productId" value={product.id} />
                        <label className={adminLabelClassName}>
                          Starting price (VND)
                          <input
                            name="defaultPrice"
                            inputMode="numeric"
                            placeholder="100000"
                            className={adminInputClassName}
                          />
                        </label>
                      </ActionForm>

                      {!simpleVariant && activeVariants.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="border-b border-border">
                                <th className="py-1.5 pr-2 font-medium">Combination</th>
                                <th className="py-1.5 pr-2 font-medium">SKU</th>
                                <th className="py-1.5 pr-2 font-medium">Price</th>
                                <th className="py-1.5 pr-2 font-medium">Status</th>
                                <th className="py-1.5 font-medium">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {activeVariants.map((variant) => (
                                <tr key={variant.id} className="border-b border-border last:border-0">
                                  <td className="py-1.5 pr-2 align-top">
                                    {formatCombination(variant, optionNameById, valueLabelById)}
                                  </td>
                                  <td colSpan={4} className="py-1.5">
                                    <ActionForm
                                      action={updateProductVariantAction}
                                      submitLabel="Save"
                                      className="flex flex-wrap items-end gap-2"
                                    >
                                      <input type="hidden" name="productVariantId" value={variant.id} />
                                      <label className={adminLabelClassName}>
                                        SKU
                                        <input
                                          name="sku"
                                          defaultValue={variant.sku ?? ""}
                                          placeholder="(none)"
                                          className={`w-32 ${adminInputClassName}`}
                                        />
                                      </label>
                                      <label className={adminLabelClassName}>
                                        Price (VND)
                                        <input
                                          name="price"
                                          inputMode="numeric"
                                          defaultValue={String(variant.price)}
                                          className={`w-28 ${adminInputClassName}`}
                                        />
                                      </label>
                                      <span className="pb-1.5 text-muted-foreground">{variant.status}</span>
                                    </ActionForm>
                                    <div className="mt-1">
                                      <StockControl
                                        productVariantId={variant.id}
                                        inventory={inventoryByVariant.get(variant.id)}
                                      />
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {archivedVariantsByProduct.get(product.id)?.length ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                            Archived variants ({archivedVariantsByProduct.get(product.id)?.length})
                          </summary>
                          <div className="mt-1 overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead>
                                <tr className="border-b border-border">
                                  <th className="py-1.5 pr-2 font-medium">Combination</th>
                                  <th className="py-1.5 pr-2 font-medium">SKU</th>
                                  <th className="py-1.5 pr-2 font-medium">Price</th>
                                  <th className="py-1.5 font-medium">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {archivedVariantsByProduct.get(product.id)?.map((variant) => (
                                  <tr key={variant.id} className="border-b border-border text-muted-foreground last:border-0">
                                    <td className="py-1.5 pr-2">
                                      {formatCombination(variant, optionNameById, valueLabelById)}
                                    </td>
                                    <td className="py-1.5 pr-2">{variant.sku ?? "(none)"}</td>
                                    <td className="py-1.5 pr-2">{variant.price.toLocaleString("vi-VN")} ₫</td>
                                    <td className="py-1.5">Archived</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      ) : null}
                    </div>
                  )}
                </div>
              </details>
            );
          })}
          {products.length === 0 && (
            <p className="text-sm text-muted-foreground">No products yet.</p>
          )}
        </div>
      </section>
    </>
  );
}
