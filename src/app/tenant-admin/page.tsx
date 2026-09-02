import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { getScopedDb } from "@/lib/db/tenant-db";
import { ActionForm } from "@/components/ActionForm";
import {
  updateBrandingAction,
  createProductAction,
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
import { OrderStatusForm } from "./OrderStatusForm";
import { listOrders } from "@/lib/order-queries";

const PRODUCT_STATUSES = ["draft", "active"] as const;

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
      <span className="pb-1.5 text-xs text-black/60 dark:text-white/60">
        On hand: {inventory.onHand} · Reserved: {inventory.reserved} · Available: {available}
      </span>
      <label className="flex flex-col gap-1">
        Adjust by
        <input name="adjustment" inputMode="numeric" placeholder="+10 or -3" className="w-24 rounded border px-2 py-1" />
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
    <main className="flex flex-1 flex-col gap-8 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold">Tenant Admin</h1>
        <p className="text-black/70 dark:text-white/70">
          You are managing {tenant?.name ?? "(unknown tenant)"}.
        </p>
        {primaryDomain && (
          <a
            href={`http://${primaryDomain.hostname}:3000/`}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline"
          >
            View storefront ↗
          </a>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Branding</h2>
        <ActionForm
          action={updateBrandingAction}
          submitLabel="Save branding"
          className="flex max-w-md flex-col gap-2"
        >
          <label className="flex flex-col gap-1 text-sm">
            Store name
            <input
              name="storeName"
              defaultValue={branding?.storeName ?? ""}
              placeholder={tenant?.name}
              className="rounded border px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Logo URL
            <input
              name="logoUrl"
              defaultValue={branding?.logoUrl ?? ""}
              placeholder="https://..."
              className="rounded border px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Favicon URL
            <input
              name="faviconUrl"
              defaultValue={branding?.faviconUrl ?? ""}
              placeholder="https://..."
              className="rounded border px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Primary color
            <input
              name="primaryColor"
              defaultValue={branding?.primaryColor ?? ""}
              placeholder="#3b3b3b"
              className="rounded border px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Secondary color
            <input
              name="secondaryColor"
              defaultValue={branding?.secondaryColor ?? ""}
              placeholder="#8a8a8a"
              className="rounded border px-2 py-1"
            />
          </label>
        </ActionForm>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Variant Options</h2>
        <p className="text-xs text-black/60 dark:text-white/60">
          Reusable option types (e.g. Color, Size) shared across every product for this store.
        </p>

        <ActionForm
          action={createVariantOptionAction}
          submitLabel="Add option"
          className="flex max-w-md flex-col gap-2"
        >
          <label className="flex flex-col gap-1 text-sm">
            Option name
            <input name="name" placeholder="Color" className="rounded border px-2 py-1" />
          </label>
        </ActionForm>

        <div className="flex flex-col gap-3">
          {variantOptions.map((option) => {
            const values = valuesByOption.get(option.id) ?? [];
            return (
              <div key={option.id} className="rounded border p-3 text-sm">
                <h3 className="font-medium">{option.name}</h3>
                <div className="mt-2 flex flex-col gap-1">
                  {values.map((value) => (
                    <div key={value.id} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
                      <span>{value.value}</span>
                      <ActionForm action={deleteVariantOptionValueAction} submitLabel="Delete">
                        <input type="hidden" name="variantOptionValueId" value={value.id} />
                      </ActionForm>
                    </div>
                  ))}
                  {values.length === 0 && (
                    <p className="text-xs text-black/60 dark:text-white/60">No values yet.</p>
                  )}
                </div>
                {values.length > 0 && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
                    Deleting a value also removes it from any product variants that used it.
                  </p>
                )}
                <ActionForm
                  action={createVariantOptionValueAction}
                  submitLabel="Add value"
                  className="mt-2 flex items-end gap-2"
                >
                  <input type="hidden" name="variantOptionId" value={option.id} />
                  <label className="flex flex-col gap-1">
                    Value
                    <input name="value" placeholder="White" className="rounded border px-2 py-1" />
                  </label>
                </ActionForm>
              </div>
            );
          })}
          {variantOptions.length === 0 && (
            <p className="text-sm text-black/60 dark:text-white/60">No variant options yet.</p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Products</h2>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Import Products (CSV)</h3>
          <p className="text-xs text-black/60 dark:text-white/60">
            CSV import supports: name, price, status (optional, defaults to draft). Max 500 rows, 1 MB.
            Media can be added after import from the product editor below.
          </p>
          <ImportProductsForm action={importProductsAction} />
        </div>

        <ActionForm
          action={createProductAction}
          submitLabel="Add product"
          className="flex max-w-md flex-col gap-2"
        >
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input name="name" className="rounded border px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Price (VND)
            <input name="price" inputMode="numeric" className="rounded border px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Description (optional)
            <textarea name="description" rows={3} className="rounded border px-2 py-1" />
          </label>
          <ProductMediaGallery />
          <label className="flex flex-col gap-1 text-sm">
            Status
            <select name="status" defaultValue="draft" className="rounded border px-2 py-1">
              {PRODUCT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        </ActionForm>

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

            return (
              <div key={product.id} className="flex flex-col gap-3 rounded border p-3 text-sm">
                <ActionForm action={updateProductAction} submitLabel="Save" className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="productId" value={product.id} />
                  <label className="flex flex-col gap-1">
                    Name
                    <input name="name" defaultValue={product.name} className="rounded border px-2 py-1" />
                  </label>
                  {simpleVariant ? (
                    <label className="flex flex-col gap-1">
                      Price (VND)
                      <input
                        name="price"
                        inputMode="numeric"
                        defaultValue={String(simpleVariant.price)}
                        className="rounded border px-2 py-1"
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
                  <label className="flex flex-col gap-1">
                    Status
                    <select name="status" defaultValue={product.status} className="rounded border px-2 py-1">
                      {PRODUCT_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex w-full flex-col gap-1">
                    Description (optional)
                    <textarea
                      name="description"
                      rows={2}
                      defaultValue={product.description ?? ""}
                      className="rounded border px-2 py-1"
                    />
                  </label>
                </ActionForm>

                <div className="border-t pt-2">
                  <ProductMediaGallery
                    productId={product.id}
                    initialMedia={product.media.map((m) => ({ id: m.id, type: m.type, url: m.url }))}
                  />
                </div>

                {simpleVariant && (
                  <div className="border-t pt-2">
                    <h4 className="text-xs font-medium uppercase text-black/60 dark:text-white/60">Stock</h4>
                    <StockControl productVariantId={simpleVariant.id} inventory={inventoryByVariant.get(simpleVariant.id)} />
                  </div>
                )}

                <div className="flex flex-col gap-2 border-t pt-2">
                  <h4 className="text-xs font-medium uppercase text-black/60 dark:text-white/60">Options</h4>
                  {assignedOptions.length === 0 ? (
                    <p className="text-xs text-black/60 dark:text-white/60">No options assigned — simple product.</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {assignedOptions.map((po) => (
                        <div key={po.id} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
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
                      <label className="flex flex-col gap-1">
                        Option
                        <select name="variantOptionId" className="rounded border px-2 py-1">
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
                  <div className="flex flex-col gap-2 border-t pt-2">
                    <h4 className="text-xs font-medium uppercase text-black/60 dark:text-white/60">Variants</h4>
                    <ActionForm
                      action={generateVariantsAction}
                      submitLabel="Generate variants"
                      className="flex items-end gap-2"
                    >
                      <input type="hidden" name="productId" value={product.id} />
                      <label className="flex flex-col gap-1">
                        Starting price (VND)
                        <input name="defaultPrice" inputMode="numeric" placeholder="100000" className="rounded border px-2 py-1" />
                      </label>
                    </ActionForm>

                    {!simpleVariant && activeVariants.length > 0 && (
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b">
                            <th className="py-1 pr-2 font-medium">Combination</th>
                            <th className="py-1 pr-2 font-medium">SKU</th>
                            <th className="py-1 pr-2 font-medium">Price</th>
                            <th className="py-1 pr-2 font-medium">Status</th>
                            <th className="py-1 font-medium">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeVariants.map((variant) => (
                            <tr key={variant.id} className="border-b last:border-0">
                              <td className="py-1 pr-2 align-top">{formatCombination(variant, optionNameById, valueLabelById)}</td>
                              <td colSpan={4} className="py-1">
                                <ActionForm
                                  action={updateProductVariantAction}
                                  submitLabel="Save"
                                  className="flex flex-wrap items-end gap-2"
                                >
                                  <input type="hidden" name="productVariantId" value={variant.id} />
                                  <label className="flex flex-col gap-1">
                                    SKU
                                    <input
                                      name="sku"
                                      defaultValue={variant.sku ?? ""}
                                      placeholder="(none)"
                                      className="w-32 rounded border px-2 py-1"
                                    />
                                  </label>
                                  <label className="flex flex-col gap-1">
                                    Price (VND)
                                    <input
                                      name="price"
                                      inputMode="numeric"
                                      defaultValue={String(variant.price)}
                                      className="w-28 rounded border px-2 py-1"
                                    />
                                  </label>
                                  <span className="pb-1.5">{variant.status}</span>
                                </ActionForm>
                                <div className="mt-1">
                                  <StockControl productVariantId={variant.id} inventory={inventoryByVariant.get(variant.id)} />
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {archivedVariantsByProduct.get(product.id)?.length ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-black/60 dark:text-white/60">
                          Archived variants ({archivedVariantsByProduct.get(product.id)?.length})
                        </summary>
                        <table className="mt-1 w-full text-left text-xs">
                          <thead>
                            <tr className="border-b">
                              <th className="py-1 pr-2 font-medium">Combination</th>
                              <th className="py-1 pr-2 font-medium">SKU</th>
                              <th className="py-1 pr-2 font-medium">Price</th>
                              <th className="py-1 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {archivedVariantsByProduct.get(product.id)?.map((variant) => (
                              <tr key={variant.id} className="border-b text-black/60 last:border-0 dark:text-white/60">
                                <td className="py-1 pr-2">{formatCombination(variant, optionNameById, valueLabelById)}</td>
                                <td className="py-1 pr-2">{variant.sku ?? "(none)"}</td>
                                <td className="py-1 pr-2">{variant.price.toLocaleString("vi-VN")} ₫</td>
                                <td className="py-1">Archived</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </details>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
          {products.length === 0 && (
            <p className="text-sm text-black/60 dark:text-white/60">No products yet.</p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Orders</h2>

        <div className="flex flex-col gap-3">
          {orders.map((order) => (
            <div key={order.id} className="rounded border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">Order {order.id}</span>
                <span className="rounded-full border px-2 py-0.5 text-xs capitalize">{order.status}</span>
                <span className="text-xs text-black/60 dark:text-white/60">
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
                        ? "rounded-full border px-2 py-0.5 text-xs capitalize text-red-600"
                        : "rounded-full border px-2 py-0.5 text-xs capitalize"
                    }
                  >
                    Payment: {order.paymentStatus}
                  </span>
                )}
                <span className="text-xs text-black/60 dark:text-white/60">
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
              <p className="mt-1 text-xs text-black/60 dark:text-white/60">
                {order.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
              </p>

              <div className="mt-2 border-t pt-2">
                <h4 className="text-xs font-medium uppercase text-black/60 dark:text-white/60">Customer</h4>
                <p className="text-xs">{order.customer.name}</p>
                <p className="text-xs text-black/60 dark:text-white/60">{order.customer.email}</p>
                <p className="text-xs text-black/60 dark:text-white/60">{order.customer.phone}</p>
              </div>

              <div className="mt-2 border-t pt-2">
                <h4 className="text-xs font-medium uppercase text-black/60 dark:text-white/60">Shipping address</h4>
                <p className="text-xs">{order.shippingAddress}</p>
                <p className="text-xs text-black/60 dark:text-white/60">{order.shippingWard}</p>
                <p className="text-xs text-black/60 dark:text-white/60">{order.shippingDistrict}</p>
                <p className="text-xs text-black/60 dark:text-white/60">{order.shippingCity}</p>
                {order.shippingNote && (
                  <p className="text-xs text-black/60 dark:text-white/60">Note: {order.shippingNote}</p>
                )}
              </div>

              <table className="mt-3 w-full text-left text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="py-1 pr-2 font-medium">Item</th>
                    <th className="py-1 pr-2 font-medium">Qty</th>
                    <th className="py-1 pr-2 font-medium">Unit price</th>
                    <th className="py-1 font-medium">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="py-1 pr-2">
                        {item.productName}
                        {item.combinationLabel && (
                          <span className="text-black/60 dark:text-white/60"> — {item.combinationLabel}</span>
                        )}
                      </td>
                      <td className="py-1 pr-2">{item.quantity}</td>
                      <td className="py-1 pr-2 font-mono">{formatVnd(item.unitPrice)}</td>
                      <td className="py-1 font-mono">{formatVnd(item.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {orders.length === 0 && (
            <p className="text-sm text-black/60 dark:text-white/60">No orders yet.</p>
          )}
        </div>
      </section>
    </main>
  );
}
