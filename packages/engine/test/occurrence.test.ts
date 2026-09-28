import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { type Adjustment, createBusinessCalendar } from '../src/business.ts';
import { type CivilDate, formatISODate } from '../src/date.ts';
import {
  findOrphanedOverrides,
  indexOverrides,
  occurrenceForKey,
  occurrenceKey,
  parseOccurrenceKey,
  resolveOccurrences,
  ruleOccurrences,
} from '../src/occurrence.ts';
import type { Schedule } from '../src/schedule.ts';
import type { Overrides, Rule } from '../src/types.ts';
import { FED, d, naiveAdjust, naiveFedHolidays, naiveScheduled, scheduleArb, windowArb } from './support.ts';

const fed = createBusinessCalendar(FED);

const rule = (schedule: Schedule, adjust: Adjustment = 'none', id = 'r1'): Rule => ({
  id,
  name: 'Rent',
  kind: 'expense',
  account: 'checking',
  amount: 185_000,
  schedule,
  adjust,
});

describe('occurrence keys', () => {
  test('format and parse', () => {
    expect(occurrenceKey('abc', d(2026, 10, 1))).toBe('abc@2026-10-01');
    expect(occurrenceKey('abc', d(2026, 10, 1), 2)).toBe('abc@2026-10-01#2');
    expect(parseOccurrenceKey('abc@2026-10-01#2')).toEqual({ ruleId: 'abc', scheduled: d(2026, 10, 1), index: 2 });
    expect(parseOccurrenceKey('a@b@2026-10-01')).toEqual({ ruleId: 'a@b', scheduled: d(2026, 10, 1), index: 1 });
    for (const bad of ['abc', '@2026-10-01', 'abc@2026-02-30', 'abc@2026-10-01#1', 'abc@2026-10-01#0', 'abc@2026-10-01#x']) {
      expect(parseOccurrenceKey(bad), bad).toBeUndefined();
    }
  });

  test('collisions get distinct keys', () => {
    const r = rule({ kind: 'monthly', start: d(2026, 1, 1), interval: 1, days: [30, 'last'] });
    expect(ruleOccurrences(r, d(2026, 2, 1), d(2026, 2, 28), fed).map((o) => o.key)).toEqual(['r1@2026-02-28', 'r1@2026-02-28#2']);
    expect(occurrenceForKey(r, 'r1@2026-02-28#2', fed)).toBeDefined();
    expect(occurrenceForKey(r, 'r1@2026-03-31#2', fed)).toBeUndefined();
    expect(occurrenceForKey(r, 'other@2026-02-28', fed)).toBeUndefined();
  });
});

describe('weekend and holiday adjustment', () => {
  test('a Saturday Nov 1 payday with "before" lands on Friday Oct 31', () => {
    const pay = { ...rule({ kind: 'monthly', start: d(2025, 1, 1), interval: 1, days: [1] }, 'before'), kind: 'income' as const };
    const october = ruleOccurrences(pay, d(2025, 10, 1), d(2025, 10, 31), fed).map((o) => formatISODate(o.date));
    expect(october).toEqual(['2025-10-01', '2025-10-31']);
    expect(ruleOccurrences(pay, d(2025, 11, 1), d(2025, 11, 30), fed)).toHaveLength(0);
  });

  test('adjustment never shifts the phase of later occurrences', () => {
    const r = rule({ kind: 'monthly', start: d(2026, 1, 1), interval: 1, days: [4] }, 'after');
    const dates = ruleOccurrences(r, d(2026, 7, 1), d(2026, 9, 30), fed).map((o) => formatISODate(o.date));
    // Jul 4 is a Saturday (holiday not observed) → Mon Jul 6; Aug 4 and Sep 4 are unaffected.
    expect(dates).toEqual(['2026-07-06', '2026-08-04', '2026-09-04']);
  });

  test('matches schedule + adjust by reference, filtered on the adjusted date', () => {
    const holidays = new Set<number>();
    for (let year = 2018; year <= 2036; year++) for (const h of naiveFedHolidays(year)) holidays.add(h);
    fc.assert(
      fc.property(scheduleArb, windowArb, fc.constantFrom<Adjustment>('before', 'after', 'none'), (schedule, { from, to }, mode) => {
        const actual = ruleOccurrences(rule(schedule, mode), from, to, fed).map((o) => o.date);
        const expected = naiveScheduled(schedule, from - 10, to + 10)
          .map((x) => naiveAdjust(x, mode, (y) => holidays.has(y)))
          .filter((x) => x >= from && x <= to);
        expect(actual).toEqual(expected);
      }),
      { numRuns: 1000 },
    );
  });

  test('paused rules produce nothing', () => {
    const r = { ...rule({ kind: 'weekly', start: d(2026, 1, 2), interval: 1 }), paused: true };
    expect(ruleOccurrences(r, d(2026, 1, 1), d(2026, 12, 31), fed)).toEqual([]);
    expect(resolveOccurrences(r, d(2026, 1, 1), d(2026, 12, 31), fed, indexOverrides({}))).toEqual([]);
  });
});

describe('overrides', () => {
  const monthly = rule({ kind: 'monthly', start: d(2026, 1, 1), interval: 1, days: [25] });
  const window = [d(2026, 9, 27), d(2026, 12, 31)] as const;
  const resolve = (plan: Overrides, whatIf: Overrides = {}) =>
    resolveOccurrences(monthly, window[0], window[1], fed, indexOverrides(plan, whatIf));

  test('no overrides: same as the raw occurrences', () => {
    fc.assert(
      fc.property(scheduleArb, windowArb, (schedule, { from, to }) => {
        const r = rule(schedule, 'after');
        const plain = ruleOccurrences(r, from, to, fed);
        const resolved = resolveOccurrences(r, from, to, fed, indexOverrides({}));
        expect(resolved.map((o) => [o.key, o.finalDate])).toEqual(plain.map((o) => [o.key, o.date]));
        expect(resolved.every((o) => !o.skipped && !o.moved && !o.whatIf)).toBe(true);
      }),
    );
  });

  test('skip keeps the occurrence, flagged', () => {
    const out = resolve({ 'r1@2026-10-25': { skip: true } });
    expect(out.find((o) => o.key === 'r1@2026-10-25')?.skipped).toBe(true);
    expect(out.filter((o) => o.skipped)).toHaveLength(1);
  });

  test('move within the window', () => {
    const out = resolve({ 'r1@2026-10-25': { date: d(2026, 11, 3) } });
    const moved = out.find((o) => o.key === 'r1@2026-10-25');
    expect(moved && formatISODate(moved.finalDate)).toBe('2026-11-03');
    expect(moved?.moved).toBe(true);
    // Order follows the final date.
    expect(out.map((o) => formatISODate(o.finalDate))).toEqual(['2026-11-03', '2026-11-25', '2026-12-25']);
  });

  test('regression: an occurrence scheduled before the window but moved into it still appears', () => {
    // The prototype dropped this: rent due Sep 25, moved to Oct 3, balance entered Sep 27.
    const out = resolve({ 'r1@2026-09-25': { date: d(2026, 10, 3) } });
    expect(out.map((o) => [o.key, formatISODate(o.finalDate)])).toContainEqual(['r1@2026-09-25', '2026-10-03']);
  });

  test('moved out of the window disappears from it', () => {
    const out = resolve({ 'r1@2026-10-25': { date: d(2026, 9, 1) } });
    expect(out.map((o) => o.key)).not.toContain('r1@2026-10-25');
  });

  test('moving onto its own date is not a move', () => {
    const out = resolve({ 'r1@2026-10-25': { date: d(2026, 10, 25) } });
    expect(out.find((o) => o.key === 'r1@2026-10-25')?.moved).toBe(false);
  });

  test('amount override', () => {
    const out = resolve({ 'r1@2026-10-25': { amount: 150_000 } });
    expect(out.find((o) => o.key === 'r1@2026-10-25')?.amountOverride).toBe(150_000);
    expect(out.find((o) => o.key === 'r1@2026-11-25')?.amountOverride).toBeUndefined();
  });

  test('what-if layers on top of the plan, field by field', () => {
    const out = resolve({ 'r1@2026-10-25': { skip: true, amount: 100 } }, { 'r1@2026-10-25': { skip: false }, 'r1@2026-11-25': { date: d(2026, 11, 20) } });
    const oct = out.find((o) => o.key === 'r1@2026-10-25');
    expect(oct?.skipped).toBe(false);
    expect(oct?.amountOverride).toBe(100);
    expect(oct?.whatIf).toBe(true);
    const nov = out.find((o) => o.key === 'r1@2026-11-25');
    expect(nov?.whatIf).toBe(true);
    expect(nov?.moved).toBe(true);
    expect(out.find((o) => o.key === 'r1@2026-12-25')?.whatIf).toBe(false);
  });

  test('a move targeting a date the rule never scheduled is ignored', () => {
    const out = resolve({ 'r1@2026-09-24': { date: d(2026, 10, 3) } });
    expect(out.map((o) => o.key)).not.toContain('r1@2026-09-24');
  });
});

describe('orphaned overrides', () => {
  test('reports overrides for deleted rules and for dates the schedule no longer produces', () => {
    const r = rule({ kind: 'monthly', start: d(2026, 1, 1), interval: 1, days: [5] });
    const orphans = findOrphanedOverrides(
      [r],
      { 'r1@2026-10-05': { skip: true }, 'r1@2026-10-25': { skip: true }, 'gone@2026-10-05': { skip: true }, 'not a key': {} },
      { 'r1@2026-11-06': { date: d(2026, 11, 7) } },
      fed,
    );
    expect(orphans).toEqual([
      { key: 'gone@2026-10-05', layer: 'plan', reason: 'rule-missing' },
      { key: 'not a key', layer: 'plan', reason: 'rule-missing' },
      { key: 'r1@2026-10-25', layer: 'plan', reason: 'not-scheduled' },
      { key: 'r1@2026-11-06', layer: 'whatIf', reason: 'not-scheduled' },
    ]);
  });
});

test('occurrences are ordered by date then key', () => {
  const a = rule({ kind: 'weekly', start: d(2026, 1, 2), interval: 1 }, 'none', 'b');
  const out = resolveOccurrences(a, d(2026, 1, 1), d(2026, 1, 31), fed, indexOverrides({ 'b@2026-01-09': { date: d(2026, 1, 2) } }));
  expect(out.map((o) => o.key)).toEqual(['b@2026-01-02', 'b@2026-01-09', 'b@2026-01-16', 'b@2026-01-23', 'b@2026-01-30']);
  expect(out.map((o) => o.finalDate as CivilDate)).toEqual([d(2026, 1, 2), d(2026, 1, 2), d(2026, 1, 16), d(2026, 1, 23), d(2026, 1, 30)]);
});
