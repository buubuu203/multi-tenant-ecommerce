"use server";

import { headers } from "next/headers";
import { createOrder } from "@/lib/order-mutations";
import { initiatePaymentForOrder } from "@/lib/payment-mutations";
import type { ActionResult } from "@/lib/action-result";

// Only the two identity fields this checkout flow is allowed to trust from
// the client cart — see cart-context.tsx's own doc comment for why price/
// name/SKU/label are never authoritative. This type structurally cannot
// carry a price field, so there is nothing for a tampered client call to
// smuggle through even if it tried.
export type CheckoutItemInput = {
  productVariantId: string;
  quantity: number;
};

// Step 32: guest-checkout contact info — NOT authentication (no password,
// no session field, nothing account-related). Structurally cannot carry a
// price/product/SKU/tenantId field, same defensive intent as
// CheckoutItemInput above.
export type CheckoutCustomerInput = {
  name: string;
  email: string;
  phone: string;
};

// Step 34: order-time shipping address snapshot. Same defensive intent as
// the two types above — structurally cannot carry anything beyond these
// five fields.
export type CheckoutShippingInput = {
  address: string;
  ward: string;
  district: string;
  city: string;
  note?: string;
};

/**
 * Converts the current client-side cart into an Order. tenantId is read
 * from the trusted `x-tenant-id` header — resolved server-side by
 * src/proxy.ts from the verified request hostname, the same pattern every
 * other storefront read/write in this project uses (get-tenant-products.ts,
 * get-current-tenant.ts) — never accepted as a client-supplied argument.
 *
 * Does no order/inventory/payment/customer/shipping logic of its own:
 * delegates entirely to the existing createOrder() (Step 28), which
 * re-reads authoritative ProductVariant data, verifies tenant ownership,
 * snapshots price, reserves inventory atomically in the same transaction
 * as the Order/OrderItem rows, (Step 30) validates+stores the chosen
 * payment method, (Step 32) validates+upserts the Customer record, and
 * (Step 34) validates+persists the shipping address — all in that same
 * transaction. This function's only job is resolving the trusted tenant
 * context and passing through the minimal (productVariantId, quantity)
 * pairs plus the selected payment method, entered contact info, and
 * entered shipping address — nothing about pricing, totals, stock,
 * payment validity, customer identity, or address validity is decided
 * here.
 */
export async function checkoutAction(
  items: CheckoutItemInput[],
  paymentMethod: string,
  customer: CheckoutCustomerInput,
  shipping: CheckoutShippingInput,
): Promise<ActionResult<{ orderId: string; paymentRedirectUrl?: string; paymentInitiationFailed?: boolean }>> {
  const headerList = await headers();
  const tenantId = headerList.get("x-tenant-id");
  if (!tenantId) {
    return { success: false, error: "Store not found." };
  }

  // Strip down to exactly {productVariantId, quantity} regardless of what
  // extra fields the caller's object happens to carry — mirrors the same
  // defensive intent as OrderItemInput itself, one layer earlier.
  const sanitizedItems = items.map((item) => ({
    productVariantId: item.productVariantId,
    quantity: item.quantity,
  }));

  // Same defensive stripping for the customer object — only these three
  // fields are ever read, regardless of what else the caller's object
  // might carry.
  const sanitizedCustomer = {
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
  };

  // Same defensive stripping for the shipping object.
  const sanitizedShipping = {
    address: shipping.address,
    ward: shipping.ward,
    district: shipping.district,
    city: shipping.city,
    note: shipping.note,
  };

  const result = await createOrder(tenantId, sanitizedItems, paymentMethod, sanitizedCustomer, sanitizedShipping);
  if (!result.success) {
    return result;
  }

  // Step 48: the order (and its inventory reservation) is ALREADY
  // created and committed at this point, for every payment method,
  // including "momo" — the approved pay-after design keeps reservation
  // timing completely unchanged. Payment initiation is a separate step
  // layered on afterward; nothing below this line can undo the order or
  // its reservation. cod/bank_transfer are untouched — no Payment row is
  // ever created for them.
  if (paymentMethod === "momo") {
    const total = result.data.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const paymentResult = await initiatePaymentForOrder(tenantId, result.data.orderId, total, `Order ${result.data.orderId}`);
    if (!paymentResult.initiated) {
      // Smallest safe behavior for this MVP: the order stands as created
      // (per the pay-after design, its existence never depended on
      // payment succeeding) — we simply tell the customer payment could
      // not be started, rather than inventing a retry/cancellation flow.
      return {
        success: true,
        data: { orderId: result.data.orderId, paymentInitiationFailed: true },
      };
    }
    return {
      success: true,
      data: { orderId: result.data.orderId, paymentRedirectUrl: paymentResult.payUrl },
    };
  }

  return { success: true, data: { orderId: result.data.orderId } };
}
