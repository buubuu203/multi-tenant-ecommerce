'use client';

import { useActionState, useEffect } from 'react';
import type { ActionResult } from '@/lib/action-result';
import { showToast } from './Toast';
import { callerOwnsFormLayout, mergeFormClassName } from './ActionForm';
import {
  resolveConfirmMessage,
  shouldRequestConfirmation,
  type ConfirmWhen,
} from './confirm-policy';

/**
 * ActionForm's sibling for actions that should not fire on a single
 * mis-click: submission is gated behind a native confirm(). The shared
 * ActionForm has no onSubmit hook to attach one to, and OrderStatusForm
 * (the first place this pattern appeared) hardcodes order-specific
 * messages — so this generalises it for any destructive action without
 * changing either of those.
 *
 * The confirm() is UX only. Whatever server-side guard the action itself
 * enforces remains the authoritative one.
 */
export function ConfirmActionForm<T>({
  action,
  children,
  submitLabel,
  confirmMessage,
  successMessage,
  variant = 'default',
  className,
  confirmWhen,
  skipConfirmation = false,
}: {
  action: (prevState: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;
  children?: React.ReactNode;
  submitLabel: string;
  /**
   * The text shown in the confirm() dialog. A plain string covers the
   * common case; a function is evaluated against the form's OWN FormData
   * at submit time, which is what lets a message describe the value the
   * operator actually picked rather than a fixed worst case. (Platform
   * Admin's status form needs this: the same form can activate a store or
   * take it offline, so a static string has to warn about both and is
   * therefore wrong for one of them.)
   */
  confirmMessage: string | ((formData: FormData) => string);
  successMessage?: string;
  /** "danger" reads as destructive; "default" matches ActionForm's button. */
  variant?: 'default' | 'danger';
  className?: string;
  /**
   * Ask for confirmation only when this field's submitted value DIFFERS
   * from `differsFrom`. Lets one form confirm a destructive change — a
   * provider switch that would replace stored configuration — while an
   * ordinary save of the same form passes straight through.
   *
   * Declarative rather than a predicate function on purpose: this is a
   * Client Component, and a function prop cannot cross the Server
   * Component boundary.
   */
  confirmWhen?: ConfirmWhen;
  /**
   * Suppresses the confirmation entirely — for the case where there is
   * nothing to lose yet, such as choosing a provider for the first time.
   * Decided on the server, where the stored state is known.
   */
  skipConfirmation?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  useEffect(() => {
    if (state?.success && successMessage) {
      showToast(successMessage, 'success');
    }
  }, [state, successMessage]);

  const buttonClassName =
    variant === 'danger'
      ? 'rounded-md border border-red-300 px-3.5 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950'
      : 'rounded-md bg-foreground px-3.5 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground';

  // Same layout contract as ActionForm (shared helpers, not a second
  // copy of the rule), so a destructive form spaces its children exactly
  // like the form it sits beneath.
  const ownsLayout = !callerOwnsFormLayout(className);

  return (
    <form
      action={formAction}
      className={mergeFormClassName(className)}
      aria-busy={pending}
      onSubmit={(e) => {
        // Read the form's current values before confirming, so a
        // function message sees exactly what is about to be submitted.
        const formData = new FormData(e.currentTarget);

        // Nothing at stake, or the guarded field was not changed: submit
        // exactly as a plain ActionForm would, with no dialog.
        const needsConfirmation = shouldRequestConfirmation({
          skipConfirmation,
          confirmWhen,
          readField: (name) => String(formData.get(name) ?? ''),
        });
        if (!needsConfirmation) return;

        if (!window.confirm(resolveConfirmMessage(confirmMessage, formData))) {
          e.preventDefault();
        }
      }}
    >
      {children}
      <div className={ownsLayout ? 'flex flex-wrap items-center gap-3' : 'contents'}>
        <button type="submit" disabled={pending} className={buttonClassName}>
          {pending ? 'Working…' : submitLabel}
        </button>
        {state && !state.success && (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}
