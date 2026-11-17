import Link from 'next/link';
import { requireTenantAdmin } from '@/lib/auth/require-tenant-admin';
import { getScopedDb } from '@/lib/db/tenant-db';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmActionForm } from '@/components/ConfirmActionForm';
import {
  updateProductAction,
  deleteProductAction,
  importProductsAction,
  previewProductsImportAction,
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
  createProductCategoryAction,
  deleteProductCategoryAction,
  updateProductCategoryAction,
} from '../actions';
import { listDiscountsByProduct } from '@/lib/discount-mutations';
import { BulkDeleteProductsForm, BULK_DELETE_PRODUCTS_FORM_ID } from '../BulkDeleteProductsForm';
import { ImportProductsForm } from '../ImportProductsForm';
import { ExportCsvButton } from '../ExportCsvButton';
import { AdminPageHeader } from '../AdminPageHeader';
import { StatusBadge } from '../StatusBadge';
import { ProductMediaGallery } from '../ProductMediaGallery';
import { DescriptionEditor } from '../DescriptionEditor';
import { Pagination } from '../Pagination';
import { PRODUCT_STATUSES } from '../product-status';
import { formatVnd } from '../format';
import { DateTimePicker } from '@/components/DateTimePicker';
import { LOW_STOCK_THRESHOLD } from '@/lib/inventory-availability';
import {
  adminInputClassName,
  adminLabelClassName,
  adminPageClassName,
  adminPanelClassName,
  adminPanelTitleClassName,
  adminSubtleClassName,
  adminEyebrowClassName,
  adminButtonPrimaryClassName,
  productInputClassName,
  productLabelClassName,
  productFieldGroupClassName,
  productSectionHeadingClassName,
} from '../styles';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

// Resolves ProductVariantOptionValue -> VariantOption / VariantOptionValue
// into a human-readable, deterministically-ordered label (sorted by option
// name, not by combinationKey — combinationKey is never read or displayed
// here, it is not a user-facing value).
// Formats a Date for a <input type="datetime-local"> defaultValue —
// that input requires "YYYY-MM-DDTHH:mm" in LOCAL time, not toISOString()
// (which is UTC and includes seconds/milliseconds/Z).
function toDatetimeLocalValue(date: Date | null | undefined): string {
  if (!date) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatCombination(
  variant: { optionValues: { variantOptionId: string; variantOptionValueId: string }[] },
  optionNameById: Map<string, string>,
  valueLabelById: Map<string, string>,
): string {
  if (variant.optionValues.length === 0) {
    return '(no options)';
  }
  return variant.optionValues
    .map((ov) => ({
      optionName: optionNameById.get(ov.variantOptionId) ?? '?',
      valueLabel: valueLabelById.get(ov.variantOptionValueId) ?? '?',
    }))
    .sort((a, b) => a.optionName.localeCompare(b.optionName))
    .map((pair) => `${pair.optionName}: ${pair.valueLabel}`)
    .join(' / ');
}

/**
 * The accessible-name suffix for a per-row variant control.
 *
 * Prefers the option combination a merchant can actually see ("Color: Red /
 * Size: Small"), falls back to the SKU — already user-facing — and only then
 * to a generic phrase. Internal ids and combination keys are never exposed.
 * Two variants that differ in their options therefore differ in their
 * accessible names.
 */
function variantContextLabel(
  variant: {
    sku: string | null;
    optionValues: { variantOptionId: string; variantOptionValueId: string }[];
  },
  optionNameById: Map<string, string>,
  valueLabelById: Map<string, string>,
): string {
  if (variant.optionValues.length > 0) {
    return formatCombination(variant, optionNameById, valueLabelById);
  }
  if (variant.sku && variant.sku.trim().length > 0) {
    return variant.sku.trim();
  }
  return 'without options';
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
      successMessage="Inventory adjusted."
      className="flex flex-wrap items-end gap-2"
    >
      <input type="hidden" name="productVariantId" value={productVariantId} />
      <span className="flex flex-wrap items-center gap-1.5 pb-1.5 text-xs text-muted-foreground">
        On hand: {inventory.onHand} · Reserved: {inventory.reserved} · Available: {available}
        {/* The stock state said in words as well as digits: a merchant
            scanning for trouble should not have to compare each number
            against a threshold they are expected to remember, and the
            signal has to survive greyscale. */}
        {available <= 0 ? (
          <StatusBadge status="Out of stock" tone="danger" />
        ) : available <= LOW_STOCK_THRESHOLD ? (
          <StatusBadge status="Low stock" tone="warning" />
        ) : null}
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
  const q = typeof params.q === 'string' ? params.q : '';
  const status = typeof params.status === 'string' ? params.status : '';
  const category = typeof params.category === 'string' ? params.category : '';
  const page = Number(params.page) > 0 ? Math.floor(Number(params.page)) : 1;

  // Name/description/category search + status/category filter + pagination,
  // all applied at the query level — a growing catalog costs the same
  // page-load regardless of how many products a tenant has in total.
  const productWhere = {
    tenantId,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { description: { contains: q, mode: 'insensitive' as const } },
            { category: { is: { name: { contains: q, mode: 'insensitive' as const } } } },
          ],
        }
      : {}),
    ...(status && PRODUCT_STATUSES.includes(status as (typeof PRODUCT_STATUSES)[number])
      ? { status: status as (typeof PRODUCT_STATUSES)[number] }
      : {}),
    ...(category ? { categoryId: category } : {}),
  };

  const [products, productCount, categoryRows] = await Promise.all([
    db.product.findMany({
      where: productWhere,
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        variants: { include: { optionValues: true } },
        media: { orderBy: { sortOrder: 'asc' } },
        category: true,
      },
    }),
    db.product.count({ where: productWhere }),
    db.productCategory.findMany({
      where: { tenantId },
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    }),
  ]);
  const categories = categoryRows;

  // Fetched once here (not via a UI-side loop) purely to avoid an N+1
  // query pattern across products/options in a single page render. All
  // writes still go exclusively through the existing mutation functions
  // via server actions below — this page never writes through `db`
  // directly.
  const variantOptions = await db.variantOption.findMany({
    where: { tenantId },
    orderBy: { name: 'asc' },
  });
  const variantOptionValues = await db.variantOptionValue.findMany({
    where: { tenantId },
    orderBy: { value: 'asc' },
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
  const archivedVariantsByProduct = new Map<string, (typeof products)[number]['variants']>();
  for (const product of products) {
    const archived = product.variants.filter((v) => v.status === 'archived');
    if (archived.length > 0) {
      archivedVariantsByProduct.set(product.id, archived);
    }
  }

  return (
    <div className={adminPageClassName}>
      {/* Products sit on the page canvas, not inside an outer page card:
          each product disclosure is already its own surface, and wrapping
          them in a second card flattened the whole screen into one slab. */}
      <section className="flex flex-col gap-4">
        <AdminPageHeader
          title="Products"
          description="Everything you sell. Open a product to edit its details, variants, stock, media and discount."
          meta={
            <span className={adminEyebrowClassName}>
              {productCount} {productCount === 1 ? 'product' : 'products'}
            </span>
          }
          actions={
            <Link href="/tenant-admin/products/new" className={adminButtonPrimaryClassName}>
              Add a product
            </Link>
          }
        />

        {/* Import and export are related data chores, so they sit together
            in one block rather than as two competing full-width cards —
            and below the catalogue actions, because neither is the thing a
            merchant came here to do. */}
        <details className="rounded-xl bg-surface-muted">
          <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium marker:content-none">
            CSV import and export
          </summary>
          <div className="grid gap-3 px-3 pb-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2 rounded-2xl bg-surface p-4 shadow-sm">
              <h3 className="text-sm font-medium">Import products (CSV)</h3>
              <p className="text-xs text-muted-foreground">
                Simple: name, price, status (optional, defaults to draft). Extended: add sku to
                update existing products by SKU, plus description, category, on_hand and
                inventory_mode. Max 500 rows, 1 MB. Media can be added afterwards from the product
                editor.
              </p>
              <ImportProductsForm
                previewAction={previewProductsImportAction}
                importAction={importProductsAction}
              />
            </div>

            <div className="flex flex-col gap-2 rounded-2xl bg-surface p-4 shadow-sm">
              <h3 className="text-sm font-medium">Export products (CSV)</h3>
              <p className="text-xs text-muted-foreground">
                One row per variant, including drafts and archived variants, with SKU, price, any
                discount and current stock. Opens in Excel with Vietnamese text intact. Contains no
                customer data.
              </p>
              <div className="mt-auto">
                <ExportCsvButton dataset="products" label="products" />
              </div>
            </div>
          </div>
        </details>

        <div className="flex flex-wrap items-end gap-3">
          {/* Search + status/category filters, plain GET form — no client JS, no
            state to lose on refresh, shareable URL. "Add a product" used to
            share this row; it is now the page header's primary action, so
            there is exactly one of it. */}
          <form
            className="flex w-full flex-wrap items-end gap-2"
            method="get"
            aria-label="Search and filter products"
          >
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs sm:flex-none">
              Search
              <input
                type="text"
                name="q"
                defaultValue={q}
                placeholder="Product name"
                className={`w-full sm:w-64 ${adminInputClassName}`}
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
            <label className="flex flex-col gap-1 text-xs">
              Category
              <select name="category" defaultValue={category} className={adminInputClassName}>
                <option value="">All</option>
                {categories.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
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

        <details className="rounded-xl bg-surface-muted">
          <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium marker:content-none">
            Manage product categories ({categories.length})
          </summary>
          <div className="grid gap-3 px-3 pb-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2 rounded-2xl bg-surface p-4 shadow-sm">
              <h3 className="text-sm font-medium">Add a category</h3>
              <ActionForm
                action={createProductCategoryAction}
                submitLabel="Add category"
                successMessage="Category added."
                className="flex flex-col gap-3"
              >
                <label className={adminLabelClassName}>
                  Category name
                  <input name="name" className={adminInputClassName} />
                </label>
              </ActionForm>
            </div>
            <div className="flex flex-col gap-2 rounded-2xl bg-surface p-4 shadow-sm">
              <h3 className="text-sm font-medium">Categories in this store</h3>
              {categories.length === 0 ? (
                <p className="text-xs text-muted-foreground">No categories created yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {categories.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <ActionForm
                          action={updateProductCategoryAction}
                          submitLabel="Save category"
                          submitAriaLabel={`Save category ${item.name}`}
                          successMessage="Category updated."
                          className="flex items-center gap-2"
                        >
                          <input type="hidden" name="categoryId" value={item.id} />
                          <label className="sr-only" htmlFor={`category-${item.id}`}>
                            Category name
                          </label>
                          <input
                            id={`category-${item.id}`}
                            name="name"
                            defaultValue={item.name}
                            className={`min-w-0 flex-1 ${adminInputClassName}`}
                          />
                        </ActionForm>
                        <span className="text-xs text-muted-foreground">
                          {item._count.products} products
                        </span>
                      </div>
                      <ConfirmActionForm
                        action={deleteProductCategoryAction}
                        submitLabel="Delete category"
                        variant="danger"
                        className="flex items-center gap-2"
                        confirmMessage={`Delete the category "${item.name}"? Its ${item._count.products} product${item._count.products === 1 ? '' : 's'} will become uncategorized, not deleted.`}
                      >
                        <input type="hidden" name="categoryId" value={item.id} />
                      </ConfirmActionForm>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                Deleting a category leaves its products uncategorized.
              </p>
            </div>
          </div>
        </details>

        {/* The products table that used to sit here is gone. Its five
            columns — name, status, variant count, price, and an "Open
            below" cell that was not a link — were all repeated by the
            editor disclosures underneath, so every product was rendered
            twice and the table needed a 620px min-width to do it. The
            disclosure summary now carries that same information. */}

        <Pagination
          basePath="/tenant-admin/catalog"
          searchParams={params}
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={productCount}
        />

        <h3 className="sr-only">Product list</h3>
        {/* The checkboxes live inside each product's own row below, not
            inside this form — a <form> cannot contain another <form>, and
            every product row already has its own (Save product, Delete
            product). Each checkbox instead points at this form by id via
            the standard HTML `form` attribute, so one native submit still
            collects every checked productId. */}
        <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-muted px-3 py-2">
          <p className="text-xs text-muted-foreground">
            Tick products below to delete several at once.
          </p>
          <BulkDeleteProductsForm />
        </div>
        <div className="flex flex-col gap-3">
          {products.map((product) => {
            const activeVariants = product.variants.filter((v) => v.status !== 'archived');
            const simpleVariant =
              activeVariants.length === 1 && activeVariants[0].combinationKey === ''
                ? activeVariants[0]
                : null;

            const assignedOptions = productOptionsByProduct.get(product.id) ?? [];
            const assignedOptionIds = new Set(assignedOptions.map((po) => po.variantOptionId));
            const availableOptions = variantOptions.filter((o) => !assignedOptionIds.has(o.id));

            const primaryMedia = product.media[0];
            const summaryPrice = simpleVariant
              ? formatVnd(simpleVariant.price)
              : `${activeVariants.length} variant${activeVariants.length === 1 ? '' : 's'}`;

            return (
              <div key={product.id} className="flex items-start gap-2">
                {/* Outside the <summary>/<details> entirely, so clicking
                    it toggles selection only — not the disclosure too —
                    and outside every per-product <form> below, so it can
                    belong to the bulk-delete form via the `form`
                    attribute instead of nesting forms. */}
                <input
                  type="checkbox"
                  name="productIds"
                  value={product.id}
                  form={BULK_DELETE_PRODUCTS_FORM_ID}
                  aria-label={`Select ${product.name} for bulk deletion`}
                  className="mt-4 ml-3 h-4 w-4 flex-shrink-0 accent-foreground"
                />
                <details className="group min-w-0 flex-1 rounded-2xl bg-surface text-sm shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-muted">
                      {primaryMedia ? (
                        primaryMedia.type === 'image' ? (
                          // eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra, see storefront ProductList.tsx
                          <img
                            src={primaryMedia.url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <video
                            src={primaryMedia.url}
                            muted
                            className="h-full w-full object-cover"
                          />
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-medium">{product.name}</span>
                      {/* A collapsed product says what is inside it: variant
                        count, media count and whether a discount exists —
                        the three things a merchant opens a product to check.
                        Words, not icons, so the summary survives greyscale. */}
                      <span className="text-xs text-muted-foreground">
                        {activeVariants.length} variant{activeVariants.length === 1 ? '' : 's'} ·{' '}
                        {product.media.length} image{product.media.length === 1 ? '' : 's'} ·{' '}
                        {product.category?.name ?? 'Uncategorized'} ·{' '}
                        {discountByProduct.get(product.id) ? 'Discounted' : 'No discount'}
                      </span>
                    </span>
                    <span className="money text-sm font-medium whitespace-nowrap">
                      {summaryPrice}
                    </span>
                    {/* A product with no media is sellable but renders
                      without a picture everywhere a shopper meets it —
                      the list, the detail page, the cart. CSV import
                      allows zero media by design, so this is how a
                      merchant finds those rows after a bulk import
                      instead of discovering them on the storefront. */}
                    {product.media.length === 0 && (
                      <StatusBadge status="Thiếu ảnh" tone="warning" />
                    )}
                    {/* Shared badge, so a draft product reads the same here as
                      everywhere else in the admin. */}
                    <StatusBadge status={product.status} />
                    <span className="text-muted-foreground transition-transform group-open:rotate-90">
                      ›
                    </span>
                  </summary>

                  <div className="flex flex-col gap-6 border-t border-border p-6">
                    <ActionForm
                      action={updateProductAction}
                      // One Server Action persists name, price, status and
                      // description together, so this IS the product-level save
                      // for this editor — named for what it commits rather than
                      // left as a generic "Save" competing with every other
                      // button in the panel.
                      submitLabel="Save product"
                      successMessage="Product saved."
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
                        <label className={productLabelClassName}>
                          Category
                          <select
                            name="categoryId"
                            defaultValue={product.categoryId ?? ''}
                            className={productInputClassName}
                          >
                            <option value="">Uncategorized</option>
                            {categories.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name}
                              </option>
                            ))}
                          </select>
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
                          <DescriptionEditor defaultValue={product.description ?? ''} />
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
                            One discount per product — saving again replaces the current one, never
                            stacks.
                          </p>
                          <ActionForm
                            action={upsertProductDiscountAction}
                            successMessage="Discount saved."
                            submitLabel={discount ? 'Save discount' : 'Add discount'}
                            className="flex flex-wrap items-end gap-2"
                          >
                            <input type="hidden" name="productId" value={product.id} />
                            <label className={adminLabelClassName}>
                              Type
                              <select
                                name="discountType"
                                defaultValue={discount?.discountType ?? 'percentage'}
                                className={`w-28 ${adminInputClassName}`}
                              >
                                <option value="percentage">% off</option>
                                <option value="fixed_amount">₫ off</option>
                              </select>
                            </label>
                            <label className={adminLabelClassName}>
                              Value
                              <input
                                name="discountValue"
                                inputMode="numeric"
                                placeholder={
                                  discount?.discountType === 'fixed_amount' ? '50000' : '10'
                                }
                                defaultValue={discount ? String(discount.discountValue) : ''}
                                className={`w-24 ${adminInputClassName}`}
                              />
                            </label>
                            <div className="flex flex-col gap-1">
                              <span className="text-xs font-medium text-muted-foreground">
                                Starts (optional)
                              </span>
                              <DateTimePicker
                                name="startsAt"
                                defaultValue={discount?.startsAt ?? null}
                                placeholder="No start date"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-xs font-medium text-muted-foreground">
                                Ends (optional)
                              </span>
                              <DateTimePicker
                                name="endsAt"
                                defaultValue={discount?.endsAt ?? null}
                                placeholder="No end date"
                              />
                            </div>
                            <label className="flex items-center gap-2 pb-1.5 text-xs">
                              <input
                                type="checkbox"
                                name="enabled"
                                defaultChecked={discount?.enabled ?? true}
                              />
                              Enabled
                            </label>
                          </ActionForm>
                          {discount && (
                            // Destructive, so it follows the same pattern as
                            // option removal and value deletion: danger
                            // treatment plus a confirmation step. The action,
                            // its payload and its authorization are unchanged —
                            // only a gate in front of the submit.
                            <ConfirmActionForm
                              action={deleteProductDiscountAction}
                              submitLabel="Remove discount"
                              variant="danger"
                              successMessage="Discount removed."
                              confirmMessage="Remove this discount from the product? It will stop applying immediately and customers will pay the full price. You can add a new discount afterwards."
                            >
                              <input type="hidden" name="productId" value={product.id} />
                            </ConfirmActionForm>
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
                              <span>
                                {optionNameById.get(po.variantOptionId) ?? '(unknown option)'}
                              </span>
                              <ConfirmActionForm
                                action={removeProductOptionAction}
                                submitLabel="Remove option"
                                successMessage="Option removed."
                                confirmMessage="Remove this option from the product? Variants generated from it are removed too. This cannot be undone."
                                variant="danger"
                              >
                                <input type="hidden" name="productOptionId" value={po.id} />
                              </ConfirmActionForm>
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
                          successMessage="Option assigned."
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
                          successMessage="Variants generated."
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
                                  <tr
                                    key={variant.id}
                                    className="border-b border-border last:border-0"
                                  >
                                    <td className="py-1.5 pr-2 align-top">
                                      {formatCombination(variant, optionNameById, valueLabelById)}
                                    </td>
                                    <td colSpan={4} className="py-1.5">
                                      <ActionForm
                                        action={updateProductVariantAction}
                                        // A separate Server Action on a separate
                                        // resource (ProductVariant), so this is
                                        // NOT folded into Save product — it is
                                        // labelled for its own scope instead.
                                        submitLabel="Save variant"
                                        // Visible text stays "Save variant"; the
                                        // accessible name carries the row's
                                        // identity, so a screen reader listing
                                        // every button in this table does not
                                        // read one name N times. Built from the
                                        // same human-readable combination shown
                                        // in the adjacent cell — never an id.
                                        submitAriaLabel={`Save variant ${variantContextLabel(
                                          variant,
                                          optionNameById,
                                          valueLabelById,
                                        )}`}
                                        successMessage="Variant saved."
                                        className="flex flex-wrap items-end gap-2"
                                      >
                                        <input
                                          type="hidden"
                                          name="productVariantId"
                                          value={variant.id}
                                        />
                                        <label className={adminLabelClassName}>
                                          SKU
                                          <input
                                            name="sku"
                                            defaultValue={variant.sku ?? ''}
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
                                        <span className="pb-1.5 text-muted-foreground">
                                          {variant.status}
                                        </span>
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
                              Archived variants ({archivedVariantsByProduct.get(product.id)?.length}
                              )
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
                                    <tr
                                      key={variant.id}
                                      className="border-b border-border text-muted-foreground last:border-0"
                                    >
                                      <td className="py-1.5 pr-2">
                                        {formatCombination(variant, optionNameById, valueLabelById)}
                                      </td>
                                      <td className="py-1.5 pr-2">{variant.sku ?? '(none)'}</td>
                                      <td className="py-1.5 pr-2">
                                        {variant.price.toLocaleString('vi-VN')} ₫
                                      </td>
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

                    <div className="flex flex-col gap-2 border-t border-border pt-3">
                      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        Danger zone
                      </h4>
                      <ConfirmActionForm
                        action={deleteProductAction}
                        submitLabel="Delete product"
                        variant="danger"
                        successMessage="Product deleted."
                        confirmMessage={`Delete "${product.name}"? This removes it, its variants, media and stock permanently. A product that has ever been ordered cannot be deleted.`}
                      >
                        <input type="hidden" name="productId" value={product.id} />
                      </ConfirmActionForm>
                    </div>
                  </div>
                </details>
              </div>
            );
          })}
          {products.length === 0 && (
            <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              {q || status || category
                ? 'No products match these filters.'
                : 'No products yet. Add one above, or import a CSV to get started.'}
            </p>
          )}
        </div>
      </section>
      {/* Variant options are store-wide settings, not the catalogue: they
          are configured occasionally and then used by every product, so
          they sit after the products and start collapsed instead of
          opening the page above the thing merchants came for. */}
      <details className={adminPanelClassName}>
        <summary className="cursor-pointer list-none marker:content-none">
          <span className="flex flex-col gap-1">
            <span className={adminPanelTitleClassName}>Variant options</span>
            <span className="text-xs text-muted-foreground">
              Reusable option types (e.g. Color, Size) shared across every product for this store.
            </span>
          </span>
        </summary>

        <ActionForm
          action={createVariantOptionAction}
          successMessage="Option added."
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
              <div
                key={option.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted p-3 text-sm"
              >
                <h3 className="font-medium">{option.name}</h3>
                <div className="flex flex-col gap-1">
                  {values.map((value) => (
                    <div
                      key={value.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5"
                    >
                      <span>{value.value}</span>
                      <ConfirmActionForm
                        action={deleteVariantOptionValueAction}
                        submitLabel="Delete value"
                        successMessage="Option value deleted."
                        confirmMessage="Delete this option value? Any product variant built from it is removed too. This cannot be undone."
                        variant="danger"
                      >
                        <input type="hidden" name="variantOptionValueId" value={value.id} />
                      </ConfirmActionForm>
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
                  successMessage="Value added."
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
            <div className={adminSubtleClassName}>
              <p className={adminPanelTitleClassName}>No variant options yet</p>
              <p className="text-xs text-muted-foreground">
                Add one above — for example Color or Size — then give it values before building
                product variants from it.
              </p>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
