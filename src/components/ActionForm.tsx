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
}: {
  action: (prevState: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;
  children: React.ReactNode;
  submitLabel: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className={className}>
      {children}
      <button type="submit" disabled={pending} className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black">
        {submitLabel}
      </button>
      {state && !state.success && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
