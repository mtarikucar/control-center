import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, type Migration } from './migrations.ts';

export type Db = DatabaseSync;

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

export function appliedVersion(db: Db): number {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)',
  );
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as unknown as { v: number | null };
  return row.v ?? 0;
}

function inTransaction(db: Db, work: () => void): void {
  db.exec('BEGIN');
  try {
    work();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** The database's migrations are not the code's (e.g. two branches numbered theirs alike): nothing may run on it. */
export class MigrationOrderError extends Error {}

/**
 * Every version the database has applied must be the code's migration of that number, by name, and every migration of
 * the code below the last applied one must have been applied. Otherwise a merge that numbered two migrations alike
 * (B6 and B26 both 16) would be skipped silently, as migrateUp runs only versions above the last applied, or migrateDown
 * would run another migration's down.
 */
export function checkApplied(db: Db, migrations: Migration[] = MIGRATIONS): void {
  const current = appliedVersion(db);
  const rows = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() as unknown as Array<{ version: number; name: string }>;
  const code = new Map(migrations.map((m) => [m.version, m.name]));
  for (const r of rows) {
    const name = code.get(r.version);
    if (name !== r.name) throw new MigrationOrderError(`v${r.version} canlıda “${r.name}”, kodda ${name === undefined ? 'yok' : `“${name}”`}: göç sırası bozuk.`);
  }
  const done = new Set(rows.map((r) => r.version));
  const skipped = migrations.filter((m) => m.version < current && !done.has(m.version)).sort((a, b) => a.version - b.version)[0];
  if (skipped) {
    throw new MigrationOrderError(`v${skipped.version} kodda “${skipped.name}” ama canlıda uygulanmamış; sonraki bir göç uygulandığı için hiç çalışmazdı: göç sırası bozuk.`);
  }
}

export function migrateUp(db: Db, migrations: Migration[] = MIGRATIONS): number {
  checkApplied(db, migrations);
  const current = appliedVersion(db);
  for (const m of migrations.filter((x) => x.version > current).sort((a, b) => a.version - b.version)) {
    inTransaction(db, () => {
      db.exec(m.up);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, Date.now());
    });
  }
  return appliedVersion(db);
}

export function migrateDown(db: Db, target: number, migrations: Migration[] = MIGRATIONS): number {
  checkApplied(db, migrations);
  const current = appliedVersion(db);
  const toRevert = migrations.filter((m) => m.version > target && m.version <= current).sort((a, b) => b.version - a.version);
  for (const m of toRevert) {
    inTransaction(db, () => {
      db.exec(m.down);
      db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(m.version);
    });
  }
  return appliedVersion(db);
}
