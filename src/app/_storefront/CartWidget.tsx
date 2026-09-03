"use client";

import { useState } from "react";
import { useCart } from "./cart-context";
import { checkoutAction } from "./checkout-actions";
import { isValidVietnamesePhone } from "@/lib/validation/phone";
import type { PaymentInstructions } from "@/lib/payments/provider";

function formatVnd(price: number): string {
  return `${price.toLocaleString("vi-VN")} ₫`;
}

const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Step 51: labels only — which of these actually appear is driven by
// `enabledPaymentMethods` (server-resolved from TenantPaymentMethod), not
// hardcoded per tenant. All three remain valid PaymentMethod values; a
// tenant simply may not have enabled/configured all of them.
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cod: "Cash on delivery",
  momo: "MoMo",
  bank_transfer: "Bank transfer",
};

const inputClassName =
  "rounded-md border border-border bg-background px-2.5 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20";
const errorInputClassName =
  "rounded-md border border-red-400 bg-background px-2.5 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40";

type FieldErrors = Partial<Record<"name" | "email" | "phone" | "address" | "ward" | "district" | "city", string>>;

type CheckoutState =
  | { status: "idle" }
  | { status: "validating" }
  | { status: "submitting" }
  | { status: "success"; orderId: string; instructions: PaymentInstructions }
  | { status: "error"; message: string };

// Minimal V1 cart + checkout panel: count, list, quantity +/-, remove,
// clear, and a checkout action that hands the cart's (productVariantId,
// quantity) pairs to the server — see checkout-actions.ts for why nothing
// else about the cart is ever sent, and cart-context.tsx for why the
// prices shown here are convenience-only, not authoritative.
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
}: {
  availabilityByVariant: Record<string, number>;
  // Step 51: server-resolved from TenantPaymentMethod (see
  // payment-service.ts's getEnabledPaymentMethods) — UX only, so a
  // customer never sees a method the tenant hasn't configured; the real
  // enforcement is server-side in createOrder(), unaffected by this prop.
  enabledPaymentMethods: string[];
}) {
  const { items, itemCount, updateQuantity, removeItem, clearCart } = useCart();
  const [open, setOpen] = useState(false);
  const [checkout, setCheckout] = useState<CheckoutState>({ status: "idle" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [paymentMethod, setPaymentMethod] = useState<string>(enabledPaymentMethods[0] ?? "cod");
  // Step 32: guest-checkout contact info — no login, no session, no
  // account. Kept as plain component state, same as paymentMethod above.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  // Step 34: order-time shipping address — plain component state, same as
  // the contact-info fields above. No saved addresses, no reuse across
  // orders.
  const [address, setAddress] = useState("");
  const [ward, setWard] = useState("");
  const [district, setDistrict] = useState("");
  const [city, setCity] = useState("");
  const [note, setNote] = useState("");

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  // Step 51: fast client-side feedback only — every one of these rules is
  // re-checked authoritatively server-side in order-mutations.ts. Never
  // relies on HTML `required` alone.
  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!name.trim()) errors.name = "Full name is required.";
    if (!email.trim() || !BASIC_EMAIL_PATTERN.test(email.trim())) errors.email = "A valid email is required.";
    if (!phone.trim() || !isValidVietnamesePhone(phone)) errors.phone = "A valid Vietnamese phone number is required.";
    if (!address.trim()) errors.address = "Address is required.";
    if (!ward.trim()) errors.ward = "Ward is required.";
    if (!district.trim()) errors.district = "District is required.";
    if (!city.trim()) errors.city = "City is required.";
    return errors;
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
    setCheckout({ status: "validating" });
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setCheckout({ status: "idle" });
      return;
    }

    setCheckout({ status: "submitting" });
    const result = await checkoutAction(
      items.map((item) => ({ productVariantId: item.productVariantId, quantity: item.quantity })),
      paymentMethod,
      { name, email, phone },
      { address, ward, district, city, note },
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
      fn(...args);
    };
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-muted"
        aria-expanded={open}
      >
        Cart ({itemCount})
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-2 w-80 rounded-lg border border-border bg-surface p-4 text-sm shadow-lg">
          {checkout.status === "success" ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-green-600 text-white">
                  ✓
                </span>
                <div>
                  <p className="font-medium">Order placed!</p>
                  <p className="font-mono text-xs text-muted-foreground">{checkout.orderId}</p>
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
                  className="self-start rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
                >
                  {checkout.instructions.nextAction}
                </a>
              )}

              {checkout.instructions.type === "bank_transfer" && (
                <div className="rounded-md border border-border bg-surface-muted p-3 text-xs">
                  <p className="font-medium">{checkout.instructions.title}</p>
                  {checkout.instructions.bankName && <p className="mt-1">{checkout.instructions.bankName}</p>}
                  {(checkout.instructions.accountNumber || checkout.instructions.virtualAccountNumber) && (
                    <p className="font-mono">
                      {checkout.instructions.virtualAccountNumber ?? checkout.instructions.accountNumber}
                    </p>
                  )}
                  {checkout.instructions.accountHolder && <p>{checkout.instructions.accountHolder}</p>}
                  {checkout.instructions.qrCodeUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- provider-hosted QR image, not a static asset
                    <img src={checkout.instructions.qrCodeUrl} alt="Payment QR code" className="mt-2 h-32 w-32" />
                  )}
                  <p className="mt-1 font-mono">{formatVnd(checkout.instructions.amount)}</p>
                  {checkout.instructions.expiresAt && (
                    <p className="mt-1 text-muted-foreground">
                      Expires: {new Date(checkout.instructions.expiresAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  )}
                  <p className="mt-2 text-muted-foreground">{checkout.instructions.nextAction}</p>
                </div>
              )}

              {checkout.instructions.type === "none" && (
                <p className="text-xs text-muted-foreground">{checkout.instructions.nextAction}</p>
              )}

              {/* Bookmarkable order-confirmation link — the customer's only
                  way to check this order's status again after leaving this
                  page (see src/app/orders/[orderId]/page.tsx). */}
              <a
                href={`/orders/${checkout.orderId}`}
                className="self-start rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-muted"
              >
                View your order
              </a>
              <button
                type="button"
                onClick={() => setCheckout({ status: "idle" })}
                className="self-start text-xs text-muted-foreground underline hover:text-foreground"
              >
                Continue shopping
              </button>
            </div>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground">Your cart is empty.</p>
          ) : (
            <>
              <ul className="flex flex-col gap-3">
                {items.map((item) => {
                  const available = availabilityByVariant[item.productVariantId];
                  const atAvailableLimit = typeof available === "number" && item.quantity >= available;
                  return (
                    <li key={item.productVariantId} className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        {/* Step 45: display-only thumbnail, same posture as
                            price — never re-fetched/re-validated here. */}
                        {item.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra, see ProductList.tsx
                          <img src={item.imageUrl} alt={item.productName} className="h-10 w-10 rounded-md object-cover" />
                        )}
                        <div className="flex flex-col">
                          <span>{item.productName}</span>
                          {item.variantLabel && (
                            <span className="text-xs text-muted-foreground">{item.variantLabel}</span>
                          )}
                          <span className="font-mono text-xs">{formatVnd(item.price)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={handleCartAction(() => updateQuantity(item.productVariantId, item.quantity - 1))}
                          className="flex h-6 w-6 items-center justify-center rounded-md border border-border transition-colors hover:bg-surface-muted"
                          aria-label={`Decrease quantity of ${item.productName}`}
                        >
                          −
                        </button>
                        <span className="w-5 text-center">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={handleCartAction(() => updateQuantity(item.productVariantId, item.quantity + 1))}
                          disabled={atAvailableLimit}
                          className="flex h-6 w-6 items-center justify-center rounded-md border border-border transition-colors hover:bg-surface-muted disabled:opacity-40"
                          aria-label={`Increase quantity of ${item.productName}`}
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={handleCartAction(() => removeItem(item.productVariantId))}
                          className="ml-1 text-xs text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs">
                <span className="text-muted-foreground">
                  Subtotal (final total confirmed at checkout)
                </span>
                <span className="font-mono">{formatVnd(subtotal)}</span>
              </div>

              <fieldset className="mt-3 flex flex-col gap-2 text-xs">
                <legend className="mb-1 text-muted-foreground">Contact info</legend>
                <label className="flex flex-col gap-1">
                  Full name
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={fieldErrors.name ? errorInputClassName : inputClassName}
                  />
                  {fieldErrors.name && <span className="text-red-600">{fieldErrors.name}</span>}
                </label>
                <label className="flex flex-col gap-1">
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={fieldErrors.email ? errorInputClassName : inputClassName}
                  />
                  {fieldErrors.email && <span className="text-red-600">{fieldErrors.email}</span>}
                </label>
                <label className="flex flex-col gap-1">
                  Phone
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0912345678"
                    className={fieldErrors.phone ? errorInputClassName : inputClassName}
                  />
                  {fieldErrors.phone && <span className="text-red-600">{fieldErrors.phone}</span>}
                </label>
              </fieldset>

              <fieldset className="mt-3 flex flex-col gap-2 text-xs">
                <legend className="mb-1 text-muted-foreground">Shipping address</legend>
                <label className="flex flex-col gap-1">
                  Address
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className={fieldErrors.address ? errorInputClassName : inputClassName}
                  />
                  {fieldErrors.address && <span className="text-red-600">{fieldErrors.address}</span>}
                </label>
                <label className="flex flex-col gap-1">
                  Ward
                  <input
                    type="text"
                    value={ward}
                    onChange={(e) => setWard(e.target.value)}
                    className={fieldErrors.ward ? errorInputClassName : inputClassName}
                  />
                  {fieldErrors.ward && <span className="text-red-600">{fieldErrors.ward}</span>}
                </label>
                <label className="flex flex-col gap-1">
                  District
                  <input
                    type="text"
                    value={district}
                    onChange={(e) => setDistrict(e.target.value)}
                    className={fieldErrors.district ? errorInputClassName : inputClassName}
                  />
                  {fieldErrors.district && <span className="text-red-600">{fieldErrors.district}</span>}
                </label>
                <label className="flex flex-col gap-1">
                  City
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className={fieldErrors.city ? errorInputClassName : inputClassName}
                  />
                  {fieldErrors.city && <span className="text-red-600">{fieldErrors.city}</span>}
                </label>
                <label className="flex flex-col gap-1">
                  Delivery note
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className={inputClassName}
                  />
                </label>
              </fieldset>

              <fieldset className="mt-3 flex flex-col gap-1.5 text-xs">
                <legend className="mb-1 text-muted-foreground">Payment method</legend>
                {enabledPaymentMethods.length === 0 ? (
                  <p className="text-red-600">This store hasn&apos;t enabled any payment method yet.</p>
                ) : (
                  enabledPaymentMethods.map((method) => (
                    <label key={method} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="paymentMethod"
                        value={method}
                        checked={paymentMethod === method}
                        onChange={() => setPaymentMethod(method)}
                      />
                      {PAYMENT_METHOD_LABELS[method] ?? method}
                    </label>
                  ))
                )}
              </fieldset>

              {checkout.status === "error" && (
                <p className="mt-2 text-xs text-red-600">{checkout.message}</p>
              )}

              <div className="mt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleCartAction(clearCart)}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Clear cart
                </button>
                <button
                  type="button"
                  onClick={handleCheckout}
                  disabled={checkout.status === "submitting" || checkout.status === "validating" || enabledPaymentMethods.length === 0}
                  className="rounded-md bg-foreground px-4 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {checkout.status === "submitting" ? "Placing order…" : "Checkout"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
