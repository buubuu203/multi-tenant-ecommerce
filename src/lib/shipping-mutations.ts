import { getScopedDb } from "./db/tenant-db";
import { Prisma } from "@/generated/prisma/client";
import type { ActionResult } from "./action-result";

// Same shared-tx typing pattern as inventory-mutations.ts's ScopedTx.
type ScopedDb = ReturnType<typeof getScopedDb>;
type ScopedTx = Parameters<Parameters<ScopedDb["$transaction"]>[0]>[0];

export type ShippingMethodInput = {
  name: string;
  amount: string; // whole VND, same string-from-form-field convention as ProductInput.price
  enabled: boolean;
  isDefault: boolean;
};

// Same validation idiom as product-mutations.ts's validateProductInput —
// whole non-negative integer only, no decimals (this codebase has no
// currency subunit concept, V1 is Vietnam-only VND).
function validateShippingMethodInput(
  input: ShippingMethodInput,
): { name: string; amount: number; enabled: boolean; isDefault: boolean } | { error: string } {
  const name = input.name.trim();
  if (!name) {
    return { error: "Name is required." };
  }

  if (!/^\d+$/.test(input.amount.trim())) {
    return { error: "Amount must be a whole number of VND (no decimals)." };
  }
  const amount = Number(input.amount.trim());
  if (!Number.isSafeInteger(amount) || amount < 0) {
    return { error: "Amount must be a non-negative whole number." };
  }

  return { name, amount, enabled: input.enabled, isDefault: input.isDefault };
}

/**
 * Unsets isDefault on every OTHER shipping method for this tenant, inside
 * the same transaction as the create/update that's about to set it on
 * one. This is the normal-case enforcement of "at most one default per
 * tenant" — a database-level partial unique index
 * (tenant_shipping_methods_one_default_per_tenant, see the Shipping V1
 * migration) is the hard backstop against two genuinely concurrent
 * requests both committing a default; see the doc comment on
 * TenantShippingMethod in schema.prisma.
 *
 * MUST be called BEFORE the create/update that sets the target row's own
 * isDefault to true (not after) — a unique index is checked per
 * statement, not deferred to end-of-transaction, so setting a new
 * default while an old one still has isDefault = true would itself
 * violate the constraint even inside the same transaction that's about
 * to clear it.
 */
async function clearOtherDefaults(tx: ScopedTx, tenantId: string, exceptId: string | null): Promise<void> {
  await tx.tenantShippingMethod.updateMany({
    where: exceptId ? { tenantId, isDefault: true, id: { not: exceptId } } : { tenantId, isDefault: true },
    data: { isDefault: false },
  });
}

/**
 * Creates a new shipping method for this tenant. tenantId must be the
 * trusted value from requireTenantAdmin() — never accepted from form
 * input, same rule as every other Tenant Admin mutation in this codebase.
 * Starts disabled unless the merchant explicitly checks "Enabled" on the
 * create form — mirrors how a new Product starts as `draft` until
 * deliberately published, so a half-configured method never surfaces at
 * checkout.
 */
export async function createShippingMethod(tenantId: string, input: ShippingMethodInput): Promise<ActionResult> {
  const validated = validateShippingMethodInput(input);
  if ("error" in validated) {
    return { success: false, error: validated.error };
  }

  const db = getScopedDb(tenantId);
  try {
    await db.$transaction(async (tx) => {
      // Clear BEFORE create — see clearOtherDefaults()'s doc comment for
      // why the order matters now that a partial unique index exists.
      // The new row doesn't exist yet, so there's no id to exempt.
      if (validated.isDefault) {
        await clearOtherDefaults(tx, tenantId, null);
      }
      await tx.tenantShippingMethod.create({
        data: {
          tenantId,
          name: validated.name,
          amount: validated.amount,
          enabled: validated.enabled,
          isDefault: validated.isDefault,
        },
      });
    });
    return { success: true, data: undefined };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // Expected under genuine concurrency (see clearOtherDefaults' doc
      // comment) — another request set a default between this one's
      // clear step and its create step. Not a bug; the customer/merchant
      // just needs to retry, same posture as any other "someone else
      // just changed this" conflict.
      return { success: false, error: "Another update just changed the default shipping method — please try again." };
    }
    console.error("createShippingMethod failed:", e);
    return { success: false, error: "Something went wrong creating the shipping method." };
  }
}

/**
 * Updates an existing shipping method's name/amount/enabled/isDefault.
 * `methodId` is scoped under getScopedDb(tenantId) — a methodId belonging
 * to another tenant matches no row (the extension merges tenantId into
 * `where`), surfaced as a clean "not found" rather than a raw Prisma
 * error or, worse, a cross-tenant write.
 */
export async function updateShippingMethod(
  tenantId: string,
  methodId: string,
  input: ShippingMethodInput,
): Promise<ActionResult> {
  const validated = validateShippingMethodInput(input);
  if ("error" in validated) {
    return { success: false, error: validated.error };
  }

  const db = getScopedDb(tenantId);
  try {
    await db.$transaction(async (tx) => {
      // Clear BEFORE update — see clearOtherDefaults()'s doc comment.
      // Safe to run even before confirming methodId exists/belongs to
      // this tenant: if the update below finds no matching row, the
      // whole transaction (including this clear) rolls back.
      if (validated.isDefault) {
        await clearOtherDefaults(tx, tenantId, methodId);
      }
      const result = await tx.tenantShippingMethod.updateMany({
        where: { id: methodId, tenantId },
        data: {
          name: validated.name,
          amount: validated.amount,
          enabled: validated.enabled,
          isDefault: validated.isDefault,
        },
      });
      if (result.count === 0) {
        throw new Error("Shipping method not found.");
      }
    });
    return { success: true, data: undefined };
  } catch (e) {
    if (e instanceof Error && e.message === "Shipping method not found.") {
      return { success: false, error: e.message };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // Expected under genuine concurrency — see createShippingMethod's
      // identical handling above.
      return { success: false, error: "Another update just changed the default shipping method — please try again." };
    }
    console.error("updateShippingMethod failed:", e);
    return { success: false, error: "Something went wrong updating the shipping method." };
  }
}

/**
 * Deletes a shipping method. No reassignment of isDefault to another
 * method happens here — getEnabledShippingMethods()/checkout already
 * treat "no enabled method is currently the default" as "no method is
 * pre-selected," which is sufficient per the approved design (see
 * shipping-service.ts) without needing extra reassignment logic here.
 * Deleting the current default is therefore safe and requires no special
 * case. Historical Orders are never affected — Order.shippingMethodName
 * is a snapshot, never a live reference to this row (see schema.prisma).
 */
export async function deleteShippingMethod(tenantId: string, methodId: string): Promise<ActionResult> {
  const db = getScopedDb(tenantId);
  try {
    const result = await db.tenantShippingMethod.deleteMany({ where: { id: methodId, tenantId } });
    if (result.count === 0) {
      return { success: false, error: "Shipping method not found." };
    }
    return { success: true, data: undefined };
  } catch (e) {
    console.error("deleteShippingMethod failed:", e);
    return { success: false, error: "Something went wrong deleting the shipping method." };
  }
}
