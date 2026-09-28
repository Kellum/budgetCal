import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { WEEKENDS_ONLY, adjustToBusinessDay, createBusinessCalendar } from '../src/business.ts';
import { type CivilDate, formatISODate } from '../src/date.ts';
import { FED, d, dateArb, naiveAdjust, naiveFedHolidays } from './support.ts';

const fed = createBusinessCalendar(FED);
const iso = (dates: readonly CivilDate[]): string[] => dates.map(formatISODate);

describe('Federal Reserve holidays', () => {
  test('2026, including Independence Day on a Saturday (not observed)', () => {
    expect(iso(fed.holidaysIn(2026))).toEqual([
      '2026-01-01',
      '2026-01-19',
      '2026-02-16',
      '2026-05-25',
      '2026-06-19',
      '2026-09-07',
      '2026-10-12',
      '2026-11-11',
      '2026-11-26',
      '2026-12-25',
    ]);
  });

  test('2027: Juneteenth and Christmas on Saturdays are not observed; July 4 on Sunday moves to Monday', () => {
    expect(iso(fed.holidaysIn(2027))).toEqual([
      '2027-01-01',
      '2027-01-18',
      '2027-02-15',
      '2027-05-31',
      '2027-07-05',
      '2027-09-06',
      '2027-10-11',
      '2027-11-11',
      '2027-11-25',
    ]);
  });

  test('Juneteenth starts in 2022', () => {
    expect(fed.isHoliday(d(2021, 6, 18))).toBe(false);
    expect(fed.isHoliday(d(2022, 6, 20))).toBe(true); // Sunday the 19th, observed Monday
  });

  test('New Year on a Sunday is observed Monday Jan 2; on a Saturday, Dec 31 stays open', () => {
    expect(fed.isHoliday(d(2023, 1, 2))).toBe(true);
    expect(fed.isHoliday(d(2021, 12, 31))).toBe(false);
    expect(fed.isHoliday(d(2022, 1, 1))).toBe(false);
  });

  test('matches an independent reference for every year 1995–2060', () => {
    for (let year = 1995; year <= 2060; year++) {
      expect(fed.holidaysIn(year), String(year)).toEqual(naiveFedHolidays(year));
    }
  });

  test('a previous-Friday observance policy pulls Saturday holidays into the prior year', () => {
    const federalGovernment = createBusinessCalendar({ ...FED, observance: { saturday: 'previous-friday', sunday: 'next-monday' } });
    expect(federalGovernment.isHoliday(d(2021, 12, 31))).toBe(true); // Jan 1, 2022 was a Saturday
    expect(federalGovernment.holidaysIn(2021)).toContain(d(2021, 12, 31));
    expect(federalGovernment.holidaysIn(2022)).not.toContain(d(2021, 12, 31));
  });
});

describe('adjustment', () => {
  test('before, after and none', () => {
    const saturday = d(2026, 10, 3);
    expect(formatISODate(adjustToBusinessDay(saturday, 'before', fed))).toBe('2026-10-02');
    expect(formatISODate(adjustToBusinessDay(saturday, 'after', fed))).toBe('2026-10-05');
    expect(adjustToBusinessDay(saturday, 'none', fed)).toBe(saturday);
    expect(adjustToBusinessDay(d(2026, 10, 1), 'after', fed)).toBe(d(2026, 10, 1)); // already a business day
  });

  test('skips a Monday holiday after a weekend', () => {
    // Sat Oct 10, 2026 → Mon Oct 12 is Columbus Day → Tue Oct 13
    expect(formatISODate(adjustToBusinessDay(d(2026, 10, 10), 'after', fed))).toBe('2026-10-13');
    expect(formatISODate(adjustToBusinessDay(d(2026, 10, 12), 'before', fed))).toBe('2026-10-09');
  });

  test('crosses month and year boundaries', () => {
    expect(formatISODate(adjustToBusinessDay(d(2025, 11, 1), 'before', fed))).toBe('2025-10-31');
    expect(formatISODate(adjustToBusinessDay(d(2026, 1, 1), 'before', fed))).toBe('2025-12-31');
    expect(formatISODate(adjustToBusinessDay(d(2027, 12, 31), 'after', fed))).toBe('2027-12-31'); // Friday, open
  });

  test('agrees with a naive reference and lands on a business day in the right direction', () => {
    const holidays = new Set<number>();
    for (let year = 2018; year <= 2035; year++) for (const h of naiveFedHolidays(year)) holidays.add(h);
    fc.assert(
      fc.property(dateArb(), fc.constantFrom('before' as const, 'after' as const, 'none' as const), (date, mode) => {
        const adjusted = adjustToBusinessDay(date, mode, fed);
        expect(adjusted).toBe(naiveAdjust(date, mode, (x) => holidays.has(x)));
        if (mode === 'before') expect(adjusted).toBeLessThanOrEqual(date);
        if (mode === 'after') expect(adjusted).toBeGreaterThanOrEqual(date);
        if (mode !== 'none') expect(fed.isBusinessDay(adjusted)).toBe(true);
      }),
      { numRuns: 3000 },
    );
  });

  test('weekends-only calendar ignores holidays', () => {
    expect(WEEKENDS_ONLY.isBusinessDay(d(2026, 12, 25))).toBe(true);
    expect(WEEKENDS_ONLY.isBusinessDay(d(2026, 12, 26))).toBe(false);
  });

  test('a broken calendar fails loudly rather than looping', () => {
    const allClosed = { isHoliday: () => true, isBusinessDay: () => false, holidaysIn: () => [] };
    expect(() => adjustToBusinessDay(d(2026, 1, 1), 'after', allClosed)).toThrow(RangeError);
  });
});

describe('gaps found by mutation testing', () => {
  test('holiday rules can end, and results are cached consistently', () => {
    const calendar = createBusinessCalendar({
      name: 'test',
      observance: { saturday: 'none', sunday: 'none' },
      rules: [{ name: 'Old holiday', type: 'fixed', month: 3, day: 3, fromYear: 2020, toYear: 2022 }],
    });
    expect(calendar.isHoliday(d(2022, 3, 3))).toBe(true); // Thursday
    expect(calendar.isHoliday(d(2023, 3, 3))).toBe(false); // Friday, after toYear
    expect(calendar.isHoliday(d(2019, 3, 3))).toBe(false); // Sunday, before fromYear anyway
    expect(calendar.isHoliday(d(2021, 3, 3))).toBe(true);
    expect(calendar.isHoliday(d(2022, 3, 3))).toBe(true); // second lookup, from cache
  });

  test('a Sunday holiday with no Monday observance is simply not a closure', () => {
    const calendar = createBusinessCalendar({ ...FED, observance: { saturday: 'none', sunday: 'none' } });
    expect(calendar.isHoliday(d(2027, 7, 5))).toBe(false); // July 4, 2027 is a Sunday
  });

  test('holidaysIn is sorted even when rules are not', () => {
    const calendar = createBusinessCalendar({ ...FED, rules: [...FED.rules].reverse() });
    const list = calendar.holidaysIn(2026);
    expect(list).toEqual([...list].sort((a, b) => a - b));
  });

  test('the edge years of the supported range work', () => {
    expect(fed.holidaysIn(1900).length).toBeGreaterThan(0);
    expect(fed.holidaysIn(2400).length).toBeGreaterThan(0);
  });

  test('a run of exactly the maximum closed days still resolves', () => {
    const closedFor = (n: number) => ({
      isHoliday: () => false,
      isBusinessDay: (x: CivilDate) => x >= d(2026, 1, 1) + n || x < d(2026, 1, 1),
      holidaysIn: () => [],
    });
    expect(adjustToBusinessDay(d(2026, 1, 1), 'after', closedFor(7))).toBe(d(2026, 1, 8));
    expect(() => adjustToBusinessDay(d(2026, 1, 1), 'after', closedFor(8))).toThrow(RangeError);
  });
});
