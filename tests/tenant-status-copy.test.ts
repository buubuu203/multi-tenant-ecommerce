import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tenantStatusConfirmMessage,
  DISRUPTIVE_STATUSES,
  TENANT_STATUSES,
  isTenantStatus,
} from "../src/app/platform-admin/tenant-status-copy";

const OFFLINE_WARNING = /takes its storefront offline/;

test("suspending a live store warns that the storefront goes offline", () => {
  const msg = tenantStatusConfirmMessage("Shop A Co.", "active", "suspended");
  assert.match(msg, /from active to suspended/);
  assert.match(msg, OFFLINE_WARNING);
  assert.match(msg, /Shop A Co\./);
});

test("archiving warns about going offline and about being the strongest state", () => {
  const msg = tenantStatusConfirmMessage("Shop A Co.", "active", "archived");
  assert.match(msg, OFFLINE_WARNING);
  assert.match(msg, /gone for good/);
});

test("reactivating a suspended store does NOT show the offline warning", () => {
  // The bug this fixes: the old static copy warned about suspending and
  // archiving even on the way back to active.
  const msg = tenantStatusConfirmMessage("Shop A Co.", "suspended", "active");
  assert.doesNotMatch(msg, OFFLINE_WARNING);
  assert.match(msg, /go live for customers/);
  assert.match(msg, /from suspended to active/);
});

test("no transition INTO a non-disruptive status mentions going offline", () => {
  for (const from of TENANT_STATUSES) {
    for (const to of TENANT_STATUSES) {
      if (from === to) continue;
      const msg = tenantStatusConfirmMessage("Shop A Co.", from, to);
      if (DISRUPTIVE_STATUSES.has(to)) {
        assert.match(msg, OFFLINE_WARNING, `${from} -> ${to} should warn`);
      } else {
        assert.doesNotMatch(msg, OFFLINE_WARNING, `${from} -> ${to} must not warn`);
      }
    }
  }
});

test("every status change still confirms — including a no-op save", () => {
  // Accuracy was the goal, not fewer prompts: a message is produced for
  // every transition, so ConfirmActionForm always gates the submit.
  for (const from of TENANT_STATUSES) {
    for (const to of TENANT_STATUSES) {
      const msg = tenantStatusConfirmMessage("Shop A Co.", from, to);
      assert.ok(msg.length > 0 && msg.includes("?"), `${from} -> ${to} produced no prompt`);
    }
  }
  assert.match(
    tenantStatusConfirmMessage("Shop A Co.", "active", "active"),
    /already active\. Save anyway\?/,
  );
});

test("pending explains the coming-soon storefront rather than an outage", () => {
  const msg = tenantStatusConfirmMessage("Shop A Co.", "active", "pending");
  assert.doesNotMatch(msg, OFFLINE_WARNING);
  assert.match(msg, /coming soon/);
});

test("an unrecognised submitted value gets a vague prompt, never a confident wrong one", () => {
  // FormData is untyped, so a tampered or stale value must not produce a
  // message asserting something that will not happen. The server action
  // rejects it regardless.
  const msg = tenantStatusConfirmMessage("Shop A Co.", "active", "deleted");
  assert.equal(msg, "Change “Shop A Co.” status?");
  assert.doesNotMatch(msg, OFFLINE_WARNING);
  for (const bad of [null, undefined, 42, "", "ACTIVE"]) {
    assert.equal(isTenantStatus(bad), false, `${String(bad)} must not pass as a status`);
  }
});
