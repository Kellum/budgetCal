/**
 * The export file: a backup and the way to move data between devices without sync.
 * See docs/PLAN.md §5.
 *
 * { format: "budgetcal", schemaVersion, exportedAt, appVersion, data }
 *
 * Deleted records are left out: an export is a clean snapshot, not a sync log.
 */

import { migrate } from './migrate.ts';
import { type StoredDocument, SCHEMA_VERSION } from './records.ts';

export const EXPORT_FORMAT = 'budgetcal';

export interface ExportEnvelope {
  readonly format: typeof EXPORT_FORMAT;
  readonly schemaVersion: number;
  /** ISO 8601 timestamp supplied by the caller. */
  readonly exportedAt: string;
  readonly appVersion: string;
  readonly data: StoredDocument;
}

export function createExport(document: StoredDocument, info: { exportedAt: string; appVersion: string }): string {
  const envelope: ExportEnvelope = {
    format: EXPORT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: info.exportedAt,
    appVersion: info.appVersion,
    data: { ...document, records: document.records.filter((r) => !r.deleted) },
  };
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

export type ReadExportResult =
  | { readonly ok: true; readonly document: StoredDocument; readonly migratedFrom: number; readonly exportedAt: string }
  | { readonly ok: false; readonly error: string };

export function readExport(text: string): ReadExportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file isn't a backup: it isn't valid JSON." };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: "This file isn't a backup." };
  const envelope = raw as Partial<Record<keyof ExportEnvelope | 'app', unknown>>;
  if (envelope.app === 'cashflow-calendar') {
    return { ok: false, error: 'This is a backup from the prototype. Importing prototype backups is not supported yet.' };
  }
  if (envelope.format !== EXPORT_FORMAT) return { ok: false, error: "This file isn't a backup from this app." };
  if (typeof envelope.schemaVersion !== 'number' || typeof envelope.data !== 'object' || envelope.data === null) {
    return { ok: false, error: 'This backup is incomplete.' };
  }
  if ((envelope.data as { schemaVersion?: unknown }).schemaVersion !== envelope.schemaVersion) {
    return { ok: false, error: 'This backup is inconsistent: its version numbers disagree.' };
  }
  const result = migrate(envelope.data);
  if (!result.ok) return result;
  return { ...result, exportedAt: typeof envelope.exportedAt === 'string' ? envelope.exportedAt : '' };
}
