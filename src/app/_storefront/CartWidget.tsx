"use client";

import { useEffect, useState } from "react";
import { useCart } from "./cart-context";
import { checkoutAction, getCurrentCartPrices, validateVoucherAction, findAutoPromotionAction } from "./checkout-actions";
import type { AutoPromotionResult } from "./checkout-actions";
import { reconcileCartPrices, PRICE_CHANGE_NOTICE } from "@/lib/cart-reconcile";
import { isValidVietnamesePhone } from "@/lib/validation/phone";
import type { PaymentInstructions } from "@/lib/payments/provider";
import type { ShippingMethodOption } from "@/lib/shipping-service";
import { useDictionary } from "@/lib/i18n/use-dictionary";

function formatVnd(price: number): string {
  return `${price.toLocaleString("vi-VN")} ₫`;
}

const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Step 51: labels only — which of these actually appear is driven by
// `enabledPaymentMethods` (server-resolved from TenantPaymentMethod), not
// hardcoded per tenant. All three remain valid PaymentMethod values; a
// tenant simply may not have enabled/configured all of them.
const PAYMENT_LABEL_KEYS: Record<string, [string, string]> = {
  cod: ["cod", "codHint"],
  momo: ["momo", "momoHint"],
  bank_transfer: ["bankTransfer", "bankTransferHint"],
};

const inputClassName =
  "rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20";
const errorInputClassName =
  "rounded-md border border-red-400 bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40";
const selectClassName = `${inputClassName} appearance-none bg-none`;
const errorSelectClassName = `${errorInputClassName} appearance-none bg-none`;

type FieldErrors = Partial<Record<"name" | "email" | "phone" | "address" | "ward" | "city" | "shippingMethod", string>>;

// Vietnam's July 2025 administrative reform collapsed the old
// province/district/ward 3-tier structure into a 2-tier province/ward
// structure (63 provinces -> 34, ~10000 wards -> ~3300) — see
// public/vn-address.json (fetched from a real, current dataset — see
// order-mutations.ts's validateShippingInput comment for why "district"
// is no longer collected at all). Fetched once, lazily, only when the
// drawer is actually opened — no reason to ship/parse ~65KB of address
// data on every storefront page load before a customer ever opens the
// cart.
type VnProvince = { province: string; wards: string[] };

type CheckoutState =
  | { status: "idle" }
  | { status: "validating" }
  | { status: "submitting" }
  | { status: "success"; orderId: string; instructions: PaymentInstructions }
  | { status: "error"; message: string };

// Phase 3 (checkout as a sequence): the drawer's content used to be one
// long scroll — cart, contact, address, shipping method, and payment all
// visible/scrollable at once. The fields and validation are unchanged;
// only how much is shown at a time changed. "success" isn't a step here —
// it's still driven by `checkout.status === "success"`, same as before.
type CheckoutStep = "cart" | "shipping" | "payment";
const STEP_LABEL_KEYS: Record<CheckoutStep, "stepCart" | "stepShipping" | "stepPayment"> = {
  cart: "stepCart",
  shipping: "stepShipping",
  payment: "stepPayment",
};
const STEP_ORDER: CheckoutStep[] = ["cart", "shipping", "payment"];

// Small, self-contained "copy to clipboard" button — used for the order id
// and bank/VA account number in the success panel, where a customer is
// very likely to need to paste the value elsewhere (their banking app).
function CopyButton({ value, label, copiedLabel = "Copied!" }: { value: string; label: string; copiedLabel?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
    >
      {copied ? copiedLabel : label}
    </button>
  );
}

// Full-height slide-over drawer: cart review, contact/shipping/payment
// details, and the post-checkout success/payment-instructions view, all in
// one scrollable panel with a sticky header and sticky footer — the
// previous version crammed the same content into a fixed w-80 anchored
// dropdown, which was unusable once the form fields and a QR code were
// both visible at once (see the panel in the screenshot this replaces).
//
// Step 39: availabilityByVariant is a plain id -> available lookup (not
// the full TenantProduct shape — this component only ever needs one
// number per item already in the cart) passed down from page.tsx, since
// CartWidget has no other access to product/inventory data. Used only to
// cap the "+" button client-side; it is a UX convenience, NOT a
// correctness guarantee — inventory can change between this read and
// checkout, and createOrder()'s reserveInventoryInTx() remains the sole
// authority (see handleCheckout below, unchanged from before this step).
// A variant missing from the map (e.g. no longer active) is treated as
// "unknown" rather than "zero" — it does not block incrementing, since a
// stale absence here must never be more restrictive than the real
// checkout-time check.
export function CartWidget({
  availabilityByVariant,
  enabledPaymentMethods,
  enabledShippingMethods,
  privacyNoticeVersionId,
}: {
  availabilityByVariant: Record<string, number>;
  // Step 51: server-resolved from TenantPaymentMethod (see
  // payment-service.ts's getEnabledPaymentMethods) — UX only, so a
  // customer never sees a method the tenant hasn't configured; the real
  // enforcement is server-side in createOrder(), unaffected by this prop.
  enabledPaymentMethods: string[];
  // V1 Configurable Shipping: server-resolved from TenantShippingMethod
  // (see shipping-service.ts's getEnabledShippingMethods) — same UX-only
  // role as enabledPaymentMethods above. If the method flagged isDefault
  // is disabled/deleted, it simply won't appear here, so no entry has
  // isDefault: true — see the fallback selection logic below.
  enabledShippingMethods: ShippingMethodOption[];
  privacyNoticeVersionId: string | null;
}) {
  const { items, itemCount, updateQuantity, removeItem, clearCart, replacePrices } = useCart();
  const dict = useDictionary();
  const paymentDict = dict.payment as Record<string, string>;
  const [open, setOpen] = useState(false);
  const [checkout, setCheckout] = useState<CheckoutState>({ status: "idle" });
  const [step, setStep] = useState<CheckoutStep>("cart");
  // Cart Price Reconciliation: set when the pre-submit price check found
  // a line whose price had moved. Its presence both shows the notice and
  // records that the customer has not yet re-confirmed the new prices.
  const [priceNotice, setPriceNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [consentedPrivacyNoticeVersionId, setConsentedPrivacyNoticeVersionId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>(enabledPaymentMethods[0] ?? "cod");
  // Default to the enabled method flagged isDefault; if none is (see doc
  // comment above), fall back to the first enabled method — this IS the
  // "choose another enabled method appropriately" behavior from the
  // approved design, achieved purely by what's in this list, never by
  // mutating TenantShippingMethod.isDefault itself.
  const [shippingMethodId, setShippingMethodId] = useState<string>(
    enabledShippingMethods.find((m) => m.isDefault)?.id ?? enabledShippingMethods[0]?.id ?? "",
  );
  // Step 32: guest-checkout contact info — no login, no session, no
  // account. Kept as plain component state, same as paymentMethod above.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  // Step 34: order-time shipping address — plain component state, same as
  // the contact-info fields above. No saved addresses, no reuse across
  // orders. `city` and `ward` hold the SELECTED province/ward names
  // (populated from vn-address.json below) — sent as-is to createOrder(),
  // which still expects the same {address, ward, district, city} shape;
  // `district` is always "" now (see order-mutations.ts).
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [ward, setWard] = useState("");
  const [note, setNote] = useState("");

  // Voucher / coupon code state
  const [voucherInput, setVoucherInput] = useState("");
  const [voucherApplied, setVoucherApplied] = useState<{ code: string; discountAmount: number } | null>(null);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [voucherLoading, setVoucherLoading] = useState(false);

  // Auto-promotion: evaluated when the cart changes and no manual voucher is applied
  const [autoPromo, setAutoPromo] = useState<AutoPromotionResult>(null);
  const privacyConsentAccepted =
    Boolean(privacyNoticeVersionId) &&
    consentedPrivacyNoticeVersionId === privacyNoticeVersionId;

  async function handleApplyVoucher() {
    if (!voucherInput.trim()) return;
    setVoucherLoading(true);
    setVoucherError(null);
    const cartItemsForVoucher = items.map((item) => ({
      productVariantId: item.productVariantId,
      quantity: item.quantity,
    }));
    const result = await validateVoucherAction(voucherInput, subtotal, cartItemsForVoucher);
    setVoucherLoading(false);
    if (result.success) {
      setVoucherApplied({ code: result.data.code ?? voucherInput, discountAmount: result.data.discountAmount });
      setVoucherError(null);
    } else {
      setVoucherApplied(null);
      setVoucherError(result.error);
    }
  }

  function handleRemoveVoucher() {
    setVoucherApplied(null);
    setVoucherInput("");
    setVoucherError(null);
  }

  const [provinces, setProvinces] = useState<VnProvince[]>([]);
  useEffect(() => {
    if (!open || provinces.length > 0) return;
    fetch("/vn-address.json")
      .then((res) => res.json())
      .then((data: VnProvince[]) => setProvinces(data))
      .catch(() => {
        // Left empty on failure — the province/ward selects simply show no
        // options, and validate() below already requires both to be
        // non-empty, so checkout is blocked rather than silently accepting
        // a missing address. Not surfaced as a checkout error string since
        // this fetch failing is a static-asset/network issue, not
        // something retrying the checkout form fixes.
      });
  }, [open, provinces.length]);
  const selectedProvince = provinces.find((p) => p.province === city);

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  // Client-side display convenience ONLY — the server independently
  // re-resolves the method by id and re-computes this exact same sum
  // authoritatively in createOrder()/checkoutAction() (V1 Configurable
  // Shipping); this value is never sent to the server as data, only the
  // selected method's id is (see handleCheckout below).
  // Keep the METHOD, not just its amount: "no method chosen yet" and "a
  // method that happens to cost 0" both collapse to 0 and must not be
  // shown the same way — see the summary row below.
  const selectedShippingMethod = enabledShippingMethods.find((m) => m.id === shippingMethodId);
  const selectedShippingAmount = selectedShippingMethod?.amount ?? 0;

  useEffect(() => {
    if (voucherApplied || items.length === 0) {
      setAutoPromo(null);
      return;
    }
    let cancelled = false;
    const cartItemsForCheck = items.map((item) => ({
      productVariantId: item.productVariantId,
      quantity: item.quantity,
    }));
    const sub = items.reduce((s, item) => s + item.price * item.quantity, 0);
    findAutoPromotionAction(cartItemsForCheck, sub).then((result) => {
      if (!cancelled) setAutoPromo(result);
    });
    return () => { cancelled = true; };
  }, [items, voucherApplied]);

  const activeDiscount = voucherApplied
    ? { label: voucherApplied.code, amount: voucherApplied.discountAmount, isAuto: false }
    : autoPromo
      ? { label: autoPromo.label, amount: autoPromo.discountAmount, isAuto: true }
      : null;
  const total = Math.max(0, subtotal + selectedShippingAmount - (activeDiscount?.amount ?? 0));

  // Escape-to-close, and lock page scroll while the drawer is open — a
  // full-height overlay behind a still-scrollable page reads as broken.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Step 51: fast client-side feedback only — every one of these rules is
  // re-checked authoritatively server-side in order-mutations.ts. Never
  // relies on HTML `required` alone.
  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!name.trim()) errors.name = dict.validation.nameRequired;
    if (!email.trim() || !BASIC_EMAIL_PATTERN.test(email.trim())) errors.email = dict.validation.emailRequired;
    if (!phone.trim() || !isValidVietnamesePhone(phone)) errors.phone = dict.validation.phoneRequired;
    if (!address.trim()) errors.address = dict.validation.addressRequired;
    if (!city.trim()) errors.city = dict.validation.cityRequired;
    if (!ward.trim()) errors.ward = dict.validation.wardRequired;
    if (!shippingMethodId) errors.shippingMethod = dict.validation.shippingMethodRequired;
    return errors;
  }

  // "Continue" from Shipping & contact re-uses the exact same validate()
  // used by the final submit — this step now happens to be where every
  // one of those fields lives, so gating advancement on it means a
  // customer can never reach Payment with an invalid address/contact,
  // without duplicating the validation rules.
  function handleContinueToPayment() {
    if (!privacyNoticeVersionId || !privacyConsentAccepted) return;
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setStep("payment");
  }

  function handleBack() {
    const currentIndex = STEP_ORDER.indexOf(step);
    if (currentIndex > 0) setStep(STEP_ORDER[currentIndex - 1]);
    if (checkout.status === "error") setCheckout({ status: "idle" });
  }

  async function handleCheckout() {
    // Step 51: duplicate-submit protection — the button is disabled
    // whenever status is anything but "idle"/"error" (see the render
    // below), and this guard is the second layer: a rapid double-click
    // landing here twice while the first call is still in flight is
    // blocked by state already having left "idle".
    if (checkout.status === "validating" || checkout.status === "submitting") {
      return;
    }
    if (!privacyNoticeVersionId) {
      setCheckout({
        status: "error",
        message: dict.checkout.privacyNoticeUnavailable,
      });
      return;
    }
    if (!privacyConsentAccepted) {
      setCheckout({
        status: "error",
        message: dict.checkout.privacyConsentRequired,
      });
      return;
    }
    setCheckout({ status: "validating" });
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setCheckout({ status: "idle" });
      return;
    }

    // Cart Price Reconciliation: the cart's line prices are a
    // display-only localStorage snapshot (see cart-context.tsx), so they
    // can be stale — a discount that started or expired since the item
    // was added, an admin price edit — or tampered with outright. The
    // server has always been the one deciding what to charge, so this
    // was never a money bug; it was a consent bug, where the amount the
    // customer saw while clicking "Place order" was not the amount the
    // order would be written for. So re-read the authoritative prices
    // here and, if any moved, write them into the cart and send the
    // customer back to review it rather than submitting. The price the
    // order is actually written for is still the one createOrder()
    // re-reads for itself a moment later — this check never supplies it.
    const priceCheck = await getCurrentCartPrices(
      items.map((item) => ({ productVariantId: item.productVariantId, quantity: item.quantity })),
    );
    if (!priceCheck.success) {
      setCheckout({ status: "error", message: priceCheck.error });
      return;
    }
    const reconciliation = reconcileCartPrices(items, priceCheck.data);
    if (reconciliation.changed) {
      replacePrices(reconciliation.items);
      setPriceNotice(PRICE_CHANGE_NOTICE);
      setCheckout({ status: "idle" });
      // Back to the cart step, because that is the only step that shows
      // the per-line prices the customer is being asked to review.
      setStep("cart");
      return;
    }
    // Lines the server declined to price (archived/removed since they
    // were added) are deliberately NOT handled here: createOrder()
    // already refuses them with its own customer-facing message, and
    // duplicating that rule client-side would let the two drift.
    setPriceNotice(null);

    setCheckout({ status: "submitting" });
    const result = await checkoutAction(
      items.map((item) => ({ productVariantId: item.productVariantId, quantity: item.quantity })),
      paymentMethod,
      { name, email, phone },
      { address, ward, district: "", city, note },
      shippingMethodId,
      voucherApplied?.code ?? undefined,
      !voucherApplied && autoPromo ? autoPromo.voucherId : undefined,
      privacyNoticeVersionId,
      privacyConsentAccepted,
    );
    if (result.success) {
      // Only clear the cart on genuine success — a failed checkout must
      // leave every item exactly as the customer had it, so they can fix
      // whatever went wrong (or just retry) without re-adding anything.
      clearCart();
      setCheckout({ status: "success", orderId: result.data.orderId, instructions: result.data.instructions });
    } else {
      setCheckout({ status: "error", message: result.error });
    }
  }

  function handleCartAction<T extends unknown[]>(fn: (...args: T) => void) {
    // Editing the cart after a completed/failed checkout attempt returns
    // the panel to its normal editing state — an old success/error banner
    // must not linger once the customer starts a new cart edit.
    return (...args: T) => {
      if (checkout.status !== "idle" && checkout.status !== "submitting") {
        setCheckout({ status: "idle" });
      }
      // Touching the cart after a price change is the customer reviewing
      // it — the notice has done its job and must not linger.
      setPriceNotice(null);
      // Cart changes invalidate the applied voucher's discount amount
      // (subtotal changed), so clear it and let the customer re-apply.
      if (voucherApplied) handleRemoveVoucher();
      fn(...args);
    };
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        aria-expanded={open}
      >
        {dict.cart.cartButton.replace("{count}", String(itemCount))}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <button
            type="button"
            aria-label={dict.cart.closeCart}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/30"
          />

          {/* Drawer */}
          <div className="relative z-10 flex h-full min-w-0 w-full max-w-md flex-col bg-surface shadow-xl sm:my-3 sm:mr-3 sm:h-[calc(100%-1.5rem)] sm:rounded-2xl sm:border sm:border-border">
            <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{dict.cart.checkout}</p>
                <h2 className="mt-1 text-base font-semibold">
                {checkout.status === "success" ? dict.cart.orderConfirmed : dict.cart.yourCart}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={dict.cart.closeCart}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                ✕
              </button>
            </div>

            {checkout.status !== "success" && items.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto border-b border-border px-5 py-3 sm:px-6">
                {STEP_ORDER.map((s, index) => {
                  const currentIndex = STEP_ORDER.indexOf(step);
                  const isActive = s === step;
                  const isDone = index < currentIndex;
                  return (
                    <div key={s} className="flex flex-1 items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${
                            isActive
                              ? "bg-foreground text-background"
                              : isDone
                                ? "bg-foreground/80 text-background"
                                : "bg-surface-muted text-muted-foreground"
                          }`}
                        >
                          {isDone ? "✓" : index + 1}
                        </span>
                        <span
                          className={`text-xs whitespace-nowrap ${isActive ? "font-medium text-foreground" : "text-muted-foreground"}`}
                        >
                          {dict.cart[STEP_LABEL_KEYS[s]]}
                        </span>
                      </div>
                      {index < STEP_ORDER.length - 1 && (
                        <span className="h-px flex-1 bg-border" aria-hidden="true" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
              {checkout.status === "success" ? (
                <div className="flex flex-col gap-4">
                  <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-green-600 text-base text-white">
                      ✓
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium text-green-900">{dict.payment.orderPlaced}</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <p className="truncate font-mono text-xs text-green-800">{checkout.orderId}</p>
                        <CopyButton value={checkout.orderId} label={dict.common.copy} copiedLabel={dict.common.copied} />
                      </div>
                    </div>
                  </div>

                  {/* Step 51: renders purely off the canonical PaymentInstructions
                      shape — never branches on provider name. "redirect" is
                      MoMo today, "bank_transfer" covers both manual and SePay
                      VA (the presence of qrCodeUrl/virtualAccountNumber is
                      supplementary detail on the same action, not a separate
                      rail), "none" covers cod and any not-yet-actionable case. */}
                  {checkout.instructions.type === "redirect" && (
                    <a
                      href={checkout.instructions.redirectUrl}
                      className="rounded-md bg-foreground px-4 py-2.5 text-center text-sm font-medium text-background transition-opacity hover:opacity-90"
                    >
                      {checkout.instructions.nextAction}
                    </a>
                  )}

                  {checkout.instructions.type === "bank_transfer" && (
                    <div className="rounded-lg border border-border bg-surface-muted p-4">
                      <p className="text-sm font-medium">{checkout.instructions.title}</p>

                      {checkout.instructions.qrCodeUrl && (
                        <div className="mt-3 flex justify-center">
                          {/* eslint-disable-next-line @next/next/no-img-element -- provider-hosted QR image, not a static asset */}
                          <img
                            src={checkout.instructions.qrCodeUrl}
                            alt={dict.payment.paymentQrCode}
                            className="h-48 w-48 rounded-md border border-border bg-white p-2"
                          />
                        </div>
                      )}

                      <div className="mt-3 flex flex-col gap-1.5 text-sm">
                        {checkout.instructions.bankName && (
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">{dict.payment.bank}</span>
                            <span className="font-medium">{checkout.instructions.bankName}</span>
                          </div>
                        )}
                        {(checkout.instructions.accountNumber || checkout.instructions.virtualAccountNumber) && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">
                              {checkout.instructions.virtualAccountNumber ? dict.payment.virtualAccount : dict.payment.accountNumber}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono">
                                {checkout.instructions.virtualAccountNumber ?? checkout.instructions.accountNumber}
                              </span>
                              <CopyButton
                                value={(checkout.instructions.virtualAccountNumber ?? checkout.instructions.accountNumber)!}
                                label={dict.common.copy} copiedLabel={dict.common.copied}
                              />
                            </div>
                          </div>
                        )}
                        {checkout.instructions.accountHolder && (
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">{dict.payment.accountHolder}</span>
                            <span className="font-medium">{checkout.instructions.accountHolder}</span>
                          </div>
                        )}
                        <div className="mt-1 flex items-center justify-between border-t border-border pt-1.5">
                          <span className="text-muted-foreground">{dict.payment.amount}</span>
                          <span className="money text-base font-semibold">
                            {formatVnd(checkout.instructions.amount)}
                          </span>
                        </div>
                        {checkout.instructions.expiresAt && (
                          <p className="text-xs text-muted-foreground">
                            {dict.payment.expires}{" "}
                            {new Date(checkout.instructions.expiresAt).toLocaleString("en-US", {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </p>
                        )}
                      </div>

                      <p className="mt-3 text-xs text-muted-foreground">{checkout.instructions.nextAction}</p>
                    </div>
                  )}

                  {checkout.instructions.type === "none" && (
                    <p className="rounded-lg border border-border bg-surface-muted p-4 text-sm text-muted-foreground">
                      {checkout.instructions.nextAction}
                    </p>
                  )}
                </div>
              ) : items.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center">
                  <p className="text-sm text-muted-foreground">{dict.cart.cartEmpty}</p>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="text-xs text-foreground underline underline-offset-2"
                  >
                    {dict.common.continueShopping}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-6">
                  {step === "cart" && (
                  <>
                  {/* Cart Price Reconciliation: sits above the lines it is
                      asking the customer to look at. role="status" rather
                      than "alert" — nothing has gone wrong, and the prices
                      shown below are already correct by the time this
                      renders. */}
                  {priceNotice && (
                    <p
                      role="status"
                      className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-foreground"
                    >
                      {priceNotice}
                    </p>
                  )}
                  <ul className="flex flex-col gap-4">
                    {items.map((item) => {
                      const available = availabilityByVariant[item.productVariantId];
                      const atAvailableLimit = typeof available === "number" && item.quantity >= available;
                      return (
                        <li key={item.productVariantId} className="flex min-w-0 items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-1 items-start gap-3">
                            {/* Step 45: display-only thumbnail, same posture as
                                price — never re-fetched/re-validated here. */}
                            {item.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra, see ProductList.tsx
                              <img
                                src={item.imageUrl}
                                alt={item.productName}
                                className="h-14 w-14 rounded-md object-cover"
                              />
                            ) : (
                              // A CSV-imported product can have no media. Without
                              // this the row simply lost its thumbnail and the
                              // text jumped left, so one line in the cart sat out
                              // of alignment with the rest.
                              <span
                                aria-hidden="true"
                                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-surface-muted text-[10px] text-muted-foreground"
                              >
                                {dict.products.noImage}
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <span className="block break-words text-sm">{item.productName}</span>
                              {item.variantLabel && (
                                <span className="block break-words text-xs text-muted-foreground">{item.variantLabel}</span>
                              )}
                              <span className="mt-0.5 flex flex-wrap items-baseline gap-1.5">
                                {item.originalPrice != null && (
                                  <span className="money text-[11px] text-muted-foreground line-through">
                                    {formatVnd(item.originalPrice)}
                                  </span>
                                )}
                                <span className="money text-xs">{formatVnd(item.price)}</span>
                                {(item.discountPercent != null || (item.discountAmount != null && item.discountAmount > 0)) && (
                                  <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-medium text-white">
                                    {item.discountPercent != null
                                      ? `−${item.discountPercent}%`
                                      : `−${formatVnd(item.discountAmount!)}`}
                                  </span>
                                )}
                              </span>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={handleCartAction(() => updateQuantity(item.productVariantId, item.quantity - 1))}
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-border transition-colors hover:bg-surface-muted"
                                aria-label={dict.cart.decreaseQuantity.replace("{name}", item.productName)}
                              >
                                −
                              </button>
                              <span className="w-6 text-center text-sm">{item.quantity}</span>
                              <button
                                type="button"
                                onClick={handleCartAction(() => updateQuantity(item.productVariantId, item.quantity + 1))}
                                disabled={atAvailableLimit}
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-border transition-colors hover:bg-surface-muted disabled:opacity-40"
                                aria-label={dict.cart.increaseQuantity.replace("{name}", item.productName)}
                              >
                                +
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={handleCartAction(() => removeItem(item.productVariantId))}
                              className="text-xs text-red-600 hover:underline"
                            >
                              {dict.cart.remove}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  </>
                  )}

                  {step === "shipping" && !privacyNoticeVersionId && (
                    <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                      {dict.checkout.privacyNoticeUnavailable}{' '}
                      <a href="/privacy" target="_blank" rel="noreferrer" className="underline">
                        {dict.privacy.title}
                      </a>
                    </p>
                  )}
                  {step === "shipping" && privacyNoticeVersionId && (
                  <>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={privacyConsentAccepted}
                      required
                      onChange={(event) =>
                        setConsentedPrivacyNoticeVersionId(
                          event.target.checked ? privacyNoticeVersionId : null,
                        )
                      }
                      className="mt-1"
                    />
                    <span>
                      {dict.checkout.privacyConsentBeforeLink}
                      <a
                        href="/privacy"
                        target="_blank"
                        rel="noreferrer"
                        aria-label={dict.checkout.privacyNoticeLink}
                        className="underline"
                      >
                        {dict.checkout.privacyConsentLink}
                      </a>
                      {dict.checkout.privacyConsentAfterLink}
                    </span>
                  </label>
                  <fieldset className="flex flex-col gap-3">
                    <legend className="mb-1 text-sm font-medium">{dict.checkout.contactInfo}</legend>
                    <label className="flex flex-col gap-1 text-xs">
                      {dict.checkout.fullName}
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={dict.checkout.namePlaceholder}
                        className={fieldErrors.name ? errorInputClassName : inputClassName}
                      />
                      {fieldErrors.name && <span className="text-red-600">{fieldErrors.name}</span>}
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      {dict.checkout.email}
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={dict.checkout.emailPlaceholder}
                        className={fieldErrors.email ? errorInputClassName : inputClassName}
                      />
                      {fieldErrors.email && <span className="text-red-600">{fieldErrors.email}</span>}
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      {dict.checkout.phone}
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder={dict.checkout.phonePlaceholder}
                        className={fieldErrors.phone ? errorInputClassName : inputClassName}
                      />
                      {fieldErrors.phone && <span className="text-red-600">{fieldErrors.phone}</span>}
                    </label>
                  </fieldset>

                  <fieldset className="flex flex-col gap-3">
                    <legend className="mb-1 text-sm font-medium">{dict.checkout.shippingAddress}</legend>
                    {/* Province -> ward, per Vietnam's current (post-July-
                        2025) 2-tier administrative structure — see
                        public/vn-address.json and the VnProvince comment
                        above. Ward select is disabled until a province is
                        chosen, and resets if the province changes, since a
                        ward name only makes sense within its own province. */}
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1 text-xs">
                        {dict.checkout.provinceCity}
                        <select
                          value={city}
                          onChange={(e) => {
                            setCity(e.target.value);
                            setWard("");
                          }}
                          className={fieldErrors.city ? errorSelectClassName : selectClassName}
                        >
                          <option value="">{dict.checkout.selectProvince}</option>
                          {provinces.map((p) => (
                            <option key={p.province} value={p.province}>
                              {p.province}
                            </option>
                          ))}
                        </select>
                        {fieldErrors.city && <span className="text-red-600">{fieldErrors.city}</span>}
                      </label>
                      <label className="flex flex-col gap-1 text-xs">
                        {dict.checkout.ward}
                        <select
                          value={ward}
                          onChange={(e) => setWard(e.target.value)}
                          disabled={!selectedProvince}
                          className={`${fieldErrors.ward ? errorSelectClassName : selectClassName} disabled:opacity-50`}
                        >
                          <option value="">{selectedProvince ? dict.checkout.selectWard : dict.checkout.selectProvinceFirst}</option>
                          {selectedProvince?.wards.map((w) => (
                            <option key={w} value={w}>
                              {w}
                            </option>
                          ))}
                        </select>
                        {fieldErrors.ward && <span className="text-red-600">{fieldErrors.ward}</span>}
                      </label>
                    </div>
                    <label className="flex flex-col gap-1 text-xs">
                      {dict.checkout.streetAddress}
                      <input
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder={dict.checkout.addressPlaceholder}
                        className={fieldErrors.address ? errorInputClassName : inputClassName}
                      />
                      {fieldErrors.address && <span className="text-red-600">{fieldErrors.address}</span>}
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      {dict.checkout.deliveryNote}
                      <input
                        type="text"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={dict.checkout.deliveryNotePlaceholder}
                        className={inputClassName}
                      />
                    </label>
                  </fieldset>

                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1 text-sm font-medium">{dict.checkout.shippingMethod}</legend>
                    {enabledShippingMethods.length === 0 ? (
                      <p className="text-xs text-red-600">{dict.checkout.noShippingMethod}</p>
                    ) : (
                      enabledShippingMethods.map((method) => (
                        <label
                          key={method.id}
                          className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                            shippingMethodId === method.id
                              ? "border-foreground bg-surface-muted"
                              : "border-border hover:bg-surface-muted"
                          }`}
                        >
                          <span className="flex items-center gap-3">
                            <input
                              type="radio"
                              name="shippingMethod"
                              value={method.id}
                              checked={shippingMethodId === method.id}
                              onChange={() => setShippingMethodId(method.id)}
                              className="flex-shrink-0"
                            />
                            <span className="font-medium">{method.name}</span>
                          </span>
                          <span className="money text-xs">{method.amount === 0 ? dict.common.free : formatVnd(method.amount)}</span>
                        </label>
                      ))
                    )}
                    {fieldErrors.shippingMethod && <span className="text-xs text-red-600">{fieldErrors.shippingMethod}</span>}
                  </fieldset>
                  </>
                  )}

                  {step === "payment" && (
                  <>
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1 text-sm font-medium">{dict.checkout.paymentMethod}</legend>
                    {enabledPaymentMethods.length === 0 ? (
                      <p className="text-xs text-red-600">{dict.checkout.noPaymentMethod}</p>
                    ) : (
                      enabledPaymentMethods.map((method) => (
                        <label
                          key={method}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                            paymentMethod === method
                              ? "border-foreground bg-surface-muted"
                              : "border-border hover:bg-surface-muted"
                          }`}
                        >
                          <input
                            type="radio"
                            name="paymentMethod"
                            value={method}
                            checked={paymentMethod === method}
                            onChange={() => setPaymentMethod(method)}
                            className="flex-shrink-0"
                          />
                          <div className="flex flex-col">
                            <span className="font-medium">{PAYMENT_LABEL_KEYS[method] ? paymentDict[PAYMENT_LABEL_KEYS[method][0]] : method}</span>
                            {PAYMENT_LABEL_KEYS[method] && (
                              <span className="text-xs text-muted-foreground">{paymentDict[PAYMENT_LABEL_KEYS[method][1]]}</span>
                            )}
                          </div>
                        </label>
                      ))
                    )}
                  </fieldset>

                  {checkout.status === "error" && (
                    <p className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                      {checkout.message}
                    </p>
                  )}
                  </>
                  )}
                </div>
              )}
            </div>

            {checkout.status !== "success" && items.length > 0 && (
              <div className="border-t border-border px-5 py-4">
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{dict.cart.subtotal}</span>
                  <span className="money">{formatVnd(subtotal)}</span>
                </div>
                <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{dict.cart.shipping}</span>
                  {/* Only a chosen method can be "Free". With none chosen
                      — including a store that has enabled none at all,
                      where checkout is blocked entirely — this used to
                      read "Free", promising free delivery the shop had
                      not actually offered. */}
                  <span className="money">
                    {selectedShippingMethod ? (
                      selectedShippingMethod.amount === 0 ? (
                        dict.common.free
                      ) : (
                        formatVnd(selectedShippingMethod.amount)
                      )
                    ) : (
                      <>
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">{dict.common.notSelectedYet}</span>
                      </>
                    )}
                  </span>
                </div>
                {/* Auto-promotion banner */}
                {autoPromo && !voucherApplied && (
                  <div className="mb-2 flex items-center justify-between rounded-md border border-green-200 bg-green-50 px-2.5 py-1.5 text-xs dark:border-green-800 dark:bg-green-950">
                    <span className="font-medium text-green-700 dark:text-green-400">
                      {autoPromo.label}
                    </span>
                    <span className="money font-medium text-green-700 dark:text-green-400">
                      −{formatVnd(autoPromo.discountAmount)}
                    </span>
                  </div>
                )}
                {/* Voucher code input */}
                {!voucherApplied ? (
                  <div className="mb-2">
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={voucherInput}
                        onChange={(e) => { setVoucherInput(e.target.value); setVoucherError(null); }}
                        placeholder={(dict.voucher as Record<string, string>).enterCode}
                        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs uppercase placeholder:normal-case focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleApplyVoucher(); } }}
                      />
                      <button
                        type="button"
                        onClick={handleApplyVoucher}
                        disabled={voucherLoading || !voucherInput.trim()}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-muted disabled:opacity-40"
                      >
                        {voucherLoading ? (dict.voucher as Record<string, string>).applying : (dict.voucher as Record<string, string>).apply}
                      </button>
                    </div>
                    {voucherError && <p className="mt-1 text-xs text-red-600">{voucherError}</p>}
                  </div>
                ) : (
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-medium text-green-700">
                      {(dict.voucher as Record<string, string>).applied.replace("{code}", voucherApplied.code)}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="money text-green-700">−{formatVnd(voucherApplied.discountAmount)}</span>
                      <button
                        type="button"
                        onClick={handleRemoveVoucher}
                        className="text-muted-foreground underline hover:text-foreground"
                      >
                        {(dict.voucher as Record<string, string>).remove}
                      </button>
                    </div>
                  </div>
                )}
                <div className="mb-3 flex items-center justify-between border-t border-border pt-2 text-sm">
                  <span className="text-muted-foreground">{dict.cart.total}</span>
                  <span className="money text-base font-semibold">{formatVnd(total)}</span>
                </div>
                {step === "shipping" && enabledPaymentMethods.length === 0 && (
                  <p className="mb-3 text-xs text-red-600" role="status">
                    {dict.checkout.noPaymentMethod}
                  </p>
                )}
                <div className="flex gap-2">
                  {step !== "cart" && (
                    <button
                      type="button"
                      onClick={handleBack}
                      disabled={checkout.status === "submitting"}
                      className="rounded-md border border-border px-4 py-3 text-sm font-medium transition-colors hover:bg-surface-muted disabled:opacity-40"
                    >
                      {dict.common.back}
                    </button>
                  )}
                  {step === "cart" && (
                    <button
                      type="button"
                      onClick={() => setStep("shipping")}
                      className="flex-1 rounded-md bg-foreground px-4 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
                    >
                      {dict.cart.continueToShipping}
                    </button>
                  )}
                  {step === "shipping" && (
                    <button
                      type="button"
                      onClick={handleContinueToPayment}
                      disabled={
                        !privacyNoticeVersionId ||
                        !privacyConsentAccepted ||
                        enabledPaymentMethods.length === 0 ||
                        enabledShippingMethods.length === 0
                      }
                      className="flex-1 rounded-md bg-foreground px-4 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      {dict.cart.continueToPayment}
                    </button>
                  )}
                  {step === "payment" && (
                    <button
                      type="button"
                      onClick={handleCheckout}
                      disabled={
                        checkout.status === "submitting" ||
                        checkout.status === "validating" ||
                        !privacyNoticeVersionId ||
                        !privacyConsentAccepted ||
                        enabledPaymentMethods.length === 0 ||
                        enabledShippingMethods.length === 0
                      }
                      className="flex-1 rounded-md bg-foreground px-4 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      {checkout.status === "submitting" ? dict.cart.placingOrder : dict.cart.placeOrder}
                    </button>
                  )}
                </div>
                {step === "cart" && (
                  <button
                    type="button"
                    onClick={handleCartAction(clearCart)}
                    className="mt-2 w-full text-center text-xs text-muted-foreground underline hover:text-foreground"
                  >
                    {dict.cart.clearCart}
                  </button>
                )}
              </div>
            )}

            {checkout.status === "success" && (
              <div className="border-t border-border px-5 py-4">
                <div className="flex gap-2">
                  <a
                    // Phase 5 (post-purchase friction): the email is only
                    // ever used to PREFILL the lookup form's input below —
                    // the customer still has to submit it themselves
                    // (order-queries.ts's getOrderForCustomer() remains the
                    // sole authority). This just saves retyping an email
                    // they entered seconds ago, in their own browser tab,
                    // right after submitting it themselves.
                    href={`/orders/${checkout.orderId}?email=${encodeURIComponent(email)}`}
                    className="flex-1 rounded-md border border-border px-4 py-2.5 text-center text-sm font-medium transition-colors hover:bg-surface-muted"
                  >
                    {dict.cart.viewYourOrder}
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setCheckout({ status: "idle" });
                      setStep("cart");
                      setOpen(false);
                    }}
                    className="flex-1 rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
                  >
                    {dict.common.continueShopping}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
