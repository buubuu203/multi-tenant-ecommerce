import { createHmac, timingSafeEqual } from "crypto";
import type { PaymentProvider, CreatePaymentParams, CreatePaymentResult, WebhookResult } from "./provider";

// Step 51: SePay Order VA v2 (developer.sepay.vn/en/sepay-api/v2/don-hang/bat-dau-nhanh).
// Platform-level credentials — one SePay account, many tenants' own bank
// accounts registered under it (each tenant's TenantPaymentMethod.config
// carries its own `baUuid`; the API token below is shared, same
// deliberate-scope decision as MoMo's single platform merchant account).
const SEPAY_API_TOKEN = process.env.SEPAY_API_TOKEN;
const SEPAY_WEBHOOK_SECRET = process.env.SEPAY_WEBHOOK_SECRET;
// Sandbox by default for local development — Production/Preview promotion
// would set SEPAY_API_BASE_URL to https://userapi.sepay.vn/v2 explicitly.
const SEPAY_API_BASE_URL = process.env.SEPAY_API_BASE_URL ?? "https://userapi-sandbox.sepay.vn/v2";
// Replay-protection window per SePay's documented recommendation.
const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export function isSepayConfigured(): boolean {
  return Boolean(SEPAY_API_TOKEN && SEPAY_WEBHOOK_SECRET);
}

type SepayVaConfig = {
  baUuid?: string;
};

type SepayCreateOrderResponse = {
  status?: string;
  va_number?: string;
  qr_code_url?: string;
  expired_at?: string;
  id?: string; // SePay's order UUID (data.id) — distinct from our order_code
  message?: string;
};

// SePay's documented webhook payload fields (per the official Order VA v2
// + webhook docs). Distinct meanings, deliberately not conflated:
//   id             — SePay's own bank-transaction ID. STABLE across
//                    webhook retries/replays. THE dedupe key
//                    (PaymentEvent.providerEventId) — never `code`.
//   code           — the payment reference extracted from the transfer
//                    content, expected to equal the `order_code` we sent
//                    when creating the order/VA (our Payment.providerOrderId).
//   subAccount     — the matched virtual account / sub-account.
//   transferAmount — the amount actually transferred; validated against
//                    Payment.amount before ever accepting the payment.
//   transferType   — "in" for an inbound transfer; anything else rejected.
export type SepayWebhookPayload = {
  id: string;
  code: string;
  subAccount?: string;
  transferAmount: number;
  transferType: string;
  [key: string]: unknown;
};

/**
 * Verifies SePay's recommended HMAC-SHA256 webhook authentication:
 *   X-SePay-Signature: sha256={hex}
 *   X-SePay-Timestamp: {unix seconds}
 * signed over `${timestamp}.${rawBody}` with the webhook secret. Rejects
 * a timestamp outside the documented ~5 minute replay window BEFORE any
 * signature comparison (a stale-but-correctly-signed replay is still
 * rejected). Constant-time comparison — this is a security boundary,
 * same posture as verifyMomoIpnSignature().
 */
function verifySepayWebhookSignature(rawBody: string, headers: Headers): boolean {
  if (!SEPAY_WEBHOOK_SECRET) {
    return false;
  }
  const signatureHeader = headers.get("x-sepay-signature");
  const timestampHeader = headers.get("x-sepay-timestamp");
  if (!signatureHeader || !timestampHeader) {
    return false;
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
    return false;
  }

  const match = /^sha256=([0-9a-f]+)$/i.exec(signatureHeader.trim());
  if (!match) {
    return false;
  }
  const expected = createHmac("sha256", SEPAY_WEBHOOK_SECRET).update(`${timestampHeader}.${rawBody}`).digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(match[1], "hex");
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * Order VA v2: creates an order + virtual account under the tenant's
 * registered SePay bank account (`config.baUuid`). `order_code` is OUR
 * generated reference (Payment.providerOrderId) — SePay's webhook `code`
 * field echoes it back, the same correlation-key pattern MoMo already
 * uses for its own `orderId`.
 */
export class SePayVirtualAccountProvider implements PaymentProvider {
  readonly type = "bank_transfer_sepay_va" as const;

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    if (!isSepayConfigured()) {
      return { success: false, error: "SePay is not configured on this server." };
    }
    const config = (params.config ?? {}) as SepayVaConfig;
    if (!config.baUuid) {
      return { success: false, error: "SePay bank account is not configured for this store." };
    }

    const providerOrderId = `${params.orderId}`;

    try {
      const response = await fetch(`${SEPAY_API_BASE_URL}/bank-accounts/${config.baUuid}/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SEPAY_API_TOKEN}`,
        },
        body: JSON.stringify({
          order_code: providerOrderId,
          amount: params.amount,
          with_qrcode: true,
        }),
      });
      const data = (await response.json()) as SepayCreateOrderResponse;
      if (!response.ok || !data.va_number) {
        return { success: false, error: data.message ?? "SePay did not return a virtual account." };
      }

      const expiresAt = data.expired_at ? new Date(data.expired_at) : null;

      return {
        success: true,
        providerOrderId,
        expiresAt,
        metadata: { sepayOrderId: data.id ?? null, vaNumber: data.va_number, qrCodeUrl: data.qr_code_url ?? null },
        instructions: {
          type: "bank_transfer",
          title: "Transfer to:",
          amount: params.amount,
          currency: "VND",
          virtualAccountNumber: data.va_number,
          qrCodeUrl: data.qr_code_url,
          expiresAt: expiresAt ? expiresAt.toISOString() : undefined,
          nextAction: "Scan the QR code or transfer the exact amount to the virtual account number above.",
        },
      };
    } catch {
      return { success: false, error: "Could not reach SePay to create the payment." };
    }
  }

  /**
   * Steps, in order (per the approved correction — signature verified
   * BEFORE the payload is ever parsed for business use):
   *   1. Verify HMAC signature + timestamp — reject outright otherwise.
   *   2. Validate required fields are present.
   *   3. transferType must be "in" — an OUTBOUND bank transaction is not
   *      evidence the customer's payment failed (money simply left the
   *      account for an unrelated reason); it is treated exactly like an
   *      invalid/irrelevant webhook — rejected here, BEFORE any Payment
   *      lookup or PaymentEvent recording ever happens in
   *      webhook-service.ts, so a retry of the same outbound transaction
   *      is rejected identically every time, never a false "duplicate
   *      success." Payment is never touched, never marked "failed" for
   *      this reason.
   *   4. Amount is intentionally NOT checked here — webhook-service.ts
   *      does that once it has the actual Payment row, and (per the
   *      approved correction) records PaymentEvent only AFTER that check
   *      passes, so a wrong-amount webhook is never recorded as a
   *      processed event either — a retry of the same wrong-amount
   *      transaction must be rejected again, not treated as an
   *      already-handled duplicate. V1 policy: exact payment only;
   *      partial payments (SePay/BIDV can support them) are explicitly
   *      OUT OF SCOPE.
   *   5. providerEventId is `payload.id` (SePay's bank transaction ID) —
   *      NEVER `payload.code` (the order_code / payment reference).
   */
  async handleWebhook(rawBody: string, headers: Headers): Promise<WebhookResult> {
    if (!verifySepayWebhookSignature(rawBody, headers)) {
      return { success: false, error: "Invalid signature." };
    }

    let payload: SepayWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as SepayWebhookPayload;
    } catch {
      return { success: false, error: "Invalid payload." };
    }

    if (!payload.id || !payload.code || typeof payload.transferAmount !== "number" || !payload.transferType) {
      return { success: false, error: "Malformed payload." };
    }

    if (payload.transferType !== "in") {
      return { success: false, error: "Not an inbound transfer." };
    }

    return {
      success: true,
      providerOrderId: payload.code,
      providerEventId: payload.id,
      newStatus: "succeeded",
      verifiedAmount: payload.transferAmount,
      rawPayload: payload,
    };
  }

  async cancelPayment(providerOrderId: string): Promise<void> {
    // Order VA v2 supports DELETE .../orders/{order_xid} for Pending
    // orders — not wired up in V1 (no cancellation flow triggers it yet
    // from this codebase); left as a documented no-op rather than a
    // half-implemented call with nothing to invoke it.
    void providerOrderId;
  }
}
