/**
 * The paycheck waterfall and the contribution-limit cliff. See docs/PLAN.md §4.8.
 *
 *   gross − pre-tax deductions − taxes − post-tax deductions = net
 *
 * The engine never computes tax tables. Users copy lines from a pay stub. Taxes entered as a
 * percentage of wages recompute when a pre-tax deduction stops, which is what keeps the
 * cliff estimate honest: when a 401(k) deduction stops, more pay is taxable, so take-home
 * rises by less than the deduction.
 *
 * Payroll deductions never become calendar events. They only shape net pay.
 */

import { type CivilDate, yearOf } from './date.ts';
import { type BasisPoints, type Cents, percentOf, sumCents } from './money.ts';

export type WageBasis = 'gross' | 'income' | 'fica';

export type LineAmount =
  | { readonly type: 'fixed'; readonly cents: Cents }
  | { readonly type: 'percent'; readonly bp: BasisPoints; readonly of: WageBasis };

export interface YearToDate {
  /** Pay date of the stub the figure was copied from. Covers paychecks on or before this date. */
  readonly asOf: CivilDate;
  /** Contributions so far this year (limit lines) or wages subject to the tax so far (wage-cap lines). */
  readonly amount: Cents;
}

export interface PayLine {
  readonly id: string;
  readonly name: string;
  readonly stage: 'pretax' | 'tax' | 'posttax';
  readonly amount: LineAmount;
  /** Pre-tax lines: which wage bases this deduction reduces. 401(k): income. HSA/§125: income and fica. */
  readonly reduces?: readonly ('income' | 'fica')[];
  /** Contribution limit key (pre-tax or post-tax lines), e.g. "401k-elective". Shared per person. */
  readonly limit?: string;
  /** Wage cap key (percentage tax lines), e.g. "ss-wage-base". Tracked per paycheck rule. */
  readonly wageCap?: string;
  readonly ytd?: YearToDate;
}

export interface Paycheck {
  readonly gross: Cents;
  readonly lines: readonly PayLine[];
}

// ---------------------------------------------------------------------------------------
// Limits table (from config/limits/<year>.json)

export interface CatchUp {
  readonly fromAge: number;
  readonly toAge?: number;
  readonly amount: Cents;
}

export interface LimitDefinition {
  readonly kind: 'contribution' | 'wage-cap';
  readonly base: Cents;
  readonly catchUps: readonly CatchUp[];
}

export interface LimitsTable {
  readonly years: ReadonlyMap<number, ReadonlyMap<string, LimitDefinition>>;
}

/** Shape of config/limits/<year>.json. Amounts are whole dollars there, cents here. */
export interface LimitsConfigFile {
  readonly year: number;
  readonly limits: Readonly<
    Record<
      string,
      {
        readonly kind: 'contribution' | 'wage-cap';
        readonly base: number;
        readonly catchUps: readonly { readonly fromAge: number; readonly toAge?: number; readonly amount: number }[];
      }
    >
  >;
}

const dollars = (value: number, label: string): Cents => {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be whole dollars, got ${value}`);
  return value * 100;
};

export function limitsFromConfig(files: readonly LimitsConfigFile[]): LimitsTable {
  const years = new Map<number, ReadonlyMap<string, LimitDefinition>>();
  for (const file of files) {
    if (years.has(file.year)) throw new RangeError(`Limits for ${file.year} given twice`);
    const limits = new Map<string, LimitDefinition>();
    for (const [key, value] of Object.entries(file.limits)) {
      limits.set(key, {
        kind: value.kind,
        base: dollars(value.base, `${file.year} ${key}`),
        catchUps: value.catchUps.map((c) => ({
          fromAge: c.fromAge,
          ...(c.toAge !== undefined ? { toAge: c.toAge } : {}),
          amount: dollars(c.amount, `${file.year} ${key} catch-up`),
        })),
      });
    }
    years.set(file.year, limits);
  }
  return { years };
}

export interface ResolvedLimit {
  readonly amount: Cents;
  /** True when the year's limits are not published and another year's were used. */
  readonly estimated: boolean;
}

/** The limit for `key` in `year`, including any catch-up for age attained by Dec 31. */
export function limitFor(table: LimitsTable, key: string, year: number, birthYear?: number): ResolvedLimit | undefined {
  const known = [...table.years.keys()].sort((a, b) => a - b);
  if (known.length === 0) return undefined;
  const usedYear = [...known].reverse().find((y) => y <= year) ?? known[0];
  const definition = usedYear === undefined ? undefined : table.years.get(usedYear)?.get(key);
  if (!definition) return undefined;
  let amount = definition.base;
  if (birthYear !== undefined) {
    const age = year - birthYear;
    const catchUp = definition.catchUps.find((c) => age >= c.fromAge && (c.toAge === undefined || age <= c.toAge));
    if (catchUp) amount += catchUp.amount;
  }
  return { amount, estimated: usedYear !== year };
}

// ---------------------------------------------------------------------------------------
// Validation

export function paycheckProblems(paycheck: Paycheck, table?: LimitsTable): string[] {
  const problems: string[] = [];
  if (!Number.isSafeInteger(paycheck.gross) || paycheck.gross <= 0) problems.push('Gross pay must be more than $0.');
  const ids = new Set<string>();
  for (const line of paycheck.lines) {
    const label = line.name || line.id;
    if (ids.has(line.id)) problems.push(`Line "${label}" appears twice.`);
    ids.add(line.id);
    if (line.amount.type === 'fixed' && (!Number.isSafeInteger(line.amount.cents) || line.amount.cents < 0)) {
      problems.push(`"${label}" must be $0 or more.`);
    }
    if (line.amount.type === 'percent') {
      if (!Number.isSafeInteger(line.amount.bp) || line.amount.bp < 0 || line.amount.bp > 10000) {
        problems.push(`"${label}" must be between 0% and 100%.`);
      }
      if (line.stage !== 'tax' && line.amount.of !== 'gross') problems.push(`"${label}" can only be a percentage of gross pay.`);
    }
    if (line.reduces && line.stage !== 'pretax') problems.push(`Only pre-tax lines reduce taxable wages ("${label}").`);
    if (line.limit && line.stage === 'tax') problems.push(`Taxes do not have contribution limits ("${label}").`);
    if (line.wageCap && (line.stage !== 'tax' || line.amount.type !== 'percent')) {
      problems.push(`Only percentage taxes can have a wage cap ("${label}").`);
    }
    for (const key of [line.limit, line.wageCap]) {
      if (key && table && ![...table.years.values()].some((year) => year.has(key))) {
        problems.push(`Unknown limit "${key}" on "${label}".`);
      }
    }
  }
  if (problems.length === 0) {
    const sample = computePaychecks(
      [{ ruleId: '', paycheck, occurrences: [{ key: '', ruleId: '', date: 0 as CivilDate, skipped: false }] }],
      { limits: { years: new Map() } },
    ).get('');
    if (sample && sample.net < 0) problems.push('Deductions and taxes add up to more than gross pay.');
  }
  return problems;
}

// ---------------------------------------------------------------------------------------
// Computation

export interface PaycheckLineResult {
  readonly id: string;
  readonly name: string;
  readonly stage: PayLine['stage'];
  /** What the line would be with no limit or cap. */
  readonly nominal: Cents;
  readonly actual: Cents;
  /** A contribution limit or wage cap reduced this line on this paycheck. */
  readonly limited: boolean;
}

export interface PaycheckBreakdown {
  readonly gross: Cents;
  readonly lines: readonly PaycheckLineResult[];
  readonly incomeWages: Cents;
  readonly ficaWages: Cents;
  readonly net: Cents;
  /** Some year-to-date figure was not entered for this year, so it was estimated from the schedule. */
  readonly ytdEstimated: boolean;
  /** Some limit came from another year's config because this year's is not published. */
  readonly limitsEstimated: boolean;
}

export interface PaycheckOccurrence {
  readonly key: string;
  readonly ruleId: string;
  readonly date: CivilDate;
  readonly skipped: boolean;
}

export interface PaycheckInput {
  readonly ruleId: string;
  readonly paycheck: Paycheck;
  /**
   * Every occurrence of this rule from Jan 1 of the first year of interest, ascending.
   * Earlier paychecks in a year drive later paychecks' limits.
   */
  readonly occurrences: readonly PaycheckOccurrence[];
}

export interface PaycheckContext {
  readonly limits: LimitsTable;
  readonly birthYear?: number;
}

/** Already counted in a year-to-date figure the user entered from a stub. */
const coveredByYtd = (line: PayLine, date: CivilDate): boolean =>
  line.ytd !== undefined && yearOf(line.ytd.asOf) === yearOf(date) && date <= line.ytd.asOf;

const hasYtdFor = (line: PayLine, year: number): boolean => line.ytd !== undefined && yearOf(line.ytd.asOf) === year;

/**
 * Breakdown for every paycheck occurrence, keyed by occurrence key. Paychecks from all rules are
 * processed in date order because contribution limits are per person. A skipped paycheck gets a
 * breakdown (what it would have been) but counts toward no limit.
 */
export function computePaychecks(inputs: readonly PaycheckInput[], context: PaycheckContext): Map<string, PaycheckBreakdown> {
  const queue = inputs
    .flatMap((input) => input.occurrences.map((occurrence) => ({ input, occurrence })))
    .sort((a, b) => a.occurrence.date - b.occurrence.date || (a.occurrence.key < b.occurrence.key ? -1 : 1));

  const results = new Map<string, PaycheckBreakdown>();
  let year: number | undefined;
  const contributed = new Map<string, Cents>(); // limit key → this year's contributions
  const wagesTaxed = new Map<string, Cents>(); // `${ruleId} ${key}` → this year's wages subject to the tax

  const startYear = (y: number): void => {
    year = y;
    contributed.clear();
    wagesTaxed.clear();
    for (const input of inputs) {
      for (const line of input.paycheck.lines) {
        if (!line.ytd || !hasYtdFor(line, y)) continue;
        if (line.limit) contributed.set(line.limit, (contributed.get(line.limit) ?? 0) + line.ytd.amount);
        if (line.wageCap) wagesTaxed.set(`${input.ruleId} ${line.wageCap}`, line.ytd.amount);
      }
    }
  };

  for (const { input, occurrence } of queue) {
    const y = yearOf(occurrence.date);
    if (y !== year) startYear(y);
    const { paycheck } = input;
    const gross = paycheck.gross;
    const counts = (line: PayLine): boolean => !occurrence.skipped && !coveredByYtd(line, occurrence.date);
    let ytdEstimated = false;
    let limitsEstimated = false;

    const remaining = (key: string, used: Cents): Cents | undefined => {
      const limit = limitFor(context.limits, key, y, context.birthYear);
      if (!limit) return undefined;
      if (limit.estimated) limitsEstimated = true;
      return Math.max(0, limit.amount - used);
    };

    const contribution = (line: PayLine): PaycheckLineResult => {
      const nominal = line.amount.type === 'fixed' ? line.amount.cents : percentOf(gross, line.amount.bp);
      let actual = nominal;
      if (line.limit) {
        if (!hasYtdFor(line, y)) ytdEstimated = true;
        if (!coveredByYtd(line, occurrence.date)) {
          const left = remaining(line.limit, contributed.get(line.limit) ?? 0);
          if (left !== undefined) actual = Math.min(nominal, left);
          if (counts(line)) contributed.set(line.limit, (contributed.get(line.limit) ?? 0) + actual);
        }
      }
      return { id: line.id, name: line.name, stage: line.stage, nominal, actual, limited: actual < nominal };
    };

    const pretax = paycheck.lines.filter((l) => l.stage === 'pretax').map((line) => ({ line, result: contribution(line) }));
    // Wages never go below zero, even if pre-tax deductions exceed gross (validation flags that).
    const reduced = (basis: 'income' | 'fica'): Cents =>
      Math.max(0, gross - sumCents(pretax.filter(({ line }) => line.reduces?.includes(basis)).map(({ result }) => result.actual)));
    const incomeWages = reduced('income');
    const ficaWages = reduced('fica');
    const basisOf = (of: WageBasis): Cents => (of === 'gross' ? gross : of === 'income' ? incomeWages : ficaWages);

    const taxes = paycheck.lines
      .filter((l) => l.stage === 'tax')
      .map((line): PaycheckLineResult => {
        if (line.amount.type === 'fixed') {
          return { id: line.id, name: line.name, stage: line.stage, nominal: line.amount.cents, actual: line.amount.cents, limited: false };
        }
        const wages = basisOf(line.amount.of);
        const nominal = percentOf(wages, line.amount.bp);
        let subject = wages;
        if (line.wageCap) {
          if (!hasYtdFor(line, y)) ytdEstimated = true;
          if (!coveredByYtd(line, occurrence.date)) {
            const capKey = `${input.ruleId} ${line.wageCap}`;
            const used = wagesTaxed.get(capKey) ?? 0;
            const left = remaining(line.wageCap, used);
            if (left !== undefined) subject = Math.min(wages, left);
            if (counts(line)) wagesTaxed.set(capKey, used + wages);
          }
        }
        const actual = percentOf(subject, line.amount.bp);
        return { id: line.id, name: line.name, stage: line.stage, nominal, actual, limited: actual < nominal };
      });

    const posttax = paycheck.lines.filter((l) => l.stage === 'posttax').map(contribution);
    const lines = [...pretax.map(({ result }) => result), ...taxes, ...posttax];

    results.set(occurrence.key, {
      gross,
      lines,
      incomeWages,
      ficaWages,
      net: gross - sumCents(lines.map((l) => l.actual)),
      ytdEstimated,
      limitsEstimated,
    });
  }
  return results;
}

// ---------------------------------------------------------------------------------------
// Notices: "take-home projected to rise ≈$340 from Oct 24"

export interface PaycheckChangeCause {
  readonly lineId: string;
  readonly lineName: string;
  readonly change: 'limit-reached' | 'cap-reached' | 'year-reset';
}

export interface PaycheckNotice {
  readonly ruleId: string;
  readonly key: string;
  readonly date: CivilDate;
  readonly previousNet: Cents;
  readonly net: Cents;
  readonly causes: readonly PaycheckChangeCause[];
  /** Always true in practice: these are projections built on entered pay stub lines. */
  readonly estimated: boolean;
}

/**
 * Where net pay changes because a limit or cap was reached, or because a new year reset
 * them. Other changes (edits, overrides) are not the engine's to explain.
 */
export function paycheckNotices(inputs: readonly PaycheckInput[], breakdowns: ReadonlyMap<string, PaycheckBreakdown>): PaycheckNotice[] {
  const notices: PaycheckNotice[] = [];
  for (const input of inputs) {
    const limitedLines = new Map(input.paycheck.lines.filter((l) => l.limit || l.wageCap).map((l) => [l.id, l]));
    if (limitedLines.size === 0) continue;
    let previous: { date: CivilDate; breakdown: PaycheckBreakdown } | undefined;
    for (const occurrence of input.occurrences) {
      const breakdown = breakdowns.get(occurrence.key);
      if (occurrence.skipped || !breakdown) continue;
      if (previous && breakdown.net !== previous.breakdown.net) {
        const newYear = yearOf(occurrence.date) !== yearOf(previous.date);
        const causes: PaycheckChangeCause[] = [];
        for (const result of breakdown.lines) {
          const line = limitedLines.get(result.id);
          const before = previous.breakdown.lines.find((l) => l.id === result.id);
          if (!line || !before || before.actual === result.actual) continue;
          causes.push({
            lineId: line.id,
            lineName: line.name,
            change: newYear ? 'year-reset' : line.limit ? 'limit-reached' : 'cap-reached',
          });
        }
        if (causes.length > 0) {
          notices.push({
            ruleId: input.ruleId,
            key: occurrence.key,
            date: occurrence.date,
            previousNet: previous.breakdown.net,
            net: breakdown.net,
            causes,
            estimated: true,
          });
        }
      }
      previous = { date: occurrence.date, breakdown };
    }
  }
  return notices.sort((a, b) => a.date - b.date || (a.key < b.key ? -1 : 1));
}
