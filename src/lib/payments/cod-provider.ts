import { randomUUID } from "crypto";
import type { PaymentProvider, CreatePaymentParams, CreatePaymentResult, WebhookResult } from "./provider";

// Step 51: no external call, no gateway. Payment.status stays "pending"
// indefinitely by design — per the approved correction, COD does not get
// a fake "not applicable" status. A later, separately-designed feature
// may let the merchant mark cash-collected orders as succeeded; this
// provider does not invent that transition itself.
export class CodProvider implements PaymentProvider {
  readonly type = "cod" as const;

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const providerOrderId = `${params.orderId}-cod-${randomUUID()}`;
    return {
      success: true,
      providerOrderId,
      expiresAt: null,
      metadata: null,
      instructions: {
        type: "none",
        nextAction: "Pay in cash when your order arrives.",
      },
    };
  }

  async handleWebhook(): Promise<WebhookResult> {
    return { success: false, error: "cod does not receive webhooks." };
  }

  async cancelPayment(): Promise<void> {
    // No external state to cancel.
  }
}
