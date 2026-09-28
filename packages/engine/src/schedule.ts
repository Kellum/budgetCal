/**
 * Recurrence schedules. See docs/PLAN.md §4.3.
 *
 * Every occurrence is computed from the schedule's phase (its start date), never from the
 * previous occurrence, so errors cannot accumulate: a rule for the 31st yields Jan 31,
 * Feb 28, Mar 31 — never drifting to the 28th.
 *
 * `start` is inclusive and sets the phase. `end` and `count` bound the *scheduled* date,
 * before any weekend adjustment (that happens in occurrence.ts).
 */

import {
  type CivilDate,
  type DayOfMonth,
  type NthWeekday,
  type Weekday,
  addDays,
  clampedDay,
  fromMonthIndex,
  maxDate,
  minDate,
  monthIndexOf,
  nthWeekdayOfMonth,
  toYearMonthDay,
} from './date.ts';

interface Bounds {
  readonly start: CivilDate;
  /** Last possible scheduled date, inclusive. */
  readonly end?: CivilDate;
  /** Maximum number of occurrences counted from `start`. */
  readonly count?: number;
}

export type Schedule =
  | { readonly kind: 'once'; readonly start: CivilDate }
  | (Bounds & { readonly kind: 'weekly'; readonly interval: number })
  | (Bounds & { readonly kind: 'monthly'; readonly interval: number; readonly days: readonly DayOfMonth[] })
  | (Bounds & {
      readonly kind: 'monthly-weekday';
      readonly interval: number;
      readonly nth: NthWeekday;
      readonly weekday: Weekday;
    })
  | (Bounds & { readonly kind: 'yearly'; readonly interval: number; readonly month: number; readonly day: DayOfMonth });

/** Problems with a schedule, as plain sentences. Empty means valid. */
export function scheduleProblems(schedule: Schedule): string[] {
  const problems: string[] = [];
  if (schedule.kind === 'once') return problems;
  if (!Number.isInteger(schedule.interval) || schedule.interval < 1 || schedule.interval > 99) {
    problems.push('Interval must be a whole number from 1 to 99.');
  }
  if (schedule.end !== undefined && schedule.end < schedule.start) problems.push('End date is before the start date.');
  if (schedule.count !== undefined && (!Number.isInteger(schedule.count) || schedule.count < 1 || schedule.count > 5000)) {
    problems.push('Count must be a whole number from 1 to 5000.');
  }
  const validDay = (day: DayOfMonth): boolean => day === 'last' || (Number.isInteger(day) && day >= 1 && day <= 31);
  switch (schedule.kind) {
    case 'monthly':
      if (schedule.days.length === 0) problems.push('Pick at least one day of the month.');
      if (!schedule.days.every(validDay)) problems.push('Days of the month must be 1–31 or "last".');
      if (new Set(schedule.days).size !== schedule.days.length) problems.push('A day of the month is listed twice.');
      break;
    case 'monthly-weekday':
      if (![1, 2, 3, 4, 'last'].includes(schedule.nth)) problems.push('Week of the month must be 1–4 or "last".');
      if (!Number.isInteger(schedule.weekday) || schedule.weekday < 0 || schedule.weekday > 6) {
        problems.push('Weekday must be 0 (Sunday) to 6 (Saturday).');
      }
      break;
    case 'yearly':
      if (!Number.isInteger(schedule.month) || schedule.month < 1 || schedule.month > 12) {
        problems.push('Month must be 1–12.');
      }
      if (!validDay(schedule.day)) problems.push('Day of the month must be 1–31 or "last".');
      break;
    case 'weekly':
      break;
  }
  return problems;
}

function assertValid(schedule: Schedule): void {
  const problems = scheduleProblems(schedule);
  if (problems.length > 0) throw new RangeError(`Invalid schedule: ${problems.join(' ')}`);
}

/** Scheduled dates in one period (month or year), sorted, before bounds are applied. */
type PeriodDates = (period: number) => CivilDate[];

function periodic(schedule: Exclude<Schedule, { kind: 'once' | 'weekly' }>): {
  first: number;
  dates: PeriodDates;
  periodOf: (date: CivilDate) => number;
} {
  switch (schedule.kind) {
    case 'monthly':
      return {
        first: monthIndexOf(schedule.start),
        periodOf: monthIndexOf,
        dates: (index) => {
          const { year, month } = fromMonthIndex(index);
          // Sort by resolved date; ties (e.g. 30 and 'last' in February) keep list order.
          return schedule.days.map((day) => clampedDay(year, month, day)).sort((a, b) => a - b);
        },
      };
    case 'monthly-weekday':
      return {
        first: monthIndexOf(schedule.start),
        periodOf: monthIndexOf,
        dates: (index) => {
          const { year, month } = fromMonthIndex(index);
          return [nthWeekdayOfMonth(year, month, schedule.weekday, schedule.nth)];
        },
      };
    case 'yearly':
      return {
        first: toYearMonthDay(schedule.start).year,
        periodOf: (date) => toYearMonthDay(date).year,
        dates: (year) => [clampedDay(year, schedule.month, schedule.day)],
      };
  }
}

/**
 * The last occurrence `count` allows: its date, and how many of the occurrences on that date
 * are within the count (normally 1; more only when two day specs collide on that date).
 */
function lastByCount(schedule: Exclude<Schedule, { kind: 'once' }>): { date: CivilDate; take: number } | undefined {
  if (schedule.count === undefined) return undefined;
  if (schedule.kind === 'weekly') return { date: addDays(schedule.start, (schedule.count - 1) * 7 * schedule.interval), take: 1 };
  const { first, dates } = periodic(schedule);
  let remaining = schedule.count;
  for (let period = first; ; period += schedule.interval) {
    let take = 0;
    let previous: CivilDate | undefined;
    for (const date of dates(period)) {
      if (date < schedule.start) continue;
      take = date === previous ? take + 1 : 1;
      previous = date;
      remaining -= 1;
      if (remaining === 0) return { date, take };
    }
  }
}

/** Inclusive upper bound on scheduled dates from `end` and `count` combined. */
export function scheduleEnd(schedule: Schedule): CivilDate | undefined {
  if (schedule.kind === 'once') return schedule.start;
  const byCount = lastByCount(schedule)?.date;
  if (byCount === undefined) return schedule.end;
  return schedule.end === undefined ? byCount : minDate(byCount, schedule.end);
}

/**
 * Every scheduled date in [from, to], ascending. A date appears twice only if the schedule
 * genuinely schedules two occurrences on it (e.g. days [30, 'last'] in February).
 */
export function scheduledDates(schedule: Schedule, from: CivilDate, to: CivilDate): CivilDate[] {
  assertValid(schedule);
  const end = scheduleEnd(schedule);
  const lo = maxDate(from, schedule.start);
  const hi = end === undefined ? to : minDate(to, end);
  if (lo > hi) return [];

  if (schedule.kind === 'once') return [schedule.start];

  const out: CivilDate[] = [];
  if (schedule.kind === 'weekly') {
    const step = 7 * schedule.interval;
    const skip = Math.ceil((lo - schedule.start) / step);
    for (let date = addDays(schedule.start, skip * step); date <= hi; date = addDays(date, step)) out.push(date);
    return out;
  }

  const { first, dates, periodOf } = periodic(schedule);
  const offset = (((periodOf(lo) - first) % schedule.interval) + schedule.interval) % schedule.interval;
  const firstPeriod = periodOf(lo) + (offset === 0 ? 0 : schedule.interval - offset);
  for (let period = firstPeriod; period <= periodOf(hi); period += schedule.interval) {
    for (const date of dates(period)) if (date >= lo && date <= hi) out.push(date);
  }

  // When count's last occurrence shares its date with another, keep only the counted ones.
  const last = lastByCount(schedule);
  if (last && last.date === hi) {
    const firstOnLast = out.indexOf(last.date);
    if (firstOnLast !== -1) out.length = Math.min(out.length, firstOnLast + last.take);
  }
  return out;
}

/** How many occurrences the schedule places on exactly this date (0, 1, or rarely 2+). */
export function occurrencesOn(schedule: Schedule, date: CivilDate): number {
  return scheduledDates(schedule, date, date).length;
}
