"use server";

import { headers } from "next/headers";
import { createOrder } from "@/lib/order-mutations";
import { prisma } from "@/lib/prisma";
import { applyDiscount } from "@/lib/discounts";
import type { CurrentPrice } from "@/lib/cart-reconcile";
import { createPaymentForOrder } from "@/lib/payments/payment-service";
import type { PaymentInstructions } from "@/lib/payments/provider";
import type { PaymentMethod } from "@/generated/prisma/client";
import type { ActionResult } from "@/lib/action-result";
import { getDictionary, getLocale } from "@/lib/i18n";
import { validateVoucher, findBestAutoPromotion, type CartItemForVoucher } from "@/lib/vouchers";
import {
  getCurrentPrivacyNotice,
  isCurrentPrivacyNoticeVersion,
} from "@/lib/privacy-mutations";

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
  shippingMethodId: string,
  voucherCode?: string,
  autoPromotionId?: string,
  privacyNoticeVersionId?: string | null,
  privacyConsentAccepted?: boolean,
): Promise<ActionResult<{ orderId: string; instructions: PaymentInstructions }>> {
  const headerList = await headers();
  const tenantId = headerList.get("x-tenant-id");
  if (!tenantId) {
    return { success: false, error: "Store not found." };
  }

  const currentPrivacyNotice = await getCurrentPrivacyNotice(tenantId);
  if (
    !currentPrivacyNotice ||
    !isCurrentPrivacyNoticeVersion(currentPrivacyNotice.id, privacyNoticeVersionId)
  ) {
    const dict = await getDictionary(await getLocale());
    return {
      success: false,
      error: dict.privacy.errors.checkoutNoticeChanged,
    };
  }
  if (!privacyConsentAccepted) {
    const dict = await getDictionary(await getLocale());
    return { success: false, error: dict.checkout.privacyConsentRequired };
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

  const result = await createOrder(
    tenantId,
    sanitizedItems,
    paymentMethod,
    sanitizedCustomer,
    sanitizedShipping,
    shippingMethodId,
    voucherCode || undefined,
    autoPromotionId || undefined,
    currentPrivacyNotice.id,
    privacyConsentAccepted,
  );
  if (!result.success) {
    if (result.error === "privacyConsentRequired") {
      const dict = await getDictionary(await getLocale());
      return { success: false, error: dict.checkout.privacyConsentRequired };
    }
    if (result.error === "privacyNoticeChanged") {
      const dict = await getDictionary(await getLocale());
      return { success: false, error: dict.privacy.errors.checkoutNoticeChanged };
    }
    return result;
  }

  const total =
    result.data.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
    + result.data.shippingAmount
    - result.data.voucherDiscount;
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

/**
 * Cart Price Reconciliation: returns the CURRENT authoritative price of
 * each requested variant, so the checkout UI can confirm the customer is
 * looking at today's prices before they submit (see cart-reconcile.ts).
 *
 * Reads the same two things order-mutations.ts reads to charge — the
 * ProductVariant row and its Product's Discount — through the same
 * applyDiscount() helper, so what this returns is by construction what
 * createOrder() would snapshot a moment later. It is a read-only
 * preview, not a price quote the client can hold or replay: createOrder()
 * still re-reads and snapshots price itself, and accepts no price from
 * the client at all.
 *
 * tenantId comes from the trusted `x-tenant-id` header, never a client
 * argument, and filters the variant query — so this can only ever price
 * variants belonging to the store the request was actually made to, and
 * a variant id guessed from another tenant simply comes back absent.
 * Archived variants and non-active products are likewise omitted rather
 * than priced, matching createOrder()'s own refusal to sell them.
 */
export async function getCurrentCartPrices(
  items: CheckoutItemInput[],
): Promise<ActionResult<CurrentPrice[]>> {
  const headerList = await headers();
  const tenantId = headerList.get("x-tenant-id");
  if (!tenantId) {
    return { success: false, error: "Store not found." };
  }

  const variantIds = [...new Set(items.map((item) => item.productVariantId))];
  if (variantIds.length === 0) {
    return { success: true, data: [] };
  }

  const variants = await prisma.productVariant.findMany({
    where: {
      id: { in: variantIds },
      tenantId,
      status: { not: "archived" },
      product: { tenantId, status: "active" },
    },
    include: { product: { include: { discount: true } } },
  });

  return {
    success: true,
    data: variants.map((variant) => {
      const { finalPrice, discountPercent, discountAmount } = applyDiscount(variant.price, variant.product.discount);
      const hasDiscount = discountPercent !== null || discountAmount > 0;
      return {
        productVariantId: variant.id,
        price: finalPrice,
        originalPrice: hasDiscount ? variant.price : null,
        discountPercent,
      };
    }),
  };
}

export async function validateVoucherAction(
  code: string,
  orderSubtotal: number,
  cartItems?: CheckoutItemInput[],
): Promise<ActionResult<{ discountAmount: number; code: string | null; label: string | null; discountType: string; discountValue: number; scope: string }>> {
  const headerList = await headers();
  const tenantId = headerList.get("x-tenant-id");
  if (!tenantId) {
    return { success: false, error: "Store not found." };
  }

  let enrichedItems: CartItemForVoucher[] | undefined;
  if (cartItems && cartItems.length > 0) {
    const variantIds = [...new Set(cartItems.map((i) => i.productVariantId))];
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: variantIds }, tenantId },
      include: { product: { include: { discount: true } } },
    });
    const variantMap = new Map(variants.map((v) => [v.id, v]));
    enrichedItems = cartItems
      .filter((i) => variantMap.has(i.productVariantId))
      .map((i) => {
        const v = variantMap.get(i.productVariantId)!;
        const { finalPrice } = applyDiscount(v.price, v.product.discount);
        return {
          productVariantId: i.productVariantId,
          productId: v.productId,
          unitPrice: finalPrice,
          quantity: i.quantity,
        };
      });
  }

  const result = await validateVoucher(tenantId, code, orderSubtotal, enrichedItems);
  if (!result.valid) {
    return { success: false, error: result.error };
  }
  return {
    success: true,
    data: {
      discountAmount: result.discountAmount,
      code: result.voucher.code,
      label: result.voucher.label ?? null,
      discountType: result.voucher.discountType,
      discountValue: result.voucher.discountValue,
      scope: result.voucher.scope,
    },
  };
}

export type AutoPromotionResult = {
  label: string;
  discountAmount: number;
  voucherId: string;
} | null;

export async function findAutoPromotionAction(
  cartItems: CheckoutItemInput[],
  orderSubtotal: number,
): Promise<AutoPromotionResult> {
  const headerList = await headers();
  const tenantId = headerList.get("x-tenant-id");
  if (!tenantId) return null;

  const variantIds = cartItems.map((item) => item.productVariantId);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, tenantId },
    include: { product: { include: { discount: true } } },
  });

  const enrichedItems: CartItemForVoucher[] = cartItems.map((item) => {
    const variant = variants.find((v) => v.id === item.productVariantId);
    if (!variant) return { productVariantId: item.productVariantId, productId: "", unitPrice: 0, quantity: item.quantity };
    const { finalPrice } = applyDiscount(variant.price, variant.product.discount);
    return {
      productVariantId: item.productVariantId,
      productId: variant.productId,
      unitPrice: finalPrice,
      quantity: item.quantity,
    };
  });

  const result = await findBestAutoPromotion(tenantId, enrichedItems, orderSubtotal);
  if (!result || !result.valid) return null;

  return {
    label: result.voucher.label ?? "Auto promotion",
    discountAmount: result.discountAmount,
    voucherId: result.voucher.id,
  };
}
