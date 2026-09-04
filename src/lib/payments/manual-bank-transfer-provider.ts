import { randomUUID } from "crypto";
import type { PaymentProvider, CreatePaymentParams, CreatePaymentResult, WebhookResult } from "./provider";

type ManualBankTransferConfig = {
  bankName?: string;
  accountNumber?: string;
  accountHolder?: string;
};

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
