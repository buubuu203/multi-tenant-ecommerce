"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/action-result";

// Generic form + Server Action wrapper shared by Platform Admin and Tenant
// Admin — contains no area-specific behavior, just useActionState wiring
// and typed inline error display.
export function ActionForm<T>({
  action,
  children,
  submitLabel,
  className,
  disabled = false,
}: {
  action: (prevState: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;
  children: React.ReactNode;
  submitLabel: string;
  className?: string;
  // Step 50: lets a caller block submission for a reason ActionForm itself
  // has no visibility into (e.g. a child upload still in flight) — kept as
  // a plain boolean rather than anything media-specific, since this
  // component is shared by both Tenant Admin and Platform Admin forms with
  // no media concept at all.
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className={className}>
      {children}
      <button
        type="submit"
        disabled={pending || disabled}
        className="rounded-md bg-foreground px-3.5 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {submitLabel}
      </button>
      {state && !state.success && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
