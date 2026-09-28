/**
 * Stored records, schema version 1. See docs/PLAN.md §5.
 *
 * Everything the app stores is a flat list of records. Each record has a stable id, the hybrid
 * logical clock timestamp of its last edit (which also names the device that made it), and a
 * deletion marker instead of being removed. That is exactly the shape encrypted sync needs, so
 * sync can be added without a migration.
 *
 * Dates are YYYY-MM-DD strings and money is integer cents, so exported files are readable.
 */

import { tryParseISODate } from '@budgetcal/engine';
import { z } from 'zod';
import { isHlc } from './hlc.ts';

export const SCHEMA_VERSION = 1;

const isoDate = z.string().refine((s) => tryParseISODate(s) !== undefined, 'Expected a real date as YYYY-MM-DD');
const cents = z.number().int({ error: 'Amounts must be whole cents' }).refine(Number.isSafeInteger, 'Amount is too large');
const nonNegativeCents = cents.refine((n) => n >= 0, 'Amount cannot be negative');
const id = z.string().min(1).max(100).regex(/^[^@:\s]+$/, 'Ids cannot contain @, : or spaces');
const hlc = z.string().refine(isHlc, 'Expected a clock timestamp');

const meta = { id, hlc, deleted: z.boolean() };

const dayOfMonth = z.union([z.number().int().min(1).max(31), z.literal('last')]);
const bounds = {
  start: isoDate,
  end: isoDate.optional(),
  count: z.number().int().min(1).max(5000).optional(),
  interval: z.number().int().min(1).max(99),
};

export const scheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), start: isoDate }),
  z.object({ kind: z.literal('weekly'), ...bounds }),
  z.object({ kind: z.literal('monthly'), ...bounds, days: z.array(dayOfMonth).min(1).max(4) }),
  z.object({
    kind: z.literal('monthly-weekday'),
    ...bounds,
    nth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal('last')]),
    weekday: z.number().int().min(0).max(6),
  }),
  z.object({ kind: z.literal('yearly'), ...bounds, month: z.number().int().min(1).max(12), day: dayOfMonth }),
]);

const lineAmount = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fixed'), cents: nonNegativeCents }),
  z.object({
    type: z.literal('percent'),
    bp: z.number().int().min(0).max(10000),
    of: z.enum(['gross', 'income', 'fica']),
  }),
]);

export const payLineSchema = z.object({
  id,
  name: z.string().max(80),
  stage: z.enum(['pretax', 'tax', 'posttax']),
  amount: lineAmount,
  reduces: z.array(z.enum(['income', 'fica'])).max(2).optional(),
  limit: z.string().max(40).optional(),
  wageCap: z.string().max(40).optional(),
  ytd: z.object({ asOf: isoDate, amount: nonNegativeCents }).optional(),
});

export const paycheckSchema = z.object({
  gross: nonNegativeCents,
  lines: z.array(payLineSchema).max(40),
});

export const accountRecord = z.object({
  type: z.literal('account'),
  ...meta,
  name: z.string().min(1).max(80),
  /** The cushion: days closing below this are flagged. */
  threshold: cents,
  order: z.number().int(),
});

export const ruleRecord = z.object({
  type: z.literal('rule'),
  ...meta,
  name: z.string().min(1).max(120),
  kind: z.enum(['income', 'expense', 'transfer']),
  account: id,
  toAccount: id.optional(),
  amount: nonNegativeCents,
  schedule: scheduleSchema,
  adjust: z.enum(['before', 'after', 'none']),
  paused: z.boolean(),
  paycheck: paycheckSchema.optional(),
  note: z.string().max(1000).optional(),
});

export const balanceRecord = z.object({
  type: z.literal('balance'),
  ...meta,
  account: id,
  date: isoDate,
  amount: cents,
  clearedKeys: z.array(z.string().max(160)).max(200),
});

export const overrideRecord = z
  .object({
    type: z.literal('override'),
    ...meta,
    id: z.string().min(1).max(200),
    layer: z.enum(['plan', 'whatIf']),
    /** Occurrence key, `ruleId@YYYY-MM-DD`. */
    key: z.string().min(1).max(160),
    skip: z.boolean().optional(),
    date: isoDate.optional(),
    amount: nonNegativeCents.optional(),
  })
  // One record per layer and occurrence, so two devices changing the same occurrence converge
  // on one record instead of creating duplicates.
  .refine((r) => r.id === overrideId(r.layer, r.key), 'Override id must be "<layer>:<key>"');

export const settingsRecord = z.object({
  type: z.literal('settings'),
  ...meta,
  id: z.literal('settings'),
  birthYear: z.number().int().min(1900).max(2100).optional(),
  horizonDays: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]),
});

export const recordSchema = z.discriminatedUnion('type', [accountRecord, ruleRecord, balanceRecord, overrideRecord, settingsRecord]);

export const documentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  records: z.array(recordSchema).max(20_000),
});

export type AccountRecord = z.infer<typeof accountRecord>;
export type RuleRecord = z.infer<typeof ruleRecord>;
export type BalanceRecord = z.infer<typeof balanceRecord>;
export type OverrideRecord = z.infer<typeof overrideRecord>;
export type SettingsRecord = z.infer<typeof settingsRecord>;
export type StoredRecord = z.infer<typeof recordSchema>;
export type StoredDocument = z.infer<typeof documentSchema>;
export type StoredSchedule = z.infer<typeof scheduleSchema>;
export type StoredPaycheck = z.infer<typeof paycheckSchema>;

export function overrideId(layer: 'plan' | 'whatIf', key: string): string {
  return `${layer}:${key}`;
}

/** Records are identified by type and id together. */
export function recordKey(record: Pick<StoredRecord, 'type' | 'id'>): string {
  return `${record.type}/${record.id}`;
}
