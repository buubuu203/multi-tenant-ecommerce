// Root-level loading UI for the buyer storefront. Every storefront route
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
