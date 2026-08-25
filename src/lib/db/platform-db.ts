import { prisma } from "../prisma";

/**
 * Explicit database access for Platform Admin — the ONLY code path allowed
 * to intentionally read/write across multiple tenants at once.
 *
 * This is the exact same underlying connection as `prisma`; the separate
 * name exists purely so cross-tenant access is visible in a diff/code
 * review, not because the connection or safety guarantees differ.
 *
 * Import this only from Platform Admin route/action code. Tenant-facing
 * feature code must use getScopedDb(tenantId) from ./tenant-db instead —
 * new application/admin feature code should not import src/lib/prisma.ts
 * directly.
 */
export const platformDb = prisma;
