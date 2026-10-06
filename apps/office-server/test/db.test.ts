import { describe, expect, it } from 'vitest';
import { appliedVersion, migrateDown, migrateUp, openDb, type Db } from '../src/db.ts';
import { MIGRATIONS } from '../src/migrations.ts';

const V1_TABLES = ['employees', 'events', 'quota', 'schema_migrations'];
const V2_TABLES = ['employees', 'events', 'notices', 'plans', 'quota', 'schema_migrations', 'tasks'];
const V3_TABLES = [
  'decisions', 'employee_notes', 'employees', 'events', 'notes', 'notes_fts', 'notes_fts_config', 'notes_fts_data', 'notes_fts_docsize',
  'notes_fts_idx', 'notices', 'plans', 'playbook', 'quota', 'schema_migrations', 'tasks',
];

function tables(db: Db): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as unknown as { name: string }[];
  return rows.map((r) => r.name);
}
const columns = (db: Db, table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map((c) => c.name);
const upTo = (version: number) => MIGRATIONS.filter((m) => m.version <= version);

describe('migrations', () => {
  it('applies every migration up', () => {
    const db = openDb(':memory:');
    expect(migrateUp(db)).toBe(3);
    expect(tables(db)).toEqual(V3_TABLES);
  });

  it('round-trips up → down → up', () => {
    const db = openDb(':memory:');
    migrateUp(db);
    expect(migrateDown(db, 0)).toBe(0);
    expect(tables(db)).toEqual(['schema_migrations']);
    expect(appliedVersion(db)).toBe(0);
    expect(migrateUp(db)).toBe(3);
    expect(tables(db)).toEqual(V3_TABLES);
  });

  it('is a no-op when run twice in either direction', () => {
    const db = openDb(':memory:');
    migrateUp(db);
    expect(migrateUp(db)).toBe(3);
    migrateDown(db, 0);
    expect(migrateDown(db, 0)).toBe(0);
  });

  it('v2 adds the company tables and employee columns, and v2 down restores v1 exactly', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(2));
    expect(appliedVersion(db)).toBe(2);
    expect(tables(db)).toEqual(V2_TABLES);
    expect(columns(db, 'employees')).toEqual(expect.arrayContaining(['title', 'team', 'kind', 'reports_to']));
    expect(migrateDown(db, 1)).toBe(1);
    expect(tables(db)).toEqual(V1_TABLES);
    expect(columns(db, 'employees')).not.toContain('kind');
  });

  it('v2 keeps employees hired under v1, as members with no title', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(1));
    db.prepare(
      `INSERT INTO employees (id, slug, name, role, model, character_id, desk_index, session_id, session_started, lifecycle, created_at)
       VALUES ('e1', 'ada', 'Ada', 'r', 'haiku', 'coder', 0, 's1', 0, 'idle', 1)`,
    ).run();
    migrateUp(db);
    expect({ ...(db.prepare('SELECT title, team, kind, reports_to FROM employees').get() as object) }).toEqual({ title: '', team: '', kind: 'member', reports_to: null });
  });

  it('v3 adds the memory tables and the task kind; v3 down restores v2 exactly and keeps tasks', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(2));
    db.prepare(
      `INSERT INTO tasks (id, plan_id, title, description, done, requester, assignee, priority, depends_on, status, chain_depth, created_at)
       VALUES ('t1', NULL, 'eski', '', '[]', 'owner', 'e1', 3, '[]', 'waiting', 0, 1)`,
    ).run();
    migrateUp(db);
    expect(tables(db)).toEqual(V3_TABLES);
    expect({ ...(db.prepare('SELECT kind FROM tasks').get() as object) }).toEqual({ kind: 'work' });
    expect(migrateDown(db, 2)).toBe(2);
    expect(tables(db)).toEqual(V2_TABLES);
    expect(columns(db, 'tasks')).not.toContain('kind');
    expect(db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toMatchObject({ n: 1 });
    expect(migrateUp(db)).toBe(3);
  });

  it('v3 keeps the notes index in step with the notes table', () => {
    const db = openDb(':memory:');
    migrateUp(db);
    db.prepare("INSERT INTO notes (ts, by_id, title, text, tags, source) VALUES (1, 'e1', 'Seslendirme', 'ElevenLabs Türkçe iyi', '[]', NULL)").run();
    const hits = () => db.prepare("SELECT rowid FROM notes_fts WHERE notes_fts MATCH 'turkce'").all().length;
    expect(hits()).toBe(1);
    db.prepare('DELETE FROM notes').run();
    expect(hits()).toBe(0);
  });
});
