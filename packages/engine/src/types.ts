/**
 * The plan the engine projects. This is the engine's view of the data: plain, already
 * validated, no storage metadata. The model package maps stored records onto these types.
 */

import type { Adjustment } from './business.ts';
import type { CivilDate } from './date.ts';
import type { Cents } from './money.ts';
import type { Paycheck } from './paycheck.ts';
import type { Schedule } from './schedule.ts';

export type RuleKind = 'income' | 'expense' | 'transfer';

export interface Rule {
  readonly id: string;
  readonly name: string;
  readonly kind: RuleKind;
  /** The account money lands in (income) or leaves from (expense, transfer). */
  readonly account: string;
  /** Transfers only. Undefined means an untracked destination such as an IRA or brokerage. */
  readonly toAccount?: string;
  /** Positive cents. For an income rule with a paycheck, net pay is computed and this is ignored. */
  readonly amount: Cents;
  readonly schedule: Schedule;
  /** What happens when a date lands on a weekend or bank holiday. */
  readonly adjust: Adjustment;
  readonly paused?: boolean;
  readonly paycheck?: Paycheck;
}

/** A change to a single occurrence, keyed by occurrence key (see occurrence.ts). */
export interface Override {
  readonly skip?: boolean;
  /** Moved to this date. */
  readonly date?: CivilDate;
  /** Replaces the rule's amount (or computed net pay) for this occurrence. Positive cents. */
  readonly amount?: Cents;
}

export type Overrides = Readonly<Record<string, Override>>;

/** "My balance was X on date D" — the only confirmed number in the app. */
export interface BalanceEntry {
  readonly id: string;
  readonly account: string;
  readonly date: CivilDate;
  readonly amount: Cents;
  /** Keys of occurrences dated `date` that are already reflected in `amount`. */
  readonly clearedKeys: readonly string[];
  /** Entry order; breaks ties between entries on the same date (later wins). */
  readonly sequence: number;
}

export interface Account {
  readonly id: string;
  /** The user's cushion: days closing below this are flagged. */
  readonly threshold: Cents;
}

export interface Person {
  /** Used only to pick catch-up contribution limits (age attained by Dec 31). */
  readonly birthYear?: number;
}

export interface Plan {
  readonly accounts: readonly Account[];
  readonly rules: readonly Rule[];
  readonly balances: readonly BalanceEntry[];
  readonly overrides: Overrides;
  readonly person?: Person;
}
