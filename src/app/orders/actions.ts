"use server";

import { headers } from "next/headers";
import { getOrderForCustomer, type CustomerOrderView } from "@/lib/order-queries";
import type { ActionResult } from "@/lib/action-result";

const GENERIC_LOOKUP_ERROR = "We couldn't find an order matching that order ID and email.";

/**
 * Guest order lookup — no accounts/sessions, so Order ID + checkout email
 * is the entire access-control mechanism (see getOrderForCustomer()'s own
 * doc comment for why it returns null uniformly for every failure case).
 * tenantId comes exclusively from the trusted `x-tenant-id` header (same
 * pattern as checkout-actions.ts) — never accepted from the client. The
 * email is read from FormData (a POST body), never placed in a URL/query
 * string by any caller of this action.
 *
 * Returns the SAME generic error string regardless of whether the order
 * doesn't exist, the email was wrong, or the order belongs to another
 * tenant — deliberately not distinguishing these, so a guesser learns
 * nothing from a failed attempt.
 */
export async function lookupOrderAction(
  _prevState: ActionResult<CustomerOrderView> | null,
  formData: FormData,
): Promise<ActionResult<CustomerOrderView>> {
  const headerList = await headers();
  const tenantId = headerList.get("x-tenant-id");
  if (!tenantId) {
    return { success: false, error: "Store not found." };
  }

  const orderId = String(formData.get("orderId") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  if (!orderId || !email) {
    return { success: false, error: "Enter your order ID and the email used at checkout." };
  }

  const order = await getOrderForCustomer(tenantId, orderId, email);
  if (!order) {
    return { success: false, error: GENERIC_LOOKUP_ERROR };
  }

  return { success: true, data: order };
}
