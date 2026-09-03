import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantProduct } from "../../_storefront/get-tenant-products";
import { ProductRow } from "../../_storefront/ProductList";
import { CartProvider } from "../../_storefront/cart-context";
import { CartWidget } from "../../_storefront/CartWidget";

// This page's content depends on the request's hostname (resolved by
// src/proxy.ts into the x-tenant-id header), same as the storefront home
// page — force dynamic rendering for the same tenant-isolation reason.
export const dynamic = "force-dynamic";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const product = await getTenantProduct(productId);

  // getTenantProduct() returns null uniformly for "doesn't exist", "wrong
  // tenant", and "draft" — notFound() renders src/app/products/not-found.tsx,
  // a real HTTP 404, without ever revealing which case occurred.
  if (!product) {
    notFound();
  }

  // Same "flat id -> available map, built once from already-fetched data"
  // pattern as src/app/page.tsx — CartWidget has no other access to
  // inventory data.
  const availabilityByVariant = Object.fromEntries(product.variants.map((variant) => [variant.id, variant.available]));

  return (
    <CartProvider>
      <div className="flex flex-1 flex-col">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-background/80 px-6 py-3 backdrop-blur-sm">
          <Link href="/" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            ← Back to store
          </Link>
          <CartWidget availabilityByVariant={availabilityByVariant} />
        </div>
        <main className="px-6 py-10 sm:py-14">
          <ul className="mx-auto max-w-md">
            <ProductRow product={product} linkToDetail={false} />
          </ul>
        </main>
      </div>
    </CartProvider>
  );
}
