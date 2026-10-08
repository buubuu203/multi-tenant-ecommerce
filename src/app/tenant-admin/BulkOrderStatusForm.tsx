"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import {
  bulkOrderStatusConfirmMessage,
  isBulkOrderStatus,
  NO_SELECTION_ERROR,
} from "./bulk-order-status-copy";

// Phase 2 (Orders at scale): a single form, rendered once, that every
// order row's checkbox targets via `form="bulk-orders-form"` — HTML lets
// an <input> belong to a form it isn't a DOM descendant of, which is what
// makes this work without nesting a <form> inside each order row's own
// per-row ActionForm/OrderStatusForm (nested <form> elements are invalid).
// Two submit buttons carry `nextStatus` as their own name/value pair, a
// plain HTML mechanism — no extra client state needed to track which
// button was pressed; onSubmit reads it back off event.submitter.
//
// Submission is gated behind a confirm(), the same way OrderStatusForm
// gates the single-order action. This form previously had no gate at all,
// which made the MORE dangerous of the two paths the unguarded one: one
// click could irreversibly fulfil or cancel every ticked order, consuming
// or releasing inventory across all of them, with no prompt.
//
// The confirm() is UX only. requireTenantAdmin() inside
// bulkUpdateOrderStatusAction and the per-order transition guard in
// updateOrderStatus() remain the authoritative checks, and this component
// sends no tenant, no price and no status of its own invention — only the
// ticked order ids and the button's own value.
export function BulkOrderStatusForm({
  action,
}: {
  action: (
    prevState: ActionResult<{ updated: number; failed: number }> | null,
    formData: FormData,
  ) => Promise<ActionResult<{ updated: number; failed: number }>>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  // Client-side selection error, separate from the server's ActionResult
  // error so a "nothing ticked" mistake never reaches the server at all.
  const [selectionError, setSelectionError] = useState<string | null>(null);

  return (
    <form
      id="bulk-orders-form"
      action={formAction}
      onSubmit={(event) => {
        // Counted from the form's OWN FormData rather than a document-wide
        // querySelectorAll: these checkboxes are associated by the `form`
        // attribute rather than by nesting, and FormData reflects exactly
        // what is about to be submitted — so the number in the prompt can
        // never disagree with the number the server acts on.
        const formData = new FormData(event.currentTarget);
        const selected = formData.getAll("orderIds").filter((id) => String(id).trim().length > 0);

        if (selected.length === 0) {
          event.preventDefault();
          setSelectionError(NO_SELECTION_ERROR);
          return;
        }

        // Which button was pressed. Validated rather than trusted: an
        // unrecognised value is not confirmed here and would be rejected
        // server-side anyway by updateOrderStatus()'s own allowlist.
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        const nextStatus = submitter instanceof HTMLButtonElement ? submitter.value : "";
        if (!isBulkOrderStatus(nextStatus)) {
          event.preventDefault();
          return;
        }

        if (!window.confirm(bulkOrderStatusConfirmMessage(nextStatus, selected.length))) {
          event.preventDefault();
          return;
        }
        setSelectionError(null);
      }}
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
      {selectionError && (
        <span role="alert" className="text-red-600">
          {selectionError}
        </span>
      )}
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
