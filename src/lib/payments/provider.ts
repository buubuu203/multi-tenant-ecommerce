import type { PaymentProviderType, PaymentStatus } from "@/generated/prisma/client";

// Step 51: canonical, provider-agnostic instructions handed to the
// checkout UI. Modeled around the CUSTOMER'S ACTION, not the provider's
// implementation — "bank_transfer" covers both bank_transfer_manual and
// bank_transfer_sepay_va (the presence of qrCodeUrl/virtualAccountNumber
// is supplementary detail on the same action, not a separate rail).
// Checkout components render off `type` alone and must never branch on
// provider name.
export type PaymentInstructions =
  | { type: "none"; nextAction: string }
  | {
      type: "bank_transfer";
      title: string;
      amount: number;
      currency: "VND";
      bankName?: string;
      accountNumber?: string;
      accountHolder?: string;
      virtualAccountNumber?: string;
      qrCodeUrl?: string;
      expiresAt?: string; // ISO string — this crosses the server/client boundary
      nextAction: string;
    }
  | {
      type: "redirect";
      redirectUrl: string;
      nextAction: string;
    };

export type CreatePaymentParams = {
  tenantId: string;
  orderId: string;
  amount: number;
  orderInfo: string;
  // Provider-shaped config from TenantPaymentMethod.config — e.g. SePay's
  // {baUuid}, manual bank transfer's {bankName, accountNumber, accountHolder}.
  // Never a raw API secret — those stay in platform-level env vars.
  config: Record<string, unknown> | null;
};

export type CreatePaymentResult =
  | {
      success: true;
      providerOrderId: string;
      instructions: PaymentInstructions;
      expiresAt: Date | null;
      metadata: Record<string, unknown> | null;
    }
  | { success: false; error: string };

export type WebhookResult =
  | {
      success: true;
      providerOrderId: string;
      providerEventId: string | null;
      newStatus: PaymentStatus;
      verifiedAmount: number;
      rawPayload: unknown;
    }
  | { success: false; error: string };

// Step 51: implemented by CodProvider, ManualBankTransferProvider,
// SePayVirtualAccountProvider, MomoProvider. cancelPayment/handleWebhook
// are no-ops for providers that never receive a webhook or support
// cancellation (cod, bank_transfer_manual) — kept in the interface for
// shape consistency across the abstraction, not because every provider
// implements every capability meaningfully.
export interface PaymentProvider {
  readonly type: PaymentProviderType;
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>;
  handleWebhook(rawBody: string, headers: Headers): Promise<WebhookResult>;
  cancelPayment(providerOrderId: string): Promise<void>;
}
