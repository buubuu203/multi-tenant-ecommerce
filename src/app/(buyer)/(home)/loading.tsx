// Loading UI for the storefront HOME route only.
//
// This lives in its own nested (home) route group, one level inside the
// shared (buyer) group that now also holds /products/[productId] and
// /orders (see (buyer)/layout.tsx for the header/footer those three
// share). A loading.tsx creates a Suspense boundary for its whole
// subtree, and the response starts streaming the moment that fallback
// renders — after which the HTTP status is already committed as 200 and
// cannot be changed. If this file sat at the shared (buyer) root instead,
// it would cover /products/[productId] too, and a nonexistent or
// cross-tenant product's notFound() could only ever be a soft 404.
//
// Route groups do not affect URLs, so "/" still renders page.tsx beside
// this file and keeps its skeleton, while /products/* and /orders sit in
// sibling segments under (buyer) and are NOT inside this Suspense
// boundary, so they can still return a real 404. The skeleton is shaped
// like this page specifically (hero band over a product grid), so it was
// the wrong fallback for those routes regardless. Every storefront route
// is dynamic (hostname-resolved tenant + live catalog), so without this a
// customer saw a blank page during navigation.
//
// Shaped to match the storefront's actual layout — a wide hero band above
// a product grid — so the transition reads as "this page is arriving"
// rather than as an unrelated spinner screen.
export default function StorefrontLoading() {
  return (
    <main aria-busy="true" aria-label="Loading" className="flex flex-1 flex-col">
      <div className="aspect-video w-full animate-pulse bg-surface-muted" />
      <div className="flex flex-col gap-4 px-6 py-12 sm:py-16">
        <div className="h-6 w-32 animate-pulse rounded bg-surface-muted" />
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="flex flex-col gap-2">
              <div className="aspect-square w-full animate-pulse rounded-lg bg-surface-muted" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-surface-muted" />
              <div className="h-4 w-1/3 animate-pulse rounded bg-surface-muted" />
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
