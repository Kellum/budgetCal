/**
 * Occurrences: a rule's scheduled dates, adjusted for weekends and holidays, with the
 * user's single-occurrence changes applied. See docs/PLAN.md §4.4–4.6.
 */

import { type BusinessCalendar, MAX_ADJUSTMENT_DAYS, adjustToBusinessDay } from './business.ts';
import { type CivilDate, addDays, formatISODate, tryParseISODate } from './date.ts';
import type { Cents } from './money.ts';
import { occurrencesOn, scheduledDates } from './schedule.ts';
import type { Override, Overrides, Rule } from './types.ts';

export interface Occurrence {
  /** `ruleId@YYYY-MM-DD` of the scheduled date, with `#n` when a rule schedules n > 1 on one date. */
  readonly key: string;
  readonly ruleId: string;
  /** The date the schedule says, before weekend adjustment. */
  readonly scheduled: CivilDate;
  /** After weekend/holiday adjustment, before any user change. */
  readonly date: CivilDate;
}

export interface ResolvedOccurrence extends Occurrence {
  /** Where it actually lands in the projection. */
  readonly finalDate: CivilDate;
  readonly skipped: boolean;
  readonly moved: boolean;
  /** Touched by the what-if layer. */
  readonly whatIf: boolean;
  /** Set when the user changed this occurrence's amount. */
  readonly amountOverride?: Cents;
}

export function occurrenceKey(ruleId: string, scheduled: CivilDate, index = 1): string {
  return `${ruleId}@${formatISODate(scheduled)}${index > 1 ? `#${index}` : ''}`;
}

export function parseOccurrenceKey(key: string): { ruleId: string; scheduled: CivilDate; index: number } | undefined {
  const at = key.lastIndexOf('@');
  if (at <= 0) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})(?:#([2-9]|[1-9]\d+))?$/.exec(key.slice(at + 1));
  if (!match?.[1]) return undefined;
  const scheduled = tryParseISODate(match[1]);
  if (scheduled === undefined) return undefined;
  return { ruleId: key.slice(0, at), scheduled, index: match[2] ? Number(match[2]) : 1 };
}

function withKeys(rule: Rule, dates: readonly CivilDate[], calendar: BusinessCalendar): Occurrence[] {
  const out: Occurrence[] = [];
  let previous: CivilDate | undefined;
  let index = 0;
  for (const scheduled of dates) {
    index = scheduled === previous ? index + 1 : 1;
    previous = scheduled;
    out.push({
      key: occurrenceKey(rule.id, scheduled, index),
      ruleId: rule.id,
      scheduled,
      date: adjustToBusinessDay(scheduled, rule.adjust, calendar),
    });
  }
  return out;
}

/** A rule's occurrences whose adjusted date is in [from, to], ordered by date. Ignores overrides. */
export function ruleOccurrences(rule: Rule, from: CivilDate, to: CivilDate, calendar: BusinessCalendar): Occurrence[] {
  if (rule.paused) return [];
  const margin = rule.adjust === 'none' ? 0 : MAX_ADJUSTMENT_DAYS;
  const dates = scheduledDates(rule.schedule, addDays(from, -margin), addDays(to, margin));
  return withKeys(rule, dates, calendar).filter((o) => o.date >= from && o.date <= to);
}

/** The occurrence a key names, if the rule really schedules it. */
export function occurrenceForKey(rule: Rule, key: string, calendar: BusinessCalendar): Occurrence | undefined {
  const parsed = parseOccurrenceKey(key);
  if (!parsed || parsed.ruleId !== rule.id) return undefined;
  if (occurrencesOn(rule.schedule, parsed.scheduled) < parsed.index) return undefined;
  return { key, ruleId: rule.id, scheduled: parsed.scheduled, date: adjustToBusinessDay(parsed.scheduled, rule.adjust, calendar) };
}

export type OverrideLayer = 'plan' | 'whatIf';

export interface OrphanedOverride {
  readonly key: string;
  readonly layer: OverrideLayer;
  readonly reason: 'rule-missing' | 'not-scheduled';
}

/** Overrides grouped by rule, both layers, built once per projection. */
export interface OverrideIndex {
  readonly plan: Overrides;
  readonly whatIf: Overrides;
  readonly keysByRule: ReadonlyMap<string, readonly string[]>;
}

export function indexOverrides(plan: Overrides, whatIf: Overrides = {}): OverrideIndex {
  const keysByRule = new Map<string, string[]>();
  for (const key of new Set([...Object.keys(plan), ...Object.keys(whatIf)])) {
    const parsed = parseOccurrenceKey(key);
    if (!parsed) continue;
    const keys = keysByRule.get(parsed.ruleId) ?? [];
    keys.push(key);
    keysByRule.set(parsed.ruleId, keys);
  }
  return { plan, whatIf, keysByRule };
}

/** Overrides that no longer match an occurrence. They are reported, never applied, never deleted here. */
export function findOrphanedOverrides(
  rules: readonly Rule[],
  plan: Overrides,
  whatIf: Overrides,
  calendar: BusinessCalendar,
): OrphanedOverride[] {
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const orphans: OrphanedOverride[] = [];
  const check = (overrides: Overrides, layer: OverrideLayer): void => {
    for (const key of Object.keys(overrides).sort()) {
      const parsed = parseOccurrenceKey(key);
      const rule = parsed ? byId.get(parsed.ruleId) : undefined;
      if (!rule) orphans.push({ key, layer, reason: 'rule-missing' });
      else if (!occurrenceForKey(rule, key, calendar)) orphans.push({ key, layer, reason: 'not-scheduled' });
    }
  };
  check(plan, 'plan');
  check(whatIf, 'whatIf');
  return orphans;
}

function merged(index: OverrideIndex, key: string): { override: Override; whatIf: boolean } {
  const base = index.plan[key];
  const scenario = index.whatIf[key];
  return { override: { ...base, ...scenario }, whatIf: scenario !== undefined };
}

/**
 * A rule's occurrences landing in [from, to] after the user's changes: skipped ones are kept
 * (flagged), moved ones appear on their new date wherever they were originally scheduled.
 */
export function resolveOccurrences(
  rule: Rule,
  from: CivilDate,
  to: CivilDate,
  calendar: BusinessCalendar,
  index: OverrideIndex,
): ResolvedOccurrence[] {
  if (rule.paused) return [];
  const candidates = new Map<string, Occurrence>();
  for (const occurrence of ruleOccurrences(rule, from, to, calendar)) candidates.set(occurrence.key, occurrence);
  for (const key of index.keysByRule.get(rule.id) ?? []) {
    if (candidates.has(key)) continue;
    const { override } = merged(index, key);
    if (override.date === undefined || override.date < from || override.date > to) continue;
    const occurrence = occurrenceForKey(rule, key, calendar);
    if (occurrence) candidates.set(key, occurrence);
  }

  const out: ResolvedOccurrence[] = [];
  for (const occurrence of candidates.values()) {
    const { override, whatIf } = merged(index, occurrence.key);
    const finalDate = override.date ?? occurrence.date;
    if (finalDate < from || finalDate > to) continue;
    out.push({
      ...occurrence,
      finalDate,
      skipped: override.skip === true,
      moved: finalDate !== occurrence.date,
      whatIf,
      ...(override.amount !== undefined ? { amountOverride: override.amount } : {}),
    });
  }
  return out.sort((a, b) => a.finalDate - b.finalDate || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

