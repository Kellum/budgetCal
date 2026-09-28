import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { type Adjustment, WEEKENDS_ONLY, createBusinessCalendar } from '../src/business.ts';
import { type CivilDate, formatISODate } from '../src/date.ts';
import { ruleOccurrences } from '../src/occurrence.ts';
import { type Projection, latestBalances, project } from '../src/project.ts';
import type { BalanceEntry, Overrides, Plan, Rule, RuleKind } from '../src/types.ts';
import { FED, d, scheduleArb } from './support.ts';

const fed = createBusinessCalendar(FED);
const TODAY = d(2026, 9, 28); // a Monday

const pay: Rule = {
  id: 'pay',
  name: 'Paycheck',
  kind: 'income',
  account: 'checking',
  amount: 178_000,
  schedule: { kind: 'weekly', start: d(2026, 10, 2), interval: 2 },
  adjust: 'before',
};
const rent: Rule = {
  id: 'rent',
  name: 'Rent',
  kind: 'expense',
  account: 'checking',
  amount: 185_000,
  schedule: { kind: 'monthly', start: d(2026, 1, 1), interval: 1, days: [1] },
  adjust: 'after',
};
const save: Rule = {
  id: 'save',
  name: 'To savings',
  kind: 'transfer',
  account: 'checking',
  toAccount: 'savings',
  amount: 10_000,
  schedule: { kind: 'monthly', start: d(2026, 1, 1), interval: 1, days: [15] },
  adjust: 'after',
};
const ira: Rule = {
  id: 'ira',
  name: 'Roth IRA',
  kind: 'transfer',
  account: 'checking',
  amount: 30_000,
  schedule: { kind: 'monthly', start: d(2026, 1, 1), interval: 1, days: [16] },
  adjust: 'after',
};

const balance = (account: string, date: CivilDate, amount: number, extra: Partial<BalanceEntry> = {}): BalanceEntry => ({
  id: `${account}-${date}`,
  account,
  date,
  amount,
  clearedKeys: [],
  sequence: 1,
  ...extra,
});

const basePlan: Plan = {
  accounts: [
    { id: 'checking', threshold: 50_000 },
    { id: 'savings', threshold: 0 },
  ],
  rules: [pay, rent, save, ira],
  balances: [balance('checking', TODAY, 90_000), balance('savings', d(2026, 9, 1), 100_000)],
  overrides: {},
};

const run = (plan: Plan = basePlan, end = d(2026, 10, 16), whatIf?: Overrides): Projection =>
  project(plan, { today: TODAY, end, calendar: fed, ...(whatIf ? { whatIf } : {}) });

const day = (projection: Projection, account: string, date: CivilDate) =>
  projection.accounts.find((a) => a.account === account)?.days.find((x) => x.date === date);

describe('a worked example', () => {
  const projection = run();

  test('checking, by hand', () => {
    const summary = projection.accounts[0]?.days
      .filter((x) => x.events.length > 0)
      .map((x) => [formatISODate(x.date), x.closing, x.low, x.negative, x.belowThreshold]);
    expect(summary).toEqual([
      ['2026-10-01', -95_000, -95_000, true, true], // $900 − $1,850 rent
      ['2026-10-02', 83_000, -95_000, false, false], // + $1,780 pay; low is the opening, before pay lands
      ['2026-10-15', 73_000, 73_000, false, false], // − $100 to savings
      ['2026-10-16', 221_000, 43_000, false, false], // + $1,780 pay, − $300 IRA; low if IRA posts first
    ]);
  });

  test('savings receives the transfer; the IRA is an untracked destination', () => {
    expect(day(projection, 'savings', d(2026, 9, 15))?.closing).toBe(110_000);
    expect(day(projection, 'savings', d(2026, 10, 15))?.closing).toBe(120_000);
    const toSavings = day(projection, 'checking', d(2026, 10, 15))?.events[0];
    expect(toSavings?.counterparty).toBe('savings');
    const toIra = day(projection, 'checking', d(2026, 10, 16))?.events.find((e) => e.ruleId === 'ira');
    expect(toIra?.counterparty).toBeNull();
    expect(toIra?.amount).toBe(-30_000);
  });

  test('days before today are assumed, today on are projected', () => {
    const savings = projection.accounts[1];
    expect(savings?.days[0]?.basis).toBe('assumed');
    expect(day(projection, 'savings', d(2026, 9, 27))?.basis).toBe('assumed');
    expect(day(projection, 'savings', TODAY)?.basis).toBe('projected');
    expect(day(projection, 'savings', TODAY)?.daysFromToday).toBe(0);
    expect(day(projection, 'savings', d(2026, 9, 1))?.daysFromToday).toBe(-27);
  });

  test('contiguous days from the anchor date through the end', () => {
    expect(projection.accounts[0]?.days).toHaveLength(19);
    expect(projection.accounts[1]?.days).toHaveLength(46);
    expect(projection.accounts[0]?.days[0]?.opening).toBe(90_000);
  });

  test('inflows are listed before outflows on the same day', () => {
    expect(day(projection, 'checking', d(2026, 10, 16))?.events.map((e) => e.ruleId)).toEqual(['pay', 'ira']);
  });
});

describe('balance entries', () => {
  test('the latest entry wins: by date, then by sequence', () => {
    const entries = [
      balance('checking', d(2026, 9, 20), 1, { id: 'a' }),
      balance('checking', d(2026, 9, 25), 2, { id: 'b', sequence: 1 }),
      balance('checking', d(2026, 9, 25), 3, { id: 'c', sequence: 2 }),
      balance('checking', d(2026, 9, 21), 4, { id: 'd', sequence: 9 }),
    ];
    expect(latestBalances(entries).get('checking')?.id).toBe('c');
  });

  test('items on the anchor day already in the balance are shown but not applied', () => {
    const plan: Plan = {
      ...basePlan,
      balances: [balance('checking', d(2026, 10, 2), 200_000, { clearedKeys: ['pay@2026-10-02'] }), basePlan.balances[1] as BalanceEntry],
    };
    const oct2 = day(run(plan), 'checking', d(2026, 10, 2));
    expect(oct2?.events[0]?.cleared).toBe(true);
    expect(oct2?.closing).toBe(200_000);
  });

  test('items on the anchor day not marked cleared are applied', () => {
    const plan: Plan = { ...basePlan, balances: [balance('checking', d(2026, 10, 2), 200_000), basePlan.balances[1] as BalanceEntry] };
    expect(day(run(plan), 'checking', d(2026, 10, 2))?.closing).toBe(378_000);
  });

  test('accounts without a balance are reported, not guessed', () => {
    const plan: Plan = { ...basePlan, balances: [balance('savings', d(2026, 9, 1), 100_000)] };
    const projection = run(plan);
    expect(projection.unanchored).toEqual(['checking']);
    expect(projection.accounts.map((a) => a.account)).toEqual(['savings']);
    // The transfer still lands in savings.
    expect(day(projection, 'savings', d(2026, 10, 15))?.closing).toBe(120_000);
  });

  test('no balances at all', () => {
    const projection = run({ ...basePlan, balances: [] });
    expect(projection.accounts).toEqual([]);
    expect(projection.unanchored).toEqual(['checking', 'savings']);
  });

  test('an anchor after the end gives no days', () => {
    const projection = run({ ...basePlan, balances: [balance('checking', d(2026, 11, 1), 0)] }, d(2026, 10, 31));
    expect(projection.accounts[0]?.days).toEqual([]);
  });
});

describe('single-occurrence changes', () => {
  test('regression: rent due before the balance date, moved after it, is still subtracted', () => {
    const plan: Plan = {
      ...basePlan,
      rules: [{ ...rent, schedule: { kind: 'monthly', start: d(2026, 1, 1), interval: 1, days: [25] } }],
      balances: [balance('checking', d(2026, 9, 27), 300_000)],
      overrides: { 'rent@2026-09-25': { date: d(2026, 10, 3) } },
    };
    const oct3 = day(run(plan), 'checking', d(2026, 10, 3));
    expect(oct3?.events.map((e) => [e.key, e.moved])).toEqual([['rent@2026-09-25', true]]);
    expect(oct3?.closing).toBe(115_000);
  });

  test('moved from after the balance date to before it: assumed already reflected', () => {
    const plan: Plan = { ...basePlan, overrides: { 'rent@2026-10-01': { date: d(2026, 9, 20) } } };
    expect(day(run(plan), 'checking', d(2026, 10, 1))?.closing).toBe(90_000);
  });

  test('skipped: shown, not applied', () => {
    const plan: Plan = { ...basePlan, overrides: { 'rent@2026-10-01': { skip: true } } };
    const oct1 = day(run(plan), 'checking', d(2026, 10, 1));
    expect(oct1?.events[0]?.skipped).toBe(true);
    expect(oct1?.closing).toBe(90_000);
  });

  test('amount changed', () => {
    const plan: Plan = { ...basePlan, overrides: { 'rent@2026-10-01': { amount: 100_000 } } };
    const oct1 = day(run(plan), 'checking', d(2026, 10, 1));
    expect(oct1?.events[0]?.amountChanged).toBe(true);
    expect(oct1?.closing).toBe(-10_000);
  });

  test('what-if changes are flagged and do not touch the plan', () => {
    const projection = run(basePlan, d(2026, 10, 16), { 'rent@2026-10-01': { date: d(2026, 10, 5) } });
    const oct5 = day(projection, 'checking', d(2026, 10, 5));
    expect(oct5?.events[0]?.whatIf).toBe(true);
    expect(day(projection, 'checking', d(2026, 10, 1))?.closing).toBe(90_000);
    expect(basePlan.overrides).toEqual({});
  });

  test('weekend adjustment is visible on the event', () => {
    // Nov 1, 2026 is a Sunday: rent with "after" lands Monday Nov 2.
    const nov2 = day(run(basePlan, d(2026, 11, 30)), 'checking', d(2026, 11, 2));
    const event = nov2?.events.find((e) => e.ruleId === 'rent');
    expect(event?.adjusted).toBe(true);
    expect(formatISODate(event?.scheduled as CivilDate)).toBe('2026-11-01');
  });

  test('orphaned overrides are reported', () => {
    const plan: Plan = { ...basePlan, overrides: { 'rent@2026-10-02': { skip: true } } };
    expect(run(plan).orphans).toEqual([{ key: 'rent@2026-10-02', layer: 'plan', reason: 'not-scheduled' }]);
  });
});

describe('bad references fail loudly', () => {
  const bad = (plan: Partial<Plan>) => () => run({ ...basePlan, ...plan });
  test.each([
    ['unknown account', { rules: [{ ...rent, account: 'nope' }] }],
    ['unknown destination', { rules: [{ ...save, toAccount: 'nope' }] }],
    ['transfer to itself', { rules: [{ ...save, toAccount: 'checking' }] }],
    ['destination on a non-transfer', { rules: [{ ...rent, toAccount: 'savings' }] }],
    ['duplicate rule', { rules: [rent, rent] }],
    ['@ in rule id', { rules: [{ ...rent, id: 'a@b' }] }],
    ['negative amount', { rules: [{ ...rent, amount: -1 }] }],
    ['fractional cents', { rules: [{ ...rent, amount: 1.5 }] }],
    ['paycheck on an expense', { rules: [{ ...rent, paycheck: { gross: 1, lines: [] } }] }],
    ['balance for unknown account', { balances: [balance('nope', TODAY, 0)] }],
    ['duplicate account', { accounts: [{ id: 'checking', threshold: 0 }, { id: 'checking', threshold: 0 }] }],
  ])('%s', (_, plan) => expect(bad(plan as Partial<Plan>)).toThrow(RangeError));

  test('paycheck rules need a limits table', () => {
    expect(bad({ rules: [{ ...pay, paycheck: { gross: 400_000, lines: [] } }] })).toThrow(/limits/);
  });
});

// ---------------------------------------------------------------------------------------
// Properties over random plans

const ACCOUNTS = ['a', 'b', 'c'] as const;

const ruleArb = (id: string): fc.Arbitrary<Rule> =>
  fc
    .record({
      kind: fc.constantFrom<RuleKind>('income', 'expense', 'transfer'),
      account: fc.constantFrom(...ACCOUNTS),
      to: fc.option(fc.constantFrom(...ACCOUNTS), { nil: undefined }),
      amount: fc.integer({ min: 0, max: 500_000 }),
      schedule: scheduleArb,
      adjust: fc.constantFrom<Adjustment>('before', 'after', 'none'),
      paused: fc.boolean(),
    })
    .map(({ kind, account, to, amount, schedule, adjust, paused }) => ({
      id,
      name: id,
      kind,
      account,
      ...(kind === 'transfer' && to !== undefined && to !== account ? { toAccount: to } : {}),
      amount,
      schedule,
      adjust,
      ...(paused ? { paused } : {}),
    }));

const planArb: fc.Arbitrary<{ plan: Plan; end: CivilDate }> = fc
  .record({
    rules: fc.integer({ min: 0, max: 8 }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => ruleArb(`r${i}`)))),
    anchors: fc.tuple(
      ...ACCOUNTS.map((account) =>
        fc.option(
          fc.record({ offset: fc.integer({ min: -60, max: 5 }), amount: fc.integer({ min: -500_000, max: 2_000_000 }) }),
          { nil: undefined, freq: 5 },
        ).map((x) => (x ? balance(account, (TODAY + x.offset) as CivilDate, x.amount) : undefined)),
      ),
    ),
    thresholds: fc.tuple(...ACCOUNTS.map(() => fc.integer({ min: 0, max: 100_000 }))),
    span: fc.integer({ min: 0, max: 400 }),
    overrideSeed: fc.array(
      fc.record({
        pick: fc.nat(),
        change: fc.oneof(
          fc.record({ skip: fc.constant(true) }),
          fc.record({ date: fc.integer({ min: -90, max: 120 }) }),
          fc.record({ amount: fc.integer({ min: 0, max: 300_000 }) }),
        ),
      }),
      { maxLength: 6 },
    ),
  })
  .map(({ rules, anchors, thresholds, span, overrideSeed }) => {
    const end = (TODAY + span) as CivilDate;
    const candidates = rules.flatMap((rule) => ruleOccurrences(rule, (TODAY - 90) as CivilDate, end, fed));
    const overrides: Record<string, { skip?: boolean; date?: CivilDate; amount?: number }> = {};
    for (const { pick, change } of overrideSeed) {
      const occurrence = candidates[pick % Math.max(1, candidates.length)];
      if (!occurrence) continue;
      overrides[occurrence.key] =
        'date' in change ? { date: (occurrence.date + change.date) as CivilDate } : change;
    }
    const plan: Plan = {
      accounts: ACCOUNTS.map((id, i) => ({ id, threshold: thresholds[i] ?? 0 })),
      rules,
      balances: anchors.filter((x): x is BalanceEntry => x !== undefined),
      overrides,
    };
    return { plan, end };
  });

describe('ledger invariants on random plans', () => {
  test('each day: opening = previous closing; closing = opening + applied events; low ≤ both', () => {
    fc.assert(
      fc.property(planArb, ({ plan, end }) => {
        const projection = project(plan, { today: TODAY, end, calendar: fed });
        for (const account of projection.accounts) {
          let expectedOpening = account.anchor.amount;
          let expectedDate = account.anchor.date;
          for (const x of account.days) {
            expect(x.date).toBe(expectedDate);
            expect(x.opening).toBe(expectedOpening);
            const applied = x.events.filter((e) => !e.skipped && !e.cleared);
            expect(x.closing).toBe(x.opening + applied.reduce((sum, e) => sum + e.amount, 0));
            expect(x.low).toBeLessThanOrEqual(Math.min(x.opening, x.closing));
            expect(x.belowThreshold).toBe(x.closing < (plan.accounts.find((a) => a.id === account.account)?.threshold ?? 0));
            expect(x.negative).toBe(x.closing < 0);
            expect(x.basis).toBe(x.date < TODAY ? 'assumed' : 'projected');
            for (const e of x.events) expect(e.date).toBe(x.date);
            expectedOpening = x.closing;
            expectedDate = (x.date + 1) as CivilDate;
          }
          if (account.anchor.date <= end) expect(expectedDate).toBe(end + 1);
        }
      }),
      { numRuns: 300 },
    );
  });

  test('rule order and override order do not matter', () => {
    fc.assert(
      fc.property(planArb, fc.nat(), ({ plan, end }, seed) => {
        const shuffle = <T,>(items: readonly T[]): T[] =>
          [...items].map((x, i) => ({ x, k: (i * 7919 + seed) % 104729 })).sort((a, b) => a.k - b.k).map(({ x }) => x);
        const reordered: Plan = {
          ...plan,
          rules: shuffle(plan.rules),
          overrides: Object.fromEntries(shuffle(Object.entries(plan.overrides))),
        };
        expect(project(reordered, { today: TODAY, end, calendar: fed })).toEqual(project(plan, { today: TODAY, end, calendar: fed }));
      }),
      { numRuns: 150 },
    );
  });

  test('transfers between tracked accounts move money without creating or destroying it', () => {
    fc.assert(
      fc.property(planArb, ({ plan, end }) => {
        const transfersOnly: Plan = {
          ...plan,
          rules: plan.rules.filter((r) => r.kind === 'transfer' && r.toAccount !== undefined),
          balances: ACCOUNTS.map((account) => balance(account, (TODAY - 10) as CivilDate, 100_000)),
        };
        const projection = project(transfersOnly, { today: TODAY, end, calendar: WEEKENDS_ONLY });
        for (let i = 0; i < (projection.accounts[0]?.days.length ?? 0); i++) {
          // Skipping a transfer skips both legs, so the total holds even then.
          expect(projection.accounts.reduce((sum, a) => sum + (a.days[i]?.closing ?? 0), 0)).toBe(300_000);
        }
      }),
      { numRuns: 200 },
    );
  });

  test('every applied event is an occurrence of its rule (or an explicit move of one)', () => {
    fc.assert(
      fc.property(planArb, ({ plan, end }) => {
        const projection = project(plan, { today: TODAY, end, calendar: fed });
        for (const account of projection.accounts) {
          for (const x of account.days) {
            for (const e of x.events) {
              const rule = plan.rules.find((r) => r.id === e.ruleId) as Rule;
              const natural = ruleOccurrences(rule, (e.scheduled - 10) as CivilDate, (e.scheduled + 10) as CivilDate, fed);
              const occurrence = natural.find((o) => o.key === e.key);
              expect(occurrence, e.key).toBeDefined();
              expect(e.moved).toBe(occurrence?.date !== e.date);
              if (e.moved) expect(plan.overrides[e.key]?.date).toBe(e.date);
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('gaps found by mutation testing', () => {
  test('event flags are false when nothing happened to the event', () => {
    const event = day(run(), 'checking', d(2026, 10, 2))?.events[0];
    expect(event).toMatchObject({ skipped: false, moved: false, whatIf: false, cleared: false, adjusted: false, amountChanged: false });
    expect(event).not.toHaveProperty('counterparty');
    expect(event).not.toHaveProperty('paycheck');
  });

  test('a cleared key only clears the item on the anchor date itself', () => {
    const plan: Plan = {
      ...basePlan,
      balances: [balance('checking', TODAY, 90_000, { clearedKeys: ['rent@2026-10-01'] }), basePlan.balances[1] as BalanceEntry],
    };
    const oct1 = day(run(plan), 'checking', d(2026, 10, 1));
    expect(oct1?.events[0]?.cleared).toBe(false);
    expect(oct1?.closing).toBe(-95_000);
  });

  test('a balance exactly at the cushion is not below it', () => {
    const plan: Plan = { ...basePlan, accounts: [{ id: 'checking', threshold: 83_000 }, { id: 'savings', threshold: 0 }] };
    expect(day(run(plan), 'checking', d(2026, 10, 2))?.belowThreshold).toBe(false);
    expect(day(run(plan), 'checking', d(2026, 10, 15))?.belowThreshold).toBe(true);
  });

  test('a zero-amount event does not lower the day low', () => {
    const plan: Plan = { ...basePlan, overrides: { 'rent@2026-10-01': { amount: 0 } } };
    const oct1 = day(run(plan), 'checking', d(2026, 10, 1));
    expect([oct1?.low, oct1?.closing]).toEqual([90_000, 90_000]);
  });

  test('moving onto the first or last day of the window counts', () => {
    const first = run({ ...basePlan, overrides: { 'rent@2026-10-01': { date: TODAY } } });
    expect(day(first, 'checking', TODAY)?.events.map((e) => e.key)).toEqual(['rent@2026-10-01']);
    const last = run({ ...basePlan, overrides: { 'rent@2026-10-01': { date: d(2026, 10, 16) } } });
    expect(day(last, 'checking', d(2026, 10, 16))?.events.map((e) => e.key)).toContain('rent@2026-10-01');
  });

  test('same-day events are ordered inflows first, then by key', () => {
    const extra: Rule = { ...rent, id: 'aaa', name: 'A', amount: 185_000 };
    const plan: Plan = { ...basePlan, rules: [rent, extra, pay] };
    const oct = run(plan, d(2026, 11, 30));
    expect(day(oct, 'checking', d(2026, 10, 1))?.events.map((e) => e.key)).toEqual(['aaa@2026-10-01', 'rent@2026-10-01']);
  });

  test('paycheck notices outside the projection window are left out', () => {
    const job: Rule = {
      ...pay,
      schedule: { kind: 'weekly', start: d(2026, 1, 2), interval: 2 },
      paycheck: {
        gross: 1_000_000,
        lines: [{ id: '401k', name: '401(k)', stage: 'pretax', amount: { type: 'percent', bp: 2000, of: 'gross' }, reduces: ['income'], limit: '401k-elective' }],
      },
    };
    const table = { years: new Map([[2026, new Map([['401k-elective', { kind: 'contribution' as const, base: 2_450_000, catchUps: [] }]])]]) };
    const plan: Plan = { ...basePlan, rules: [job], balances: [balance('checking', d(2026, 6, 19), 0)] };
    const inWindow = project(plan, { today: TODAY, end: d(2026, 7, 3), calendar: fed, limits: table });
    expect(inWindow.notices.map((n) => formatISODate(n.date))).toEqual(['2026-07-03']); // Jun 18 is before the balance date
    const before = project(plan, { today: TODAY, end: d(2026, 7, 2), calendar: fed, limits: table });
    expect(before.notices).toEqual([]);
  });

  test('an unanchored plan returns no notices and no days', () => {
    const projection = project({ ...basePlan, balances: [] }, { today: TODAY, end: d(2026, 12, 31), calendar: fed });
    expect(projection).toEqual({ accounts: [], unanchored: ['checking', 'savings'], orphans: [], notices: [] });
  });

  test('balance entries must be whole cents; account ids must be unique', () => {
    expect(() => run({ ...basePlan, balances: [balance('checking', TODAY, 0.5)] })).toThrow(/whole cents/);
  });
});
