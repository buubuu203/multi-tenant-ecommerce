'use client';

import { useActionState, useEffect } from 'react';
import type { ActionResult } from '@/lib/action-result';
import { showToast } from './Toast';

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
/**
 * The default vertical rhythm for a form that does not bring its own
 * layout. Children previously rendered as bare siblings of the submit
 * button, so a form with no `className` had NO spacing at all between
 * its labels, fields, checkboxes and that button — which is what made
 * Payments and the shipping-method forms read as one dense block.
 */
export const actionFormLayoutClassName = 'flex flex-col gap-3';

/**
 * Whether the caller has already taken responsibility for laying the
 * form out. Several callers deliberately use a ROW (`flex items-end
 * gap-2` for an inline stock control, `inline-flex` inside a table
 * cell); adding `flex flex-col` to those would rotate them. So the base
 * layout is applied only when the caller names no display utility of its
 * own, and the caller's classes are always preserved either way.
 */
export function callerOwnsFormLayout(className?: string): boolean {
  return /\b(flex|inline-flex|grid|inline-grid|block|inline-block|contents)\b/.test(
    className ?? '',
  );
}

export function mergeFormClassName(className?: string): string {
  if (callerOwnsFormLayout(className)) return className ?? '';
  return [actionFormLayoutClassName, className].filter(Boolean).join(' ');
}

export function ActionForm<T>({
  action,
  children,
  submitLabel,
  successMessage,
  className,
  disabled = false,
  variant = 'default',
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
  /**
   * "danger" gives a destructive action the same visual weight it has on
   * ConfirmActionForm, so a Remove/Delete control never renders as a filled
   * primary competing with the Save beside it. Default is unchanged, so no
   * existing caller is affected.
   */
  variant?: 'default' | 'danger';
}) {
  const [state, formAction, pending] = useActionState(action, null);

  useEffect(() => {
    if (state?.success && successMessage) {
      showToast(successMessage, 'success');
    }
  }, [state, successMessage]);

  // When ActionForm owns the layout it also owns the separation before the
  // submit button: a rule and real space, so Save never sits flush against
  // the last field. Row-layout callers keep the previous flat structure.
  const ownsLayout = !callerOwnsFormLayout(className);

  const submit = (
    <>
      <button
        type="submit"
        // `pending` alone already prevents a second submission while one
        // is in flight (React ignores further calls to a pending action,
        // but disabling the button is the visible half of that guarantee
        // — a user should never see a clickable button do nothing).
        disabled={pending || disabled}
        className={
          variant === 'danger'
            ? 'rounded-md border border-red-300 px-3.5 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950'
            : 'rounded-md bg-foreground px-3.5 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground'
        }
      >
        {pending ? 'Working…' : submitLabel}
      </button>
      {state && !state.success && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
    </>
  );

  return (
    <form action={formAction} className={mergeFormClassName(className)} aria-busy={pending}>
      {children}
      {ownsLayout ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
          {submit}
        </div>
      ) : (
        submit
      )}
    </form>
  );
}
