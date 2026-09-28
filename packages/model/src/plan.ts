/**
 * Stored records → the engine's Plan. Records the engine could not use are left out and
 * reported, so a bad record can never crash a projection or silently distort one.
 */

import {
  type Account,
  type BalanceEntry,
  type CivilDate,
  type LimitsTable,
  type Override,
  type Overrides,
  type Paycheck,
  type PayLine,
  type Plan,
  type Rule,
  type Schedule,
  parseISODate,
  paycheckProblems,
  scheduleProblems,
} from '@budgetcal/engine';
import { compareHlc, type Hlc } from './hlc.ts';
import {
  type AccountRecord,
  type BalanceRecord,
  type OverrideRecord,
  type RuleRecord,
  type SettingsRecord,
  type StoredDocument,
  type StoredPaycheck,
  type StoredRecord,
  type StoredSchedule,
  recordKey,
} from './records.ts';

export interface RecordProblem {
  /** `type/id` of the record. */
  readonly record: string;
  readonly message: string;
}

export interface PlanResult {
  readonly plan: Plan;
  readonly whatIf: Overrides;
  readonly problems: readonly RecordProblem[];
}

const date = (iso: string): CivilDate => parseISODate(iso);

export function toSchedule(stored: StoredSchedule): Schedule {
  if (stored.kind === 'once') return { kind: 'once', start: date(stored.start) };
  const bounds = {
    start: date(stored.start),
    interval: stored.interval,
    ...(stored.end !== undefined ? { end: date(stored.end) } : {}),
    ...(stored.count !== undefined ? { count: stored.count } : {}),
  };
  switch (stored.kind) {
    case 'weekly':
      return { kind: 'weekly', ...bounds };
    case 'monthly':
      return { kind: 'monthly', ...bounds, days: stored.days };
    case 'monthly-weekday':
      return { kind: 'monthly-weekday', ...bounds, nth: stored.nth, weekday: stored.weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6 };
    case 'yearly':
      return { kind: 'yearly', ...bounds, month: stored.month, day: stored.day };
  }
}

export function toPaycheck(stored: StoredPaycheck): Paycheck {
  return {
    gross: stored.gross,
    lines: stored.lines.map(
      (line): PayLine => ({
        id: line.id,
        name: line.name,
        stage: line.stage,
        amount: line.amount,
        ...(line.reduces ? { reduces: line.reduces } : {}),
        ...(line.limit ? { limit: line.limit } : {}),
        ...(line.wageCap ? { wageCap: line.wageCap } : {}),
        ...(line.ytd ? { ytd: { asOf: date(line.ytd.asOf), amount: line.ytd.amount } } : {}),
      }),
    ),
  };
}

function toOverride(record: OverrideRecord): Override {
  return {
    ...(record.skip !== undefined ? { skip: record.skip } : {}),
    ...(record.date !== undefined ? { date: date(record.date) } : {}),
    ...(record.amount !== undefined ? { amount: record.amount } : {}),
  };
}

const live = <T extends StoredRecord['type']>(document: StoredDocument, type: T) =>
  document.records.filter((r): r is Extract<StoredRecord, { type: T }> => r.type === type && !r.deleted);

/** Build the engine's plan from stored records, leaving out (and reporting) anything unusable. */
export function toPlan(document: StoredDocument, limits?: LimitsTable): PlanResult {
  const problems: RecordProblem[] = [];
  const report = (record: StoredRecord, message: string): void => {
    problems.push({ record: recordKey(record), message });
  };

  const accountRecords: AccountRecord[] = live(document, 'account').sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
  const accounts: Account[] = accountRecords.map((a) => ({ id: a.id, threshold: a.threshold }));
  const accountIds = new Set(accounts.map((a) => a.id));

  const rules: Rule[] = [];
  for (const record of live(document, 'rule') as RuleRecord[]) {
    if (!accountIds.has(record.account)) {
      report(record, 'Its account no longer exists.');
      continue;
    }
    if (record.kind === 'transfer' && record.toAccount !== undefined) {
      if (!accountIds.has(record.toAccount)) {
        report(record, 'The account it transfers to no longer exists.');
        continue;
      }
      if (record.toAccount === record.account) {
        report(record, 'It transfers to the same account it comes from.');
        continue;
      }
    }
    if (record.kind !== 'transfer' && record.toAccount !== undefined) {
      report(record, 'Only transfers can have a destination account.');
      continue;
    }
    if (record.paycheck && record.kind !== 'income') {
      report(record, 'Only income can have a paycheck breakdown.');
      continue;
    }
    const schedule = toSchedule(record.schedule);
    const scheduleIssues = scheduleProblems(schedule);
    if (scheduleIssues.length > 0) {
      for (const message of scheduleIssues) report(record, message);
      continue;
    }
    const paycheck = record.paycheck ? toPaycheck(record.paycheck) : undefined;
    if (paycheck) {
      const paycheckIssues = paycheckProblems(paycheck, limits);
      if (paycheckIssues.length > 0) {
        for (const message of paycheckIssues) report(record, message);
        continue;
      }
    }
    rules.push({
      id: record.id,
      name: record.name,
      kind: record.kind,
      account: record.account,
      ...(record.toAccount !== undefined ? { toAccount: record.toAccount } : {}),
      amount: record.amount,
      schedule,
      adjust: record.adjust,
      ...(record.paused ? { paused: true } : {}),
      ...(paycheck ? { paycheck } : {}),
    });
  }

  // Entry order comes from the clock: a later edit is a later entry.
  const balanceRecords = (live(document, 'balance') as BalanceRecord[]).sort((a, b) => compareHlc(a.hlc as Hlc, b.hlc as Hlc));
  const balances: BalanceEntry[] = [];
  balanceRecords.forEach((record, sequence) => {
    if (!accountIds.has(record.account)) {
      report(record, 'Its account no longer exists.');
      return;
    }
    balances.push({
      id: record.id,
      account: record.account,
      date: date(record.date),
      amount: record.amount,
      clearedKeys: record.clearedKeys,
      sequence,
    });
  });

  const plan: Record<string, Override> = {};
  const whatIf: Record<string, Override> = {};
  for (const record of live(document, 'override') as OverrideRecord[]) {
    (record.layer === 'plan' ? plan : whatIf)[record.key] = toOverride(record);
  }

  const settings = live(document, 'settings')[0] as SettingsRecord | undefined;

  return {
    plan: {
      accounts,
      rules,
      balances,
      overrides: plan,
      ...(settings?.birthYear !== undefined ? { person: { birthYear: settings.birthYear } } : {}),
    },
    whatIf,
    problems,
  };
}
