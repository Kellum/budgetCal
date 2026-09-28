import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { type CivilDate, formatISODate, weekday } from '../src/date.ts';
import { type Schedule, occurrencesOn, scheduleEnd, scheduleProblems, scheduledDates } from '../src/schedule.ts';
import { d, naiveScheduled, scheduleArb, windowArb } from './support.ts';

const iso = (dates: readonly CivilDate[]): string[] => dates.map(formatISODate);

describe('oracle equivalence', () => {
  test('every schedule kind matches the day-by-day reference on random windows', () => {
    fc.assert(
      fc.property(scheduleArb, windowArb, (schedule, { from, to }) => {
        expect(iso(scheduledDates(schedule, from, to))).toEqual(iso(naiveScheduled(schedule, from, to)));
      }),
      { numRuns: 1500 },
    );
  });
});

describe('structural properties', () => {
  test('splitting a window anywhere gives the same dates', () => {
    fc.assert(
      fc.property(scheduleArb, windowArb, fc.double({ min: 0, max: 1, noNaN: true }), (schedule, { from, to }, t) => {
        const mid = (from + Math.floor((to - from) * t)) as CivilDate;
        const whole = scheduledDates(schedule, from, to);
        const parts = [...scheduledDates(schedule, from, mid), ...scheduledDates(schedule, (mid + 1) as CivilDate, to)];
        expect(parts).toEqual(whole);
      }),
      { numRuns: 1000 },
    );
  });

  test('results are ascending and inside the window and bounds', () => {
    fc.assert(
      fc.property(scheduleArb, windowArb, (schedule, { from, to }) => {
        const dates = scheduledDates(schedule, from, to);
        const end = scheduleEnd(schedule);
        for (let i = 0; i < dates.length; i++) {
          const date = dates[i] as CivilDate;
          expect(date).toBeGreaterThanOrEqual(Math.max(from, schedule.start));
          expect(date).toBeLessThanOrEqual(to);
          if (end !== undefined) expect(date).toBeLessThanOrEqual(end);
          if (i > 0) expect(date).toBeGreaterThanOrEqual(dates[i - 1] as CivilDate);
        }
      }),
    );
  });

  test('count limits the total number of occurrences from start', () => {
    fc.assert(
      fc.property(scheduleArb, (schedule) => {
        if (schedule.kind === 'once' || schedule.count === undefined) return;
        // scheduleEnd is the last date count allows; nothing may follow it.
        const last = scheduleEnd(schedule) as CivilDate;
        expect(scheduledDates(schedule, (last + 1) as CivilDate, (last + 3 * 366) as CivilDate)).toEqual([]);
        const all = scheduledDates(schedule, schedule.start, last);
        expect(all.length).toBeLessThanOrEqual(schedule.count);
        if (schedule.end === undefined) expect(all.length).toBe(schedule.count);
      }),
    );
  });
});

describe('every N weeks', () => {
  const biweeklyArb = fc.record({
    start: fc.integer({ min: d(2020, 1, 1), max: d(2030, 12, 31) }).map((x) => x as CivilDate),
    interval: fc.integer({ min: 1, max: 4 }),
  });

  test('gaps are exactly 7·N days and every date is the same weekday', () => {
    fc.assert(
      fc.property(biweeklyArb, windowArb, ({ start, interval }, { from, to }) => {
        const dates = scheduledDates({ kind: 'weekly', start, interval }, from, to);
        for (let i = 1; i < dates.length; i++) {
          expect((dates[i] as number) - (dates[i - 1] as number)).toBe(7 * interval);
        }
        for (const date of dates) expect(weekday(date)).toBe(weekday(start));
      }),
    );
  });

  test('moving the start by whole periods never changes dates after both starts', () => {
    fc.assert(
      fc.property(biweeklyArb, fc.integer({ min: 1, max: 30 }), windowArb, ({ start, interval }, k, { from, to }) => {
        const later = (start + k * 7 * interval) as CivilDate;
        const lo = Math.max(from, later) as CivilDate;
        if (lo > to) return;
        expect(scheduledDates({ kind: 'weekly', start, interval }, lo, to)).toEqual(
          scheduledDates({ kind: 'weekly', start: later, interval }, lo, to),
        );
      }),
    );
  });

  test('count in a window matches the closed form', () => {
    fc.assert(
      fc.property(biweeklyArb, windowArb, ({ start, interval }, { from, to }) => {
        const step = 7 * interval;
        const lo = Math.max(from, start);
        const expected = lo > to ? 0 : Math.floor((to - start) / step) - Math.ceil((lo - start) / step) + 1;
        expect(scheduledDates({ kind: 'weekly', start, interval }, from, to)).toHaveLength(Math.max(0, expected));
      }),
    );
  });

  test('26 or 27 biweekly paydays in a year, depending on phase', () => {
    const paydays = (start: CivilDate, year: number): number =>
      scheduledDates({ kind: 'weekly', start, interval: 2 }, d(year, 1, 1), d(year, 12, 31)).length;
    // 26 × 14 = 364 days, so a 27th payday needs the first on Jan 1 (or Jan 2 in a leap year).
    expect(paydays(d(2027, 1, 1), 2027)).toBe(27); // Fri Jan 1 … Fri Dec 31, 2027
    expect(paydays(d(2026, 1, 2), 2026)).toBe(26); // Fri Jan 2 … Fri Dec 18; next is Jan 1, 2027
    expect(paydays(d(2020, 1, 2), 2020)).toBe(27); // leap year: Thu Jan 2 … Thu Dec 31
    expect(paydays(d(2020, 1, 3), 2020)).toBe(26);
  });

  test('window edges: inclusive at both ends, exclusive just outside', () => {
    const s: Schedule = { kind: 'weekly', start: d(2026, 10, 2), interval: 2 };
    expect(iso(scheduledDates(s, d(2026, 10, 16), d(2026, 10, 16)))).toEqual(['2026-10-16']);
    expect(scheduledDates(s, d(2026, 10, 17), d(2026, 10, 29))).toEqual([]);
    expect(iso(scheduledDates(s, d(2026, 10, 15), d(2026, 10, 30)))).toEqual(['2026-10-16', '2026-10-30']);
    expect(scheduledDates(s, d(2026, 1, 1), d(2026, 10, 1))).toEqual([]); // before start
    expect(iso(scheduledDates(s, d(2026, 1, 1), d(2026, 10, 2)))).toEqual(['2026-10-02']);
  });

  test('end and count land exactly on an occurrence', () => {
    const base = { kind: 'weekly', start: d(2026, 10, 2), interval: 2 } as const;
    expect(iso(scheduledDates({ ...base, end: d(2026, 10, 30) }, d(2026, 1, 1), d(2027, 1, 1)))).toEqual([
      '2026-10-02',
      '2026-10-16',
      '2026-10-30',
    ]);
    expect(iso(scheduledDates({ ...base, count: 2 }, d(2026, 1, 1), d(2027, 1, 1)))).toEqual(['2026-10-02', '2026-10-16']);
    expect(iso(scheduledDates({ ...base, count: 3, end: d(2026, 10, 29) }, d(2026, 1, 1), d(2027, 1, 1)))).toEqual([
      '2026-10-02',
      '2026-10-16',
    ]);
  });
});

describe('monthly', () => {
  test('the 31st clamps to each month end without drifting', () => {
    const s: Schedule = { kind: 'monthly', start: d(2026, 1, 31), interval: 1, days: [31] };
    expect(iso(scheduledDates(s, d(2026, 1, 1), d(2026, 5, 31)))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
    const leap: Schedule = { ...s, start: d(2024, 1, 31) };
    expect(iso(scheduledDates(leap, d(2024, 2, 1), d(2024, 3, 1)))).toEqual(['2024-02-29']);
  });

  test('the 29th and 30th in February', () => {
    const s = (day: number): Schedule => ({ kind: 'monthly', start: d(2026, 1, 1), interval: 1, days: [day] });
    expect(iso(scheduledDates(s(29), d(2026, 2, 1), d(2026, 3, 31)))).toEqual(['2026-02-28', '2026-03-29']);
    expect(iso(scheduledDates(s(30), d(2028, 2, 1), d(2028, 2, 29)))).toEqual(['2028-02-29']);
  });

  test('twice a month: the 15th and the last day', () => {
    const s: Schedule = { kind: 'monthly', start: d(2026, 1, 1), interval: 1, days: [15, 'last'] };
    expect(iso(scheduledDates(s, d(2026, 1, 1), d(2026, 3, 31)))).toEqual([
      '2026-01-15',
      '2026-01-31',
      '2026-02-15',
      '2026-02-28',
      '2026-03-15',
      '2026-03-31',
    ]);
  });

  test('exactly one occurrence per qualifying month for a single day', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 31 }),
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 0, max: 11 }),
        (day, interval, phase) => {
          const start = d(2025, 1 + phase, 1);
          const dates = scheduledDates({ kind: 'monthly', start, interval, days: [day] }, start, d(2029, 12, 31));
          const months = dates.map((x) => formatISODate(x).slice(0, 7));
          expect(new Set(months).size).toBe(dates.length);
          for (const x of dates) {
            const [, , dd] = formatISODate(x).split('-').map(Number);
            expect(dd).toBeLessThanOrEqual(day);
          }
        },
      ),
    );
  });

  test('never before start, even inside the first month', () => {
    const s: Schedule = { kind: 'monthly', start: d(2026, 1, 20), interval: 1, days: [15, 'last'] };
    expect(iso(scheduledDates(s, d(2026, 1, 1), d(2026, 2, 15)))).toEqual(['2026-01-31', '2026-02-15']);
  });

  test('every 3 months keeps its phase from start', () => {
    const s: Schedule = { kind: 'monthly', start: d(2026, 11, 5), interval: 3, days: [5] };
    expect(iso(scheduledDates(s, d(2027, 1, 1), d(2027, 12, 31)))).toEqual(['2027-02-05', '2027-05-05', '2027-08-05', '2027-11-05']);
  });

  test('two days that collide in February both occur', () => {
    const s: Schedule = { kind: 'monthly', start: d(2026, 1, 1), interval: 1, days: [30, 'last'] };
    expect(iso(scheduledDates(s, d(2026, 2, 1), d(2026, 2, 28)))).toEqual(['2026-02-28', '2026-02-28']);
    expect(occurrencesOn(s, d(2026, 2, 28))).toBe(2);
    expect(occurrencesOn(s, d(2026, 3, 30))).toBe(1);
    expect(occurrencesOn(s, d(2026, 3, 29))).toBe(0);
  });
});

test('regression: count stops mid-collision (found by the property test above)', () => {
  // The 5th occurrence is the first of two on Jun 30 (30th and last day). The second must not appear.
  const s: Schedule = { kind: 'monthly', start: d(2020, 5, 22), interval: 1, days: [22, 'last', 30], count: 5 };
  expect(iso(scheduledDates(s, d(2020, 1, 1), d(2021, 12, 31)))).toEqual([
    '2020-05-22',
    '2020-05-30',
    '2020-05-31',
    '2020-06-22',
    '2020-06-30',
  ]);
  expect(occurrencesOn(s, d(2020, 6, 30))).toBe(1);
});

describe('monthly on a weekday', () => {
  test('second Friday and last Monday', () => {
    const second: Schedule = { kind: 'monthly-weekday', start: d(2026, 1, 1), interval: 1, nth: 2, weekday: 5 };
    expect(iso(scheduledDates(second, d(2026, 1, 1), d(2026, 3, 31)))).toEqual(['2026-01-09', '2026-02-13', '2026-03-13']);
    const lastMonday: Schedule = { kind: 'monthly-weekday', start: d(2026, 1, 1), interval: 1, nth: 'last', weekday: 1 };
    expect(iso(scheduledDates(lastMonday, d(2026, 5, 1), d(2026, 6, 30)))).toEqual(['2026-05-25', '2026-06-29']);
  });
});

describe('yearly', () => {
  test('Feb 29 falls back to Feb 28 in common years', () => {
    const s: Schedule = { kind: 'yearly', start: d(2024, 1, 1), interval: 1, month: 2, day: 29 };
    expect(iso(scheduledDates(s, d(2024, 1, 1), d(2028, 12, 31)))).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ]);
  });

  test('every other year keeps its phase', () => {
    const s: Schedule = { kind: 'yearly', start: d(2025, 6, 1), interval: 2, month: 6, day: 1 };
    expect(iso(scheduledDates(s, d(2026, 1, 1), d(2030, 12, 31)))).toEqual(['2027-06-01', '2029-06-01']);
  });
});

describe('once', () => {
  test('exactly its date, if in the window', () => {
    const s: Schedule = { kind: 'once', start: d(2026, 10, 15) };
    expect(iso(scheduledDates(s, d(2026, 10, 1), d(2026, 10, 31)))).toEqual(['2026-10-15']);
    expect(scheduledDates(s, d(2026, 10, 16), d(2026, 10, 31))).toEqual([]);
    expect(scheduledDates(s, d(2026, 10, 1), d(2026, 10, 14))).toEqual([]);
    expect(scheduleEnd(s)).toBe(d(2026, 10, 15));
  });
});

describe('validation', () => {
  test('problems are reported in plain language and scheduledDates refuses invalid schedules', () => {
    const bad: Schedule[] = [
      { kind: 'weekly', start: d(2026, 1, 1), interval: 0 },
      { kind: 'weekly', start: d(2026, 1, 1), interval: 1.5 },
      { kind: 'weekly', start: d(2026, 1, 1), interval: 1, end: d(2025, 1, 1) },
      { kind: 'weekly', start: d(2026, 1, 1), interval: 1, count: 0 },
      { kind: 'monthly', start: d(2026, 1, 1), interval: 1, days: [] },
      { kind: 'monthly', start: d(2026, 1, 1), interval: 1, days: [32] },
      { kind: 'monthly', start: d(2026, 1, 1), interval: 1, days: [5, 5] },
      { kind: 'monthly-weekday', start: d(2026, 1, 1), interval: 1, nth: 5 as never, weekday: 1 },
      { kind: 'monthly-weekday', start: d(2026, 1, 1), interval: 1, nth: 1, weekday: 7 as never },
      { kind: 'yearly', start: d(2026, 1, 1), interval: 1, month: 13, day: 1 },
      { kind: 'yearly', start: d(2026, 1, 1), interval: 1, month: 1, day: 0 },
    ];
    for (const schedule of bad) {
      expect(scheduleProblems(schedule).length, JSON.stringify(schedule)).toBeGreaterThan(0);
      expect(() => scheduledDates(schedule, d(2026, 1, 1), d(2026, 12, 31))).toThrow(RangeError);
    }
    expect(scheduleProblems({ kind: 'monthly', start: d(2026, 1, 1), interval: 1, days: [1, 'last'] })).toEqual([]);
  });
});

describe('gaps found by mutation testing', () => {
  test('count ending on the second of a same-day pair keeps both', () => {
    const s: Schedule = { kind: 'monthly', start: d(2026, 1, 1), interval: 1, days: [30, 'last'], count: 4 };
    // Jan 30, Jan 31, then Feb 28 twice.
    expect(iso(scheduledDates(s, d(2026, 1, 1), d(2026, 12, 31)))).toEqual(['2026-01-30', '2026-01-31', '2026-02-28', '2026-02-28']);
    expect(scheduleEnd(s)).toBe(d(2026, 2, 28));
  });

  test('end without count, and count without end', () => {
    const endOnly: Schedule = { kind: 'monthly', start: d(2026, 1, 1), interval: 1, days: [1], end: d(2026, 3, 15) };
    expect(scheduleEnd(endOnly)).toBe(d(2026, 3, 15));
    expect(scheduleEnd({ kind: 'monthly', start: d(2026, 1, 1), interval: 1, days: [1] })).toBeUndefined();
  });

  test('validation boundaries', () => {
    const weekly = (extra: object): Schedule => ({ kind: 'weekly', start: d(2026, 1, 1), interval: 1, ...extra }) as Schedule;
    expect(scheduleProblems(weekly({ interval: 99 }))).toEqual([]);
    expect(scheduleProblems(weekly({ interval: 100 }))).toHaveLength(1);
    expect(scheduleProblems(weekly({ count: 5000 }))).toEqual([]);
    expect(scheduleProblems(weekly({ count: 5001 }))).toHaveLength(1);
    expect(scheduleProblems(weekly({ count: 1.5 }))).toHaveLength(1);
    expect(scheduleProblems(weekly({ end: d(2026, 1, 1) }))).toEqual([]);
    const mw = (weekday: number): Schedule => ({ kind: 'monthly-weekday', start: d(2026, 1, 1), interval: 1, nth: 1, weekday: weekday as 0 });
    expect(scheduleProblems(mw(0))).toEqual([]);
    expect(scheduleProblems(mw(6))).toEqual([]);
    expect(scheduleProblems(mw(-1))).toHaveLength(1);
    expect(scheduleProblems(mw(1.5))).toHaveLength(1);
    const yearly = (month: number): Schedule => ({ kind: 'yearly', start: d(2026, 1, 1), interval: 1, month, day: 1 });
    expect(scheduleProblems(yearly(12))).toEqual([]);
    expect(scheduleProblems(yearly(0))).toHaveLength(1);
    expect(scheduleProblems(yearly(1.5))).toHaveLength(1);
    const monthly = (days: (number | 'last')[]): Schedule => ({ kind: 'monthly', start: d(2026, 1, 1), interval: 1, days });
    expect(scheduleProblems(monthly([1, 32]))).toHaveLength(1);
    expect(scheduleProblems(monthly([0]))).toHaveLength(1);
  });
});
