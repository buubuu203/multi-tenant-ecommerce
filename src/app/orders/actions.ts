"use server";

import { headers } from "next/headers";
import { getOrderForCustomer, getOrdersForCustomerEmail, type CustomerOrderView } from "@/lib/order-queries";
import type { ActionResult } from "@/lib/action-result";

const GENERIC_LOOKUP_ERROR = "We couldn't find an order matching that order ID and email.";
const NO_HISTORY_ERROR = "We couldn't find any orders placed with that email.";

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

/**
 * Order history — every order this tenant has under the given email,
 * newest first. Same guest-access posture as lookupOrderAction: email
 * alone is the proof of ownership (there is no order id to also check),
 * which is weaker than the paired lookup above by design — this is the
 * tradeoff for a customer being able to see their history at all without
 * an account/session system. tenantId is still exclusively the trusted
 * `x-tenant-id` header, never client-supplied.
 */
export async function lookupOrderHistoryAction(
  _prevState: ActionResult<CustomerOrderView[]> | null,
  formData: FormData,
): Promise<ActionResult<CustomerOrderView[]>> {
  const headerList = await headers();
  const tenantId = headerList.get("x-tenant-id");
  if (!tenantId) {
    return { success: false, error: "Store not found." };
  }

  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    return { success: false, error: "Enter the email used at checkout." };
  }

  const orders = await getOrdersForCustomerEmail(tenantId, email);
  if (orders.length === 0) {
    return { success: false, error: NO_HISTORY_ERROR };
  }

  return { success: true, data: orders };
}
