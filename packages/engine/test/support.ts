/**
 * Test support: fast-check arbitraries and deliberately naive reference implementations.
 *
 * The oracles share no code with the engine. They use JS Date in UTC for calendar maths and
 * test every single day against the definition of the schedule, which is slow and obviously
 * correct — the opposite trade-off from the engine.
 */

import fc from 'fast-check';
import holidayConfig from '../../../config/holidays/us-federal-reserve.json' with { type: 'json' };
import type { HolidayCalendarConfig } from '../src/business.ts';
import type { CivilDate, DayOfMonth, NthWeekday, Weekday } from '../src/date.ts';
import type { Schedule } from '../src/schedule.ts';

export const FED = holidayConfig as HolidayCalendarConfig;

const MS_PER_DAY = 86_400_000;

/** Oracle conversions via Date.UTC — independent of the engine's Hinnant algorithms. */
export const oracle = {
  day(year: number, month: number, day: number): CivilDate {
    return (Date.UTC(year, month - 1, day) / MS_PER_DAY) as CivilDate;
  },
  ymd(date: number): { year: number; month: number; day: number; weekday: number } {
    const d = new Date(date * MS_PER_DAY);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
  },
  daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  },
};

/** `d(2026, 9, 28)` — shorthand used throughout the tests. */
export const d = oracle.day;

/** Every scheduled date in [from, to] by testing each day against the definition. */
export function naiveScheduled(schedule: Schedule, from: number, to: number): CivilDate[] {
  const matchesOn = (date: number): number => {
    const { year, month, day, weekday } = oracle.ymd(date);
    const start = oracle.ymd(schedule.start);
    const dim = oracle.daysInMonth(year, month);
    const resolve = (spec: DayOfMonth): number => (spec === 'last' ? dim : Math.min(spec, dim));
    switch (schedule.kind) {
      case 'once':
        return date === schedule.start ? 1 : 0;
      case 'weekly':
        return (date - schedule.start) % (7 * schedule.interval) === 0 ? 1 : 0;
      case 'monthly': {
        if ((year * 12 + month - (start.year * 12 + start.month)) % schedule.interval !== 0) return 0;
        return schedule.days.filter((spec) => resolve(spec) === day).length;
      }
      case 'monthly-weekday': {
        if ((year * 12 + month - (start.year * 12 + start.month)) % schedule.interval !== 0) return 0;
        if (weekday !== schedule.weekday) return 0;
        const nth: NthWeekday = schedule.nth;
        return (nth === 'last' ? day + 7 > dim : Math.ceil(day / 7) === nth) ? 1 : 0;
      }
      case 'yearly':
        if ((year - start.year) % schedule.interval !== 0) return 0;
        return month === schedule.month && day === resolve(schedule.day) ? 1 : 0;
    }
  };

  const out: CivilDate[] = [];
  let taken = 0;
  const count = schedule.kind === 'once' ? 1 : schedule.count;
  const end = schedule.kind === 'once' ? schedule.start : schedule.end;
  for (let date = schedule.start; date <= to; date++) {
    if (end !== undefined && date > end) break;
    const n = matchesOn(date);
    for (let i = 0; i < n; i++) {
      if (count !== undefined && taken >= count) return out;
      taken++;
      if (date >= from) out.push(date as CivilDate);
    }
  }
  return out;
}

/** Fed holidays by definition, computed independently of the engine's rule evaluation. */
export function naiveFedHolidays(year: number): number[] {
  const nth = (month: number, weekday: number, n: number): number => {
    let count = 0;
    for (let day = 1; ; day++) {
      if (oracle.ymd(oracle.day(year, month, day)).weekday === weekday && ++count === n) return oracle.day(year, month, day);
    }
  };
  const last = (month: number, weekday: number): number => {
    for (let day = oracle.daysInMonth(year, month); ; day--) {
      if (oracle.ymd(oracle.day(year, month, day)).weekday === weekday) return oracle.day(year, month, day);
    }
  };
  const fixed = (y: number, month: number, day: number): number | undefined => {
    const date = oracle.day(y, month, day);
    const weekday = oracle.ymd(date).weekday;
    if (weekday === 6) return undefined; // Saturday: not observed
    return weekday === 0 ? date + 1 : date;
  };
  const dates = [
    fixed(year, 1, 1),
    nth(1, 1, 3),
    nth(2, 1, 3),
    last(5, 1),
    year >= 2022 ? fixed(year, 6, 19) : undefined,
    fixed(year, 7, 4),
    nth(9, 1, 1),
    nth(10, 1, 2),
    fixed(year, 11, 11),
    nth(11, 4, 4),
    fixed(year, 12, 25),
  ];
  return dates.filter((x): x is number => x !== undefined).sort((a, b) => a - b);
}

export function naiveAdjust(date: number, mode: 'before' | 'after' | 'none', isHoliday: (d: number) => boolean): number {
  if (mode === 'none') return date;
  const business = (x: number): boolean => {
    const weekday = oracle.ymd(x).weekday;
    return weekday !== 0 && weekday !== 6 && !isHoliday(x);
  };
  let x = date;
  while (!business(x)) x += mode === 'before' ? -1 : 1;
  return x;
}

// ---------------------------------------------------------------------------------------
// Arbitraries

export const LO = d(2019, 1, 1);
export const HI = d(2033, 12, 31);

export const dateArb = (lo = LO, hi = HI): fc.Arbitrary<CivilDate> => fc.integer({ min: lo, max: hi }) as fc.Arbitrary<CivilDate>;

/** A window [from, to] of up to ~2 years somewhere in range. */
export const windowArb = fc
  .tuple(dateArb(d(2020, 1, 1), d(2031, 12, 31)), fc.integer({ min: 0, max: 800 }))
  .map(([from, span]) => ({ from, to: (from + span) as CivilDate }));

const dayOfMonthArb: fc.Arbitrary<DayOfMonth> = fc.oneof(
  { weight: 4, arbitrary: fc.integer({ min: 1, max: 31 }) },
  // Bias toward the troublesome end of the month.
  { weight: 3, arbitrary: fc.integer({ min: 28, max: 31 }) },
  { weight: 2, arbitrary: fc.constant('last' as const) },
);

const boundsArb = (start: CivilDate) =>
  fc.record(
    {
      end: fc.integer({ min: start, max: start + 1500 }).map((x) => x as CivilDate),
      count: fc.integer({ min: 1, max: 60 }),
    },
    { requiredKeys: [] },
  );

export const scheduleArb: fc.Arbitrary<Schedule> = dateArb(d(2020, 1, 1), d(2030, 12, 31)).chain((start) =>
  fc.oneof(
    fc.constant<Schedule>({ kind: 'once', start }),
    fc
      .tuple(fc.integer({ min: 1, max: 4 }), boundsArb(start))
      .map(([interval, bounds]): Schedule => ({ kind: 'weekly', start, interval, ...bounds })),
    fc
      .tuple(fc.integer({ min: 1, max: 4 }), fc.uniqueArray(dayOfMonthArb, { minLength: 1, maxLength: 3 }), boundsArb(start))
      .map(([interval, days, bounds]): Schedule => ({ kind: 'monthly', start, interval, days, ...bounds })),
    fc
      .tuple(
        fc.integer({ min: 1, max: 3 }),
        fc.constantFrom<NthWeekday>(1, 2, 3, 4, 'last'),
        fc.integer({ min: 0, max: 6 }) as fc.Arbitrary<Weekday>,
        boundsArb(start),
      )
      .map(([interval, nth, weekday, bounds]): Schedule => ({ kind: 'monthly-weekday', start, interval, nth, weekday, ...bounds })),
    fc
      .tuple(fc.integer({ min: 1, max: 2 }), fc.integer({ min: 1, max: 12 }), dayOfMonthArb, boundsArb(start))
      .map(([interval, month, day, bounds]): Schedule => ({ kind: 'yearly', start, interval, month, day, ...bounds })),
  ),
);
