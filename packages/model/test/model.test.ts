import {
  type LimitsConfigFile,
  createBusinessCalendar,
  type HolidayCalendarConfig,
  formatISODate,
  limitsFromConfig,
  parseISODate,
  project,
} from '@budgetcal/engine';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import holidays from '../../../config/holidays/us-federal-reserve.json' with { type: 'json' };
import limits2026 from '../../../config/limits/2026.json' with { type: 'json' };
import { type Hlc, compareHlc, createClock, formatHlc, isHlc, parseHlc } from '../src/hlc.ts';
import { EXPORT_FORMAT, createExport, readExport } from '../src/exportfile.ts';
import { mergeRecords } from '../src/merge.ts';
import { migrate, runMigrations } from '../src/migrate.ts';
import { toPlan } from '../src/plan.ts';
import { type StoredDocument, type StoredRecord, documentSchema, overrideId, recordKey } from '../src/records.ts';
import v1 from './fixtures/v1.json' with { type: 'json' };

const LIMITS = limitsFromConfig([limits2026 as LimitsConfigFile]);
const v1Text = JSON.stringify(v1);

describe('hybrid logical clock', () => {
  test('format, parse and string order agree', () => {
    const t = formatHlc({ millis: 1_790_604_000_000, counter: 35, device: 'phone' });
    expect(t).toBe('001790604000000:00000z:phone');
    expect(parseHlc(t)).toEqual({ millis: 1_790_604_000_000, counter: 35, device: 'phone' });
    expect(isHlc(t)).toBe(true);
    for (const bad of ['', '1:2:3', '001790604000000:00000z:', '001790604000000:00000Z:phone', '001790604000000:00000z:ph one']) {
      expect(isHlc(bad), bad).toBe(false);
    }
    expect(() => formatHlc({ millis: -1, counter: 0, device: 'x' })).toThrow(RangeError);
    expect(() => formatHlc({ millis: 0, counter: 0, device: 'a:b' })).toThrow(RangeError);
  });

  test('string order matches (millis, counter, device) order', () => {
    const parts = fc.record({
      millis: fc.integer({ min: 0, max: 2 ** 45 }),
      counter: fc.integer({ min: 0, max: 36 ** 6 - 1 }),
      device: fc.stringMatching(/^[a-z0-9]{1,8}$/),
    });
    fc.assert(
      fc.property(parts, parts, (a, b) => {
        const expected = a.millis - b.millis || a.counter - b.counter || (a.device < b.device ? -1 : a.device > b.device ? 1 : 0);
        expect(Math.sign(compareHlc(formatHlc(a), formatHlc(b)))).toBe(Math.sign(expected));
      }),
    );
  });

  test('ticks strictly increase even when the wall clock stalls or goes backwards', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 5_000 }), { minLength: 1, maxLength: 50 }), (walls) => {
        let i = 0;
        const clock = createClock('d1', () => walls[Math.min(i++, walls.length - 1)] ?? 0);
        let previous: Hlc | undefined;
        for (let n = 0; n < walls.length; n++) {
          const t = clock.tick();
          if (previous) expect(compareHlc(t, previous)).toBe(1);
          previous = t;
        }
      }),
    );
  });

  test('after receiving a remote timestamp, the next local tick is later than it', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e12 }), fc.integer({ min: 0, max: 1e12 }), fc.integer({ min: 0, max: 1000 }), (wall, remoteMillis, counter) => {
        const clock = createClock('local', () => wall);
        const remote = formatHlc({ millis: remoteMillis, counter, device: 'remote' });
        clock.receive(remote);
        expect(compareHlc(clock.tick(), remote)).toBe(1);
      }),
    );
  });

  test('a device with a clock far behind still orders its edits after what it has seen', () => {
    const laptop = createClock('laptop', () => 2_000_000);
    const phone = createClock('phone', () => 1_000); // wrong clock
    const edit = laptop.tick();
    phone.receive(edit);
    expect(compareHlc(phone.tick(), edit)).toBe(1);
  });

  test('resumes from a saved timestamp', () => {
    const clock = createClock('d1', () => 5, formatHlc({ millis: 10, counter: 3, device: 'd1' }));
    expect(clock.tick()).toBe(formatHlc({ millis: 10, counter: 4, device: 'd1' }));
    expect(() => clock.receive('nonsense' as Hlc)).toThrow(RangeError);
  });
});

describe('schema version 1 fixture (kept forever)', () => {
  test('reads, validates and converts to a plan the engine accepts', () => {
    const result = readExport(v1Text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(1);
    const { plan, whatIf, problems } = toPlan(result.document, LIMITS);
    expect(problems).toEqual([]);
    expect(plan.accounts.map((a) => a.id)).toEqual(['checking', 'savings']);
    expect(plan.rules.map((r) => r.id)).toEqual(['paycheck', 'rent', 'save', 'roth-ira', 'car-insurance', 'haircut', 'tax-refund']);
    expect(plan.person).toEqual({ birthYear: 1992 });
    expect(Object.keys(plan.overrides)).toEqual(['rent@2026-11-01']);
    expect(whatIf).toEqual({ 'save@2026-10-15': { skip: true } });

    const projection = project(plan, {
      today: parseISODate('2026-09-28'),
      end: parseISODate('2027-03-31'),
      calendar: createBusinessCalendar(holidays as HolidayCalendarConfig),
      limits: LIMITS,
      whatIf,
    });
    expect(projection.orphans).toEqual([]);
    const checking = projection.accounts.find((a) => a.account === 'checking');
    const payday = checking?.days.find((d) => formatISODate(d.date) === '2026-10-02')?.events[0];
    expect(payday?.paycheck?.net).toBe(186_555);
    const movedRent = checking?.days.find((d) => formatISODate(d.date) === '2026-11-03')?.events[0];
    expect([movedRent?.key, movedRent?.moved]).toEqual(['rent@2026-11-01', true]);
  });

  test('export → read → export is byte-identical', () => {
    const first = readExport(v1Text);
    if (!first.ok) throw new Error(first.error);
    const exported = createExport(first.document, { exportedAt: v1.exportedAt, appVersion: v1.appVersion });
    const second = readExport(exported);
    if (!second.ok) throw new Error(second.error);
    expect(createExport(second.document, { exportedAt: v1.exportedAt, appVersion: v1.appVersion })).toBe(exported);
    expect(JSON.parse(exported)).toEqual(v1);
  });
});

describe('reading export files', () => {
  const withData = (patch: (d: typeof v1) => unknown): string => JSON.stringify(patch(structuredClone(v1)));

  test.each([
    ['not JSON', '{nope', /isn't valid JSON/],
    ['not an object', '42', /isn't a backup/],
    ['another app', JSON.stringify({ format: 'other' }), /isn't a backup from this app/],
    ['a prototype backup', JSON.stringify({ app: 'cashflow-calendar', version: 1, data: {} }), /prototype/],
    ['missing data', JSON.stringify({ format: EXPORT_FORMAT, schemaVersion: 1 }), /incomplete/],
    ['mismatched versions', withData((d) => ({ ...d, schemaVersion: 2 })), /disagree/],
    ['a newer app', withData((d) => ({ ...d, schemaVersion: 99, data: { ...d.data, schemaVersion: 99 } })), /newer version/],
    ['a negative amount on a rule', withData((d) => ((d.data.records[4] as { amount: number }).amount = -5, d)), /cannot be negative/],
    ['an impossible date', withData((d) => ((d.data.records[10] as { date: string }).date = '2026-02-30', d)), /real date/],
    ['fractional cents', withData((d) => ((d.data.records[10] as { amount: number }).amount = 1.5, d)), /records\.10\.amount: Amounts must be whole cents/],
    ['an override id that does not match its key', withData((d) => ((d.data.records[12] as { id: string }).id = 'plan:other', d)), /Override id/],
    ['an unknown record type', withData((d) => (d.data.records.push({ type: 'mystery' } as never), d)), /not valid/],
  ])('refuses %s, with a plain message', (_, text, message) => {
    const result = readExport(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });

  test('deleted records are left out of exports', () => {
    const read = readExport(v1Text);
    if (!read.ok) throw new Error(read.error);
    const withDeleted: StoredDocument = {
      ...read.document,
      records: read.document.records.map((r) => (r.id === 'rent' ? { ...r, deleted: true } : r)),
    };
    const exported = JSON.parse(createExport(withDeleted, { exportedAt: 'x', appVersion: 'y' })) as { data: StoredDocument };
    expect(exported.data.records.some((r) => r.id === 'rent')).toBe(false);
  });
});

describe('migrations', () => {
  test('run in order, each producing the next version', () => {
    const steps = {
      1: (d: unknown) => ({ ...(d as object), schemaVersion: 2, trail: ['1→2'] }),
      2: (d: unknown) => ({ ...(d as object), schemaVersion: 3, trail: [...(d as { trail: string[] }).trail, '2→3'] }),
    };
    expect(runMigrations({ schemaVersion: 1 }, steps, 3)).toEqual({ ok: true, from: 1, document: { schemaVersion: 3, trail: ['1→2', '2→3'] } });
    expect(runMigrations({ schemaVersion: 2, trail: [] }, steps, 3)).toEqual({ ok: true, from: 2, document: { schemaVersion: 3, trail: ['2→3'] } });
    expect(runMigrations({ schemaVersion: 2 }, {}, 3)).toEqual({ ok: false, error: 'No upgrade path from version 2.' });
    expect(runMigrations({ schemaVersion: 1 }, { 1: (d: unknown) => d }, 2)).toEqual({
      ok: false,
      error: 'The upgrade from version 1 did not produce version 2.',
    });
    expect(runMigrations({ schemaVersion: 4 }, steps, 3)).toMatchObject({ ok: false });
    expect(migrate({ records: [] })).toEqual({ ok: false, error: 'This data has no schema version, so it cannot be read safely.' });
  });

  test('version 1 needs no steps', () => {
    const result = migrate(v1.data);
    expect(result.ok && result.migratedFrom).toBe(1);
  });
});

describe('converting to a plan', () => {
  const base = documentSchema.parse(v1.data);
  const edit = (id: string, patch: Record<string, unknown>): StoredDocument => ({
    ...base,
    records: base.records.map((r) => (r.id === id ? ({ ...r, ...patch } as StoredRecord) : r)),
  });

  test('unusable records are left out and reported, never thrown', () => {
    const doc = edit('rent', { account: 'gone' });
    const { plan, problems } = toPlan(doc, LIMITS);
    expect(plan.rules.map((r) => r.id)).not.toContain('rent');
    expect(problems).toEqual([{ record: 'rule/rent', message: 'Its account no longer exists.' }]);
  });

  test.each([
    ['transfer to a missing account', 'save', { toAccount: 'gone' }, 'The account it transfers to no longer exists.'],
    ['transfer to itself', 'save', { toAccount: 'checking' }, 'It transfers to the same account it comes from.'],
    ['destination on an expense', 'rent', { toAccount: 'savings' }, 'Only transfers can have a destination account.'],
    ['paycheck on an expense', 'rent', { paycheck: { gross: 1000, lines: [] } }, 'Only income can have a paycheck breakdown.'],
    ['end before start', 'rent', { schedule: { kind: 'monthly', start: '2026-05-01', end: '2026-01-01', interval: 1, days: [1] } }, 'End date is before the start date.'],
  ])('%s', (_, id, patch, message) => {
    expect(toPlan(edit(id, patch), LIMITS).problems).toEqual([{ record: `rule/${id}`, message }]);
  });

  test('paycheck problems are reported', () => {
    const doc = edit('paycheck', { paycheck: { gross: 1000, lines: [{ id: 'x', name: 'X', stage: 'posttax', amount: { type: 'fixed', cents: 2000 } }] } });
    expect(toPlan(doc, LIMITS).problems).toEqual([{ record: 'rule/paycheck', message: 'Deductions and taxes add up to more than gross pay.' }]);
  });

  test('deleted records are ignored; a deleted account takes its balances with it', () => {
    const doc: StoredDocument = {
      ...base,
      records: base.records.map((r) => (r.id === 'savings' ? { ...r, deleted: true } : r)),
    };
    const { plan, problems } = toPlan(doc, LIMITS);
    expect(plan.accounts.map((a) => a.id)).toEqual(['checking']);
    expect(problems.map((p) => p.record)).toEqual(['rule/save', 'balance/b-2']);
  });

  test('balance entry order follows the clock, not the list order', () => {
    const doc: StoredDocument = {
      ...base,
      records: [
        ...base.records,
        { type: 'balance', id: 'late', hlc: '001790604999999:000000:phone' as Hlc, deleted: false, account: 'checking', date: '2026-09-28', amount: 1, clearedKeys: [] },
        { type: 'balance', id: 'early', hlc: '001790604000001:000000:phone' as Hlc, deleted: false, account: 'checking', date: '2026-09-28', amount: 2, clearedKeys: [] },
      ],
    };
    const sequences = Object.fromEntries(toPlan(doc).plan.balances.map((b) => [b.id, b.sequence]));
    expect((sequences.late ?? 0) > (sequences.early ?? 0)).toBe(true);
    expect((sequences.early ?? 0) > (sequences['b-1'] ?? 0)).toBe(true);
  });
});

describe('merging', () => {
  const rec = (id: string, millis: number, device: string, extra: Partial<StoredRecord> = {}): StoredRecord =>
    ({
      type: 'account',
      id,
      hlc: formatHlc({ millis, counter: 0, device }),
      deleted: false,
      name: `${id}@${millis}`,
      threshold: 0,
      order: 0,
      ...extra,
    }) as StoredRecord;

  test('latest edit wins; the loser is reported', () => {
    const phone = rec('a', 10, 'phone');
    const laptop = rec('a', 20, 'laptop');
    const { records, replaced } = mergeRecords([phone], [laptop]);
    expect(records).toEqual([laptop]);
    expect(replaced).toEqual([phone]);
  });

  test('a later deletion beats an earlier edit, and an older edit cannot resurrect it', () => {
    const deleted = rec('a', 30, 'phone', { deleted: true });
    expect(mergeRecords([rec('a', 20, 'laptop')], [deleted]).records).toEqual([deleted]);
    expect(mergeRecords([deleted], [rec('a', 25, 'laptop')]).records).toEqual([deleted]);
  });

  test('identical duplicates are not reported as replaced', () => {
    const a = rec('a', 10, 'phone');
    expect(mergeRecords([a], [structuredClone(a)]).replaced).toEqual([]);
  });

  const recordArb = fc
    .record({
      id: fc.constantFrom('a', 'b', 'c'),
      millis: fc.integer({ min: 0, max: 50 }),
      counter: fc.integer({ min: 0, max: 3 }),
      device: fc.constantFrom('phone', 'laptop', 'tablet'),
      deleted: fc.boolean(),
      threshold: fc.integer({ min: 0, max: 5 }),
    })
    .map(
      ({ id, millis, counter, device, deleted, threshold }): StoredRecord => ({
        type: 'account',
        id,
        hlc: formatHlc({ millis, counter, device }),
        deleted,
        name: id,
        threshold,
        order: 0,
      }),
    );
  const setArb = fc.array(recordArb, { maxLength: 12 });

  test('converges regardless of order, grouping or duplication', () => {
    fc.assert(
      fc.property(setArb, setArb, setArb, fc.nat(), (x, y, z, seed) => {
        const all = [...x, ...y, ...z];
        const shuffled = [...all, ...all.slice(0, seed % (all.length + 1))]
          .map((r, i) => ({ r, k: (i * 7919 + seed) % 104729 }))
          .sort((a, b) => a.k - b.k)
          .map(({ r }) => r);
        const direct = mergeRecords(all).records;
        expect(mergeRecords(shuffled).records).toEqual(direct);
        expect(mergeRecords(mergeRecords(x, y).records, z).records).toEqual(direct);
        expect(mergeRecords(x, mergeRecords(y, z).records).records).toEqual(direct);
        expect(mergeRecords(direct, direct).records).toEqual(direct);
        // One record per type/id, and each is the latest version seen.
        for (const record of direct) {
          const versions = all.filter((r) => recordKey(r) === recordKey(record));
          for (const version of versions) expect(compareHlc(record.hlc as Hlc, version.hlc as Hlc)).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 500 },
    );
  });
});

test('override ids are deterministic so two devices converge on one record', () => {
  expect(overrideId('plan', 'rent@2026-11-01')).toBe('plan:rent@2026-11-01');
});
