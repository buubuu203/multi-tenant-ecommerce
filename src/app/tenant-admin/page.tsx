import { requireTenantAdmin } from "@/lib/auth/require-tenant-admin";
import { getScopedDb } from "@/lib/db/tenant-db";
import { ActionForm } from "@/components/ActionForm";
import { updateBrandingAction, createProductAction, updateProductAction, importProductsAction } from "./actions";
import { ImportProductsForm } from "./ImportProductsForm";

const PRODUCT_STATUSES = ["draft", "active"] as const;

export const dynamic = "force-dynamic";

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
    include: { variants: true },
  });

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
        <h2 className="text-lg font-medium">Products</h2>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Import Products (CSV)</h3>
          <p className="text-xs text-black/60 dark:text-white/60">
            Columns: name, price, status (optional, defaults to draft). Max 500 rows, 1 MB.
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
            // Simple-product path only (no options yet) — every product
            // created via createProduct() has exactly one variant with
            // combinationKey === "", the same sentinel product-mutations.ts
            // and the v4.1 migration backfill both use to mean "the" variant.
            const simpleVariant = product.variants.find((v) => v.combinationKey === "");

            return (
              <ActionForm
                key={product.id}
                action={updateProductAction}
                submitLabel="Save"
                className="flex flex-wrap items-end gap-2 rounded border p-3 text-sm"
              >
                <input type="hidden" name="productId" value={product.id} />
                <label className="flex flex-col gap-1">
                  Name
                  <input name="name" defaultValue={product.name} className="rounded border px-2 py-1" />
                </label>
                <label className="flex flex-col gap-1">
                  Price (VND)
                  <input
                    name="price"
                    inputMode="numeric"
                    defaultValue={simpleVariant ? String(simpleVariant.price) : ""}
                    className="rounded border px-2 py-1"
                  />
                </label>
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
              </ActionForm>
            );
          })}
          {products.length === 0 && (
            <p className="text-sm text-black/60 dark:text-white/60">No products yet.</p>
          )}
        </div>
      </section>
    </main>
  );
}
