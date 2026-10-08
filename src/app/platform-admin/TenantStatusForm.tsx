"use client";

import { ConfirmActionForm } from "@/components/ConfirmActionForm";
import { adminInputClassName, adminLabelClassName } from "../tenant-admin/styles";
import type { ActionResult } from "@/lib/action-result";
import {
  TENANT_STATUSES,
  DISRUPTIVE_STATUSES,
  isTenantStatus,
  tenantStatusConfirmMessage,
} from "./tenant-status-copy";

/**
 * The per-tenant status form, extracted into a Client Component for one
 * specific reason: its confirm() text has to be computed from the status
 * the operator actually picked, and a Server Component cannot pass a
 * function to a Client Component — React refuses to serialize it. page.tsx
 * is a Server Component, so building the message there was a runtime
 * error ("Functions cannot be passed directly to Client Components"),
 * which typechecking and the production build both accept happily.
 *
 * Here the function is created on the client and handed to another Client
 * Component, which is allowed. `action` stays a Server Action passed down
 * by reference, the normal supported pattern, so no authorization or
 * validation moves to the client — updateTenantStatusAction still runs
 * requirePlatformAdmin() on the server exactly as before.
 */
export function TenantStatusForm<T>({
  tenantId,
  tenantName,
  currentStatus,
  action,
}: {
  tenantId: string;
  tenantName: string;
  /** The tenant's status as stored; narrowed here rather than trusted. */
  currentStatus: string;
  action: (prevState: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;
}) {
  const from = isTenantStatus(currentStatus) ? currentStatus : "pending";

  return (
    <ConfirmActionForm
      action={action}
      submitLabel="Save status"
      successMessage="Tenant status saved."
      // Derived from the status actually selected, not a fixed worst
      // case — reactivating a suspended store no longer warns that it is
      // about to go offline.
      confirmMessage={(formData) =>
        tenantStatusConfirmMessage(tenantName, from, formData.get("status"))
      }
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="tenantId" value={tenantId} />
      <label className={adminLabelClassName}>
        Status
        <select name="status" defaultValue={currentStatus} className={adminInputClassName}>
          {TENANT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
              {DISRUPTIVE_STATUSES.has(status) ? " — takes storefront offline" : ""}
            </option>
          ))}
        </select>
      </label>
    </ConfirmActionForm>
  );
}
