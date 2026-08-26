import type { Product } from "@/generated/prisma/client";

function formatVnd(price: number): string {
  return `${price.toLocaleString("vi-VN")} ₫`;
}

export function ProductList({ products }: { products: Product[] }) {
  if (products.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3 px-6 py-12">
      <h2 className="text-lg font-medium">Products</h2>
      <ul className="flex flex-col gap-2">
        {products.map((product) => (
          <li key={product.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
            <span>{product.name}</span>
            <span className="font-mono">{formatVnd(product.price)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
