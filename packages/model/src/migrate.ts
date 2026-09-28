/**
 * Schema migrations. See docs/PLAN.md §5.
 *
 * Each migration is a pure function from version N to N+1 over plain JSON. Loading from
 * storage, importing a file and receiving a synced record all run the same chain. Migrations
 * only go forward; data from a newer version of the app is refused, never half-read.
 */

import { type StoredDocument, SCHEMA_VERSION, documentSchema } from './records.ts';

type Json = unknown;

/** MIGRATIONS[n] upgrades a version-n document to version n+1. None yet: version 1 is the first. */
export const MIGRATIONS: Readonly<Record<number, (document: Json) => Json>> = {};

export type MigrateResult =
  | { readonly ok: true; readonly document: StoredDocument; readonly migratedFrom: number }
  | { readonly ok: false; readonly error: string };

const versionOf = (raw: Json): number | undefined => {
  if (typeof raw !== 'object' || raw === null || !('schemaVersion' in raw)) return undefined;
  const version = (raw as { schemaVersion: unknown }).schemaVersion;
  return typeof version === 'number' && Number.isInteger(version) && version >= 1 ? version : undefined;
};

/** Apply migrations from the document's version up to `current`, without validating the result. */
export function runMigrations(
  raw: Json,
  migrations: Readonly<Record<number, (document: Json) => Json>> = MIGRATIONS,
  current: number = SCHEMA_VERSION,
): { ok: true; document: Json; from: number } | { ok: false; error: string } {
  const from = versionOf(raw);
  if (from === undefined) return { ok: false, error: 'This data has no schema version, so it cannot be read safely.' };
  if (from > current) {
    return { ok: false, error: 'This data was saved by a newer version of the app. Update the app on this device, then try again.' };
  }
  let document = raw;
  for (let version = from; version < current; version++) {
    const step = migrations[version];
    if (!step) return { ok: false, error: `No upgrade path from version ${version}.` };
    document = step(document);
    if (versionOf(document) !== version + 1) return { ok: false, error: `The upgrade from version ${version} did not produce version ${version + 1}.` };
  }
  return { ok: true, document, from };
}

/** Upgrade to the current schema and validate. */
export function migrate(raw: Json): MigrateResult {
  const migrated = runMigrations(raw);
  if (!migrated.ok) return migrated;
  const parsed = documentSchema.safeParse(migrated.document);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.') || 'data'}: ${issue.message}`);
    return { ok: false, error: `The data is not valid: ${issues.join('; ')}${parsed.error.issues.length > 5 ? '; …' : ''}` };
  }
  return { ok: true, document: parsed.data, migratedFrom: migrated.from };
}
