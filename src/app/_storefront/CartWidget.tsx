"use client";

import { useState } from "react";
import { useCart } from "./cart-context";
import { checkoutAction } from "./checkout-actions";
import type { BankTransferInfo } from "@/lib/bank-transfer-info";

function formatVnd(price: number): string {
  return `${price.toLocaleString("vi-VN")} ₫`;
}

// Mirrors order-mutations.ts's PAYMENT_METHODS. Only "cod" is functionally
// complete today (Step 30) — no gateway call is made for any method yet;
// the other two are recorded but not yet processed.
const PAYMENT_METHODS = [
  { value: "cod", label: "Cash on delivery" },
  { value: "momo", label: "MoMo" },
  { value: "bank_transfer", label: "Bank transfer" },
] as const;

const inputClassName =
  "rounded-md border border-border bg-background px-2.5 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20";

type CheckoutState =
  | { status: "idle" }
  | { status: "submitting" }
  | {
      status: "success";
      orderId: string;
      paymentMethod: (typeof PAYMENT_METHODS)[number]["value"];
      paymentRedirectUrl?: string;
      paymentInitiationFailed?: boolean;
      bankTransferInfo?: BankTransferInfo;
    }
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
export function CartWidget({ availabilityByVariant }: { availabilityByVariant: Record<string, number> }) {
  const { items, itemCount, updateQuantity, removeItem, clearCart } = useCart();
  const [open, setOpen] = useState(false);
  const [checkout, setCheckout] = useState<CheckoutState>({ status: "idle" });
  const [paymentMethod, setPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]["value"]>("cod");
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

  async function handleCheckout() {
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
      setCheckout({
        status: "success",
        orderId: result.data.orderId,
        paymentMethod,
        paymentRedirectUrl: result.data.paymentRedirectUrl,
        paymentInitiationFailed: result.data.paymentInitiationFailed,
        bankTransferInfo: result.data.bankTransferInfo,
      });
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

              {/* Step 48: MoMo checkout success carries a redirect link to
                  MoMo's hosted payment page — the order already exists
                  (and its inventory reservation) regardless of whether the
                  customer completes payment. */}
              {checkout.paymentRedirectUrl && (
                <a
                  href={checkout.paymentRedirectUrl}
                  className="self-start rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
                >
                  Pay with MoMo
                </a>
              )}
              {checkout.paymentInitiationFailed && (
                <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
                  Your order was placed, but we couldn&apos;t start MoMo payment. Please contact the store, or pay on
                  delivery if the merchant allows it.
                </p>
              )}

              {/* Plain merchant-entered instructions (Tenant Admin's
                  Branding form) — only present when the tenant has fully
                  configured them (see bank-transfer-info.ts). No QR code,
                  no gateway, no automated reconciliation: the customer
                  wires the money themselves and the merchant confirms it
                  manually (see Tenant Admin's Orders section). */}
              {checkout.paymentMethod === "bank_transfer" &&
                (checkout.bankTransferInfo ? (
                  <div className="rounded-md border border-border bg-surface-muted p-3 text-xs">
                    <p className="font-medium">Transfer to:</p>
                    <p className="mt-1">{checkout.bankTransferInfo.bankName}</p>
                    <p className="font-mono">{checkout.bankTransferInfo.bankAccountNumber}</p>
                    <p>{checkout.bankTransferInfo.bankAccountHolder}</p>
                    <p className="mt-2 text-muted-foreground">
                      Please include your order ID as the transfer note, then wait for the merchant to confirm your
                      order.
                    </p>
                  </div>
                ) : (
                  <p className="rounded-md border border-border bg-surface-muted p-3 text-xs text-muted-foreground">
                    The merchant hasn&apos;t set up bank transfer details yet — please contact the store directly for
                    payment instructions.
                  </p>
                ))}

              {checkout.paymentMethod === "cod" && (
                <p className="text-xs text-muted-foreground">Pay in cash when your order arrives.</p>
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
                    className={inputClassName}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClassName}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  Phone
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className={inputClassName}
                  />
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
                    className={inputClassName}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  Ward
                  <input
                    type="text"
                    value={ward}
                    onChange={(e) => setWard(e.target.value)}
                    className={inputClassName}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  District
                  <input
                    type="text"
                    value={district}
                    onChange={(e) => setDistrict(e.target.value)}
                    className={inputClassName}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  City
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className={inputClassName}
                  />
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
                {PAYMENT_METHODS.map((method) => (
                  <label key={method.value} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value={method.value}
                      checked={paymentMethod === method.value}
                      onChange={() => setPaymentMethod(method.value)}
                    />
                    {method.label}
                  </label>
                ))}
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
                  disabled={checkout.status === "submitting"}
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
