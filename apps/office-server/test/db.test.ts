import { describe, expect, it } from 'vitest';
import { appliedVersion, migrateDown, migrateUp, openDb, type Db } from '../src/db.ts';

function tables(db: Db): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as unknown as { name: string }[];
  return rows.map((r) => r.name);
}

describe('migrations', () => {
  it('applies every migration up', () => {
    const db = openDb(':memory:');
    expect(migrateUp(db)).toBe(1);
    expect(tables(db)).toEqual(['employees', 'events', 'quota', 'schema_migrations']);
  });

  it('round-trips up → down → up', () => {
    const db = openDb(':memory:');
    migrateUp(db);
    expect(migrateDown(db, 0)).toBe(0);
    expect(tables(db)).toEqual(['schema_migrations']);
    expect(appliedVersion(db)).toBe(0);
    expect(migrateUp(db)).toBe(1);
    expect(tables(db)).toEqual(['employees', 'events', 'quota', 'schema_migrations']);
  });

  it('is a no-op when run twice in either direction', () => {
    const db = openDb(':memory:');
    migrateUp(db);
    expect(migrateUp(db)).toBe(1);
    migrateDown(db, 0);
    expect(migrateDown(db, 0)).toBe(0);
  });
});
