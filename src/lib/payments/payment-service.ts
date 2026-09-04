import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getScopedDb } from "@/lib/db/tenant-db";
import { Prisma, type Payment, type PaymentMethod, type PaymentProviderType } from "@/generated/prisma/client";
import type { PaymentProvider, PaymentInstructions } from "./provider";
import { CodProvider } from "./cod-provider";
import { ManualBankTransferProvider } from "./manual-bank-transfer-provider";
import { SePayVirtualAccountProvider } from "./sepay-va-provider";
import { MomoProvider } from "./momo-provider";

const PROVIDERS: Record<PaymentProviderType, PaymentProvider> = {
  cod: new CodProvider(),
  bank_transfer_manual: new ManualBankTransferProvider(),
  bank_transfer_sepay_va: new SePayVirtualAccountProvider(),
  momo: new MomoProvider(),
};

export function getProvider(type: PaymentProviderType): PaymentProvider {
  return PROVIDERS[type];
}

/**
 * The set of PaymentMethod values this tenant has actually enabled AND
 * configured — used to drive the storefront's payment-method selector so
 * a customer never even sees an option the server would reject (the
 * server-side enforcement in createOrder() remains authoritative
 * regardless; this is UX, not the security boundary).
 */
export async function getEnabledPaymentMethods(tenantId: string): Promise<PaymentMethod[]> {
  const rows = await getScopedDb(tenantId).tenantPaymentMethod.findMany({ where: { tenantId, enabled: true } });
  return rows
    .filter((row) => isProviderConfigured(row.provider, row.config as Record<string, unknown> | null))
    .map((row) => row.method);
}

function isProviderConfigured(provider: PaymentProviderType, config: Record<string, unknown> | null): boolean {
  if (provider === "cod") return true;
  if (provider === "bank_transfer_manual") {
    return Boolean(config?.bankName && config?.accountNumber && config?.accountHolder);
  }
  if (provider === "bank_transfer_sepay_va") {
    return Boolean(config?.baUuid);
  }
  if (provider === "momo") {
    // Platform-level credentials (env vars), not per-tenant config — a
    // tenant enabling "momo" is meaningful once the platform has MoMo
    // configured at all; per-tenant "configured" doesn't apply the same
    // way as the bank-transfer providers.
    return true;
  }
  return false;
}

export type CreatePaymentForOrderResult =
  | { success: true; instructions: PaymentInstructions }
  | { success: false; error: string };

/**
 * Resolves which provider backs `method` for this tenant (via
 * TenantPaymentMethod — never trusted from the client), verifies it's
 * both enabled AND has a valid config, calls that provider, and persists
 * the resulting Payment row.
 *
 * Called AFTER createOrder() has already succeeded — same pay-after
 * design as the original Step 48 MVP: the Order and its inventory
 * reservation are never rolled back by anything here.
 *
 * FAILURE BOUNDARY (documented, not distributed-transaction'd — see
 * Phase 3 plan Part 6):
 *   A. Provider call fails (not configured / network / provider rejects):
 *      a Payment row is still created with status "failed" — every order
 *      that reaches this point ends up with a consistent Payment record,
 *      never a silently missing one. No retry is attempted (retrying a
 *      SePay/MoMo POST without a proven-idempotent server-side contract
 *      could create a duplicate remote order) — the customer/merchant see
 *      a clear failure and may retry checkout as a fresh attempt.
 *   B. Provider call succeeds but the local Payment insert throws: this
 *      is the one gap not fully closed in V1 — the remote order/VA now
 *      exists with nothing local pointing at it. Accepted as the
 *      "smallest correct" V1 behavior (per the approved plan) because:
 *      no money has moved yet (the customer hasn't paid), and the
 *      resulting orphaned remote order simply expires/goes nowhere. Not
 *      silently swallowed — the error is thrown and surfaces as a
 *      generic checkout failure, not a false "success".
 *   C. Duplicate checkout submission: mitigated client-side only in V1
 *      (submit button disabled during the "submitting" state, the same
 *      established pattern already used by ActionForm/ProductMediaGallery
 *      elsewhere in this codebase) — a true server-side idempotency key
 *      on Order would be a larger, separate change and is explicitly out
 *      of scope here per "do not over-engineer."
 */
export async function createPaymentForOrder(
  tenantId: string,
  orderId: string,
  method: PaymentMethod,
  amount: number,
  orderInfo: string,
): Promise<CreatePaymentForOrderResult> {
  const db = getScopedDb(tenantId);
  const tenantMethod = await db.tenantPaymentMethod.findUnique({ where: { tenantId_method: { tenantId, method } } });

  if (!tenantMethod || !tenantMethod.enabled) {
    return { success: false, error: "This payment method is not available for this store." };
  }

  const provider = getProvider(tenantMethod.provider);
  const result = await provider.createPayment({
    tenantId,
    orderId,
    amount,
    orderInfo,
    config: (tenantMethod.config as Record<string, unknown> | null) ?? null,
  });

  if (!result.success) {
    await prisma.payment.create({
      data: {
        tenantId,
        orderId,
        status: "failed",
        provider: tenantMethod.provider,
        providerOrderId: `${orderId}-failed-${randomUUID()}`,
        amount,
        failureReason: result.error,
      },
    });
    return { success: false, error: result.error };
  }

  await prisma.payment.create({
    data: {
      tenantId,
      orderId,
      status: "pending",
      provider: tenantMethod.provider,
      providerOrderId: result.providerOrderId,
      amount,
      expiresAt: result.expiresAt,
      providerMetadata: (result.metadata as Prisma.InputJsonValue) ?? undefined,
    },
  });

  return { success: true, instructions: result.instructions };
}

/**
 * Reconstructs display-only PaymentInstructions from an ALREADY-PERSISTED
 * Payment row — used by the order-lookup page (a returning customer
 * checking on a still-pending payment), never during checkout itself.
 * Deliberately makes NO external provider call: a SePay VA's number/QR
 * were already fixed at creation time and are read back from
 * Payment.providerMetadata; a manual bank transfer's details are read
 * from the tenant's CURRENT TenantPaymentMethod.config (so an
 * after-the-fact bank-detail correction is reflected), not a snapshot.
 */
export async function getStoredPaymentInstructions(tenantId: string, payment: Payment): Promise<PaymentInstructions> {
  if (payment.provider === "cod") {
    return { type: "none", nextAction: "Pay in cash when your order arrives." };
  }

  if (payment.provider === "bank_transfer_manual") {
    const tenantMethod = await getScopedDb(tenantId).tenantPaymentMethod.findUnique({
      where: { tenantId_method: { tenantId, method: "bank_transfer" } },
    });
    const config = (tenantMethod?.config as { bankName?: string; accountNumber?: string; accountHolder?: string } | null) ?? null;
    if (!config?.bankName || !config.accountNumber || !config.accountHolder) {
      return { type: "none", nextAction: "Contact the store directly for payment instructions." };
    }
    return {
      type: "bank_transfer",
      title: "Transfer to:",
      amount: payment.amount,
      currency: "VND",
      bankName: config.bankName,
      accountNumber: config.accountNumber,
      accountHolder: config.accountHolder,
      nextAction: "Please include your order ID as the transfer note.",
    };
  }

  if (payment.provider === "bank_transfer_sepay_va") {
    const metadata = (payment.providerMetadata as { vaNumber?: string; qrCodeUrl?: string } | null) ?? null;
    if (!metadata?.vaNumber) {
      return { type: "none", nextAction: "Contact the store directly for payment instructions." };
    }
    return {
      type: "bank_transfer",
      title: "Transfer to:",
      amount: payment.amount,
      currency: "VND",
      virtualAccountNumber: metadata.vaNumber,
      qrCodeUrl: metadata.qrCodeUrl ?? undefined,
      expiresAt: payment.expiresAt ? payment.expiresAt.toISOString() : undefined,
      nextAction: "Scan the QR code or transfer the exact amount to the virtual account number above.",
    };
  }

  // momo: any redirect URL captured at creation time is short-lived and
  // very likely stale by the time a customer returns to look this order
  // up later — showing a plain status message is more honest than a
  // probably-dead link.
  return {
    type: "none",
    nextAction:
      payment.status === "succeeded"
        ? "Payment received via MoMo."
        : payment.status === "pending"
          ? "If you haven't completed payment yet, please check out again to get a fresh MoMo payment link."
          : "MoMo payment was not completed.",
  };
}
