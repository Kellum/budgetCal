/**
 * Merging records from two devices: for each record, the edit with the latest clock timestamp
 * wins, deletions included. Merging is commutative, associative and idempotent, so devices
 * converge whatever order changes arrive in. See docs/PLAN.md §7.
 *
 * Versions that lose are returned so the app can keep them in "changed on another device"
 * for 30 days. Nothing disappears silently.
 */

import { compareHlc, type Hlc } from './hlc.ts';
import { type StoredRecord, recordKey } from './records.ts';

export interface MergeResult {
  /** One record per type/id, sorted by type/id. */
  readonly records: readonly StoredRecord[];
  /** Versions that were replaced by a later edit. Identical duplicates are not reported. */
  readonly replaced: readonly StoredRecord[];
}

/** Total order on versions of one record: clock first, then content as a deterministic tie-break. */
function later(a: StoredRecord, b: StoredRecord): StoredRecord {
  const byClock = compareHlc(a.hlc as Hlc, b.hlc as Hlc);
  if (byClock !== 0) return byClock > 0 ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

export function mergeRecords(...sets: readonly (readonly StoredRecord[])[]): MergeResult {
  const winners = new Map<string, StoredRecord>();
  const replaced: StoredRecord[] = [];
  for (const record of sets.flat()) {
    const key = recordKey(record);
    const current = winners.get(key);
    if (!current) {
      winners.set(key, record);
      continue;
    }
    const winner = later(current, record);
    const loser = winner === current ? record : current;
    if (JSON.stringify(loser) !== JSON.stringify(winner)) replaced.push(loser);
    winners.set(key, winner);
  }
  const records = [...winners.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, r]) => r);
  return { records, replaced };
}
