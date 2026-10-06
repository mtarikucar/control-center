import { describe, expect, it } from 'vitest';
import { appliedVersion, migrateDown, migrateUp, openDb, type Db } from '../src/db.ts';
import { MIGRATIONS } from '../src/migrations.ts';

const V2_TABLES = ['employees', 'events', 'notices', 'plans', 'quota', 'schema_migrations', 'tasks'];

function tables(db: Db): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as unknown as { name: string }[];
  return rows.map((r) => r.name);
}

describe('migrations', () => {
  it('applies every migration up', () => {
    const db = openDb(':memory:');
    expect(migrateUp(db)).toBe(2);
    expect(tables(db)).toEqual(V2_TABLES);
  });

  it('round-trips up → down → up', () => {
    const db = openDb(':memory:');
    migrateUp(db);
    expect(migrateDown(db, 0)).toBe(0);
    expect(tables(db)).toEqual(['schema_migrations']);
    expect(appliedVersion(db)).toBe(0);
    expect(migrateUp(db)).toBe(2);
    expect(tables(db)).toEqual(V2_TABLES);
  });

  it('is a no-op when run twice in either direction', () => {
    const db = openDb(':memory:');
    migrateUp(db);
    expect(migrateUp(db)).toBe(2);
    migrateDown(db, 0);
    expect(migrateDown(db, 0)).toBe(0);
  });
  it('v2 adds the company tables and employee columns, and v2 down restores v1 exactly', () => {
    const db = openDb(':memory:');
    migrateUp(db);
    expect(appliedVersion(db)).toBe(2);
    expect(tables(db)).toEqual(V2_TABLES);
    const cols = () => (db.prepare('PRAGMA table_info(employees)').all() as unknown as { name: string }[]).map((c) => c.name);
    expect(cols()).toEqual(expect.arrayContaining(['title', 'team', 'kind', 'reports_to']));
    expect(migrateDown(db, 1)).toBe(1);
    expect(tables(db)).toEqual(['employees', 'events', 'quota', 'schema_migrations']);
    expect(cols()).not.toContain('kind');
    expect(migrateUp(db)).toBe(2);
  });

  it('v2 keeps employees hired under v1, as members with no title', () => {
    const db = openDb(':memory:');
    migrateUp(db, MIGRATIONS.filter((m) => m.version === 1));
    db.prepare(
      `INSERT INTO employees (id, slug, name, role, model, character_id, desk_index, session_id, session_started, lifecycle, created_at)
       VALUES ('e1', 'ada', 'Ada', 'r', 'haiku', 'coder', 0, 's1', 0, 'idle', 1)`,
    ).run();
    migrateUp(db);
    expect({ ...(db.prepare('SELECT title, team, kind, reports_to FROM employees').get() as object) }).toEqual({ title: '', team: '', kind: 'member', reports_to: null });
  });
});
