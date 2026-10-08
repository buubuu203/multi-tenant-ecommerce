import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bulkOrderStatusConfirmMessage,
  isBulkOrderStatus,
  NO_SELECTION_ERROR,
} from "../src/app/tenant-admin/bulk-order-status-copy";

/** Source with comments stripped — line comments FIRST, so a // comment
 *  mentioning a path or an identifier cannot be read as an opening /*. */
const readCode = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

// ---------- confirmation copy ----------

test("bulk fulfil names the count and the irreversible consequence", () => {
  const msg = bulkOrderStatusConfirmMessage("fulfilled", 3);
  assert.match(msg, /3 orders/, "the count is the most important word in this prompt");
  assert.match(msg, /fulfilled/);
  assert.match(msg, /consumes their reserved inventory/);
  assert.match(msg, /cannot be undone/);
});

test("bulk cancel says inventory is RELEASED, not consumed", () => {
  // The two transitions move stock in opposite directions; copy that got
  // this backwards would be worse than no copy.
  const msg = bulkOrderStatusConfirmMessage("cancelled", 3);
  assert.match(msg, /3 orders/);
  assert.match(msg, /releases their reserved inventory/);
  assert.doesNotMatch(msg, /consumes/);
  assert.match(msg, /cannot be undone/);
});

test("a single selected order reads as singular, never '1 orders'", () => {
  // A sloppy count undermines trust in exactly the dialog asking for it.
  const fulfil = bulkOrderStatusConfirmMessage("fulfilled", 1);
  const cancel = bulkOrderStatusConfirmMessage("cancelled", 1);
  assert.match(fulfil, /Mark 1 order as fulfilled\?/);
  assert.match(fulfil, /consumes its reserved inventory/);
  assert.match(cancel, /Cancel 1 order\?/);
  assert.match(cancel, /releases its reserved inventory/);
  for (const m of [fulfil, cancel]) {
    assert.doesNotMatch(m, /1 orders/);
    assert.doesNotMatch(m, /their/);
  }
});

test("larger counts stay plural and exact", () => {
  assert.match(bulkOrderStatusConfirmMessage("fulfilled", 2), /2 orders/);
  assert.match(bulkOrderStatusConfirmMessage("cancelled", 20), /20 orders/);
});

test("only the two real transitions are accepted as a bulk status", () => {
  // Mirrors ORDER_STATUS_TRANSITIONS; anything else is not confirmed
  // client-side and is rejected server-side regardless.
  assert.equal(isBulkOrderStatus("fulfilled"), true);
  assert.equal(isBulkOrderStatus("cancelled"), true);
  for (const bad of ["pending", "refunded", "", null, undefined, 1, "FULFILLED"]) {
    assert.equal(isBulkOrderStatus(bad), false, `${String(bad)} must not pass`);
  }
});

test("the no-selection error is explicit rather than a silent no-op", () => {
  assert.equal(NO_SELECTION_ERROR, "Select at least one order first.");
});

// ---------- the gate itself ----------
//
// There is no DOM in this runner, so the wiring is asserted on the source.
// That is where the bug actually was: the form had `action={formAction}`
// and no onSubmit at all, so nothing could stop a submission.

test("REGRESSION — the bulk form gates submission behind a confirm()", () => {
  const src = readCode("src/app/tenant-admin/BulkOrderStatusForm.tsx");
  assert.match(src, /onSubmit=/, "the form must have an onSubmit gate");
  assert.match(src, /window\.confirm\(/, "submission must be gated behind confirm()");
  assert.match(
    src,
    /bulkOrderStatusConfirmMessage\(/,
    "it must use the shared copy, not an inline string that can drift",
  );
  // Cancelling must stop the submission, not merely warn.
  assert.match(src, /preventDefault\(\)/);
});

test("REGRESSION — an empty selection is blocked before any request", () => {
  const src = readCode("src/app/tenant-admin/BulkOrderStatusForm.tsx");
  // The count comes from the form's own FormData, so the number shown can
  // never disagree with the number submitted.
  assert.match(src, /new FormData\(event\.currentTarget\)/);
  assert.match(src, /getAll\("orderIds"\)/);
  assert.match(src, /NO_SELECTION_ERROR/);
  assert.match(src, /role="alert"/, "the error must be announced, not just styled");
});

test("REGRESSION — the pressed button's status is validated, not trusted", () => {
  const src = readCode("src/app/tenant-admin/BulkOrderStatusForm.tsx");
  assert.match(src, /submitter/, "the target status comes from the pressed button");
  assert.match(src, /isBulkOrderStatus\(/, "and is validated before confirming");
});

test("double submission is still prevented while pending", () => {
  const src = readCode("src/app/tenant-admin/BulkOrderStatusForm.tsx");
  const disabled = src.match(/disabled=\{pending\}/g) ?? [];
  assert.equal(disabled.length, 2, "both bulk buttons stay disabled while pending");
});

test("the single-order confirmation is unchanged", () => {
  // The fix must not have disturbed the path that was already correct.
  const src = readCode("src/app/tenant-admin/OrderStatusForm.tsx");
  assert.match(src, /window\.confirm\(CONFIRM_MESSAGES\[nextStatus\]\)/);
  assert.match(src, /Mark this order as fulfilled\? This action cannot be undone\./);
  assert.match(
    src,
    /Cancel this order\? This will release its reserved inventory and cannot be undone\./,
  );
});

test("authorization and tenant context stay server-side for the bulk action", () => {
  // The confirm() is a UX layer only. The action must still authorize and
  // must not accept a tenant from the client.
  const actions = readCode("src/app/tenant-admin/actions.ts");
  const bulk = actions.slice(actions.indexOf("export async function bulkUpdateOrderStatusAction"));
  const body = bulk.slice(0, bulk.indexOf("\nexport async function"));
  assert.match(body, /requireTenantAdmin\(\)/, "still authorizes inside the Server Action");
  assert.doesNotMatch(body, /formData\.get\(['"]tenantId['"]\)/, "never a client tenant id");
  assert.match(body, /updateOrderStatus\(tenantId,/, "tenant comes from the auth helper");
  // Partial failures keep being counted rather than aborting the batch.
  assert.match(body, /updated\+\+/);
  assert.match(body, /failed\+\+/);
});
