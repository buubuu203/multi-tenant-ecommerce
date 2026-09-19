import Link from "next/link";

// Shared by Catalog and Orders — plain <Link>s carrying every current
// query param forward except `page`, so switching pages never silently
// drops an active search/status filter. No client JS needed.
export function Pagination({
  basePath,
  searchParams,
  page,
  pageSize,
  totalCount,
}: {
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  page: number;
  pageSize: number;
  totalCount: number;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  if (totalPages <= 1) return null;

  function hrefFor(targetPage: number): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === "page" || value === undefined) continue;
      if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
      else params.set(key, value);
    }
    params.set("page", String(targetPage));
    return `${basePath}?${params.toString()}`;
  }

  return (
    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>
        Page {page} of {totalPages} · {totalCount} total
      </span>
      <div className="flex gap-1">
        <Link
          href={hrefFor(Math.max(1, page - 1))}
          aria-disabled={page <= 1}
          className={`rounded-md border border-border px-2.5 py-1 transition-colors ${
            page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-surface-muted hover:text-foreground"
          }`}
        >
          ‹ Prev
        </Link>
        <Link
          href={hrefFor(Math.min(totalPages, page + 1))}
          aria-disabled={page >= totalPages}
          className={`rounded-md border border-border px-2.5 py-1 transition-colors ${
            page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-surface-muted hover:text-foreground"
          }`}
        >
          Next ›
        </Link>
      </div>
    </div>
  );
}
