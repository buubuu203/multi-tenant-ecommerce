// Shown automatically while the force-dynamic Platform Admin route
// fetches. Pure skeleton — no data, no auth check — so it is safe to
// render before the layout's authorization has resolved and never leaks
// anything about which tenants exist.
export default function PlatformAdminLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-6">
      <div className="h-40 w-full animate-pulse rounded-lg bg-surface-muted" />
      <div className="flex flex-col gap-3">
        <div className="h-28 w-full animate-pulse rounded-lg bg-surface-muted" />
        <div className="h-28 w-full animate-pulse rounded-lg bg-surface-muted" />
      </div>
    </div>
  );
}
