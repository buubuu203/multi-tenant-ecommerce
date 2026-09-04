import { randomUUID } from "crypto";
import type { PaymentProvider, CreatePaymentParams, CreatePaymentResult, WebhookResult } from "./provider";

type ManualBankTransferConfig = {
  bankName?: string;
  accountNumber?: string;
  accountHolder?: string;
};

// VietQR's public "quick link" image API (developer.vietqr.io) — no
// account, auth, or SePay Enterprise-tier requirement, unlike Order VA v2.
// Renders a scannable QR pre-filled with amount/recipient for any
// NAPAS-member Vietnamese bank, keyed by the bank's short name (e.g.
// "VietinBank", "BIDV") rather than a BIN/SWIFT code, matching what
// tenants already enter as plain text in Payments settings. The transfer
// note reuses the same hyphen-stripped order id pattern as SePay's
// order_code (img.vietqr.io's addInfo rejects special characters).
export function buildManualTransferQrUrl(
  bankName: string,
  accountNumber: string,
  accountHolder: string,
  amount: number,
  orderId: string,
): string {
  const bankCode = encodeURIComponent(bankName.replace(/\s+/g, "").toLowerCase());
  const account = encodeURIComponent(accountNumber);
  const addInfo = encodeURIComponent(orderId.replace(/-/g, ""));
  const holder = encodeURIComponent(accountHolder);
  return `https://img.vietqr.io/image/${bankCode}-${account}-compact2.png?amount=${amount}&addInfo=${addInfo}&accountName=${holder}`;
}

// Step 51: kept as a PERMANENT fallback (per correction #7) — a tenant
// without a SePay-supported bank, or who simply doesn't want the
// integration, can still accept bank transfers. No webhook, no
// reconciliation: the merchant confirms payment manually, same posture
// as cod. Never transitions Payment.status itself.
export class ManualBankTransferProvider implements PaymentProvider {
  readonly type = "bank_transfer_manual" as const;

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const config = (params.config ?? {}) as ManualBankTransferConfig;
    const providerOrderId = `${params.orderId}-manual-${randomUUID()}`;

    if (!config.bankName || !config.accountNumber || !config.accountHolder) {
      return { success: false, error: "Bank transfer is not fully configured for this store." };
    }

    return {
      success: true,
      providerOrderId,
      expiresAt: null,
      metadata: null,
      instructions: {
        type: "bank_transfer",
        title: "Transfer to:",
        amount: params.amount,
        currency: "VND",
        bankName: config.bankName,
        accountNumber: config.accountNumber,
        accountHolder: config.accountHolder,
        qrCodeUrl: buildManualTransferQrUrl(config.bankName, config.accountNumber, config.accountHolder, params.amount, params.orderId),
        nextAction:
          "Please include your order ID as the transfer note, then wait for the merchant to confirm your order.",
      },
    };
  }

  async handleWebhook(): Promise<WebhookResult> {
    return { success: false, error: "bank_transfer_manual does not receive webhooks." };
  }

  async cancelPayment(): Promise<void> {
    // No external state to cancel.
  }
}
