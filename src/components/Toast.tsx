"use client";

import { useEffect, useState } from "react";

// A minimal, dependency-free toast system: a module-level pub/sub (no
// context/provider needed, so any client component — including ones deep
// inside a form like BannerImageUpload — can call showToast() directly)
// plus one <Toaster/> subscriber mounted once per admin layout. Calling
// showToast() with no <Toaster/> mounted is a harmless no-op (nothing is
// listening), so this can never break a page that doesn't render one.

export type ToastKind = "success" | "error";
type ToastItem = { id: number; message: string; kind: ToastKind };

let nextId = 0;
let toasts: ToastItem[] = [];
const listeners = new Set<(toasts: ToastItem[]) => void>();

function emit() {
  for (const listener of listeners) listener(toasts);
}

export function showToast(message: string, kind: ToastKind = "success") {
  const id = nextId++;
  toasts = [...toasts, { id, message, kind }];
  emit();
  // Errors stay a beat longer — they're more likely to need re-reading.
  const ttl = kind === "error" ? 6000 : 3500;
  setTimeout(() => dismissToast(id), ttl);
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>(toasts);

  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4"
      role="status"
      aria-live="polite"
    >
      {items.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex max-w-sm items-center gap-2 rounded-md border px-3.5 py-2 text-sm shadow-md ${
            toast.kind === "success"
              ? "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-400"
              : "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
          }`}
        >
          <span className="flex-1">{toast.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            aria-label="Dismiss"
            className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
