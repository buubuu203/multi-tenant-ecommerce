import { getScopedDb } from "./db/tenant-db";

export type BankTransferInfo = {
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
};

/**
 * Reads the calling tenant's configured bank transfer instructions (see
 * Tenant Admin's Branding form) — only ever shown to a customer who chose
 * paymentMethod = "bank_transfer" (checkout-actions.ts, order-queries.ts).
 * Returns null unless ALL THREE fields are set — partial instructions
 * (e.g. an account number with no bank name) would be actively misleading
 * to show a customer, so this is all-or-nothing.
 */
export async function getBankTransferInfo(tenantId: string): Promise<BankTransferInfo | null> {
  const db = getScopedDb(tenantId);
  const branding = await db.branding.findUnique({ where: { tenantId } });
  if (!branding?.bankName || !branding.bankAccountNumber || !branding.bankAccountHolder) {
    return null;
  }
  return {
    bankName: branding.bankName,
    bankAccountNumber: branding.bankAccountNumber,
    bankAccountHolder: branding.bankAccountHolder,
  };
}
