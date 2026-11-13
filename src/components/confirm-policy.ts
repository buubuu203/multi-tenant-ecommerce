/**
 * The confirmation DECISION, separated from the component that acts on it.
 *
 * ConfirmActionForm had this logic inline in an onSubmit handler, where it
 * could only be covered by reading the source. Extracting it changes no
 * behaviour — the component still calls window.confirm() and still calls
 * preventDefault() when the operator declines — but the rule itself can now
 * be exercised directly.
 *
 * Limit of that coverage, stated plainly: these are pure functions. Testing
 * them proves WHEN a confirmation is requested and WHICH message is used. It
 * does not prove anything about the browser — that a declined dialog issues
 * no network request remains verified only by reading the component, never
 * at runtime.
 */

/**
 * Ask for confirmation only when `field`'s submitted value differs from
 * `differsFrom` (the value currently stored on the server).
 */
export type ConfirmWhen = { field: string; differsFrom: string };

export function shouldRequestConfirmation(options: {
  /** Nothing is at stake yet, so no dialog. Decided on the server. */
  skipConfirmation?: boolean;
  /** Absent means "always confirm", which is the original behaviour. */
  confirmWhen?: ConfirmWhen;
  /** Reads a submitted field. Keeps FormData out of this module. */
  readField: (name: string) => string;
}): boolean {
  if (options.skipConfirmation) return false;
  const when = options.confirmWhen;
  if (!when) return true;
  return options.readField(when.field) !== when.differsFrom;
}

/**
 * A plain string covers the common case; a function is evaluated against
 * the form's own submitted values, which is what lets a message describe
 * the value the operator actually picked.
 */
export function resolveConfirmMessage<T extends { get(name: string): unknown }>(
  message: string | ((formData: T) => string),
  formData: T,
): string {
  return typeof message === 'function' ? message(formData) : message;
}
