import { NextResponse } from "next/server";
import { processProviderWebhook } from "@/lib/payments/webhook-service";

// Step 48/51: public webhook endpoint MoMo calls directly (never through a
// tenant hostname) — src/proxy.ts's tenant-hostname resolution applies to
// this path too (nothing excludes /api/* from its matcher), but the
// x-tenant-id header it sets is meaningless here and is deliberately never
// read. Tenant identity is resolved entirely from the Payment row found
// via the payload's own providerOrderId correlation key — see
// webhook-service.ts's doc comment for why that is the correct pattern
// for a payment-provider callback, not a tenant-isolation gap.
//
// Always responds 200 for any request MoMo could plausibly retry
// (including "already processed" duplicates) so MoMo does not treat a
// successfully-received-but-already-handled callback as a delivery
// failure and keep retrying it — 400 is reserved for signature/shape
// failures that retrying would never fix.
export async function POST(request: Request) {
  const rawBody = await request.text();

  const result = await processProviderWebhook("momo", rawBody, request.headers);
  if (!result.accepted) {
    // Never distinguish which rejection reason to the caller beyond a
    // generic failure, same "don't leak why" posture as every other
    // boundary in this project.
    return NextResponse.json({ message: "Rejected." }, { status: 400 });
  }

  return NextResponse.json({ message: "OK" }, { status: 200 });
}
