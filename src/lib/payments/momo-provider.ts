import { initiateMomoPayment, verifyMomoIpnSignature, type MomoIpnPayload } from "@/lib/momo";
import type { PaymentProvider, CreatePaymentParams, CreatePaymentResult, WebhookResult } from "./provider";

// Step 51: thin wrapper only — momo.ts's request/signature logic is
// UNCHANGED (the audit confirmed it already matches MoMo's current
// official v3 docs exactly; this is a pure refactor into the provider
// shape, not a rewrite).
export class MomoProvider implements PaymentProvider {
  readonly type = "momo" as const;

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const result = await initiateMomoPayment({
      orderId: params.orderId,
      amount: params.amount,
      orderInfo: params.orderInfo,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      providerOrderId: result.providerOrderId,
      expiresAt: null,
      metadata: { requestId: result.requestId },
      instructions: {
        type: "redirect",
        redirectUrl: result.payUrl,
        nextAction: "Complete your payment with MoMo, then return here.",
      },
    };
  }

  async handleWebhook(rawBody: string): Promise<WebhookResult> {
    let payload: MomoIpnPayload;
    try {
      payload = JSON.parse(rawBody) as MomoIpnPayload;
    } catch {
      return { success: false, error: "Invalid payload." };
    }

    const requiredFields: (keyof MomoIpnPayload)[] = [
      "partnerCode",
      "orderId",
      "requestId",
      "amount",
      "orderInfo",
      "orderType",
      "transId",
      "resultCode",
      "message",
      "payType",
      "responseTime",
      "extraData",
      "signature",
    ];
    for (const field of requiredFields) {
      if (payload[field] === undefined || payload[field] === null) {
        return { success: false, error: "Invalid payload." };
      }
    }

    if (!verifyMomoIpnSignature(payload)) {
      return { success: false, error: "Invalid signature." };
    }

    const resultCode = Number(payload.resultCode);
    const newStatus = resultCode === 0 ? "succeeded" : "failed";

    return {
      success: true,
      providerOrderId: payload.orderId,
      providerEventId: String(payload.transId),
      newStatus,
      verifiedAmount: Number(payload.amount),
      rawPayload: payload,
    };
  }

  async cancelPayment(): Promise<void> {
    // MoMo captureWallet has no cancel-in-place API used by this codebase.
  }
}
