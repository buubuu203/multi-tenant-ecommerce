import { createHmac, timingSafeEqual, randomUUID } from "crypto";

// Step 48: MoMo Payment MVP — a SINGLE platform-level MoMo merchant
// account for the whole app (all tenants share one set of credentials),
// not per-tenant payment configuration. This is a deliberate smallest-
// scope decision, not an oversight: per-tenant merchant onboarding is a
// materially larger feature (credential storage, verification, multi-
// merchant routing) explicitly out of scope for this MVP. Credentials
// come from environment variables only — never hardcoded, never invented.
//
// If these env vars are unset, MoMo is simply "not configured" —
// initiateMomoPayment() returns a clear error rather than crashing or
// fabricating a fake integration.
const MOMO_PARTNER_CODE = process.env.MOMO_PARTNER_CODE;
const MOMO_ACCESS_KEY = process.env.MOMO_ACCESS_KEY;
const MOMO_SECRET_KEY = process.env.MOMO_SECRET_KEY;
const MOMO_ENDPOINT = process.env.MOMO_ENDPOINT ?? "https://test-payment.momo.vn/v2/gateway/api/create";
const MOMO_REDIRECT_URL = process.env.MOMO_REDIRECT_URL;
const MOMO_IPN_URL = process.env.MOMO_IPN_URL;

export function isMomoConfigured(): boolean {
  return Boolean(MOMO_PARTNER_CODE && MOMO_ACCESS_KEY && MOMO_SECRET_KEY && MOMO_REDIRECT_URL && MOMO_IPN_URL);
}

export type MomoCreatePaymentResult =
  | { success: true; payUrl: string; providerOrderId: string; requestId: string }
  | { success: false; error: string };

/**
 * Initiates a MoMo "captureWallet" payment for one Order. Builds the raw
 * signature string per MoMo's documented field order for this request
 * type, HMAC-SHA256 signed with the platform secret key, and POSTs to
 * MoMo's create-payment endpoint.
 *
 * providerOrderId is a FRESH, unguessable reference generated here (never
 * the raw Order.id) — this is what MoMo's IPN webhook echoes back, and is
 * the sole correlation key used to find the Payment row from a webhook
 * (see payment-mutations.ts). Each call to this function (e.g. a fresh
 * order) gets its own providerOrderId.
 *
 * IMPORTANT — verification status: this implementation was written
 * against MoMo's publicly documented captureWallet/v2 API shape and field
 * order. No live MoMo sandbox credentials were available in this
 * environment to verify the request against MoMo's actual service — see
 * the Step 48 report's explicit disclosure. Structural/unit behavior
 * (env-var gating, error handling, no fabricated calls when unconfigured)
 * is fully tested; the live HTTP exchange with MoMo is not.
 */
export async function initiateMomoPayment(params: {
  orderId: string;
  amount: number;
  orderInfo: string;
}): Promise<MomoCreatePaymentResult> {
  if (!isMomoConfigured()) {
    return { success: false, error: "MoMo payment is not configured on this server." };
  }

  const providerOrderId = `${params.orderId}-${randomUUID()}`;
  const requestId = randomUUID();
  const requestType = "captureWallet";
  const extraData = "";

  // MoMo's documented raw-signature field order for captureWallet/v2
  // create requests (fixed order, not alphabetical) — see MoMo's public
  // API reference. Any mismatch against MoMo's actual current spec would
  // surface as a signature-invalid rejection from MoMo itself, not a
  // silent security gap (MoMo verifies the signature it receives).
  const rawSignature =
    `accessKey=${MOMO_ACCESS_KEY}` +
    `&amount=${params.amount}` +
    `&extraData=${extraData}` +
    `&ipnUrl=${MOMO_IPN_URL}` +
    `&orderId=${providerOrderId}` +
    `&orderInfo=${params.orderInfo}` +
    `&partnerCode=${MOMO_PARTNER_CODE}` +
    `&redirectUrl=${MOMO_REDIRECT_URL}` +
    `&requestId=${requestId}` +
    `&requestType=${requestType}`;
  const signature = createHmac("sha256", MOMO_SECRET_KEY as string).update(rawSignature).digest("hex");

  const body = {
    partnerCode: MOMO_PARTNER_CODE,
    accessKey: MOMO_ACCESS_KEY,
    requestId,
    amount: String(params.amount),
    orderId: providerOrderId,
    orderInfo: params.orderInfo,
    redirectUrl: MOMO_REDIRECT_URL,
    ipnUrl: MOMO_IPN_URL,
    extraData,
    requestType,
    signature,
    lang: "vi",
  };

  try {
    const response = await fetch(MOMO_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as { payUrl?: string; resultCode?: number; message?: string };
    if (!response.ok || typeof data.payUrl !== "string" || data.resultCode !== 0) {
      return { success: false, error: data.message ?? "MoMo did not return a payment URL." };
    }
    return { success: true, payUrl: data.payUrl, providerOrderId, requestId };
  } catch {
    return { success: false, error: "Could not reach MoMo to start payment." };
  }
}

// MoMo's documented raw-signature field order for IPN (webhook) payloads
// — a DIFFERENT field set/order than the create-payment request above
// (MoMo's own spec distinguishes these). Verified with the same secret
// key used to initiate.
export type MomoIpnPayload = {
  partnerCode: string;
  orderId: string; // this is OUR providerOrderId, echoed back
  requestId: string;
  amount: string | number;
  orderInfo: string;
  orderType: string;
  transId: string | number;
  resultCode: string | number;
  message: string;
  payType: string;
  responseTime: string | number;
  extraData: string;
  signature: string;
};

export function verifyMomoIpnSignature(payload: MomoIpnPayload): boolean {
  if (!MOMO_SECRET_KEY || !MOMO_ACCESS_KEY) {
    return false;
  }
  const rawSignature =
    `accessKey=${MOMO_ACCESS_KEY}` +
    `&amount=${payload.amount}` +
    `&extraData=${payload.extraData}` +
    `&message=${payload.message}` +
    `&orderId=${payload.orderId}` +
    `&orderInfo=${payload.orderInfo}` +
    `&orderType=${payload.orderType}` +
    `&partnerCode=${payload.partnerCode}` +
    `&payType=${payload.payType}` +
    `&requestId=${payload.requestId}` +
    `&responseTime=${payload.responseTime}` +
    `&resultCode=${payload.resultCode}` +
    `&transId=${payload.transId}`;
  const expected = createHmac("sha256", MOMO_SECRET_KEY).update(rawSignature).digest("hex");

  // Constant-time comparison — this is a security boundary (an attacker
  // who could time-guess the signature could forge fake "payment
  // succeeded" callbacks).
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(payload.signature ?? "", "hex");
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, actualBuf);
}
