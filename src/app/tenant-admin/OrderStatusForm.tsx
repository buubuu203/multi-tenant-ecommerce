"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/action-result";

const CONFIRM_MESSAGES: Record<string, string> = {
  fulfilled: "Mark this order as fulfilled? This action cannot be undone.",
  cancelled: "Cancel this order? This will release its reserved inventory and cannot be undone.",
};

// Not reusing the shared ActionForm here: this is the only form in the app
// whose submission must be gated behind a native confirm() — a plain
// ActionForm has no onSubmit hook to attach one to, and this project's
// established convention (see ImportProductsForm.tsx) is a small,
// self-contained "use client" component per special case rather than
// changing the shared component's shape for every other caller. Same
// useActionState wiring, same ActionResult contract.
//
// The confirm() below is UX only — the backend transition guard in
// updateOrderStatus() (order-mutations.ts) is what's actually authoritative.
export function OrderStatusForm({
  action,
  orderId,
  nextStatus,
  label,
}: {
  action: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  orderId: string;
  nextStatus: "fulfilled" | "cancelled";
  label: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(CONFIRM_MESSAGES[nextStatus])) {
          e.preventDefault();
        }
      }}
      className="inline-flex items-center gap-1"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="nextStatus" value={nextStatus} />
      <button
        type="submit"
        disabled={pending}
        className="rounded border px-2 py-0.5 text-xs disabled:opacity-50"
      >
        {label}
      </button>
      {state && !state.success && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
