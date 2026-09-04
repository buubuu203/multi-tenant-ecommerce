"use server";

import { headers } from "next/headers";
import { createOrder } from "@/lib/order-mutations";
import { createPaymentForOrder } from "@/lib/payments/payment-service";
import type { PaymentInstructions } from "@/lib/payments/provider";
import type { PaymentMethod } from "@/generated/prisma/client";
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
 * Converts the current client-side cart into an Order, then initiates
 * payment for it via the generic PaymentService (Step 51) — never
 * branches on provider name here; `instructions` is the one canonical
 * shape the checkout UI renders off, regardless of which provider ends up
 * handling the chosen method.
 *
 * tenantId is read from the trusted `x-tenant-id` header — resolved
 * server-side by src/proxy.ts from the verified request hostname, same
 * pattern every other storefront read/write in this project uses — never
 * accepted as a client-supplied argument. The provider/config behind a
 * payment method is likewise never client-controlled — PaymentService
 * resolves it exclusively from TenantPaymentMethod, looked up by
 * (tenantId, method).
 *
 * Does no order/inventory/customer/shipping logic of its own: delegates
 * entirely to createOrder() (Step 28, extended in Step 51 with the
 * tenant-payment-method-enabled check), which re-reads authoritative
 * ProductVariant data, reserves inventory atomically, and snapshots
 * price server-side. The order (and its inventory reservation) is ALREADY
 * created and committed before payment initiation ever runs — the
 * approved pay-after design, unchanged since Step 48. Payment initiation
 * failing never rolls the order back.
 */
export async function checkoutAction(
  items: CheckoutItemInput[],
  paymentMethod: string,
  customer: CheckoutCustomerInput,
  shipping: CheckoutShippingInput,
): Promise<ActionResult<{ orderId: string; instructions: PaymentInstructions }>> {
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

  const sanitizedCustomer = {
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
  };

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

  // Server-computed total from the just-created, server-snapshotted order
  // items — never a client-supplied amount.
  const total = result.data.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const paymentResult = await createPaymentForOrder(
    tenantId,
    result.data.orderId,
    paymentMethod as PaymentMethod,
    total,
    `Order ${result.data.orderId}`,
  );

  if (!paymentResult.success) {
    // Smallest safe behavior, unchanged from the original MVP design: the
    // order stands as created regardless of payment initiation outcome —
    // the customer sees a clear failure, not a silently missing order.
    return {
      success: true,
      data: {
        orderId: result.data.orderId,
        instructions: { type: "none", nextAction: `We couldn't start payment: ${paymentResult.error}` },
      },
    };
  }

  return { success: true, data: { orderId: result.data.orderId, instructions: paymentResult.instructions } };
}
