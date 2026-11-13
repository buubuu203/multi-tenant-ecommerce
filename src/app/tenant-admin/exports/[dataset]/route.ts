import { requireTenantAdmin, NotTenantAdminError } from "@/lib/auth/require-tenant-admin";
import { toCsv, csvFilename } from "@/lib/csv";
import { buildCustomersExport } from "@/lib/exports/customers-export";
import { buildProductsExport } from "@/lib/exports/products-export";
import { buildOrdersExport } from "@/lib/exports/orders-export";

/**
 * Tenant-scoped CSV export download.
 *
 * Deliberately lives under /tenant-admin/ and NOT under /api/: src/proxy.ts
 * treats /api as a platform route and bypasses tenant hostname resolution
 * entirely (see platform-routes.ts), so an /api handler would receive no
 * x-tenant-id and could not be tenant-scoped at all. Under /tenant-admin/
 * the proxy resolves the tenant from the verified Host header exactly as it
 * does for the admin pages.
 *
 * This is NOT a public download URL. A route handler gets no layout, so it
 * performs its own requireTenantAdmin() — the same two-step check every
 * admin page and Server Action runs — before reading anything. An
 * unauthenticated request is redirected to sign-in by that helper; a
 * signed-in user who is not this store's admin gets 404, which is also
 * what a request for an unknown dataset gets, so probing cannot
 * distinguish "wrong dataset" from "not your store".
 *
 * Nothing is persisted: the CSV is generated per request and streamed back
 * in the response body. There is no temporary file and no blob storage, so
 * an export cannot outlive the request that asked for it.
 */
export const dynamic = "force-dynamic";

/**
 * The only exportable datasets. An allowlist, so the [dataset] path segment
 * can never select anything but these three — it is never interpolated into
 * a query, a model name or a filename beyond this lookup.
 *
 * `customers` was previously absent because order count and order value
 * would have required inventing a definition. Both are now defined once in
 * customer-queries.ts and reused by the screen and this export alike, so
 * the two cannot disagree. It carries PII, and the UI warns before
 * download.
 */
const DATASETS = {
  products: { build: buildProductsExport, label: "products" },
  orders: { build: buildOrdersExport, label: "orders" },
  customers: { build: buildCustomersExport, label: "customers" },
} as const;

type DatasetKey = keyof typeof DATASETS;

function isDataset(value: string): value is DatasetKey {
  return Object.prototype.hasOwnProperty.call(DATASETS, value);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ dataset: string }> },
): Promise<Response> {
  const { dataset } = await params;

  // Authorization BEFORE any read, and before the dataset is even resolved,
  // so an unauthorized caller cannot learn which datasets exist.
  let tenantId: string;
  try {
    ({ tenantId } = await requireTenantAdmin());
  } catch (e) {
    if (e instanceof NotTenantAdminError) {
      // 404, not 403: a signed-in user who is not this store's admin learns
      // nothing about whether the route or the store exists.
      return new Response("Not found", { status: 404 });
    }
    // Anything else is Next.js's own redirect signal from redirectToSignIn().
    throw e;
  }

  if (!isDataset(dataset)) {
    return new Response("Not found", { status: 404 });
  }

  const { build, label } = DATASETS[dataset];
  // Every builder takes the trusted tenantId and queries with it; none of
  // them accepts a tenant from the request.
  const table = await build(tenantId);
  const body = toCsv(table.headers, table.rows);

  // Filename is composed server-side from the fixed dataset label plus a
  // date. No tenant id, no hostname, no secret, and nothing
  // client-supplied — csvFilename() also strips anything that could break
  // out of the header value.
  const filename = csvFilename(label);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // An export reflects data as of this request and must never be
      // served from a shared or browser cache to a later request, which
      // could be a different admin or a different tenant on this origin.
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
