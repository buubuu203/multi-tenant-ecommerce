// Next.js's App Router shows this automatically while any /tenant-admin/*
// Server Component route (all of which are `force-dynamic` and do real DB
// queries) is fetching, replacing what would otherwise be a blank page
// during navigation. Pure skeleton — no data, no auth check, no
// tenant-specific content — so it's safe to render before requireTenantAdmin()
// even runs, and never leaks anything about the tenant being loaded.
export default function TenantAdminLoading() {
  return (
    <section aria-busy="true" aria-label="Loading" className="flex flex-col gap-4">
      <div className="h-6 w-40 animate-pulse rounded bg-surface-muted" />
      <div className="flex flex-col gap-2">
        <div className="h-10 w-full animate-pulse rounded-lg bg-surface-muted" />
        <div className="h-10 w-full animate-pulse rounded-lg bg-surface-muted" />
        <div className="h-10 w-full animate-pulse rounded-lg bg-surface-muted" />
      </div>
    </section>
  );
}
