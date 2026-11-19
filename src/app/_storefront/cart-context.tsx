"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Cart items are keyed by ProductVariant.id — the purchasable unit — never
// by productId, name, SKU, or combinationKey. A simple product's single
// combinationKey="" variant IS the cart item for that product; a
// variant-bearing product's selected combination resolves to its own
// distinct ProductVariant.id, so two different combinations of the same
// Product are always two separate cart items.
//
// Price here is display-only, read from the ProductVariant already loaded
// by the storefront (see get-tenant-products.ts / ProductList.tsx) — it is
// NOT authoritative. There is no checkout in this step; whenever one is
// built, it MUST re-read price server-side from the current ProductVariant
// row before charging anything, never trust this client-held value.
export type CartItem = {
  productVariantId: string;
  productId: string;
  productName: string;
  // Human-readable option/value summary (e.g. "Color: White / Size: M"),
  // or "" for a simple product's single variant. Never combinationKey.
  variantLabel: string;
  price: number;
  // Product Discount (V1): display-only, same non-authoritative posture
  // as `price` itself — set only when the item was added while a
  // discount was active. Never used for calculation; `price` above is
  // already the final (possibly discounted) amount used everywhere a
  // total is computed.
  originalPrice?: number;
  discountPercent?: number;
  discountAmount?: number;
  quantity: number;
  // Step 45: the product's externally-hosted image URL at the moment this
  // item was added (see get-tenant-products.ts/ProductList.tsx) — display
  // only, same non-authoritative posture as price. Undefined when the
  // product had no image set; never re-fetched or re-validated here.
  imageUrl?: string;
};

// Pure cart-mutation logic, independent of React — the same pattern as
// resolveVariant()/isValueSelectable() in ProductList.tsx. Keyed
// exclusively by productVariantId; never merges/matches by product name,
// SKU, or combinationKey.

export function addItemToList(items: CartItem[], item: Omit<CartItem, "quantity">, quantity = 1): CartItem[] {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return items;
  }
  const existing = items.find((i) => i.productVariantId === item.productVariantId);
  if (existing) {
    return items.map((i) =>
      i.productVariantId === item.productVariantId ? { ...i, quantity: i.quantity + quantity } : i,
    );
  }
  return [...items, { ...item, quantity }];
}

export function updateQuantityInList(items: CartItem[], productVariantId: string, quantity: number): CartItem[] {
  const normalized = Number.isInteger(quantity) ? quantity : Math.floor(quantity);
  if (normalized <= 0) {
    return items.filter((i) => i.productVariantId !== productVariantId);
  }
  return items.map((i) => (i.productVariantId === productVariantId ? { ...i, quantity: normalized } : i));
}

export function removeItemFromList(items: CartItem[], productVariantId: string): CartItem[] {
  return items.filter((i) => i.productVariantId !== productVariantId);
}

type CartContextValue = {
  items: CartItem[];
  itemCount: number;
  addItem: (item: Omit<CartItem, "quantity">, quantity?: number) => void;
  updateQuantity: (productVariantId: string, quantity: number) => void;
  removeItem: (productVariantId: string) => void;
  clearCart: () => void;
  /**
   * Cart Price Reconciliation: overwrites the cart's display prices with
   * the server's current ones (see cart-reconcile.ts). Deliberately the
   * ONLY way prices change after an item is added, and it is fed
   * exclusively from a server read — there is no path here for a client
   * to set a price of its own choosing, and none of this is authoritative
   * for the charge regardless (createOrder() re-reads price itself).
   */
  replacePrices: (items: CartItem[]) => void;
  /**
   * "Mua ngay" (Board 6): a product page adds its item then calls this to
   * tell CartWidget to open itself already on the "shipping" step, rather
   * than CartWidget polling cart state for "did something just get added
   * with intent to buy now." `token` only ever increments — CartWidget
   * watches IT (not a boolean) so two consecutive "Mua ngay" clicks each
   * re-open/re-focus the modal, even though the step they request is the
   * same both times.
   */
  requestCheckoutOpen: { token: number } | null;
  requestCheckout: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

const STORAGE_KEY = "cart";

// Each tenant is served from its own hostname/origin in this project
// (shop-a.localhost vs shop-b.localhost), and localStorage is already
// origin-scoped by the browser — so no additional tenant-id namespacing is
// needed here for isolation. This module never reads a tenantId from
// anywhere, and never makes a network/database request; the cart cannot
// leak or access another tenant's data because it never touches the
// server at all.
function isCartItem(value: unknown): value is CartItem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.productVariantId === "string" &&
    typeof v.productId === "string" &&
    typeof v.productName === "string" &&
    typeof v.variantLabel === "string" &&
    typeof v.price === "number" &&
    Number.isFinite(v.price) &&
    v.price >= 0 &&
    typeof v.quantity === "number" &&
    Number.isInteger(v.quantity) &&
    v.quantity > 0 &&
    (v.imageUrl === undefined || typeof v.imageUrl === "string")
  );
}

function loadFromStorage(): CartItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCartItem);
  } catch {
    // Malformed/corrupt stored data must never crash the storefront —
    // treat it as an empty cart and move on.
    return [];
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  // Starts empty on both server and first client render (SSR-safe: no
  // localStorage access during render). Actual stored items are loaded in
  // an effect, after mount, client-only.
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // One-time hydration read from localStorage, an external system this
    // component must synchronize from exactly once after mount (never
    // during SSR/initial render, to avoid a hydration mismatch) — the
    // pattern the set-state-in-effect rule is generally right to flag
    // doesn't apply to this one-shot read-on-mount case.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time SSR-safe localStorage hydration, not a synchronization loop
    setItems(loadFromStorage());
    // eslint-disable-next-line react-hooks/set-state-in-effect -- marks the completed one-time storage hydration
    setHydrated(true);
  }, []);

  useEffect(() => {
    // Strict Mode replays mount effects in development; don't let the
    // initial empty render overwrite the cart before the storage read lands.
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage can be unavailable (private browsing, quota) — the cart
      // still works in-memory for the current page load either way.
    }
  }, [items, hydrated]);

  const addItem: CartContextValue["addItem"] = (item, quantity = 1) => {
    setItems((prev) => addItemToList(prev, item, quantity));
  };

  const updateQuantity: CartContextValue["updateQuantity"] = (productVariantId, quantity) => {
    setItems((prev) => updateQuantityInList(prev, productVariantId, quantity));
  };

  const removeItem: CartContextValue["removeItem"] = (productVariantId) => {
    setItems((prev) => removeItemFromList(prev, productVariantId));
  };

  const clearCart = () => setItems([]);

  const replacePrices: CartContextValue["replacePrices"] = (next) => {
    // Matched by productVariantId rather than taking `next` wholesale, so
    // a reconciliation that raced with the customer editing their cart
    // can only ever update the prices of lines that are still present —
    // never resurrect a removed line or clobber a changed quantity.
    setItems((prev) =>
      prev.map((item) => {
        const updated = next.find((n) => n.productVariantId === item.productVariantId);
        if (!updated) return item;
        return {
          ...item,
          price: updated.price,
          originalPrice: updated.originalPrice,
          discountPercent: updated.discountPercent,
        };
      }),
    );
  };

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  const [requestCheckoutOpen, setRequestCheckoutOpen] = useState<{ token: number } | null>(null);
  const requestCheckout = () => setRequestCheckoutOpen((prev) => ({ token: (prev?.token ?? 0) + 1 }));

  return (
    <CartContext.Provider
      value={{
        items,
        itemCount,
        addItem,
        updateQuantity,
        removeItem,
        clearCart,
        replacePrices,
        requestCheckoutOpen,
        requestCheckout,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCart() must be used within a CartProvider");
  }
  return ctx;
}
