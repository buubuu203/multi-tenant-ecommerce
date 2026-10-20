import type { ReactNode } from "react";
import { adminHelpTextClassName } from "./styles";

/**
 * The top of every admin page: what this screen is, what it is for, and
 * the actions that belong to it.
 *
 * Previously each page opened with a bare <h2> and then dropped straight
 * into controls, so there was no consistent place to look for "what can I
 * do here" — and actions ended up wherever they were built. Giving every
 * page the same header means an operator learns the shape once.
 *
 * `actions` is a slot rather than a prop list so a page can pass whatever
 * it needs, but the ORDER is fixed by the layout: description under the
 * title, actions trailing on desktop and wrapping beneath on narrow
 * screens, which is what keeps 375px free of horizontal overflow.
 */
export function AdminPageHeader({
  title,
  description,
  actions,
  /** Small count or status shown beside the title, e.g. "3 orders". */
  meta,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* h2, not h1: the layout's h1 is the store itself, and a page is
              a section within it. Keeps one h1 per page. */}
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {meta}
        </div>
        {description && <p className={adminHelpTextClassName}>{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
