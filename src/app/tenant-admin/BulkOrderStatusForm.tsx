"use client";

import { useActionState, useEffect, useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import {
  bulkOrderStatusConfirmMessage,
  isBulkOrderStatus,
  NO_SELECTION_ERROR,
} from "./bulk-order-status-copy";
import {
  adminButtonSecondaryClassName,
  adminButtonDangerClassName,
} from "./styles";

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
  // How many orders are ticked right now, shown in the toolbar so the
  // operator can see the size of what they are about to do BEFORE the
  // confirm() tells them. The checkboxes live in the table rows, outside
  // this form's DOM subtree (they are associated by the `form` attribute),
  // so their change events never reach this element — hence a document
  // listener rather than an onChange on the form.
  const [selectedCount, setSelectedCount] = useState(0);

  useEffect(() => {
    const form = document.getElementById("bulk-orders-form");
    if (!(form instanceof HTMLFormElement)) return;
    const recount = () => {
      const ids = new FormData(form)
        .getAll("orderIds")
        .filter((id) => String(id).trim().length > 0);
      setSelectedCount(ids.length);
      // Ticking something clears a stale "nothing selected" complaint.
      if (ids.length > 0) setSelectionError(null);
    };
    recount();
    document.addEventListener("change", recount);
    return () => document.removeEventListener("change", recount);
  }, []);

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
      // Sits on the canvas as its own bar, distinct from both the filter
      // toolbar above and the order list below — a control that acts on
      // many rows at once should not look like part of any one of them.
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs"
    >
      {/* The count is the point of this toolbar: a bulk control whose
          scope you cannot see is the one that causes accidents. role=status
          so a screen reader hears the selection change without the focus
          moving. */}
      <span
        role="status"
        className={
          selectedCount === 0
            ? "text-muted-foreground"
            : "rounded-full bg-foreground px-2 py-0.5 text-xs font-semibold text-background"
        }
      >
        {selectedCount === 0
          ? "No orders selected"
          : `${selectedCount} ${selectedCount === 1 ? "order" : "orders"} selected`}
      </span>
      <span className="text-muted-foreground" aria-hidden="true">
        ·
      </span>
      <button
        type="submit"
        name="nextStatus"
        value="fulfilled"
        disabled={pending}
        className={`${adminButtonSecondaryClassName} px-2.5 py-1 text-xs`}
      >
        Mark fulfilled
      </button>
      <button
        type="submit"
        name="nextStatus"
        value="cancelled"
        disabled={pending}
        // Destructive styling: cancelling releases inventory and cannot be
        // undone, so it must not look identical to the harmless action
        // sitting next to it.
        className={`${adminButtonDangerClassName} px-2.5 py-1 text-xs`}
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
