// Date-range semantics for operational analytics.
//
// These are pure, so they run without a database and pin the boundary
// behaviour exactly: half-open intervals, a fixed Asia/Ho_Chi_Minh day
// boundary, and the rule that malformed input can never widen a query.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAnalyticsRange,
  parseAnalyticsDate,
  toAnalyticsDate,
  DEFAULT_RANGE_DAYS,
  MAX_RANGE_DAYS,
  ANALYTICS_UTC_OFFSET_HOURS,
} from '../src/lib/analytics/date-range';

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------- parsing ----------

test('only strict YYYY-MM-DD is accepted', () => {
  assert.equal(parseAnalyticsDate('2026-10-16'), '2026-10-16');
  assert.equal(parseAnalyticsDate('  2026-10-16  '), '2026-10-16');

  for (const bad of [
    undefined,
    '',
    'today',
    '2026-10-16T00:00:00Z',
    '16-10-2026',
    '2026-1-5',
    '2026/10/16',
    "2026-10-16'; DROP TABLE orders; --",
  ]) {
    assert.equal(
      parseAnalyticsDate(bad as string | undefined),
      null,
      `${String(bad)} must be rejected`,
    );
  }
});

test('a date that JavaScript would silently roll over is rejected', () => {
  // new Date("2026-02-31") becomes 3 March. Accepting it would shift the
  // window to a day the merchant never asked for.
  assert.equal(parseAnalyticsDate('2026-02-31'), null);
  assert.equal(parseAnalyticsDate('2026-13-01'), null);
  assert.equal(parseAnalyticsDate('2026-00-10'), null);
  assert.equal(parseAnalyticsDate('2025-02-29'), null, '2025 is not a leap year');
  assert.equal(parseAnalyticsDate('2024-02-29'), '2024-02-29', '2024 is');
});

// ---------- timezone ----------

test('day boundaries are Asia/Ho_Chi_Minh, not UTC', () => {
  const range = resolveAnalyticsRange({ from: '2026-10-16', to: '2026-10-16' });

  // Midnight in UTC+7 is 17:00 UTC the previous day.
  assert.equal(range.start.toISOString(), '2026-10-15T17:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-10-16T17:00:00.000Z');
  assert.equal(ANALYTICS_UTC_OFFSET_HOURS, 7);
});

test('an order just after local midnight falls in the new day, not the old one', () => {
  // 00:30 local on 16 Oct is 17:30 UTC on 15 Oct. Treating boundaries as
  // UTC would file it under the 15th.
  const justAfterMidnight = new Date('2026-10-15T17:30:00.000Z');
  assert.equal(toAnalyticsDate(justAfterMidnight), '2026-10-16');

  const sixteenth = resolveAnalyticsRange({ from: '2026-10-16', to: '2026-10-16' });
  assert.ok(justAfterMidnight >= sixteenth.start && justAfterMidnight < sixteenth.end);

  const fifteenth = resolveAnalyticsRange({ from: '2026-10-15', to: '2026-10-15' });
  assert.ok(justAfterMidnight >= fifteenth.end, 'it must NOT be in the previous day');
});

// ---------- half-open intervals ----------

test('the range is [start, end) so adjacent ranges tile without overlap', () => {
  const first = resolveAnalyticsRange({ from: '2026-10-01', to: '2026-10-07' });
  const second = resolveAnalyticsRange({ from: '2026-10-08', to: '2026-10-14' });

  assert.equal(first.end.getTime(), second.start.getTime(), 'they must meet exactly');
  assert.equal(first.days, 7);
  assert.equal(second.days, 7);
});

test('the last instant of the final day is inside the range and the next is not', () => {
  const range = resolveAnalyticsRange({ from: '2026-10-01', to: '2026-10-07' });
  const lastInstant = new Date(range.end.getTime() - 1);
  assert.ok(lastInstant < range.end);
  assert.equal(toAnalyticsDate(lastInstant), '2026-10-07', 'still the 7th locally');
  assert.equal(toAnalyticsDate(range.end), '2026-10-08', 'end itself is the 8th');
});

test('both endpoints are inclusive days, so a single-day range covers 24 hours', () => {
  const range = resolveAnalyticsRange({ from: '2026-03-01', to: '2026-03-01' });
  assert.equal(range.days, 1);
  assert.equal(range.end.getTime() - range.start.getTime(), DAY_MS);
});

// ---------- defaults and determinism ----------

test('no input yields the default window ending today, in local terms', () => {
  const now = new Date('2026-10-16T10:00:00.000Z');
  const range = resolveAnalyticsRange({}, now);

  assert.equal(range.days, DEFAULT_RANGE_DAYS);
  assert.equal(range.toDate, '2026-10-16');
  assert.equal(range.fromDate, '2026-09-17');
  assert.equal(range.adjustment, 'defaulted');
});

test('the same input always resolves to the same range', () => {
  const a = resolveAnalyticsRange({ from: '2026-01-05', to: '2026-02-05' });
  const b = resolveAnalyticsRange({ from: '2026-01-05', to: '2026-02-05' });
  assert.deepEqual(a, b);
  // And a fixed `now` makes even the default deterministic.
  const now = new Date('2026-10-16T10:00:00.000Z');
  assert.deepEqual(resolveAnalyticsRange({}, now), resolveAnalyticsRange({}, now));
});

// ---------- invalid input never broadens ----------

test('INVALID INPUT NEVER BROADENS THE QUERY', () => {
  const now = new Date('2026-10-16T10:00:00.000Z');
  const widest = MAX_RANGE_DAYS;

  for (const input of [
    { from: 'nonsense' },
    { to: 'nonsense' },
    { from: '2026-02-31', to: '2026-12-31' },
    { from: '1970-01-01', to: 'bad' },
    { from: '', to: '' },
    { from: '0000-00-00', to: '9999-99-99' },
  ]) {
    const range = resolveAnalyticsRange(input, now);
    assert.ok(
      range.days <= DEFAULT_RANGE_DAYS,
      `${JSON.stringify(input)} produced ${range.days} days; invalid input must fall back to the default`,
    );
    assert.ok(range.days < widest, 'and must never reach the maximum');
    assert.ok(range.start < range.end, 'and must stay a valid interval');
  }
});

test('one invalid endpoint discards the other rather than half-applying it', () => {
  const now = new Date('2026-10-16T10:00:00.000Z');
  // A valid `to` with a broken `from` must not silently become
  // "everything up to `to`".
  const range = resolveAnalyticsRange({ from: 'junk', to: '2026-10-16' }, now);
  assert.equal(range.adjustment, 'invalid_from');
  assert.equal(range.days, DEFAULT_RANGE_DAYS);
});

test('a reversed range is swapped, not rejected or widened', () => {
  const range = resolveAnalyticsRange({ from: '2026-10-20', to: '2026-10-10' });
  assert.equal(range.fromDate, '2026-10-10');
  assert.equal(range.toDate, '2026-10-20');
  assert.equal(range.days, 11);
  assert.equal(range.adjustment, 'reversed');
});

// ---------- the maximum ----------

test('an over-long range is clamped to the maximum, keeping the requested end', () => {
  const range = resolveAnalyticsRange({ from: '2000-01-01', to: '2026-10-16' });
  assert.equal(range.days, MAX_RANGE_DAYS);
  assert.equal(range.toDate, '2026-10-16', 'the end the merchant asked for is kept');
  assert.equal(range.adjustment, 'clamped_to_max');
  assert.ok(range.fromDate > '2000-01-01', 'the start moved forward, so the window shrank');
});

test('a range exactly at the maximum is accepted unchanged', () => {
  const to = '2026-12-31';
  const range = resolveAnalyticsRange({ from: '2026-01-01', to });
  assert.equal(range.days, 365);
  assert.ok(range.days <= MAX_RANGE_DAYS);
  assert.equal(range.adjustment, null, 'nothing needed adjusting');
});

test('a single supplied endpoint is completed to the default span', () => {
  const from = resolveAnalyticsRange({ from: '2026-05-01' });
  assert.equal(from.fromDate, '2026-05-01');
  assert.equal(from.days, DEFAULT_RANGE_DAYS);

  const to = resolveAnalyticsRange({ to: '2026-05-31' });
  assert.equal(to.toDate, '2026-05-31');
  assert.equal(to.days, DEFAULT_RANGE_DAYS);
});

test('a leap day is handled by real date arithmetic, not a 30-day guess', () => {
  const range = resolveAnalyticsRange({ from: '2024-02-01', to: '2024-03-01' });
  assert.equal(range.days, 30, 'February 2024 has 29 days, so 1 Feb–1 Mar is 30 days');
});
