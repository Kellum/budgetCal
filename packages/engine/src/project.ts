/**
 * Projection: balance entries + rules + changes → a day-by-day ledger per account.
 * See docs/PLAN.md §4.5–4.9.
 */

import type { BusinessCalendar } from './business.ts';
import { type CivilDate, addDays, civil, yearOf } from './date.ts';
import type { Cents } from './money.ts';
import {
  type OrphanedOverride,
  type ResolvedOccurrence,
  findOrphanedOverrides,
  indexOverrides,
  resolveOccurrences,
} from './occurrence.ts';
import {
  type LimitsTable,
  type PaycheckBreakdown,
  type PaycheckInput,
  type PaycheckNotice,
  computePaychecks,
  paycheckNotices,
} from './paycheck.ts';
import type { BalanceEntry, Overrides, Plan, Rule, RuleKind } from './types.ts';

export interface ProjectionOptions {
  /** The user's local calendar date. The engine never reads a clock. */
  readonly today: CivilDate;
  /** Last day to project, inclusive. */
  readonly end: CivilDate;
  readonly calendar: BusinessCalendar;
  /** Required when any rule has a paycheck. */
  readonly limits?: LimitsTable;
  /** The what-if layer, applied on top of the plan's own overrides. */
  readonly whatIf?: Overrides;
}

export interface LedgerEvent {
  readonly key: string;
  readonly ruleId: string;
  readonly name: string;
  readonly kind: RuleKind;
  readonly scheduled: CivilDate;
  /** Where it lands. */
  readonly date: CivilDate;
  /** Signed effect on this account. Shown even when skipped or cleared; applied only when neither. */
  readonly amount: Cents;
  readonly skipped: boolean;
  readonly moved: boolean;
  readonly whatIf: boolean;
  /** Dated on the balance entry's day and already reflected in it. */
  readonly cleared: boolean;
  /** Moved off a weekend or bank holiday by the rule's adjustment. */
  readonly adjusted: boolean;
  readonly amountChanged: boolean;
  /** Transfers: the other account's id, or null for an untracked destination. */
  readonly counterparty?: string | null;
  readonly paycheck?: PaycheckBreakdown;
}

export interface LedgerDay {
  readonly date: CivilDate;
  readonly opening: Cents;
  readonly closing: Cents;
  /** Balance if the day's outflows post before its inflows. */
  readonly low: Cents;
  readonly events: readonly LedgerEvent[];
  /** Before today: assumed to have happened. Today on: projected. */
  readonly basis: 'assumed' | 'projected';
  readonly daysFromToday: number;
  readonly belowThreshold: boolean;
  readonly negative: boolean;
}

export interface AccountProjection {
  readonly account: string;
  /** The balance entry this projection starts from: the only confirmed number. */
  readonly anchor: BalanceEntry;
  /** From the anchor date to `end`, one entry per day. Empty if the anchor is after `end`. */
  readonly days: readonly LedgerDay[];
}

export interface Projection {
  readonly accounts: readonly AccountProjection[];
  /** Accounts with no balance entry yet. */
  readonly unanchored: readonly string[];
  readonly orphans: readonly OrphanedOverride[];
  readonly notices: readonly PaycheckNotice[];
}

/** Each account's latest balance entry (latest date; among equal dates, highest sequence). */
export function latestBalances(balances: readonly BalanceEntry[]): Map<string, BalanceEntry> {
  const latest = new Map<string, BalanceEntry>();
  for (const entry of balances) {
    const current = latest.get(entry.account);
    if (!current || entry.date > current.date || (entry.date === current.date && entry.sequence > current.sequence)) {
      latest.set(entry.account, entry);
    }
  }
  return latest;
}

function assertReferences(plan: Plan): void {
  const accounts = new Set(plan.accounts.map((a) => a.id));
  if (accounts.size !== plan.accounts.length) throw new RangeError('Duplicate account id');
  const ruleIds = new Set<string>();
  for (const rule of plan.rules) {
    if (ruleIds.has(rule.id)) throw new RangeError(`Duplicate rule id ${rule.id}`);
    ruleIds.add(rule.id);
    if (rule.id.includes('@')) throw new RangeError(`Rule id may not contain "@": ${rule.id}`);
    if (!accounts.has(rule.account)) throw new RangeError(`Rule ${rule.id} uses unknown account ${rule.account}`);
    if (rule.toAccount !== undefined) {
      if (rule.kind !== 'transfer') throw new RangeError(`Only transfers have a destination (rule ${rule.id})`);
      if (!accounts.has(rule.toAccount)) throw new RangeError(`Rule ${rule.id} transfers to unknown account ${rule.toAccount}`);
      if (rule.toAccount === rule.account) throw new RangeError(`Rule ${rule.id} transfers to its own account`);
    }
    if (!Number.isSafeInteger(rule.amount) || rule.amount < 0) throw new RangeError(`Rule ${rule.id} amount must be positive cents`);
    if (rule.paycheck && rule.kind !== 'income') throw new RangeError(`Only income rules have a paycheck (rule ${rule.id})`);
  }
  for (const entry of plan.balances) {
    if (!accounts.has(entry.account)) throw new RangeError(`Balance entry ${entry.id} uses unknown account ${entry.account}`);
    if (!Number.isSafeInteger(entry.amount)) throw new RangeError(`Balance entry ${entry.id} must be whole cents`);
  }
}

interface Leg {
  readonly account: string;
  readonly amount: Cents;
  readonly counterparty?: string | null;
}

function legs(rule: Rule, amount: Cents): Leg[] {
  switch (rule.kind) {
    case 'income':
      return [{ account: rule.account, amount }];
    case 'expense':
      return [{ account: rule.account, amount: -amount }];
    case 'transfer':
      return rule.toAccount === undefined
        ? [{ account: rule.account, amount: -amount, counterparty: null }]
        : [
            { account: rule.account, amount: -amount, counterparty: rule.toAccount },
            { account: rule.toAccount, amount, counterparty: rule.account },
          ];
  }
}

export function project(plan: Plan, options: ProjectionOptions): Projection {
  assertReferences(plan);
  const { today, end, calendar } = options;
  const whatIf = options.whatIf ?? {};
  const index = indexOverrides(plan.overrides, whatIf);
  const anchors = latestBalances(plan.balances);
  const orphans = findOrphanedOverrides(plan.rules, plan.overrides, whatIf, calendar);

  const unanchored = plan.accounts.filter((a) => !anchors.has(a.id)).map((a) => a.id);
  const starts = [...anchors.values()].map((a) => a.date);
  if (starts.length === 0) return { accounts: [], unanchored, orphans, notices: [] };
  const from = starts.reduce((a, b) => (a < b ? a : b));

  // Paychecks need every occurrence since Jan 1 so year-to-date limits are right.
  const paycheckRules = plan.rules.filter((r) => r.paycheck && !r.paused);
  if (paycheckRules.length > 0 && !options.limits) throw new RangeError('Paycheck rules need a limits table');
  const yearStart = civil(yearOf(from), 1, 1);
  const paycheckInputs: PaycheckInput[] = paycheckRules.map((rule) => ({
    ruleId: rule.id,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- filtered above
    paycheck: rule.paycheck!,
    occurrences: resolveOccurrences(rule, yearStart, end, calendar, index).map((o) => ({
      key: o.key,
      ruleId: o.ruleId,
      date: o.finalDate,
      skipped: o.skipped,
    })),
  }));
  const breakdowns =
    options.limits && paycheckInputs.length > 0
      ? computePaychecks(paycheckInputs, {
          limits: options.limits,
          ...(plan.person?.birthYear !== undefined ? { birthYear: plan.person.birthYear } : {}),
        })
      : new Map<string, PaycheckBreakdown>();
  const notices = paycheckNotices(paycheckInputs, breakdowns).filter((n) => n.date >= from && n.date <= end);

  // Every event, bucketed by account and date.
  const byAccount = new Map<string, Map<CivilDate, LedgerEvent[]>>();
  for (const rule of plan.rules) {
    for (const occurrence of resolveOccurrences(rule, from, end, calendar, index)) {
      const breakdown = breakdowns.get(occurrence.key);
      const amount = occurrence.amountOverride ?? breakdown?.net ?? rule.amount;
      for (const leg of legs(rule, amount)) {
        const anchor = anchors.get(leg.account);
        if (!anchor || occurrence.finalDate < anchor.date) continue;
        const event = toEvent(rule, occurrence, leg, anchor, breakdown);
        const days = byAccount.get(leg.account) ?? new Map<CivilDate, LedgerEvent[]>();
        const list = days.get(occurrence.finalDate) ?? [];
        list.push(event);
        days.set(occurrence.finalDate, list);
        byAccount.set(leg.account, days);
      }
    }
  }

  const accounts: AccountProjection[] = [];
  for (const account of plan.accounts) {
    const anchor = anchors.get(account.id);
    if (!anchor) continue;
    const events = byAccount.get(account.id) ?? new Map<CivilDate, LedgerEvent[]>();
    const days: LedgerDay[] = [];
    let balance = anchor.amount;
    for (let date = anchor.date; date <= end; date = addDays(date, 1)) {
      const list = (events.get(date) ?? []).sort(
        (a, b) => b.amount - a.amount || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
      );
      const opening = balance;
      let outflows = 0;
      for (const event of list) {
        if (event.skipped || event.cleared) continue;
        balance += event.amount;
        if (event.amount < 0) outflows += event.amount;
      }
      if (!Number.isSafeInteger(balance)) throw new RangeError('Balance exceeds the safe integer range');
      days.push({
        date,
        opening,
        closing: balance,
        low: opening + outflows,
        events: list,
        basis: date < today ? 'assumed' : 'projected',
        daysFromToday: date - today,
        belowThreshold: balance < account.threshold,
        negative: balance < 0,
      });
    }
    accounts.push({ account: account.id, anchor, days });
  }

  return { accounts, unanchored, orphans, notices };
}

function toEvent(
  rule: Rule,
  occurrence: ResolvedOccurrence,
  leg: Leg,
  anchor: BalanceEntry,
  breakdown: PaycheckBreakdown | undefined,
): LedgerEvent {
  return {
    key: occurrence.key,
    ruleId: rule.id,
    name: rule.name,
    kind: rule.kind,
    scheduled: occurrence.scheduled,
    date: occurrence.finalDate,
    amount: leg.amount,
    skipped: occurrence.skipped,
    moved: occurrence.moved,
    whatIf: occurrence.whatIf,
    cleared: occurrence.finalDate === anchor.date && anchor.clearedKeys.includes(occurrence.key),
    adjusted: occurrence.date !== occurrence.scheduled,
    amountChanged: occurrence.amountOverride !== undefined,
    ...(leg.counterparty !== undefined ? { counterparty: leg.counterparty } : {}),
    ...(breakdown && occurrence.amountOverride === undefined ? { paycheck: breakdown } : {}),
  };
}
