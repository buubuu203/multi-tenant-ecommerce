import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

// Reads the tenant context resolved by src/proxy.ts (from the verified
// request hostname) and loads the tenant's own data. This header is
// resolved server-side context, not an authorization token — see the
// comment in src/proxy.ts for why that distinction matters.
export async function getCurrentTenant() {
  const headerList = await headers();
  const tenantId = headerList.get("x-tenant-id");

  if (!tenantId) {
    return null;
  }

  return prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { branding: true },
  });
}
