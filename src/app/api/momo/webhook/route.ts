import { NextResponse } from "next/server";
import { handleMomoWebhook } from "@/lib/payment-mutations";
import type { MomoIpnPayload } from "@/lib/momo";

// Step 48: public webhook endpoint MoMo calls directly (never through a
// tenant hostname) — src/proxy.ts's tenant-hostname resolution applies to
// this path too (nothing excludes /api/* from its matcher), but the
// x-tenant-id header it sets is meaningless here and is deliberately never
// read. Tenant identity is resolved entirely from the Payment row found
// via the payload's own providerOrderId correlation key — see
// payment-mutations.ts's handleMomoWebhook() doc comment for why that is
// the correct pattern for a payment-provider callback, not a tenant-
// isolation gap.
//
// Always responds 200 for any request MoMo could plausibly retry
// (including "already processed" duplicates) so MoMo does not treat a
// successfully-received-but-already-handled callback as a delivery
// failure and keep retrying it — 400 is reserved for signature/shape
// failures that retrying would never fix.
export async function POST(request: Request) {
  let payload: MomoIpnPayload;
  try {
    payload = (await request.json()) as MomoIpnPayload;
  } catch {
    return NextResponse.json({ message: "Invalid payload." }, { status: 400 });
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
      return NextResponse.json({ message: "Malformed payload." }, { status: 400 });
    }
  }

  const result = await handleMomoWebhook(payload);
  if (!result.success) {
    // Invalid signature or unknown payment — never distinguish which to
    // the caller beyond a generic rejection, same posture as every other
    // "don't leak why" boundary in this project.
    return NextResponse.json({ message: result.error }, { status: 400 });
  }

  return NextResponse.json({ message: "OK" }, { status: 200 });
}
