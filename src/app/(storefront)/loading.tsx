// Loading UI for the storefront HOME route only.
//
// This deliberately lives inside the (storefront) route group rather than
// at src/app/, which is where it used to sit. A loading.tsx creates a
// Suspense boundary for its whole subtree, and the response starts
// streaming the moment that fallback renders — after which the HTTP status
// is already committed as 200 and cannot be changed. At the root it
// therefore covered /products/[productId], so a nonexistent or
// cross-tenant product called notFound() but could only ever be a soft 404.
//
// Route groups do not affect URLs, so "/" still renders page.tsx beside
// this file and keeps its skeleton, while /products/* and /orders are no
// longer inside any Suspense boundary and can return a real 404. The
// skeleton is shaped like this page specifically (hero band over a product
// grid), so it was the wrong fallback for those routes regardless. Every storefront route
// is dynamic (hostname-resolved tenant + live catalog), so without this a
// customer saw a blank page during navigation.
//
// Shaped to match the storefront's actual layout — a wide hero band above
// a product grid — so the transition reads as "this page is arriving"
// rather than as an unrelated spinner screen.
export default function StorefrontLoading() {
  return (
    <main aria-busy="true" aria-label="Loading" className="flex flex-1 flex-col">
      <div className="aspect-[4/3] w-full animate-pulse bg-surface-muted sm:aspect-[21/9]" />
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
