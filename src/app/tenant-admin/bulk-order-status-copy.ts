// Confirmation copy for the BULK order status action, kept out of the
// component so the wording and the count arithmetic are unit-testable
// without a DOM — the same reason platform-admin/tenant-status-copy.ts
// exists for the tenant status form.
//
// Why this needed to exist at all: the bulk form previously submitted with
// no confirmation, so one click could irreversibly fulfil or cancel many
// orders at once — consuming or releasing inventory across all of them —
// while doing the same thing to a SINGLE order required confirming. The
// bulk path was the more dangerous of the two and the only unguarded one.

export type BulkOrderStatus = "fulfilled" | "cancelled";

export function isBulkOrderStatus(value: unknown): value is BulkOrderStatus {
  return value === "fulfilled" || value === "cancelled";
}

/** Shown when the operator submits with nothing ticked. */
export const NO_SELECTION_ERROR = "Select at least one order first.";

/**
 * The confirm() text for a bulk transition.
 *
 * Deliberately names the COUNT: the whole hazard of this control is that
 * it acts on an unseen number of rows, so "3 orders" is the single most
 * important word in the sentence. Singular/plural is handled rather than
 * emitting "1 orders", because a sloppy count undermines trust in exactly
 * the dialog that is asking for trust.
 *
 * The consequence clause mirrors the single-order wording in
 * OrderStatusForm so the two paths read consistently: fulfilment consumes
 * reserved stock, cancellation releases it, and neither can be undone —
 * ORDER_STATUS_TRANSITIONS offers no route back to pending.
 */
export function bulkOrderStatusConfirmMessage(status: BulkOrderStatus, count: number): string {
  const noun = count === 1 ? "order" : "orders";
  const possessive = count === 1 ? "its" : "their";
  if (status === "fulfilled") {
    return `Mark ${count} ${noun} as fulfilled? This consumes ${possessive} reserved inventory and cannot be undone.`;
  }
  return `Cancel ${count} ${noun}? This releases ${possessive} reserved inventory and cannot be undone.`;
}
