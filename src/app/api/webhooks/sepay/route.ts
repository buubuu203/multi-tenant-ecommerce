import { NextResponse } from "next/server";
import { processProviderWebhook } from "@/lib/payments/webhook-service";

// Step 51: public webhook endpoint SePay calls directly (never through a
// tenant hostname) — same posture as /api/momo/webhook. Tenant identity
// is resolved entirely from the Payment row found via the webhook's
// `code` field (our order_code / Payment.providerOrderId) — never from
// any client-supplied value on this request. See webhook-service.ts's
// doc comment for the full pipeline.
//
// Returns SePay's documented success response (200, {"success": true})
// ONLY when the webhook has been validly authenticated and processed, or
// is a legitimate already-processed duplicate. Any signature, payload,
// unknown-payment, or amount-mismatch failure returns a non-200 so SePay
// does not mistake a rejected webhook for a delivered one.
export async function POST(request: Request) {
  const rawBody = await request.text();

  const result = await processProviderWebhook("bank_transfer_sepay_va", rawBody, request.headers);
  if (!result.accepted) {
    // Never distinguish which rejection reason to the caller beyond a
    // generic failure — same "don't leak why" posture as every other
    // webhook boundary in this project.
    return NextResponse.json({ success: false }, { status: 400 });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
