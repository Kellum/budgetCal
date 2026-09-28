import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  type CivilDate,
  type NthWeekday,
  type Weekday,
  MAX_YEAR,
  MIN_YEAR,
  addDays,
  civil,
  clampedDay,
  daysInMonth,
  formatISODate,
  fromMonthIndex,
  isCivilDate,
  isLeapYear,
  monthIndex,
  monthIndexOf,
  nthWeekdayOfMonth,
  parseISODate,
  toYearMonthDay,
  tryParseISODate,
  weekday,
} from '../src/date.ts';
import { d, dateArb, oracle } from './support.ts';

const fullRange = dateArb(civil(MIN_YEAR, 1, 1), civil(MAX_YEAR, 12, 31));

describe('civil dates', () => {
  test('epoch and known dates', () => {
    expect(civil(1970, 1, 1)).toBe(0);
    expect(civil(1969, 12, 31)).toBe(-1);
    expect(civil(2000, 3, 1)).toBe(11017);
    expect(formatISODate(civil(2026, 9, 28))).toBe('2026-09-28');
    expect(weekday(civil(2026, 9, 28))).toBe(1); // a Monday
    expect(weekday(civil(1970, 1, 1))).toBe(4); // a Thursday
  });

  test('leap years follow the Gregorian rule', () => {
    expect([1900, 2000, 2023, 2024, 2100, 2400].map(isLeapYear)).toEqual([false, true, false, true, false, true]);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2100, 2)).toBe(28);
  });

  test('rejects dates that do not exist', () => {
    expect(() => civil(2026, 2, 29)).toThrow(RangeError);
    expect(() => civil(2026, 13, 1)).toThrow(RangeError);
    expect(() => civil(2026, 4, 31)).toThrow(RangeError);
    expect(() => civil(2026, 1, 0)).toThrow(RangeError);
    expect(() => civil(1899, 12, 31)).toThrow(RangeError);
    expect(() => daysInMonth(2026, 0)).toThrow(RangeError);
  });

  test('conversion agrees with an independent Date.UTC oracle across the whole range', () => {
    fc.assert(
      fc.property(fullRange, (date) => {
        const ours = toYearMonthDay(date);
        const theirs = oracle.ymd(date);
        expect(ours).toEqual({ year: theirs.year, month: theirs.month, day: theirs.day });
        expect(weekday(date)).toBe(theirs.weekday);
        expect(civil(ours.year, ours.month, ours.day)).toBe(date);
      }),
      { numRuns: 5000 },
    );
  });

  test('every boundary between months and years is contiguous', () => {
    for (let year = 1999; year <= 2031; year++) {
      for (let month = 1; month <= 12; month++) {
        const last = civil(year, month, daysInMonth(year, month));
        const next = month === 12 ? civil(year + 1, 1, 1) : civil(year, month + 1, 1);
        expect(addDays(last, 1)).toBe(next);
      }
    }
  });
});

describe('ISO strings', () => {
  test('round trip', () => {
    fc.assert(fc.property(fullRange, (date) => parseISODate(formatISODate(date)) === date));
  });

  test('strict parsing', () => {
    for (const bad of ['2026-02-30', '2026-2-3', ' 2026-01-01', '2026-01-01T00:00', '26-01-01', '2026/01/01', '', '1899-12-31', '2026-00-10']) {
      expect(tryParseISODate(bad), bad).toBeUndefined();
    }
    expect(() => parseISODate('2026-02-30')).toThrow(RangeError);
    expect(parseISODate('2024-02-29')).toBe(d(2024, 2, 29));
  });

  test('isCivilDate', () => {
    expect(isCivilDate(civil(2026, 1, 1))).toBe(true);
    expect(isCivilDate(1.5)).toBe(false);
    expect(isCivilDate('2026-01-01')).toBe(false);
    expect(isCivilDate(civil(MAX_YEAR, 12, 31) + 1)).toBe(false);
  });
});

describe('month helpers', () => {
  test('month indexes are consecutive across years', () => {
    expect(monthIndex(2026, 12) + 1).toBe(monthIndex(2027, 1));
    expect(fromMonthIndex(monthIndex(2026, 12))).toEqual({ year: 2026, month: 12 });
    expect(monthIndexOf(civil(2026, 9, 28))).toBe(monthIndex(2026, 9));
  });

  test('clamped days: the 31st becomes the last day of short months', () => {
    expect(clampedDay(2026, 2, 31)).toBe(d(2026, 2, 28));
    expect(clampedDay(2024, 2, 31)).toBe(d(2024, 2, 29));
    expect(clampedDay(2026, 4, 31)).toBe(d(2026, 4, 30));
    expect(clampedDay(2026, 4, 'last')).toBe(d(2026, 4, 30));
    expect(clampedDay(2026, 2, 29)).toBe(d(2026, 2, 28));
    expect(clampedDay(2026, 3, 15)).toBe(d(2026, 3, 15));
  });

  test('nth weekday agrees with brute force', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1990, max: 2040 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 6 }),
        fc.constantFrom<NthWeekday>(1, 2, 3, 4, 'last'),
        (year, month, wd, nth) => {
          const matches: number[] = [];
          for (let day = 1; day <= daysInMonth(year, month); day++) {
            if (oracle.ymd(d(year, month, day)).weekday === wd) matches.push(d(year, month, day));
          }
          const expected = nth === 'last' ? matches.at(-1) : matches[nth - 1];
          expect(nthWeekdayOfMonth(year, month, wd as Weekday, nth)).toBe(expected);
        },
      ),
    );
  });

  test('known nth weekdays', () => {
    expect(nthWeekdayOfMonth(2026, 11, 4, 4)).toBe(d(2026, 11, 26)); // Thanksgiving 2026
    expect(nthWeekdayOfMonth(2026, 5, 1, 'last')).toBe(d(2026, 5, 25)); // Memorial Day 2026
    expect(nthWeekdayOfMonth(2026, 9, 1, 1)).toBe(d(2026, 9, 7)); // Labor Day 2026
  });
});

test('CivilDate is branded: plain numbers need a cast', () => {
  // Compile-time check only; documents intent.
  const date: CivilDate = civil(2026, 1, 1);
  expect(typeof date).toBe('number');
});

describe('gaps found by mutation testing', () => {
  test('daysBetween, minDate, maxDate', async () => {
    const { daysBetween, minDate, maxDate } = await import('../src/date.ts');
    expect(daysBetween(d(2026, 1, 1), d(2026, 3, 1))).toBe(59);
    expect(daysBetween(d(2026, 3, 1), d(2026, 1, 1))).toBe(-59);
    expect(minDate(d(2026, 1, 1), d(2026, 1, 2))).toBe(d(2026, 1, 1));
    expect(maxDate(d(2026, 1, 1), d(2026, 1, 2))).toBe(d(2026, 1, 2));
  });

  test('range edges', () => {
    expect(isCivilDate(civil(MIN_YEAR, 1, 1))).toBe(true);
    expect(isCivilDate(civil(MIN_YEAR, 1, 1) - 1)).toBe(false);
    expect(isCivilDate(civil(MAX_YEAR, 12, 31))).toBe(true);
    expect(() => civil(MAX_YEAR + 1, 1, 1)).toThrow(RangeError);
    expect(() => civil(2026.5, 1, 1)).toThrow(RangeError);
    expect(() => civil(2026, 0, 1)).toThrow(RangeError);
    expect(() => civil(2026, 1.5, 1)).toThrow(RangeError);
    expect(tryParseISODate('2401-01-01')).toBeUndefined();
    expect(tryParseISODate('2026-13-01')).toBeUndefined();
    expect(tryParseISODate('2026-01-00')).toBeUndefined();
  });
});
