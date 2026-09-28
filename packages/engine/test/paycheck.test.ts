import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import limits2026 from '../../../config/limits/2026.json' with { type: 'json' };
import { createBusinessCalendar } from '../src/business.ts';
import { type CivilDate, formatISODate, yearOf } from '../src/date.ts';
import {
  type LimitsConfigFile,
  type Paycheck,
  type PaycheckInput,
  computePaychecks,
  limitFor,
  limitsFromConfig,
  paycheckNotices,
  paycheckProblems,
} from '../src/paycheck.ts';
import { project } from '../src/project.ts';
import type { Plan, Rule } from '../src/types.ts';
import { FED, d } from './support.ts';

const LIMITS = limitsFromConfig([limits2026 as LimitsConfigFile]);
const fed = createBusinessCalendar(FED);

describe('limits config', () => {
  test('2026 values load as cents', () => {
    expect(limitFor(LIMITS, '401k-elective', 2026)).toEqual({ amount: 2_450_000, estimated: false });
    expect(limitFor(LIMITS, 'hsa-self', 2026)?.amount).toBe(440_000);
    expect(limitFor(LIMITS, 'hsa-family', 2026)?.amount).toBe(875_000);
    expect(limitFor(LIMITS, 'ss-wage-base', 2026)?.amount).toBe(18_450_000);
    expect(limitFor(LIMITS, 'unknown', 2026)).toBeUndefined();
  });

  test('catch-ups by age attained by Dec 31', () => {
    expect(limitFor(LIMITS, '401k-elective', 2026, 1977)?.amount).toBe(2_450_000); // 49
    expect(limitFor(LIMITS, '401k-elective', 2026, 1976)?.amount).toBe(3_250_000); // 50
    expect(limitFor(LIMITS, '401k-elective', 2026, 1966)?.amount).toBe(3_575_000); // 60
    expect(limitFor(LIMITS, '401k-elective', 2026, 1963)?.amount).toBe(3_575_000); // 63
    expect(limitFor(LIMITS, '401k-elective', 2026, 1962)?.amount).toBe(3_250_000); // 64
    expect(limitFor(LIMITS, 'hsa-family', 2026, 1971)?.amount).toBe(975_000); // 55
  });

  test('an unpublished year borrows the latest known year, flagged', () => {
    expect(limitFor(LIMITS, '401k-elective', 2027)).toEqual({ amount: 2_450_000, estimated: true });
    expect(limitFor(LIMITS, '401k-elective', 2020)).toEqual({ amount: 2_450_000, estimated: true });
    expect(limitFor(limitsFromConfig([]), '401k-elective', 2026)).toBeUndefined();
  });

  test('rejects malformed config', () => {
    const file = (base: number): LimitsConfigFile => ({ year: 2026, limits: { x: { kind: 'contribution', base, catchUps: [] } } });
    expect(() => limitsFromConfig([file(1.5)])).toThrow(RangeError);
    expect(() => limitsFromConfig([file(-1)])).toThrow(RangeError);
    expect(() => limitsFromConfig([file(1), file(1)])).toThrow(RangeError);
  });
});

/** A single paycheck on one date, computed directly. */
const one = (paycheck: Paycheck, date = d(2026, 3, 6)) =>
  computePaychecks([{ ruleId: 'job', paycheck, occurrences: [{ key: 'k', ruleId: 'job', date, skipped: false }] }], { limits: LIMITS }).get('k');

describe('the waterfall', () => {
  const stub: Paycheck = {
    gross: 400_000,
    lines: [
      { id: '401k', name: '401(k)', stage: 'pretax', amount: { type: 'percent', bp: 600, of: 'gross' }, reduces: ['income'], limit: '401k-elective' },
      { id: 'health', name: 'Medical', stage: 'pretax', amount: { type: 'fixed', cents: 15_000 }, reduces: ['income', 'fica'] },
      { id: 'fed', name: 'Federal', stage: 'tax', amount: { type: 'percent', bp: 1200, of: 'income' } },
      { id: 'ss', name: 'Social Security', stage: 'tax', amount: { type: 'percent', bp: 620, of: 'fica' }, wageCap: 'ss-wage-base' },
      { id: 'medicare', name: 'Medicare', stage: 'tax', amount: { type: 'percent', bp: 145, of: 'fica' } },
      { id: 'state', name: 'State', stage: 'tax', amount: { type: 'percent', bp: 500, of: 'income' } },
      { id: 'roth', name: 'Roth 401(k)', stage: 'posttax', amount: { type: 'percent', bp: 200, of: 'gross' }, limit: '401k-elective' },
    ],
  };

  test('a $4,000 stub, by hand', () => {
    const result = one(stub);
    expect(result?.incomeWages).toBe(361_000); // 4,000 − 240 − 150
    expect(result?.ficaWages).toBe(385_000); // 4,000 − 150 (401k does not reduce FICA wages)
    expect(result?.lines.map((l) => [l.id, l.actual])).toEqual([
      ['401k', 24_000],
      ['health', 15_000],
      ['fed', 43_320],
      ['ss', 23_870],
      ['medicare', 5_583], // 5,582.5 rounds half away from zero
      ['state', 18_050],
      ['roth', 8_000],
    ]);
    expect(result?.net).toBe(262_177);
    expect(result?.lines.every((l) => !l.limited)).toBe(true);
    expect(result?.ytdEstimated).toBe(true); // no year-to-date figures entered
    expect(result?.limitsEstimated).toBe(false);
  });

  test('validation', () => {
    expect(paycheckProblems(stub, LIMITS)).toEqual([]);
    expect(paycheckProblems({ gross: 100_000, lines: [{ id: 'x', name: 'X', stage: 'posttax', amount: { type: 'fixed', cents: 100_001 } }] })).toEqual([
      'Deductions and taxes add up to more than gross pay.',
    ]);
    const bad: Paycheck = {
      gross: 0,
      lines: [
        { id: 'a', name: 'A', stage: 'posttax', amount: { type: 'percent', bp: 500, of: 'income' } },
        { id: 'a', name: 'Dup', stage: 'tax', amount: { type: 'fixed', cents: -1 }, limit: 'ira', wageCap: 'ss-wage-base' },
        { id: 'b', name: 'B', stage: 'posttax', amount: { type: 'percent', bp: 10_001, of: 'gross' }, reduces: ['income'], limit: 'nope' },
      ],
    };
    expect(paycheckProblems(bad, LIMITS)).toEqual([
      'Gross pay must be more than $0.',
      '"A" can only be a percentage of gross pay.',
      'Line "Dup" appears twice.',
      '"Dup" must be $0 or more.',
      'Taxes do not have contribution limits ("Dup").',
      'Only percentage taxes can have a wage cap ("Dup").',
      '"B" must be between 0% and 100%.',
      'Only pre-tax lines reduce taxable wages ("B").',
      'Unknown limit "nope" on "B".',
    ]);
  });
});

// A $10,000 biweekly paycheck from Fri Jan 2, 2026, deferring 20% ($2,000) to a 401(k),
// with federal tax at 20% of income wages. $24,500 ÷ $2,000 = 12.25 paychecks.
const cliffRule = (paycheck: Partial<Paycheck> = {}, extra: Partial<Rule> = {}): Rule => ({
  id: 'job',
  name: 'Paycheck',
  kind: 'income',
  account: 'checking',
  amount: 0,
  schedule: { kind: 'weekly', start: d(2026, 1, 2), interval: 2 },
  adjust: 'before',
  paycheck: {
    gross: 1_000_000,
    lines: [
      { id: '401k', name: '401(k)', stage: 'pretax', amount: { type: 'percent', bp: 2000, of: 'gross' }, reduces: ['income'], limit: '401k-elective' },
      { id: 'fed', name: 'Federal', stage: 'tax', amount: { type: 'percent', bp: 2000, of: 'income' } },
    ],
    ...paycheck,
  },
  ...extra,
});

const cliffPlan = (rule: Rule, birthYear?: number): Plan => ({
  accounts: [{ id: 'checking', threshold: 0 }],
  rules: [rule],
  balances: [{ id: 'b', account: 'checking', date: d(2026, 1, 1), amount: 0, clearedKeys: [], sequence: 1 }],
  overrides: {},
  ...(birthYear !== undefined ? { person: { birthYear } } : {}),
});

const netByDate = (plan: Plan, end = d(2027, 2, 1), overrides = {}) => {
  const projection = project({ ...plan, overrides }, { today: d(2026, 1, 1), end, calendar: fed, limits: LIMITS });
  const events = projection.accounts[0]?.days.flatMap((x) => x.events) ?? [];
  // Keyed by *scheduled* date: holidays move some paydays (Juneteenth, New Year's Day).
  return { projection, events, net: Object.fromEntries(events.map((e) => [formatISODate(e.scheduled), e.amount])) };
};

describe('the contribution cliff', () => {
  test('full deferral for 12 paychecks, a partial 13th, then take-home rises', () => {
    const { net } = netByDate(cliffPlan(cliffRule()));
    expect(net['2026-06-05']).toBe(640_000); // 12th: 10,000 − 2,000 − 20% of 8,000
    expect(net['2026-06-19']).toBe(760_000); // 13th: 500 left → 10,000 − 500 − 20% of 9,500
    expect(net['2026-07-03']).toBe(800_000); // 14th: 0 left → 10,000 − 20% of 10,000
    expect(net['2026-12-18']).toBe(800_000);
  });

  test('Juneteenth (Fri Jun 19, 2026) moves the 13th paycheck to Thursday', () => {
    const { events } = netByDate(cliffPlan(cliffRule()));
    const thirteenth = events.find((e) => e.key === 'job@2026-06-19');
    expect(formatISODate(thirteenth?.date as CivilDate)).toBe('2026-06-18');
    expect(thirteenth?.adjusted).toBe(true);
  });

  test('Jan 1, 2027 is a holiday, so that paycheck lands Dec 31 and counts toward 2026', () => {
    const { net, events } = netByDate(cliffPlan(cliffRule()));
    expect(net['2027-01-01']).toBe(800_000);
    expect(events.find((e) => formatISODate(e.date) === '2026-12-31')?.key).toBe('job@2027-01-01');
    expect(events.filter((e) => yearOf(e.date) === 2026)).toHaveLength(27);
  });

  test('the new year resets the deduction, using 2026 limits as an estimate for 2027', () => {
    const { net, events } = netByDate(cliffPlan(cliffRule()));
    expect(net['2027-01-15']).toBe(640_000);
    const jan15 = events.find((e) => formatISODate(e.date) === '2027-01-15');
    expect(jan15?.paycheck?.limitsEstimated).toBe(true);
    expect(events.find((e) => e.key === 'job@2026-06-19')?.paycheck?.limitsEstimated).toBe(false);
  });

  test('notices say when and why take-home changes', () => {
    const { projection } = netByDate(cliffPlan(cliffRule()));
    expect(
      projection.notices.map((n) => [formatISODate(n.date), n.previousNet, n.net, n.causes.map((c) => `${c.lineName}: ${c.change}`)]),
    ).toEqual([
      ['2026-06-18', 640_000, 760_000, ['401(k): limit-reached']],
      ['2026-07-03', 760_000, 800_000, ['401(k): limit-reached']],
      ['2027-01-15', 800_000, 640_000, ['401(k): year-reset']],
    ]);
    expect(projection.notices.every((n) => n.estimated)).toBe(true);
  });

  test('a catch-up-eligible person (61 in 2026) keeps deferring longer', () => {
    // $35,750 ÷ $2,000 = 17.875 → full for 17 paychecks, partial 18th.
    const { net } = netByDate(cliffPlan(cliffRule(), 1965));
    expect(net['2026-08-14']).toBe(640_000); // 17th
    expect(net['2026-08-28']).toBe(660_000); // 18th: 1,750 left → 10,000 − 1,750 − 20% of 8,250
    expect(net['2026-09-11']).toBe(800_000);
  });

  test('year-to-date from a stub: earlier paychecks are not double-counted', () => {
    const withYtd = (amount: number) =>
      cliffRule({
        lines: [
          {
            id: '401k',
            name: '401(k)',
            stage: 'pretax',
            amount: { type: 'percent', bp: 2000, of: 'gross' },
            reduces: ['income'],
            limit: '401k-elective',
            ytd: { asOf: d(2026, 6, 5), amount },
          },
          { id: 'fed', name: 'Federal', stage: 'tax', amount: { type: 'percent', bp: 2000, of: 'income' } },
        ],
      });
    const exact = netByDate(cliffPlan(withYtd(2_400_000)));
    expect(exact.net['2026-06-19']).toBe(760_000);
    expect(exact.events.find((e) => e.key === 'job@2026-06-19')?.paycheck?.ytdEstimated).toBe(false);
    // The stub says more was contributed than the schedule implies (e.g. a bonus deferral).
    const ahead = netByDate(cliffPlan(withYtd(2_450_000)));
    expect(ahead.net['2026-06-19']).toBe(800_000);
    // A stale stub from last year does not count this year.
    const stale = cliffRule({
      lines: [
        { id: '401k', name: '401(k)', stage: 'pretax', amount: { type: 'percent', bp: 2000, of: 'gross' }, reduces: ['income'], limit: '401k-elective', ytd: { asOf: d(2025, 12, 19), amount: 2_350_000 } },
        { id: 'fed', name: 'Federal', stage: 'tax', amount: { type: 'percent', bp: 2000, of: 'income' } },
      ],
    });
    const fromStale = netByDate(cliffPlan(stale));
    expect(fromStale.net['2026-06-19']).toBe(760_000);
    expect(fromStale.events[0]?.paycheck?.ytdEstimated).toBe(true);
  });

  test('traditional and Roth 401(k) share one limit', () => {
    const shared = cliffRule({
      lines: [
        { id: 'trad', name: 'Traditional', stage: 'pretax', amount: { type: 'percent', bp: 1000, of: 'gross' }, reduces: ['income'], limit: '401k-elective' },
        { id: 'fed', name: 'Federal', stage: 'tax', amount: { type: 'percent', bp: 2000, of: 'income' } },
        { id: 'roth', name: 'Roth', stage: 'posttax', amount: { type: 'percent', bp: 1000, of: 'gross' }, limit: '401k-elective' },
      ],
    });
    const { events } = netByDate(cliffPlan(shared));
    const lines = (date: string) =>
      events.find((e) => e.key === `job@${date}`)?.paycheck?.lines.map((l) => [l.id, l.actual, l.limited]);
    expect(lines('2026-06-05')).toEqual([['trad', 100_000, false], ['fed', 180_000, false], ['roth', 100_000, false]]);
    // 13th: $500 left; traditional (processed first) takes it all.
    expect(lines('2026-06-19')).toEqual([['trad', 50_000, true], ['fed', 190_000, false], ['roth', 0, true]]);
  });

  test('Social Security stops at the wage base, per employer', () => {
    const ss = cliffRule({
      lines: [{ id: 'ss', name: 'Social Security', stage: 'tax', amount: { type: 'percent', bp: 620, of: 'fica' }, wageCap: 'ss-wage-base' }],
    });
    const { projection, net } = netByDate(cliffPlan(ss));
    // $184,500 ÷ $10,000 = 18.45 → full for 18 paychecks, 19th taxes $4,500 of wages.
    expect(net['2026-08-28']).toBe(938_000);
    expect(net['2026-09-11']).toBe(972_100); // 10,000 − 6.2% of 4,500
    expect(net['2026-09-25']).toBe(1_000_000);
    expect(projection.notices[0]?.causes[0]?.change).toBe('cap-reached');
  });

  test('a skipped paycheck contributes nothing and delays the cliff', () => {
    const { net } = netByDate(cliffPlan(cliffRule()), d(2027, 2, 1), { 'job@2026-03-13': { skip: true } });
    expect(net['2026-06-19']).toBe(640_000); // now only the 12th counted paycheck
    expect(net['2026-07-03']).toBe(760_000);
  });

  test('a skipped paycheck still shows what it would have been', () => {
    const { events } = netByDate(cliffPlan(cliffRule()), d(2026, 3, 31), { 'job@2026-03-13': { skip: true } });
    const skipped = events.find((e) => e.key === 'job@2026-03-13');
    expect(skipped?.skipped).toBe(true);
    expect(skipped?.amount).toBe(640_000);
  });

  test('an amount override replaces net for that paycheck only', () => {
    const { net, events } = netByDate(cliffPlan(cliffRule()), d(2027, 2, 1), { 'job@2026-06-19': { amount: 123_400 } });
    expect(net['2026-06-19']).toBe(123_400);
    expect(events.find((e) => e.key === 'job@2026-06-19')?.paycheck).toBeUndefined();
    expect(net['2026-07-03']).toBe(800_000); // deductions assumed to have happened as usual
  });

  test('a paycheck never appears as more than one calendar event: deductions are not events', () => {
    const { events } = netByDate(cliffPlan(cliffRule()), d(2026, 1, 31));
    expect(events.map((e) => [formatISODate(e.date), e.kind])).toEqual([
      ['2026-01-02', 'income'],
      ['2026-01-16', 'income'],
      ['2026-01-30', 'income'],
    ]);
  });
});

describe('properties', () => {
  const lineArb = fc.record({
    stage: fc.constantFrom('pretax' as const, 'tax' as const, 'posttax' as const),
    fixed: fc.boolean(),
    cents: fc.integer({ min: 0, max: 300_000 }),
    bp: fc.integer({ min: 0, max: 3000 }),
    of: fc.constantFrom('gross' as const, 'income' as const, 'fica' as const),
    limited: fc.boolean(),
  });

  test('net = gross − lines; limits never exceeded; limited lines never exceed nominal', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100_000, max: 2_000_000 }),
        fc.array(lineArb, { maxLength: 6 }),
        fc.integer({ min: 1, max: 4 }),
        (gross, specs, interval) => {
          const paycheck: Paycheck = {
            gross,
            lines: specs.map((s, i) => ({
              id: `l${i}`,
              name: `L${i}`,
              stage: s.stage,
              amount: s.fixed ? { type: 'fixed', cents: s.cents } : { type: 'percent', bp: s.bp, of: s.stage === 'tax' ? s.of : 'gross' },
              ...(s.stage === 'pretax' ? { reduces: ['income' as const] } : {}),
              ...(s.limited && s.stage !== 'tax' ? { limit: 'hsa-self' } : {}),
              ...(s.limited && s.stage === 'tax' && !s.fixed ? { wageCap: 'ss-wage-base' } : {}),
            })),
          };
          const dates: CivilDate[] = [];
          for (let x = d(2026, 1, 2); x <= d(2027, 12, 31); x = (x + 7 * interval) as CivilDate) dates.push(x);
          const input: PaycheckInput = {
            ruleId: 'job',
            paycheck,
            occurrences: dates.map((date) => ({ key: `job@${formatISODate(date)}`, ruleId: 'job', date, skipped: false })),
          };
          const results = computePaychecks([input], { limits: LIMITS });
          const perYear = new Map<number, number>();
          for (const o of input.occurrences) {
            const result = results.get(o.key);
            expect(result).toBeDefined();
            if (!result) continue;
            expect(result.net).toBe(result.gross - result.lines.reduce((sum, l) => sum + l.actual, 0));
            for (const line of result.lines) {
              expect(line.actual).toBeGreaterThanOrEqual(0);
              expect(line.actual).toBeLessThanOrEqual(line.nominal);
              expect(line.limited).toBe(line.actual < line.nominal);
            }
            const hsa = result.lines
              .filter((l) => paycheck.lines.find((p) => p.id === l.id)?.limit === 'hsa-self')
              .reduce((sum, l) => sum + l.actual, 0);
            perYear.set(yearOf(o.date), (perYear.get(yearOf(o.date)) ?? 0) + hsa);
          }
          for (const total of perYear.values()) expect(total).toBeLessThanOrEqual(440_000);
          // Notices only fire where net actually changed.
          for (const notice of paycheckNotices([input], results)) expect(notice.net).not.toBe(notice.previousNet);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('gaps found by mutation testing', () => {
  test('two jobs share one person-wide 401(k) limit, processed in date order', () => {
    const jobA = cliffRule({}, { id: 'a' });
    // Job B pays on the alternate Fridays, deferring $2,000 too: $4,000 every two weeks combined.
    const jobB = cliffRule({}, { id: 'b', schedule: { kind: 'weekly', start: d(2026, 1, 9), interval: 2 } });
    const projection = project(
      { ...cliffPlan(jobA), rules: [jobB, jobA] },
      { today: d(2026, 1, 1), end: d(2026, 12, 31), calendar: fed, limits: LIMITS },
    );
    const events = projection.accounts[0]?.days.flatMap((x) => x.events) ?? [];
    const k401 = (key: string) => events.find((e) => e.key === key)?.paycheck?.lines.find((l) => l.id === '401k')?.actual;
    // 12 full deferrals (6 each) = $24,000; the 13th paycheck overall (a, Mar 27) gets the last $500.
    expect(k401('b@2026-03-20')).toBe(200_000);
    expect(k401('a@2026-03-27')).toBe(50_000);
    expect(k401('b@2026-04-03')).toBe(0);
    expect(new Set(projection.notices.map((n) => n.ruleId))).toEqual(new Set(['a', 'b']));
    expect(projection.notices.map((n) => formatISODate(n.date))).toEqual([...projection.notices.map((n) => formatISODate(n.date))].sort());
  });

  test('Social Security year-to-date wages from a stub', () => {
    const ss = cliffRule({
      lines: [
        {
          id: 'ss',
          name: 'Social Security',
          stage: 'tax',
          amount: { type: 'percent', bp: 620, of: 'fica' },
          wageCap: 'ss-wage-base',
          ytd: { asOf: d(2026, 1, 16), amount: 18_000_000 }, // e.g. a large bonus already taxed
        },
      ],
    });
    const { net, events } = netByDate(cliffPlan(ss), d(2026, 3, 1));
    expect(net['2026-01-16']).toBe(938_000); // covered by the stub: shown as it was
    expect(net['2026-01-30']).toBe(972_100); // $4,500 of wages left under the cap
    expect(net['2026-02-13']).toBe(1_000_000);
    expect(events.find((e) => e.key === 'job@2026-01-30')?.paycheck?.ytdEstimated).toBe(false);
  });

  test('wage-cap lines without year-to-date are flagged as estimated', () => {
    const ss = cliffRule({
      lines: [{ id: 'ss', name: 'SS', stage: 'tax', amount: { type: 'percent', bp: 620, of: 'fica' }, wageCap: 'ss-wage-base' }],
    });
    expect(netByDate(cliffPlan(ss), d(2026, 1, 31)).events[0]?.paycheck?.ytdEstimated).toBe(true);
  });

  test('a year-to-date figure on a line with no limit changes nothing', () => {
    const plain = cliffRule({
      lines: [{ id: 'dues', name: 'Dues', stage: 'posttax', amount: { type: 'fixed', cents: 1_000 }, ytd: { asOf: d(2026, 6, 5), amount: 99_999 } }],
    });
    const { events } = netByDate(cliffPlan(plain), d(2026, 12, 31));
    expect(new Set(events.map((e) => e.amount))).toEqual(new Set([999_000]));
    expect(events.every((e) => e.paycheck?.ytdEstimated === false)).toBe(true);
  });

  test('several configured years: each year uses its own, gaps use the latest earlier year', () => {
    const table = limitsFromConfig([
      { year: 2026, limits: { k: { kind: 'contribution', base: 200, catchUps: [] } } },
      { year: 2024, limits: { k: { kind: 'contribution', base: 100, catchUps: [{ fromAge: 50, toAge: 59, amount: 10 }] } } },
    ]);
    expect(limitFor(table, 'k', 2024)).toEqual({ amount: 10_000, estimated: false });
    expect(limitFor(table, 'k', 2025)).toEqual({ amount: 10_000, estimated: true });
    expect(limitFor(table, 'k', 2026)).toEqual({ amount: 20_000, estimated: false });
    expect(limitFor(table, 'k', 2030)).toEqual({ amount: 20_000, estimated: true });
    expect(limitFor(table, 'k', 2020)).toEqual({ amount: 10_000, estimated: true });
    expect(limitFor(table, 'k', 2024, 1974)?.amount).toBe(11_000); // 50
    expect(limitFor(table, 'k', 2024, 1964)?.amount).toBe(10_000); // 60: past toAge
    expect(limitFor(table, 'missing', 2026)).toBeUndefined();
    expect(limitsFromConfig([{ year: 2026, limits: { k: { kind: 'contribution', base: 0, catchUps: [] } } }]).years.get(2026)?.get('k')?.base).toBe(0);
  });

  test('validation at the exact edges', () => {
    const line = (amount: Paycheck['lines'][number]['amount']): Paycheck => ({
      gross: 100_000,
      lines: [{ id: 'x', name: 'X', stage: 'tax', amount }],
    });
    expect(paycheckProblems(line({ type: 'percent', bp: 0, of: 'gross' }))).toEqual([]);
    expect(paycheckProblems(line({ type: 'percent', bp: 10_000, of: 'gross' }))).toEqual([]);
    expect(paycheckProblems(line({ type: 'percent', bp: -1, of: 'gross' }))).toHaveLength(1);
    expect(paycheckProblems(line({ type: 'percent', bp: 1.5, of: 'gross' }))).toHaveLength(1);
    expect(paycheckProblems(line({ type: 'fixed', cents: 0 }))).toEqual([]);
    expect(paycheckProblems(line({ type: 'fixed', cents: 100_000 }))).toEqual([]); // net exactly $0 is allowed
    expect(paycheckProblems({ gross: 100_000, lines: [{ id: 'x', name: 'X', stage: 'pretax', amount: { type: 'fixed', cents: 1 }, wageCap: 'ss-wage-base' }] })).toEqual([
      'Only percentage taxes can have a wage cap ("X").',
    ]);
    expect(paycheckProblems({ gross: 100_000, lines: [{ id: 'x', name: 'X', stage: 'tax', amount: { type: 'percent', bp: 1, of: 'gross' }, limit: 'ira', wageCap: 'ira' }] }, LIMITS)).toEqual([
      'Taxes do not have contribution limits ("X").',
    ]);
    expect(paycheckProblems({ gross: 1, lines: [] })).toEqual([]);
  });

  test('a line with no reduces list reduces neither wage base', () => {
    const result = one({
      gross: 100_000,
      lines: [
        { id: 'p', name: 'P', stage: 'pretax', amount: { type: 'fixed', cents: 10_000 } },
        { id: 't', name: 'T', stage: 'tax', amount: { type: 'percent', bp: 1000, of: 'income' } },
        { id: 'g', name: 'G', stage: 'tax', amount: { type: 'percent', bp: 1000, of: 'gross' } },
      ],
    });
    expect([result?.incomeWages, result?.ficaWages]).toEqual([100_000, 100_000]);
    expect(result?.lines.map((l) => l.actual)).toEqual([10_000, 10_000, 10_000]);
  });
});
