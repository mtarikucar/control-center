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
const V4_TABLES = [...V3_TABLES, 'constitution', 'spend'].sort();
const V5_TABLES = [...V4_TABLES, 'proposals'].sort();
const V9_TABLES = [...V5_TABLES, 'company_state', 'goals'].sort();
const V10_TABLES = [...V9_TABLES, 'schedules'].sort();
const columns = (db: Db, table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map((c) => c.name);
const upTo = (version: number) => MIGRATIONS.filter((m) => m.version <= version);

describe('migrations', () => {
  it('applies every migration up', () => {
    const db = openDb(':memory:');
    expect(migrateUp(db)).toBe(12);
    expect(tables(db)).toEqual(V10_TABLES);
  });

  it('numbers the migrations 1, 2, 3 … with no gap and no repeat (a merge that numbers two alike or skips one fails here)', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
  });

  it('round-trips up → down → up', () => {
    const db = openDb(':memory:');
    migrateUp(db);
    expect(migrateDown(db, 0)).toBe(0);
    expect(tables(db)).toEqual(['schema_migrations']);
    expect(appliedVersion(db)).toBe(0);
    expect(migrateUp(db)).toBe(12);
    expect(tables(db)).toEqual(V10_TABLES);
  });

  it('is a no-op when run twice in either direction', () => {
    const db = openDb(':memory:');
    migrateUp(db);
    expect(migrateUp(db)).toBe(12);
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
    migrateUp(db, upTo(3));
    expect(tables(db)).toEqual(V3_TABLES);
    expect({ ...(db.prepare('SELECT kind FROM tasks').get() as object) }).toEqual({ kind: 'work' });
    expect(migrateDown(db, 2)).toBe(2);
    expect(tables(db)).toEqual(V2_TABLES);
    expect(columns(db, 'tasks')).not.toContain('kind');
    expect(db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toMatchObject({ n: 1 });
    expect(migrateUp(db, upTo(3))).toBe(3);
  });

  it('v3 keeps the notes index in step with the notes table', () => {
    const db = openDb(':memory:');
    migrateUp(db);
    db.prepare(
      "INSERT INTO notes (ts, by_id, title, text, tags, source, ft_title, ft_text, ft_tags) VALUES (1, 'e1', 'Seslendirme', 'ElevenLabs Türkçe iyi', '[]', NULL, 'seslendirme', 'elevenlabs turkce iyi', '')",
    ).run();
    const hits = (word: string) => db.prepare('SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?').all(word).length;
    expect(hits('turkce')).toBe(1);
    db.prepare("UPDATE notes SET text = 'Polly', ft_text = 'polly'").run();
    expect(hits('turkce')).toBe(0);
    expect(hits('polly')).toBe(1);
    db.prepare('DELETE FROM notes').run();
    expect(hits('polly')).toBe(0);
  });

  it('v4 adds the constitution, spending and task usage; v4 down restores v3 and keeps tasks', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(3));
    db.prepare(
      `INSERT INTO tasks (id, plan_id, title, description, done, requester, assignee, priority, depends_on, status, chain_depth, created_at)
       VALUES ('t1', NULL, 'eski', '', '[]', 'owner', 'e1', 3, '[]', 'waiting', 0, 1)`,
    ).run();
    migrateUp(db, upTo(4));
    expect(tables(db)).toEqual(V4_TABLES);
    expect({ ...(db.prepare('SELECT cost_usd, tokens FROM tasks').get() as object) }).toEqual({ cost_usd: 0, tokens: 0 });
    expect(migrateDown(db, 3)).toBe(3);
    expect(tables(db)).toEqual(V3_TABLES);
    expect(columns(db, 'tasks')).not.toContain('cost_usd');
    expect(db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toMatchObject({ n: 1 });
    expect(migrateUp(db, upTo(4))).toBe(4);
  });

  it('v5 adds proposals and the approved snapshot of plans; v5 down restores v4 and keeps plans', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(4));
    db.prepare(
      `INSERT INTO plans (id, title, goal, approach, people, steps, risks, status, version, proposed_by, created_at, updated_at)
       VALUES ('p1', 'P', 'g', 'a', '', '[]', '', 'approved', 1, 'c', 1, 1)`,
    ).run();
    migrateUp(db, upTo(5));
    expect(tables(db)).toEqual(V5_TABLES);
    expect({ ...(db.prepare('SELECT approved_snapshot FROM plans').get() as object) }).toEqual({ approved_snapshot: null });
    expect(migrateDown(db, 4)).toBe(4);
    expect(tables(db)).toEqual(V4_TABLES);
    expect(columns(db, 'plans')).not.toContain('approved_snapshot');
    expect(db.prepare('SELECT COUNT(*) AS n FROM plans').get()).toMatchObject({ n: 1 });
    expect(migrateUp(db, upTo(5))).toBe(5);
  });

  it('v6 gives notices a kind and a topic, older ones staying decisions; v6 down restores v5 and keeps them', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(5));
    db.prepare("INSERT INTO notices (employee_id, text, created_at, delivered_at) VALUES ('c', 'eski not', 1, NULL)").run();
    migrateUp(db, upTo(6));
    expect({ ...(db.prepare('SELECT kind, topic, text FROM notices').get() as object) }).toEqual({ kind: 'decision', topic: '', text: 'eski not' });
    expect(migrateDown(db, 5)).toBe(5);
    expect(columns(db, 'notices')).toEqual(['id', 'employee_id', 'text', 'created_at', 'delivered_at']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM notices').get()).toMatchObject({ n: 1 });
    expect(migrateUp(db, upTo(6))).toBe(6);
  });

  it('v7 gives tasks a difficulty, none for older ones; v7 down restores v6 and keeps them', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(6));
    db.prepare(
      `INSERT INTO tasks (id, plan_id, title, description, done, requester, assignee, priority, depends_on, status, chain_depth, created_at)
       VALUES ('t1', NULL, 'eski', '', '[]', 'owner', 'e1', 3, '[]', 'waiting', 0, 1)`,
    ).run();
    migrateUp(db);
    expect({ ...(db.prepare('SELECT difficulty FROM tasks').get() as object) }).toEqual({ difficulty: null });
    expect(migrateDown(db, 6)).toBe(6);
    expect(columns(db, 'tasks')).not.toContain('difficulty');
    expect(db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toMatchObject({ n: 1 });
    expect(migrateUp(db, upTo(7))).toBe(7);
  });

  it('v8 gives plans a method and tasks a reviewer, a reviewed task and a round; v8 down restores v7 and keeps them', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(7));
    db.prepare(
      `INSERT INTO tasks (id, plan_id, title, description, done, requester, assignee, priority, depends_on, status, chain_depth, created_at)
       VALUES ('t1', NULL, 'eski', '', '[]', 'owner', 'e1', 3, '[]', 'waiting', 0, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO plans (id, title, goal, approach, people, steps, risks, status, version, proposed_by, created_at, updated_at)
       VALUES ('p1', 'eski plan', 'g', 'a', '', '[]', '', 'draft', 1, 'c', 1, 1)`,
    ).run();
    migrateUp(db);
    expect({ ...(db.prepare('SELECT reviewer, review_of, round FROM tasks').get() as object) }).toEqual({ reviewer: null, review_of: null, round: 0 });
    expect({ ...(db.prepare('SELECT method FROM plans').get() as object) }).toEqual({ method: null });
    expect(migrateDown(db, 7)).toBe(7);
    expect(columns(db, 'tasks')).not.toContain('reviewer');
    expect(columns(db, 'tasks')).not.toContain('round');
    expect(columns(db, 'plans')).not.toContain('method');
    expect(db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toMatchObject({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM plans').get()).toMatchObject({ n: 1 });
    expect(migrateDown(db, 7)).toBe(7);
    expect(migrateUp(db, upTo(8))).toBe(8);
  });

  it('v9 adds goals and the company state, and a plan’s goal and who started it; v9 down restores v8 and keeps plans', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(8));
    db.prepare(
      `INSERT INTO plans (id, title, goal, approach, people, steps, risks, status, version, proposed_by, created_at, updated_at)
       VALUES ('p1', 'eski plan', 'g', 'a', '', '[]', '', 'approved', 1, 'c', 1, 1)`,
    ).run();
    migrateUp(db);
    expect(tables(db)).toContain('goals');
    expect(tables(db)).toContain('company_state');
    expect({ ...(db.prepare('SELECT goal_id, approved_by FROM plans').get() as object) }).toEqual({ goal_id: null, approved_by: null });
    expect(migrateDown(db, 8)).toBe(8);
    expect(tables(db)).not.toContain('goals');
    expect(tables(db)).not.toContain('company_state');
    expect(columns(db, 'plans')).not.toContain('goal_id');
    expect(columns(db, 'plans')).not.toContain('approved_by');
    expect(db.prepare('SELECT COUNT(*) AS n FROM plans').get()).toMatchObject({ n: 1 });
    expect(migrateDown(db, 8)).toBe(8);
    expect(migrateUp(db, upTo(9))).toBe(9);
  });

  it('v10 gives tasks their time fields and adds schedules; v10 down restores v9 and keeps tasks', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(9));
    db.prepare(
      `INSERT INTO tasks (id, plan_id, title, description, done, requester, assignee, priority, depends_on, status, chain_depth, created_at)
       VALUES ('t1', NULL, 'eski', '', '[]', 'owner', 'e1', 3, '[]', 'waiting', 0, 1)`,
    ).run();
    migrateUp(db);
    expect(tables(db)).toContain('schedules');
    expect({ ...(db.prepare('SELECT not_before, due_at, parked_reason, park_count, schedule_id, overdue_notified FROM tasks').get() as object) }).toEqual({
      not_before: null, due_at: null, parked_reason: null, park_count: 0, schedule_id: null, overdue_notified: 0,
    });
    expect(migrateDown(db, 9)).toBe(9);
    expect(tables(db)).not.toContain('schedules');
    for (const col of ['not_before', 'due_at', 'parked_reason', 'park_count', 'schedule_id', 'overdue_notified']) expect(columns(db, 'tasks')).not.toContain(col);
    expect(db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toMatchObject({ n: 1 });
    expect(migrateDown(db, 9)).toBe(9);
    expect(migrateUp(db, upTo(10))).toBe(10);
  });

  it('v11 gives tasks the time of their last reminder, none for older ones; v11 down restores v10 exactly and keeps them', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(10));
    const before = columns(db, 'tasks');
    db.prepare(
      `INSERT INTO tasks (id, plan_id, title, description, done, requester, assignee, priority, depends_on, status, chain_depth, nudged, created_at, started_at)
       VALUES ('t1', NULL, 'eski', '', '[]', 'owner', 'e1', 3, '[]', 'in_progress', 0, 1, 1, 2)`,
    ).run();
    migrateUp(db, upTo(11));
    expect(appliedVersion(db)).toBe(11);
    expect({ ...(db.prepare('SELECT nudged, nudged_at FROM tasks').get() as object) }).toEqual({ nudged: 1, nudged_at: null });
    expect(migrateDown(db, 10)).toBe(10);
    expect(columns(db, 'tasks')).toEqual(before);
    expect({ ...(db.prepare('SELECT id, status, nudged FROM tasks').get() as object) }).toEqual({ id: 't1', status: 'in_progress', nudged: 1 });
    expect(migrateDown(db, 10)).toBe(10);
    expect(migrateUp(db, upTo(11))).toBe(11);
    expect(columns(db, 'tasks')).toContain('nudged_at');
  });

  it('v12 gives goals their KPIs, none for older ones; v12 down restores v11 exactly and keeps the goals', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(11));
    const before = columns(db, 'goals');
    db.prepare("INSERT INTO goals (id, title, why, done, status, created_by, created_at) VALUES ('g1', 'eski', 'neden', '[\"d\"]', 'active', 'c', 1)").run();
    migrateUp(db);
    expect(appliedVersion(db)).toBe(12);
    expect({ ...(db.prepare('SELECT title, done, kpis FROM goals').get() as object) }).toEqual({ title: 'eski', done: '["d"]', kpis: '[]' });
    expect(migrateDown(db, 11)).toBe(11);
    expect(columns(db, 'goals')).toEqual(before);
    expect({ ...(db.prepare('SELECT id, title FROM goals').get() as object) }).toEqual({ id: 'g1', title: 'eski' });
    expect(migrateUp(db)).toBe(12);
  });
});
