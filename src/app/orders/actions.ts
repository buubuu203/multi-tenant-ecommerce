"use server";

import { headers } from "next/headers";
import {
  getOrderForCustomer,
  getOrderForCustomerByPhone,
  getOrdersForCustomerEmail,
  getOrdersForCustomerNameAndPhone,
  type CustomerOrderView,
} from "@/lib/order-queries";
import { isValidVietnamesePhone } from "@/lib/validation/phone";
import type { ActionResult } from "@/lib/action-result";

const GENERIC_LOOKUP_ERROR = "We couldn't find an order matching that order ID and email.";
const GENERIC_PHONE_LOOKUP_ERROR = "We couldn't find an order matching that order ID and phone number.";
const NO_HISTORY_ERROR = "We couldn't find any orders placed with that email.";
const NO_NAME_PHONE_HISTORY_ERROR = "We couldn't find any orders matching that name and phone number.";

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

/**
 * Order Lookup by phone (V1) — same access-control bar as
 * lookupOrderAction above (Order ID + a second checkout-time field), just
 * phone instead of email. See getOrderForCustomerByPhone()'s doc comment
 * for why this is not weaker than the email-based lookup.
 */
export async function lookupOrderByPhoneAction(
  _prevState: ActionResult<CustomerOrderView> | null,
  formData: FormData,
): Promise<ActionResult<CustomerOrderView>> {
  const headerList = await headers();
  const tenantId = headerList.get("x-tenant-id");
  if (!tenantId) {
    return { success: false, error: "Store not found." };
  }

  const orderId = String(formData.get("orderId") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  if (!orderId || !phone) {
    return { success: false, error: "Enter your order ID and the phone number used at checkout." };
  }
  if (!isValidVietnamesePhone(phone)) {
    return { success: false, error: "Enter a valid Vietnamese phone number." };
  }

  const order = await getOrderForCustomerByPhone(tenantId, orderId, phone);
  if (!order) {
    return { success: false, error: GENERIC_PHONE_LOOKUP_ERROR };
  }

  return { success: true, data: order };
}

/**
 * Order Lookup by name + phone (V1) — deliberately requires BOTH fields
 * together (see getOrdersForCustomerNameAndPhone()'s doc comment for why
 * neither is accepted alone): this is the "I don't remember my order ID
 * or email, but I remember what name and phone I gave" recovery path,
 * intentionally a higher bar than the single-factor email history lookup
 * above.
 */
export async function lookupOrderHistoryByNameAndPhoneAction(
  _prevState: ActionResult<CustomerOrderView[]> | null,
  formData: FormData,
): Promise<ActionResult<CustomerOrderView[]>> {
  const headerList = await headers();
  const tenantId = headerList.get("x-tenant-id");
  if (!tenantId) {
    return { success: false, error: "Store not found." };
  }

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  if (!name || !phone) {
    return { success: false, error: "Enter the name and phone number used at checkout." };
  }
  if (!isValidVietnamesePhone(phone)) {
    return { success: false, error: "Enter a valid Vietnamese phone number." };
  }

  const orders = await getOrdersForCustomerNameAndPhone(tenantId, name, phone);
  if (orders.length === 0) {
    return { success: false, error: NO_NAME_PHONE_HISTORY_ERROR };
  }

  return { success: true, data: orders };
}
