import { actorLabel, eventTypeLabel, type OrderTimelineEntry } from "@/lib/order-events";

/**
 * Read-only audit timeline for one order, inside the Tenant Admin order
 * card. A Server Component with no form, no action and no interactive
 * control: there is deliberately no way to edit or delete recorded history
 * from the UI, because no Server Action exists that could.
 *
 * Renders only what getOrderTimeline() returns — a type, a transition, a
 * server-composed summary, an actor ROLE and a timestamp. No actorId, no
 * provider payload, no account number, no customer contact details.
 */
export function OrderTimeline({ entries }: { entries: OrderTimelineEntry[] }) {
  if (entries.length === 0) {
    // Orders placed before this feature existed genuinely have no recorded
    // activity. Saying so is accurate; inventing a backfilled entry would
    // not be.
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        No recorded activity for this order yet.
      </p>
    );
  }

  return (
    // An ordered list, because the order of these entries is the
    // information — a screen reader announces position and count, which a
    // stack of divs would not convey.
    <ol className="mt-1 flex flex-col gap-2">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-col gap-0.5 border-l-2 border-border pl-3">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-xs font-medium">{eventTypeLabel(entry.type)}</span>
            {/* The raw transition alongside the sentence, so an operator can
                see the exact before/after rather than only prose. */}
            {entry.previousValue && entry.newValue && (
              <span className="text-xs text-muted-foreground">
                {entry.previousValue} → {entry.newValue}
              </span>
            )}
            {!entry.previousValue && entry.newValue && (
              <span className="text-xs text-muted-foreground">{entry.newValue}</span>
            )}
          </div>
          <span className="text-xs text-muted-foreground">{entry.summary}</span>
          <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
            {/* A machine-readable timestamp with a locale-rendered label,
                so the exact instant is available to assistive tech and to
                anything parsing the page. */}
            <time dateTime={entry.createdAt.toISOString()}>
              {entry.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
            </time>
            <span aria-hidden="true">·</span>
            <span>{actorLabel(entry.actorType)}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
