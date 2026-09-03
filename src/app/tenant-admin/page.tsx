import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { getScopedDb } from "@/lib/db/tenant-db";
import { ActionForm } from "@/components/ActionForm";
import {
  updateBrandingAction,
  updateProductAction,
  importProductsAction,
  createVariantOptionAction,
  createVariantOptionValueAction,
  deleteVariantOptionValueAction,
  assignProductOptionAction,
  removeProductOptionAction,
  generateVariantsAction,
  updateProductVariantAction,
  updateOrderStatusAction,
  adjustInventoryOnHandAction,
} from "./actions";
import { ImportProductsForm } from "./ImportProductsForm";
import { ProductMediaGallery } from "./ProductMediaGallery";
import { CreateProductForm } from "./CreateProductForm";
import { OrderStatusForm } from "./OrderStatusForm";
import { listOrders } from "@/lib/order-queries";
import { PRODUCT_STATUSES } from "./product-status";
import { adminInputClassName, adminLabelClassName, adminSectionClassName, adminCardClassName } from "./styles";

export const dynamic = "force-dynamic";

function formatVnd(price: number): string {
  return `${price.toLocaleString("vi-VN")} ₫`;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cod: "Cash on delivery",
  momo: "MoMo",
  bank_transfer: "Bank transfer",
};

// Resolves ProductVariantOptionValue -> VariantOption / VariantOptionValue
// into a human-readable, deterministically-ordered label (sorted by option
// name, not by combinationKey — combinationKey is never read or displayed
// here, it is not a user-facing value).
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
    // Every variant gets exactly one Inventory row at creation time
    // (product-mutations.ts / variant-generation.ts) — this only shows if
    // that invariant were ever violated, which this step does not change.
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
        <input name="adjustment" inputMode="numeric" placeholder="+10 or -3" className={`w-24 ${adminInputClassName}`} />
      </label>
    </ActionForm>
  );
}

export default async function TenantAdminHomePage() {
  // Independently re-verified here, not relying on the layout gate alone —
  // same defense-in-depth rule already applied to Platform Admin mutations.
  const { tenantId } = await requireTenantAdmin();

  // NOTE: getScopedDb() auto-scopes tenant-owned models (domain, branding)
  // via their `tenantId` foreign key. The Tenant model itself has no such
  // column — it IS the tenant, identified by `id` — so this call passes
  // through the extension unintercepted. It's safe only because `tenantId`
  // here was already independently verified above (Clerk metadata AND the
  // hostname-resolved tenant had to match). This is not blanket protection
  // from getScopedDb() for the Tenant model; documented here and in Notion.
  const db = getScopedDb(tenantId);
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  const branding = await db.branding.findUnique({ where: { tenantId } });
  const primaryDomain = await db.domain.findFirst({ where: { tenantId, isPrimary: true } });
  const products = await db.product.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    include: {
      variants: { include: { optionValues: true } },
      media: { orderBy: { sortOrder: "asc" } },
    },
  });

  // Variant Options data: fetched once here (not via a UI-side loop of the
  // existing list*/create* mutation functions) purely to avoid an N+1 query
  // pattern across products/options in a single page render. All writes
  // still go exclusively through the existing mutation functions via
  // server actions below — this page never writes through `db` directly.
  const variantOptions = await db.variantOption.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
  const variantOptionValues = await db.variantOptionValue.findMany({ where: { tenantId }, orderBy: { value: "asc" } });
  const allProductOptions = await db.productOption.findMany({ where: { tenantId } });

  // Step 38: one Inventory row per variant at the tenant's single default
  // Location (see product-mutations.ts/variant-generation.ts) — fetched
  // once here for the same N+1-avoidance reason as variantOptions/
  // variantOptionValues above. Read-only; the stock-adjustment form below
  // writes exclusively through adjustInventoryOnHandAction.
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
    productOptionsByProduct.set(po.productId, [...(productOptionsByProduct.get(po.productId) ?? []), po]);
  }
  const archivedVariantsByProduct = new Map<string, (typeof products)[number]["variants"]>();
  for (const product of products) {
    const archived = product.variants.filter((v) => v.status === "archived");
    if (archived.length > 0) {
      archivedVariantsByProduct.set(product.id, archived);
    }
  }

  // Read-only — see order-queries.ts. Nothing here writes to the database;
  // order creation/inventory reservation logic is untouched by this page.
  const orders = await listOrders(tenantId);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12 sm:py-16">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Tenant Admin</h1>
        <p className="text-sm text-muted-foreground">
          You are managing {tenant?.name ?? "(unknown tenant)"}.
        </p>
        {primaryDomain && (
          <a
            href={`http://${primaryDomain.hostname}:3000/`}
            target="_blank"
            rel="noreferrer"
            className="w-fit text-sm text-muted-foreground underline transition-colors hover:text-foreground"
          >
            View storefront ↗
          </a>
        )}
      </div>

      <section className={adminSectionClassName}>
        <h2 className="text-lg font-medium tracking-tight">Branding</h2>
        <ActionForm
          action={updateBrandingAction}
          submitLabel="Save branding"
          className="flex max-w-md flex-col gap-3"
        >
          <label className={adminLabelClassName}>
            Store name
            <input
              name="storeName"
              defaultValue={branding?.storeName ?? ""}
              placeholder={tenant?.name}
              className={adminInputClassName}
            />
          </label>
          <label className={adminLabelClassName}>
            Logo URL
            <input
              name="logoUrl"
              defaultValue={branding?.logoUrl ?? ""}
              placeholder="https://..."
              className={adminInputClassName}
            />
          </label>
          <label className={adminLabelClassName}>
            Favicon URL
            <input
              name="faviconUrl"
              defaultValue={branding?.faviconUrl ?? ""}
              placeholder="https://..."
              className={adminInputClassName}
            />
          </label>
          <label className={adminLabelClassName}>
            Primary color
            <input
              name="primaryColor"
              defaultValue={branding?.primaryColor ?? ""}
              placeholder="#3b3b3b"
              className={adminInputClassName}
            />
          </label>
          <label className={adminLabelClassName}>
            Secondary color
            <input
              name="secondaryColor"
              defaultValue={branding?.secondaryColor ?? ""}
              placeholder="#8a8a8a"
              className={adminInputClassName}
            />
          </label>
        </ActionForm>
      </section>

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
              <div key={option.id} className={adminCardClassName}>
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
                  {values.length === 0 && <p className="text-xs text-muted-foreground">No values yet.</p>}
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
          {variantOptions.length === 0 && <p className="text-sm text-muted-foreground">No variant options yet.</p>}
        </div>
      </section>

      <section className={adminSectionClassName}>
        <h2 className="text-lg font-medium tracking-tight">Products</h2>

        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-muted p-4">
          <h3 className="text-sm font-medium">Import Products (CSV)</h3>
          <p className="text-xs text-muted-foreground">
            CSV import supports: name, price, status (optional, defaults to draft). Max 500 rows, 1 MB.
            Media can be added after import from the product editor below.
          </p>
          <ImportProductsForm action={importProductsAction} />
        </div>

        <CreateProductForm />

        <div className="flex flex-col gap-3">
          {products.map((product) => {
            const activeVariants = product.variants.filter((v) => v.status !== "archived");
            // Simple-product path: every product created without options
            // has exactly one variant with combinationKey === "", the same
            // sentinel product-mutations.ts and the v4.1 migration backfill
            // both use to mean "the" variant. Once real combinations exist,
            // this is no longer true — see product-mutations.ts's
            // updateProduct() doc comment for why price editing below is
            // gated on this same check (Step 21).
            const simpleVariant =
              activeVariants.length === 1 && activeVariants[0].combinationKey === "" ? activeVariants[0] : null;

            const assignedOptions = productOptionsByProduct.get(product.id) ?? [];
            const assignedOptionIds = new Set(assignedOptions.map((po) => po.variantOptionId));
            const availableOptions = variantOptions.filter((o) => !assignedOptionIds.has(o.id));

            const primaryMedia = product.media[0];
            const summaryPrice = simpleVariant
              ? formatVnd(simpleVariant.price)
              : `${activeVariants.length} variant${activeVariants.length === 1 ? "" : "s"}`;

            return (
              // Step 50 (revised): collapsed by default — a merchant with
              // many products previously had every product's full editor
              // (media gallery, stock, options, variant table) expanded
              // and stacked at once, making the list unusable past a
              // handful of products. <details>/<summary> needs no client
              // JS and keeps each product's full edit form exactly as it
              // was, just hidden until opened.
              <details key={product.id} className="group rounded-lg border border-border bg-surface text-sm">
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
                  <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">{summaryPrice}</span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs capitalize">{product.status}</span>
                  <span className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
                </summary>

                <div className="flex flex-col gap-3 border-t border-border p-4">
                <ActionForm action={updateProductAction} submitLabel="Save" className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="productId" value={product.id} />
                  <label className={adminLabelClassName}>
                    Name
                    <input name="name" defaultValue={product.name} className={adminInputClassName} />
                  </label>
                  {simpleVariant ? (
                    <label className={adminLabelClassName}>
                      Price (VND)
                      <input
                        name="price"
                        inputMode="numeric"
                        defaultValue={String(simpleVariant.price)}
                        className={adminInputClassName}
                      />
                    </label>
                  ) : (
                    // updateProduct() only edits price for a simple product
                    // (Step 21) — for a variant-bearing product, per-variant
                    // prices are shown read-only in the table below instead.
                    // validateProductInput still requires a numeric string,
                    // so a harmless placeholder is submitted and ignored.
                    <input type="hidden" name="price" value="0" />
                  )}
                  <label className={adminLabelClassName}>
                    Status
                    <select name="status" defaultValue={product.status} className={adminInputClassName}>
                      {PRODUCT_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={`w-full ${adminLabelClassName}`}>
                    Description (optional)
                    <textarea
                      name="description"
                      rows={2}
                      defaultValue={product.description ?? ""}
                      className={adminInputClassName}
                    />
                  </label>
                </ActionForm>

                <div className="border-t border-border pt-3">
                  <ProductMediaGallery
                    productId={product.id}
                    initialMedia={product.media.map((m) => ({ id: m.id, type: m.type, url: m.url }))}
                  />
                </div>

                {simpleVariant && (
                  <div className="border-t border-border pt-3">
                    <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Stock</h4>
                    <StockControl productVariantId={simpleVariant.id} inventory={inventoryByVariant.get(simpleVariant.id)} />
                  </div>
                )}

                <div className="flex flex-col gap-2 border-t border-border pt-3">
                  <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Options</h4>
                  {assignedOptions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No options assigned — simple product.</p>
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
                    <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Variants</h4>
                    <ActionForm
                      action={generateVariantsAction}
                      submitLabel="Generate variants"
                      className="flex items-end gap-2"
                    >
                      <input type="hidden" name="productId" value={product.id} />
                      <label className={adminLabelClassName}>
                        Starting price (VND)
                        <input name="defaultPrice" inputMode="numeric" placeholder="100000" className={adminInputClassName} />
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
                                    <StockControl productVariantId={variant.id} inventory={inventoryByVariant.get(variant.id)} />
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
                                  <td className="py-1.5 pr-2">{formatCombination(variant, optionNameById, valueLabelById)}</td>
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
          {products.length === 0 && <p className="text-sm text-muted-foreground">No products yet.</p>}
        </div>
      </section>

      <section className={adminSectionClassName}>
        <h2 className="text-lg font-medium tracking-tight">Orders</h2>

        <div className="flex flex-col gap-3">
          {orders.map((order) => (
            <div key={order.id} className="rounded-lg border border-border bg-surface p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">Order {order.id}</span>
                <span className="rounded-full border border-border px-2 py-0.5 text-xs capitalize">{order.status}</span>
                <span className="text-xs text-muted-foreground">
                  {PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod}
                </span>
                {/* Step 49: business-level payment state — null for
                    cod/bank_transfer (no Payment row exists for those, see
                    order-queries.ts). Independent of order.status; never
                    merged into that badge. */}
                {order.paymentStatus && (
                  <span
                    className={
                      order.paymentStatus === "failed"
                        ? "rounded-full border border-border px-2 py-0.5 text-xs capitalize text-red-600"
                        : "rounded-full border border-border px-2 py-0.5 text-xs capitalize"
                    }
                  >
                    Payment: {order.paymentStatus}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {order.itemCount} item{order.itemCount === 1 ? "" : "s"}
                </span>
                <span className="font-mono text-xs">{formatVnd(order.total)}</span>
                {order.status === "pending" && (
                  <div className="ml-auto flex items-center gap-1">
                    <OrderStatusForm
                      action={updateOrderStatusAction}
                      orderId={order.id}
                      nextStatus="fulfilled"
                      label="Mark fulfilled"
                    />
                    <OrderStatusForm
                      action={updateOrderStatusAction}
                      orderId={order.id}
                      nextStatus="cancelled"
                      label="Cancel"
                    />
                  </div>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {order.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
              </p>

              <div className="mt-3 border-t border-border pt-3">
                <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Customer</h4>
                <p className="mt-1 text-xs">{order.customer.name}</p>
                <p className="text-xs text-muted-foreground">{order.customer.email}</p>
                <p className="text-xs text-muted-foreground">{order.customer.phone}</p>
              </div>

              <div className="mt-3 border-t border-border pt-3">
                <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Shipping address</h4>
                <p className="mt-1 text-xs">{order.shippingAddress}</p>
                <p className="text-xs text-muted-foreground">{order.shippingWard}</p>
                <p className="text-xs text-muted-foreground">{order.shippingDistrict}</p>
                <p className="text-xs text-muted-foreground">{order.shippingCity}</p>
                {order.shippingNote && <p className="text-xs text-muted-foreground">Note: {order.shippingNote}</p>}
              </div>

              <div className="mt-3 overflow-x-auto border-t border-border pt-3">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="py-1.5 pr-2 font-medium">Item</th>
                      <th className="py-1.5 pr-2 font-medium">Qty</th>
                      <th className="py-1.5 pr-2 font-medium">Unit price</th>
                      <th className="py-1.5 font-medium">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item) => (
                      <tr key={item.id} className="border-b border-border last:border-0">
                        <td className="py-1.5 pr-2">
                          {item.productName}
                          {item.combinationLabel && (
                            <span className="text-muted-foreground"> — {item.combinationLabel}</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2">{item.quantity}</td>
                        <td className="py-1.5 pr-2 font-mono">{formatVnd(item.unitPrice)}</td>
                        <td className="py-1.5 font-mono">{formatVnd(item.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {orders.length === 0 && <p className="text-sm text-muted-foreground">No orders yet.</p>}
        </div>
      </section>
    </main>
  );
}
