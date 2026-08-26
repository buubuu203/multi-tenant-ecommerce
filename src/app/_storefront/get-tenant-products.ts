import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

// Same pattern as get-current-tenant.ts: reads the trusted x-tenant-id
// header (resolved by src/proxy.ts from the verified request hostname) and
// queries the plain prisma client with an explicit tenantId filter. Not
// getScopedDb() — the storefront only ever handles the single
// hostname-resolved tenant, so there is no "other tenant" reachable from
// this code path in the first place (same reasoning as get-current-tenant.ts).
export async function getTenantProducts() {
  const headerList = await headers();
  const tenantId = headerList.get("x-tenant-id");

  if (!tenantId) {
    return [];
  }

  return prisma.product.findMany({
    where: { tenantId, status: "active" },
    orderBy: { createdAt: "asc" },
  });
}
