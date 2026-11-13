/**
 * A status pill for order, payment and product states.
 *
 * Replaces the per-page Record<string, string> colour maps that each page
 * previously defined for itself. Three reasons it is one component:
 *
 *  - the same status meant the same thing on three pages but could be
 *    styled differently on each;
 *  - colour alone must never carry meaning (WCAG 1.4.1), so every badge
 *    renders its LABEL as text and uses colour only to reinforce it;
 *  - a status nobody has styled yet falls back to a readable neutral
 *    rather than to invisible text.
 */
export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE: Record<BadgeTone, string> = {
  success:
    "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-400",
  warning:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400",
  danger:
    "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400",
  info: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300",
  neutral: "border-border bg-surface-muted text-muted-foreground",
};

/**
 * The shared meaning of each status across the admin. Centralised so
 * "cancelled" cannot read as a warning on one page and a failure on
 * another.
 */
const STATUS_TONE: Record<string, BadgeTone> = {
  // Order lifecycle
  pending: "warning",
  fulfilled: "success",
  cancelled: "neutral",
  // Payment lifecycle
  succeeded: "success",
  failed: "danger",
  expired: "neutral",
  // Product / variant lifecycle
  active: "success",
  draft: "warning",
  archived: "neutral",
};

export function toneForStatus(status: string | null | undefined): BadgeTone {
  if (!status) return "neutral";
  return STATUS_TONE[status.toLowerCase()] ?? "neutral";
}

export function StatusBadge({
  status,
  tone,
  className = "",
}: {
  /** Rendered as the visible label — never conveyed by colour alone. */
  status: string;
  /** Override the shared mapping only when a surface genuinely differs. */
  tone?: BadgeTone;
  className?: string;
}) {
  const resolved = tone ?? toneForStatus(status);
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap capitalize ${TONE[resolved]} ${className}`}
    >
      {status}
    </span>
  );
}
