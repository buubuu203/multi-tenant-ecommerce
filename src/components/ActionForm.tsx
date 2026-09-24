"use client";

import { useActionState, useEffect } from "react";
import type { ActionResult } from "@/lib/action-result";
import { showToast } from "./Toast";

// Generic form + Server Action wrapper shared by Platform Admin and Tenant
// Admin — contains no area-specific behavior, just useActionState wiring,
// typed inline error display, and (new) a success toast + pending label.
//
// Success feedback: `successMessage` fires a toast exactly once per actual
// action completion — the effect is keyed on the `state` object itself,
// which useActionState only replaces when a real result comes back (never
// on an unrelated re-render), so this can't double-fire or fire on mount.
// Omitting `successMessage` keeps a form silent on success, same as
// before this change — no existing caller's behavior changes unless it
// opts in.
export function ActionForm<T>({
  action,
  children,
  submitLabel,
  successMessage,
  className,
  disabled = false,
}: {
  action: (prevState: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;
  children: React.ReactNode;
  submitLabel: string;
  successMessage?: string;
  className?: string;
  // Step 50: lets a caller block submission for a reason ActionForm itself
  // has no visibility into (e.g. a child upload still in flight) — kept as
  // a plain boolean rather than anything media-specific, since this
  // component is shared by both Tenant Admin and Platform Admin forms with
  // no media concept at all.
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  useEffect(() => {
    if (state?.success && successMessage) {
      showToast(successMessage, "success");
    }
  }, [state, successMessage]);

  return (
    <form action={formAction} className={className}>
      {children}
      <button
        type="submit"
        // `pending` alone already prevents a second submission while one
        // is in flight (React ignores further calls to a pending action,
        // but disabling the button is the visible half of that guarantee
        // — a user should never see a clickable button do nothing).
        disabled={pending || disabled}
        className="rounded-md bg-foreground px-3.5 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {pending ? "Working…" : submitLabel}
      </button>
      {state && !state.success && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
