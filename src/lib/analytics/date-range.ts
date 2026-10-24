/**
 * Date-range semantics for operational analytics, in one dependency-free
 * place so the queries, the UI and the tests cannot disagree.
 *
 * TIMEZONE. Every `createdAt` column in this schema is
 * `timestamp without time zone`, and Prisma writes UTC instants into it.
 * The Postgres session timezone happens to be Asia/Ho_Chi_Minh, but that
 * is irrelevant for such a column — no conversion is applied on read or
 * write — so relying on it would be relying on an accident. Nothing here
 * uses `CURRENT_DATE`, `NOW()` or `date_trunc` for that exact reason:
 * boundaries are computed here as explicit UTC instants and passed as
 * bound parameters, which makes the result independent of whatever
 * session or server timezone the query happens to run under.
 *
 * WHICH timezone the merchant means is a separate question from how it
 * is computed. A merchant asking for "1–7 October" means those dates
 * where they are standing, and this application is unambiguously built
 * for Vietnam: VND amounts, vi-VN number formatting, a Vietnamese help
 * guide. Interpreting their input as UTC would misfile every order
 * placed between midnight and 07:00 local into the previous day.
 *
 * So boundaries are Asia/Ho_Chi_Minh. This is a FIXED PRODUCT DECISION,
 * not a tenant setting: there is no timezone column, no admin control and
 * no migration behind it, exactly like LOW_STOCK_THRESHOLD. Changing it
 * is a code change, on purpose.
 *
 * A fixed numeric offset is only safe because Vietnam has observed no
 * daylight saving since 1975 and is UTC+7 year-round. For a zone with
 * DST this arithmetic would be wrong twice a year and would need a real
 * timezone database instead.
 */

/** Asia/Ho_Chi_Minh, as a fixed offset. See the note above on why this is safe. */
export const ANALYTICS_UTC_OFFSET_HOURS = 7;

/** The label shown to merchants wherever a date boundary is explained. */
export const ANALYTICS_TIMEZONE_LABEL = 'Asia/Ho_Chi_Minh (UTC+7)';

/** Days covered when no range is supplied, or when a supplied one is unusable. */
export const DEFAULT_RANGE_DAYS = 30;

/**
 * The widest range that may be requested, in days.
 *
 * Not a performance guess: every query behind this range is an aggregate
 * that returns a bounded number of rows, so a wider window costs scan
 * time rather than memory. The cap exists so a mistyped year cannot turn
 * one page view into a full-history scan.
 */
export const MAX_RANGE_DAYS = 366;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const OFFSET_MS = ANALYTICS_UTC_OFFSET_HOURS * 60 * 60 * 1000;

/** A resolved, validated range. `end` is EXCLUSIVE: [start, end). */
export type AnalyticsRange = {
  /** Inclusive lower bound, as a UTC instant. */
  start: Date;
  /** EXCLUSIVE upper bound, as a UTC instant. */
  end: Date;
  /** The first day included, `YYYY-MM-DD` in the analytics timezone. */
  fromDate: string;
  /** The last day included, `YYYY-MM-DD` in the analytics timezone. Inclusive. */
  toDate: string;
  /** How many whole days the range covers. */
  days: number;
  /**
   * Why the requested range was not used verbatim. Null when the input
   * was accepted as given. Surfaced in the UI so a merchant is never
   * silently shown a different window from the one they asked for.
   */
  adjustment: RangeAdjustment | null;
};

export type RangeAdjustment =
  'defaulted' | 'invalid_from' | 'invalid_to' | 'reversed' | 'clamped_to_max';

export const RANGE_ADJUSTMENT_MESSAGE: Record<RangeAdjustment, string> = {
  defaulted: `Showing the last ${DEFAULT_RANGE_DAYS} days.`,
  invalid_from: `The start date was not a valid YYYY-MM-DD date, so the last ${DEFAULT_RANGE_DAYS} days are shown instead.`,
  invalid_to: `The end date was not a valid YYYY-MM-DD date, so the last ${DEFAULT_RANGE_DAYS} days are shown instead.`,
  reversed: 'The start date was after the end date, so the two were swapped.',
  clamped_to_max: `A range may cover at most ${MAX_RANGE_DAYS} days, so the start date was moved forward.`,
};

/**
 * Parses `YYYY-MM-DD` strictly.
 *
 * Strict because `new Date("2026-02-31")` and `new Date("2026-13-01")`
 * are not errors in JavaScript — the first rolls over into March. A
 * rolled-over date would silently widen or shift the window, which is
 * exactly the "never broaden the query on invalid input" failure. The
 * round-trip check below rejects any value that did not survive parsing
 * unchanged.
 */
export function parseAnalyticsDate(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;

  const [year, month, day] = trimmed.split('-').map(Number);
  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  // Build the date in UTC and require it to round-trip, which rejects
  // 2026-02-31 and friends.
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  if (
    asUtc.getUTCFullYear() !== year ||
    asUtc.getUTCMonth() !== month - 1 ||
    asUtc.getUTCDate() !== day
  ) {
    return null;
  }
  return trimmed;
}

/** Midnight at the start of this local date, as a UTC instant. */
function startOfLocalDay(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) - OFFSET_MS);
}

/** The local `YYYY-MM-DD` that a UTC instant falls on. */
export function toAnalyticsDate(instant: Date): string {
  const shifted = new Date(instant.getTime() + OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: string, days: number): string {
  const shifted = new Date(startOfLocalDay(date).getTime() + days * MS_PER_DAY + OFFSET_MS);
  return toAnalyticsDate(new Date(shifted.getTime() - OFFSET_MS));
}

/**
 * Resolves whatever arrived in the query string into a usable range.
 *
 * Never throws and never widens. Anything unparseable falls back to the
 * default window, which is narrower than the maximum, so malformed input
 * can only ever produce a smaller query than a valid one could.
 *
 * Both inputs name INCLUSIVE days. `end` is returned exclusive, as the
 * start of the day after `toDate`, so an order placed at 23:59:59.999
 * local on the last day is inside the range and one at 00:00:00.000 the
 * next day is not. Half-open intervals are what make adjacent ranges
 * tile without double-counting a boundary order.
 */
export function resolveAnalyticsRange(
  input: { from?: string; to?: string } = {},
  now: Date = new Date(),
): AnalyticsRange {
  const today = toAnalyticsDate(now);
  let adjustment: RangeAdjustment | null = null;

  const rawFrom = input.from?.trim();
  const rawTo = input.to?.trim();
  const hasInput = Boolean(rawFrom) || Boolean(rawTo);

  let from = parseAnalyticsDate(rawFrom);
  let to = parseAnalyticsDate(rawTo);

  if (rawFrom && from === null) {
    adjustment = 'invalid_from';
    from = null;
    to = null;
  } else if (rawTo && to === null) {
    adjustment = 'invalid_to';
    from = null;
    to = null;
  }

  // A partial range is completed rather than rejected: one supplied
  // endpoint is unambiguous, and the default span anchors the other.
  if (from === null && to === null) {
    if (hasInput && adjustment === null) adjustment = 'defaulted';
    if (!hasInput) adjustment = 'defaulted';
    to = today;
    from = addDays(today, -(DEFAULT_RANGE_DAYS - 1));
  } else if (from === null && to !== null) {
    from = addDays(to, -(DEFAULT_RANGE_DAYS - 1));
  } else if (to === null && from !== null) {
    to = addDays(from, DEFAULT_RANGE_DAYS - 1);
  }

  if (from! > to!) {
    [from, to] = [to, from];
    adjustment = 'reversed';
  }

  const startMs = startOfLocalDay(from!).getTime();
  const endMs = startOfLocalDay(to!).getTime() + MS_PER_DAY;
  let days = Math.round((endMs - startMs) / MS_PER_DAY);

  if (days > MAX_RANGE_DAYS) {
    // Narrow by moving the START forward, keeping the requested end. A
    // merchant who mistyped a year still sees the most recent data they
    // asked for, and the window can only ever shrink.
    from = addDays(to!, -(MAX_RANGE_DAYS - 1));
    days = MAX_RANGE_DAYS;
    adjustment = 'clamped_to_max';
  }

  return {
    start: startOfLocalDay(from!),
    end: new Date(startOfLocalDay(to!).getTime() + MS_PER_DAY),
    fromDate: from!,
    toDate: to!,
    days,
    adjustment,
  };
}
