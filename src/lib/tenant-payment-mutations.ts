import { getScopedDb } from "./db/tenant-db";
import type { PaymentMethod, PaymentProviderType } from "@/generated/prisma/client";
import type { ActionResult } from "./action-result";

function trimToNull(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

export type TenantPaymentMethodInput = {
  method: PaymentMethod;
  provider: PaymentProviderType;
  enabled: boolean;
  // Provider-shaped, validated per-provider below — never a raw secret;
  // SePay's actual API token stays in a platform-level env var, only the
  // tenant's own bank-account UUID lives here.
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountHolder?: string;
  sepayBaUuid?: string;
};

/**
 * Updates (or creates) the calling tenant's TenantPaymentMethod row for
 * one PaymentMethod. tenantId must be the trusted value from
 * requireTenantAdmin() — never accepted from form input, same rule as
 * every other Tenant Admin mutation in this codebase.
 */
export async function updateTenantPaymentMethod(tenantId: string, input: TenantPaymentMethodInput): Promise<ActionResult> {
  let config: Record<string, string> | null = null;

  if (input.provider === "bank_transfer_manual") {
    const bankName = trimToNull(input.bankName ?? "");
    const bankAccountNumber = trimToNull(input.bankAccountNumber ?? "");
    const bankAccountHolder = trimToNull(input.bankAccountHolder ?? "");
    if (input.enabled && (!bankName || !bankAccountNumber || !bankAccountHolder)) {
      return { success: false, error: "Bank name, account number, and account holder are all required to enable manual bank transfer." };
    }
    config = { bankName: bankName ?? "", accountNumber: bankAccountNumber ?? "", accountHolder: bankAccountHolder ?? "" };
  } else if (input.provider === "bank_transfer_sepay_va") {
    const baUuid = trimToNull(input.sepayBaUuid ?? "");
    if (input.enabled && !baUuid) {
      return { success: false, error: "A SePay bank account UUID is required to enable SePay virtual accounts." };
    }
    config = { baUuid: baUuid ?? "" };
  }

  try {
    const db = getScopedDb(tenantId);
    await db.tenantPaymentMethod.upsert({
      where: { tenantId_method: { tenantId, method: input.method } },
      create: { tenantId, method: input.method, provider: input.provider, enabled: input.enabled, config: config ?? undefined },
      update: { provider: input.provider, enabled: input.enabled, config: config ?? undefined },
    });
    return { success: true, data: undefined };
  } catch (e) {
    console.error("updateTenantPaymentMethod failed:", e);
    return { success: false, error: "Something went wrong saving payment settings." };
  }
}
