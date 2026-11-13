import { resolveAnalyticsRange, toAnalyticsDate, type AnalyticsRange } from './date-range';

/**
 * Named periods for the Overview filter.
 *
 * A merchant picks "this month", not a pair of ISO dates. Each preset
 * resolves to a pair of local dates and then goes through
 * resolveAnalyticsRange() like any hand-typed range, so there is exactly
 * one implementation of what a day boundary means — presets cannot drift
 * from the custom pickers beside them.
 *
 * `custom` is the escape hatch: the from/to inputs stay usable, and
 * picking a date switches the period to custom automatically.
 */
export const PERIODS = [
  'today',
  'last_7_days',
  'last_30_days',
  'this_month',
  'last_month',
  'custom',
] as const;

export type Period = (typeof PERIODS)[number];

export const DEFAULT_PERIOD: Period = 'last_30_days';

export const PERIOD_LABEL: Record<Period, string> = {
  today: 'Hôm nay',
  last_7_days: '7 ngày gần nhất',
  last_30_days: '30 ngày gần nhất',
  this_month: 'Tháng này',
  last_month: 'Tháng trước',
  custom: 'Tự chọn',
};

export function isPeriod(value: string | undefined): value is Period {
  return typeof value === 'string' && (PERIODS as readonly string[]).includes(value);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` arithmetic that stays in the analytics timezone. */
function shiftDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return toAnalyticsDate(new Date(Date.UTC(y, m - 1, d) + days * MS_PER_DAY));
}

function firstOfMonth(date: string): string {
  const [y, m] = date.split('-');
  return `${y}-${m}-01`;
}

function lastOfPreviousMonth(date: string): string {
  return shiftDays(firstOfMonth(date), -1);
}

/**
 * Turns a period — and, for `custom`, the supplied dates — into a range.
 *
 * Anything unrecognised falls back to the default period rather than
 * erroring or widening, the same posture the date parser itself takes.
 */
export function resolvePeriod(
  input: { period?: string; from?: string; to?: string } = {},
  now: Date = new Date(),
): { period: Period; range: AnalyticsRange } {
  const today = toAnalyticsDate(now);

  // A supplied date always means the merchant is choosing their own
  // window, whatever the dropdown still says.
  const hasDates = Boolean(input.from || input.to);
  const period: Period = hasDates
    ? 'custom'
    : isPeriod(input.period)
      ? input.period
      : DEFAULT_PERIOD;

  switch (period) {
    case 'today':
      return { period, range: resolveAnalyticsRange({ from: today, to: today }, now) };
    case 'last_7_days':
      return {
        period,
        range: resolveAnalyticsRange({ from: shiftDays(today, -6), to: today }, now),
      };
    case 'this_month':
      return {
        period,
        range: resolveAnalyticsRange({ from: firstOfMonth(today), to: today }, now),
      };
    case 'last_month': {
      const end = lastOfPreviousMonth(today);
      return { period, range: resolveAnalyticsRange({ from: firstOfMonth(end), to: end }, now) };
    }
    case 'custom':
      return { period, range: resolveAnalyticsRange({ from: input.from, to: input.to }, now) };
    case 'last_30_days':
    default:
      return {
        period: 'last_30_days',
        range: resolveAnalyticsRange({ from: shiftDays(today, -29), to: today }, now),
      };
  }
}
