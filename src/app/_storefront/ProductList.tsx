import type { TenantProduct } from "./get-tenant-products";

function formatVnd(price: number): string {
  return `${price.toLocaleString("vi-VN")} ₫`;
}

export function ProductList({ products }: { products: TenantProduct[] }) {
  if (products.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3 px-6 py-12">
      <h2 className="text-lg font-medium">Products</h2>
      <ul className="flex flex-col gap-2">
        {products.map((product) => {
          // Simple-product path only (no options yet) — every product has
          // exactly one variant with combinationKey === "", the same
          // sentinel product-mutations.ts and the v4.1 migration backfill
          // both use to mean "the" variant.
          const simpleVariant = product.variants.find((variant) => variant.combinationKey === "");

          return (
            <li key={product.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span>{product.name}</span>
              <span className="font-mono">{simpleVariant ? formatVnd(simpleVariant.price) : "—"}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
