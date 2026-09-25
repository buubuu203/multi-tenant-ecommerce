"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/action-result";

// Phase 2 (Orders at scale): a single form, rendered once, that every
// order row's checkbox targets via `form="bulk-orders-form"` — HTML lets
// an <input> belong to a form it isn't a DOM descendant of, which is what
// makes this work without nesting a <form> inside each order row's own
// per-row ActionForm/OrderStatusForm (nested <form> elements are invalid).
// Two submit buttons carry `nextStatus` as their own name/value pair, a
// plain HTML mechanism — no extra client state needed to track which
// button was pressed.
export function BulkOrderStatusForm({
  action,
}: {
  action: (
    prevState: ActionResult<{ updated: number; failed: number }> | null,
    formData: FormData,
  ) => Promise<ActionResult<{ updated: number; failed: number }>>;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form
      id="bulk-orders-form"
      action={formAction}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs"
    >
      <span className="text-muted-foreground">Check orders below, then:</span>
      <button
        type="submit"
        name="nextStatus"
        value="fulfilled"
        disabled={pending}
        className="rounded-md border border-border bg-surface px-2.5 py-1 transition-colors hover:bg-background disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
      >
        Mark fulfilled
      </button>
      <button
        type="submit"
        name="nextStatus"
        value="cancelled"
        disabled={pending}
        className="rounded-md border border-border bg-surface px-2.5 py-1 transition-colors hover:bg-background disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
      >
        Cancel selected
      </button>
      {state &&
        (state.success ? (
          <span role="status" className="text-muted-foreground">
            {state.data.updated} updated{state.data.failed ? `, ${state.data.failed} failed` : ""}.
          </span>
        ) : (
          <span role="alert" className="text-red-600">
            {state.error}
          </span>
        ))}
    </form>
  );
}
