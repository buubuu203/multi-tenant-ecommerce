import { platformDb } from "./db/platform-db";
import { normalizeSlug } from "./validation/slug";
import { Prisma } from "@/generated/prisma/client";

export type { ActionResult } from "./action-result";
import type { ActionResult } from "./action-result";

const VALID_STATUSES = ["pending", "active", "suspended", "archived"] as const;
type TenantStatusInput = (typeof VALID_STATUSES)[number];

function isP2002(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Creates a Tenant and its initial primary subdomain atomically — both
 * rows commit together or neither does. The hostname is always derived
 * from the already-normalized slug, never taken directly from user input.
 */
export async function createTenant(input: {
  name: string;
  slug: string;
}): Promise<ActionResult<{ tenantId: string; slug: string; hostname: string }>> {
  const name = input.name.trim();
  const slug = normalizeSlug(input.slug);

  if (!name) {
    return { success: false, error: "Name is required." };
  }
  if (!slug) {
    return { success: false, error: "Slug is required and must contain at least one letter or number." };
  }

  const hostname = `${slug}.localhost`;

  try {
    const tenant = await platformDb.$transaction(async (tx) => {
      const createdTenant = await tx.tenant.create({
        data: { name, slug, status: "pending" },
      });
      await tx.domain.create({
        data: { tenantId: createdTenant.id, hostname, type: "subdomain", isPrimary: true },
      });
      return createdTenant;
    });

    return { success: true, data: { tenantId: tenant.id, slug: tenant.slug, hostname } };
  } catch (e) {
    if (isP2002(e)) {
      return { success: false, error: "This slug is already taken." };
    }
    console.error("createTenant failed:", e);
    return { success: false, error: "Something went wrong creating the tenant." };
  }
}

export async function updateTenantName(tenantId: string, rawName: string): Promise<ActionResult> {
  const name = rawName.trim();
  if (!name) {
    return { success: false, error: "Name is required." };
  }

  try {
    await platformDb.tenant.update({ where: { id: tenantId }, data: { name } });
    return { success: true, data: undefined };
  } catch (e) {
    console.error("updateTenantName failed:", e);
    return { success: false, error: "Something went wrong updating the tenant." };
  }
}

export async function updateTenantStatus(tenantId: string, rawStatus: string): Promise<ActionResult> {
  if (!VALID_STATUSES.includes(rawStatus as TenantStatusInput)) {
    return { success: false, error: "Invalid status." };
  }

  try {
    await platformDb.tenant.update({
      where: { id: tenantId },
      data: { status: rawStatus as TenantStatusInput },
    });
    return { success: true, data: undefined };
  } catch (e) {
    console.error("updateTenantStatus failed:", e);
    return { success: false, error: "Something went wrong updating status." };
  }
}
