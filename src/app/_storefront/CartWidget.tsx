"use client";

import { useEffect, useState } from "react";
import { useCart } from "./cart-context";
import { checkoutAction } from "./checkout-actions";
import { isValidVietnamesePhone } from "@/lib/validation/phone";
import type { PaymentInstructions } from "@/lib/payments/provider";
import type { ShippingMethodOption } from "@/lib/shipping-service";

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

const PAYMENT_METHOD_HINTS: Record<string, string> = {
  cod: "Pay in cash when your order arrives",
  momo: "Pay instantly via the MoMo app",
  bank_transfer: "Transfer the exact amount to complete your order",
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

// Small, self-contained "copy to clipboard" button — used for the order id
// and bank/VA account number in the success panel, where a customer is
// very likely to need to paste the value elsewhere (their banking app).
function CopyButton({ value, label }: { value: string; label: string }) {
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
      {copied ? "Copied!" : label}
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
}) {
  const { items, itemCount, updateQuantity, removeItem, clearCart } = useCart();
  const [open, setOpen] = useState(false);
  const [checkout, setCheckout] = useState<CheckoutState>({ status: "idle" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
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
  const selectedShippingAmount = enabledShippingMethods.find((m) => m.id === shippingMethodId)?.amount ?? 0;
  const total = subtotal + selectedShippingAmount;

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
    if (!name.trim()) errors.name = "Full name is required.";
    if (!email.trim() || !BASIC_EMAIL_PATTERN.test(email.trim())) errors.email = "A valid email is required.";
    if (!phone.trim() || !isValidVietnamesePhone(phone)) errors.phone = "A valid Vietnamese phone number is required.";
    if (!address.trim()) errors.address = "Street address is required.";
    if (!city.trim()) errors.city = "Please select a province/city.";
    if (!ward.trim()) errors.ward = "Please select a ward.";
    if (!shippingMethodId) errors.shippingMethod = "Please select a shipping method.";
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
      { address, ward, district: "", city, note },
      shippingMethodId,
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
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-muted"
        aria-expanded={open}
      >
        Cart ({itemCount})
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close cart"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/30"
          />

          {/* Drawer */}
          <div className="relative flex h-full w-full max-w-md flex-col bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-base font-medium">
                {checkout.status === "success" ? "Order confirmed" : "Your cart"}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close cart"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {checkout.status === "success" ? (
                <div className="flex flex-col gap-4">
                  <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-green-600 text-base text-white">
                      ✓
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium text-green-900">Your order was placed</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <p className="truncate font-mono text-xs text-green-800">{checkout.orderId}</p>
                        <CopyButton value={checkout.orderId} label="Copy" />
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
                            alt="Payment QR code"
                            className="h-48 w-48 rounded-md border border-border bg-white p-2"
                          />
                        </div>
                      )}

                      <div className="mt-3 flex flex-col gap-1.5 text-sm">
                        {checkout.instructions.bankName && (
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Bank</span>
                            <span className="font-medium">{checkout.instructions.bankName}</span>
                          </div>
                        )}
                        {(checkout.instructions.accountNumber || checkout.instructions.virtualAccountNumber) && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">
                              {checkout.instructions.virtualAccountNumber ? "Virtual account" : "Account number"}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono">
                                {checkout.instructions.virtualAccountNumber ?? checkout.instructions.accountNumber}
                              </span>
                              <CopyButton
                                value={(checkout.instructions.virtualAccountNumber ?? checkout.instructions.accountNumber)!}
                                label="Copy"
                              />
                            </div>
                          </div>
                        )}
                        {checkout.instructions.accountHolder && (
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Account holder</span>
                            <span className="font-medium">{checkout.instructions.accountHolder}</span>
                          </div>
                        )}
                        <div className="mt-1 flex items-center justify-between border-t border-border pt-1.5">
                          <span className="text-muted-foreground">Amount</span>
                          <span className="font-mono text-base font-semibold">
                            {formatVnd(checkout.instructions.amount)}
                          </span>
                        </div>
                        {checkout.instructions.expiresAt && (
                          <p className="text-xs text-muted-foreground">
                            Expires:{" "}
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
                  <p className="text-sm text-muted-foreground">Your cart is empty.</p>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="text-xs text-foreground underline underline-offset-2"
                  >
                    Continue shopping
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-6">
                  <ul className="flex flex-col gap-4">
                    {items.map((item) => {
                      const available = availabilityByVariant[item.productVariantId];
                      const atAvailableLimit = typeof available === "number" && item.quantity >= available;
                      return (
                        <li key={item.productVariantId} className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            {/* Step 45: display-only thumbnail, same posture as
                                price — never re-fetched/re-validated here. */}
                            {item.imageUrl && (
                              // eslint-disable-next-line @next/next/no-img-element -- deliberate: no image-optimization infra, see ProductList.tsx
                              <img
                                src={item.imageUrl}
                                alt={item.productName}
                                className="h-14 w-14 rounded-md object-cover"
                              />
                            )}
                            <div className="flex flex-col">
                              <span className="text-sm">{item.productName}</span>
                              {item.variantLabel && (
                                <span className="text-xs text-muted-foreground">{item.variantLabel}</span>
                              )}
                              <span className="mt-0.5 font-mono text-xs">{formatVnd(item.price)}</span>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={handleCartAction(() => updateQuantity(item.productVariantId, item.quantity - 1))}
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-border transition-colors hover:bg-surface-muted"
                                aria-label={`Decrease quantity of ${item.productName}`}
                              >
                                −
                              </button>
                              <span className="w-6 text-center text-sm">{item.quantity}</span>
                              <button
                                type="button"
                                onClick={handleCartAction(() => updateQuantity(item.productVariantId, item.quantity + 1))}
                                disabled={atAvailableLimit}
                                className="flex h-7 w-7 items-center justify-center rounded-md border border-border transition-colors hover:bg-surface-muted disabled:opacity-40"
                                aria-label={`Increase quantity of ${item.productName}`}
                              >
                                +
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={handleCartAction(() => removeItem(item.productVariantId))}
                              className="text-xs text-red-600 hover:underline"
                            >
                              Remove
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="flex items-center justify-between rounded-lg bg-surface-muted px-3 py-2.5 text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-mono font-medium">{formatVnd(subtotal)}</span>
                  </div>

                  <fieldset className="flex flex-col gap-3">
                    <legend className="mb-1 text-sm font-medium">Contact info</legend>
                    <label className="flex flex-col gap-1 text-xs">
                      Full name
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Nguyen Van A"
                        className={fieldErrors.name ? errorInputClassName : inputClassName}
                      />
                      {fieldErrors.name && <span className="text-red-600">{fieldErrors.name}</span>}
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      Email
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className={fieldErrors.email ? errorInputClassName : inputClassName}
                      />
                      {fieldErrors.email && <span className="text-red-600">{fieldErrors.email}</span>}
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
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

                  <fieldset className="flex flex-col gap-3">
                    <legend className="mb-1 text-sm font-medium">Shipping address</legend>
                    {/* Province -> ward, per Vietnam's current (post-July-
                        2025) 2-tier administrative structure — see
                        public/vn-address.json and the VnProvince comment
                        above. Ward select is disabled until a province is
                        chosen, and resets if the province changes, since a
                        ward name only makes sense within its own province. */}
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1 text-xs">
                        Province / City
                        <select
                          value={city}
                          onChange={(e) => {
                            setCity(e.target.value);
                            setWard("");
                          }}
                          className={fieldErrors.city ? errorSelectClassName : selectClassName}
                        >
                          <option value="">Select a province…</option>
                          {provinces.map((p) => (
                            <option key={p.province} value={p.province}>
                              {p.province}
                            </option>
                          ))}
                        </select>
                        {fieldErrors.city && <span className="text-red-600">{fieldErrors.city}</span>}
                      </label>
                      <label className="flex flex-col gap-1 text-xs">
                        Ward
                        <select
                          value={ward}
                          onChange={(e) => setWard(e.target.value)}
                          disabled={!selectedProvince}
                          className={`${fieldErrors.ward ? errorSelectClassName : selectClassName} disabled:opacity-50`}
                        >
                          <option value="">{selectedProvince ? "Select a ward…" : "Select a province first"}</option>
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
                      Street address
                      <input
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="House number, street name"
                        className={fieldErrors.address ? errorInputClassName : inputClassName}
                      />
                      {fieldErrors.address && <span className="text-red-600">{fieldErrors.address}</span>}
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      Delivery note (optional)
                      <input
                        type="text"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="e.g. Leave with the receptionist"
                        className={inputClassName}
                      />
                    </label>
                  </fieldset>

                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1 text-sm font-medium">Shipping method</legend>
                    {enabledShippingMethods.length === 0 ? (
                      <p className="text-xs text-red-600">This store hasn&apos;t enabled any shipping method yet.</p>
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
                          <span className="font-mono text-xs">{method.amount === 0 ? "Free" : formatVnd(method.amount)}</span>
                        </label>
                      ))
                    )}
                    {fieldErrors.shippingMethod && <span className="text-xs text-red-600">{fieldErrors.shippingMethod}</span>}
                  </fieldset>

                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1 text-sm font-medium">Payment method</legend>
                    {enabledPaymentMethods.length === 0 ? (
                      <p className="text-xs text-red-600">This store hasn&apos;t enabled any payment method yet.</p>
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
                            <span className="font-medium">{PAYMENT_METHOD_LABELS[method] ?? method}</span>
                            {PAYMENT_METHOD_HINTS[method] && (
                              <span className="text-xs text-muted-foreground">{PAYMENT_METHOD_HINTS[method]}</span>
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
                </div>
              )}
            </div>

            {checkout.status !== "success" && items.length > 0 && (
              <div className="border-t border-border px-5 py-4">
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="font-mono">{formatVnd(subtotal)}</span>
                </div>
                <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Shipping</span>
                  <span className="font-mono">{selectedShippingAmount === 0 ? "Free" : formatVnd(selectedShippingAmount)}</span>
                </div>
                <div className="mb-3 flex items-center justify-between border-t border-border pt-2 text-sm">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-mono text-base font-semibold">{formatVnd(total)}</span>
                </div>
                <button
                  type="button"
                  onClick={handleCheckout}
                  disabled={
                    checkout.status === "submitting" ||
                    checkout.status === "validating" ||
                    enabledPaymentMethods.length === 0 ||
                    enabledShippingMethods.length === 0
                  }
                  className="w-full rounded-md bg-foreground px-4 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {checkout.status === "submitting" ? "Placing order…" : "Checkout"}
                </button>
                <button
                  type="button"
                  onClick={handleCartAction(clearCart)}
                  className="mt-2 w-full text-center text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Clear cart
                </button>
              </div>
            )}

            {checkout.status === "success" && (
              <div className="border-t border-border px-5 py-4">
                <div className="flex gap-2">
                  <a
                    href={`/orders/${checkout.orderId}`}
                    className="flex-1 rounded-md border border-border px-4 py-2.5 text-center text-sm font-medium transition-colors hover:bg-surface-muted"
                  >
                    View your order
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setCheckout({ status: "idle" });
                      setOpen(false);
                    }}
                    className="flex-1 rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
                  >
                    Continue shopping
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
