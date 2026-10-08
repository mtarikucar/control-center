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
const V13_TABLES = [...V10_TABLES, 'company_profile'].sort();
const V14_TABLES = [...V13_TABLES, 'onboarding', 'onboarding_rounds'].sort();
const V15_TABLES = [...V14_TABLES, 'integrations'].sort();
const V19_TABLES = [...V15_TABLES, 'blueprints', 'blueprint_steps'].sort();
// B26 (feat/kpi-readings): 16 on its own branch, 19 on core 4, 20 on the main that has the management cycle's 16 (decision 18591573).
const V20_TABLES = [...V19_TABLES, 'kpi_readings'].sort();
const V21_TABLES = [...V20_TABLES, 'search_fts', 'search_fts_config', 'search_fts_data', 'search_fts_docsize', 'search_fts_idx', 'search_index'].sort();
const V22_TABLES = [...V21_TABLES, 'approvals'].sort();
const columns = (db: Db, table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map((c) => c.name);
const upTo = (version: number) => MIGRATIONS.filter((m) => m.version <= version);

describe('migrations', () => {
  it('applies every migration up', () => {
    const db = openDb(':memory:');
    expect(migrateUp(db)).toBe(22);
    expect(tables(db)).toEqual(V22_TABLES);
  });

  it('review (Kerem): the applied migrations keep the names the live database has (checkApplied compares them; renaming one stops the office)', () => {
    // From the live database (VACUUM INTO copy, 2026-10-08, task 57b8d3f2): schema_migrations 1–15.
    expect(MIGRATIONS.slice(0, 15).map((m) => `${m.version}:${m.name}`)).toEqual([
      '1:core tables',
      '2:company: roles, plans, tasks, notices',
      '3:company memory: decisions, playbook, notes, employee files, task kind',
      '4:budget: constitution, spending, task usage',
      '5:proposals, approved plan snapshots',
      '6:notice kinds and topics',
      '7:task difficulty',
      '8:coordination craft: plan method, task review',
      '9:coordinator as project manager: goals, company state, a plan’s goal',
      '10:office scheduler: task times, parked status, schedules',
      '11:stall recovery: when a task was last reminded',
      '12:goal KPIs',
      '13:company profile: sections, one row per version',
      "14:onboarding: the owner's sentence and the rounds of questions",
      '15:integration registry: what the coordinator records by hand',
    ]);
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
    expect(migrateUp(db)).toBe(22);
    expect(tables(db)).toEqual(V22_TABLES);
  });

  it('is a no-op when run twice in either direction', () => {
    const db = openDb(':memory:');
    migrateUp(db);
    expect(migrateUp(db)).toBe(22);
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
    migrateUp(db, upTo(12));
    expect(appliedVersion(db)).toBe(12);
    expect({ ...(db.prepare('SELECT title, done, kpis FROM goals').get() as object) }).toEqual({ title: 'eski', done: '["d"]', kpis: '[]' });
    expect(migrateDown(db, 11)).toBe(11);
    expect(columns(db, 'goals')).toEqual(before);
    expect({ ...(db.prepare('SELECT id, title FROM goals').get() as object) }).toEqual({ id: 'g1', title: 'eski' });
    expect(migrateUp(db, upTo(12))).toBe(12);
  });

  it('v13 adds the company profile, empty on a database from before; v13 down restores v12 exactly and keeps the rest', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(12));
    db.prepare("INSERT INTO goals (id, title, why, done, status, created_by, created_at) VALUES ('g1', 'eski', 'neden', '[]', 'active', 'c', 1)").run();
    migrateUp(db, upTo(13));
    expect(appliedVersion(db)).toBe(13);
    expect(tables(db)).toEqual(V13_TABLES);
    expect(columns(db, 'company_profile')).toEqual(['id', 'version', 'section', 'json', 'assumed', 'assumed_fields', 'by', 'ts']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM company_profile').get()).toMatchObject({ n: 0 });
    db.prepare("INSERT INTO company_profile (id, version, section, json, assumed, by, ts) VALUES ('p1', 1, 'identity', '{}', 0, 'c', 1)").run();
    expect(() => db.prepare("INSERT INTO company_profile (id, version, section, json, assumed, by, ts) VALUES ('p2', 1, 'offer', '{}', 0, 'c', 1)").run()).toThrow(/UNIQUE/);
    expect(migrateDown(db, 12)).toBe(12);
    expect(tables(db)).toEqual(V10_TABLES);
    expect(columns(db, 'goals')).toContain('kpis');
    expect(db.prepare('SELECT title FROM goals').get()).toMatchObject({ title: 'eski' });
    expect(migrateUp(db, upTo(13))).toBe(13);
  });

  it('v14 adds the onboarding and its rounds, empty; one round per number per onboarding; v14 down restores v13 exactly', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(13));
    db.prepare("INSERT INTO company_profile (id, version, section, json, assumed, by, ts) VALUES ('p1', 1, 'identity', '{}', 0, 'c', 1)").run();
    migrateUp(db, upTo(14));
    expect(appliedVersion(db)).toBe(14);
    expect(tables(db)).toEqual(V14_TABLES);
    expect(columns(db, 'onboarding')).toEqual(['id', 'description', 'status', 'started_by', 'started_at', 'finished_at']);
    expect(columns(db, 'onboarding_rounds')).toEqual(['onboarding_id', 'round', 'questions', 'asked_at', 'seq']);
    db.prepare("INSERT INTO onboarding_rounds (onboarding_id, round, questions, asked_at, seq) VALUES ('o1', 1, '[]', 1, 7)").run();
    expect(() => db.prepare("INSERT INTO onboarding_rounds (onboarding_id, round, questions, asked_at, seq) VALUES ('o1', 1, '[]', 2, 8)").run()).toThrow(/UNIQUE|PRIMARY/);
    expect(migrateDown(db, 13)).toBe(13);
    expect(tables(db)).toEqual(V13_TABLES);
    expect(db.prepare('SELECT COUNT(*) AS n FROM company_profile').get()).toMatchObject({ n: 1 });
    expect(migrateUp(db, upTo(14))).toBe(14);
  });

  it('v15 adds the integration registry, empty (what the desks report stays in the events); v15 down restores v14 exactly', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(14));
    db.prepare("INSERT INTO onboarding (id, description, status, started_by, started_at) VALUES ('o1', 'cümle', 'active', 'c', 1)").run();
    migrateUp(db, upTo(15));
    expect(appliedVersion(db)).toBe(15);
    expect(tables(db)).toEqual(V15_TABLES);
    expect(columns(db, 'integrations')).toEqual(['name', 'kind', 'closed', 'capabilities', 'auth_needed', 'cost_note', 'note', 'registered_by', 'registered_at', 'updated_at']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM integrations').get()).toMatchObject({ n: 0 });
    db.prepare("INSERT INTO integrations (name, kind, registered_by, registered_at, updated_at) VALUES ('x', 'cli', 'c', 1, 1)").run();
    expect(db.prepare('SELECT closed, capabilities FROM integrations').get()).toMatchObject({ closed: 0, capabilities: '[]' });
    expect(migrateDown(db, 14)).toBe(14);
    expect(tables(db)).toEqual(V14_TABLES);
    expect(db.prepare('SELECT COUNT(*) AS n FROM onboarding').get()).toMatchObject({ n: 1 });
    expect(migrateUp(db, upTo(15))).toBe(15);
  });

  it('v16 gives plans their streams (none for older ones) and tasks a stream (none); up → down → up keeps the rows', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(15));
    const plansBefore = columns(db, 'plans');
    const tasksBefore = columns(db, 'tasks');
    db.prepare(
      `INSERT INTO plans (id, title, goal, approach, people, steps, risks, status, version, proposed_by, created_at, updated_at)
       VALUES ('p1', 'eski plan', 'g', 'a', '', '["adım"]', '', 'approved', 1, 'c', 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO tasks (id, plan_id, title, description, done, requester, assignee, priority, depends_on, status, chain_depth, created_at)
       VALUES ('t1', 'p1', 'eski', '', '[]', 'owner', 'e1', 3, '[]', 'in_progress', 0, 1)`,
    ).run();
    migrateUp(db, upTo(16));
    expect(appliedVersion(db)).toBe(16);
    expect({ ...(db.prepare('SELECT title, steps, streams FROM plans').get() as object) }).toEqual({ title: 'eski plan', steps: '["adım"]', streams: '[]' });
    expect({ ...(db.prepare('SELECT title, status, stream_id FROM tasks').get() as object) }).toEqual({ title: 'eski', status: 'in_progress', stream_id: null });
    db.prepare(`UPDATE plans SET streams = '[{"id":"api","title":"API","owner":"e1","dependsOn":[]}]'`).run();
    db.prepare("UPDATE tasks SET stream_id = 'api'").run();
    expect(migrateDown(db, 15)).toBe(15);
    expect(columns(db, 'plans')).toEqual(plansBefore);
    expect(columns(db, 'tasks')).toEqual(tasksBefore);
    expect({ ...(db.prepare('SELECT id, title, steps FROM plans').get() as object) }).toEqual({ id: 'p1', title: 'eski plan', steps: '["adım"]' });
    expect({ ...(db.prepare('SELECT id, plan_id, status FROM tasks').get() as object) }).toEqual({ id: 't1', plan_id: 'p1', status: 'in_progress' });
    expect(migrateDown(db, 15)).toBe(15);
    expect(migrateUp(db, upTo(16))).toBe(16);
    expect({ ...(db.prepare('SELECT streams FROM plans').get() as object) }).toEqual({ streams: '[]' });
    expect({ ...(db.prepare('SELECT stream_id FROM tasks').get() as object) }).toEqual({ stream_id: null });
  });

  it('v17 records which role template an employee was hired from, none for those before; v17 down restores v16 exactly and keeps them', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(16));
    const before = columns(db, 'employees');
    db.prepare(
      `INSERT INTO employees (id, slug, name, role, model, character_id, desk_index, session_id, session_started, lifecycle, created_at, title, team, kind)
       VALUES ('e1', 'ada', 'Ada', 'serbest metin', 'sonnet', 'coder', 0, 's1', 0, 'stopped', 1, '', '', 'member')`,
    ).run();
    migrateUp(db, upTo(17));
    expect(appliedVersion(db)).toBe(17);
    expect(columns(db, 'employees')).toEqual([...before, 'template', 'template_version']);
    expect({ ...(db.prepare('SELECT role, template, template_version FROM employees').get() as object) }).toEqual({ role: 'serbest metin', template: null, template_version: null });
    expect(migrateDown(db, 16)).toBe(16);
    expect(columns(db, 'employees')).toEqual(before);
    expect(db.prepare('SELECT name FROM employees').get()).toMatchObject({ name: 'Ada' });
    expect(migrateUp(db, upTo(17))).toBe(17);
  });

  it('v18 records the capabilities an employee declares and a task requires, none for those before; v18 down restores v17 exactly and keeps them', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(17));
    const employees = columns(db, 'employees');
    const tasks = columns(db, 'tasks');
    db.prepare(
      `INSERT INTO employees (id, slug, name, role, model, character_id, desk_index, session_id, session_started, lifecycle, created_at, title, team, kind)
       VALUES ('e1', 'ada', 'Ada', 'serbest metin', 'sonnet', 'coder', 0, 's1', 0, 'stopped', 1, '', '', 'member')`,
    ).run();
    db.prepare(
      `INSERT INTO tasks (id, plan_id, title, description, done, requester, assignee, priority, depends_on, status, chain_depth, created_at)
       VALUES ('t1', NULL, 'Rapor', '', '[]', 'owner', 'e1', 3, '[]', 'waiting', 0, 1)`,
    ).run();
    expect(migrateUp(db, upTo(18))).toBe(18);
    expect(columns(db, 'employees')).toEqual([...employees, 'capabilities']);
    expect(columns(db, 'tasks')).toEqual([...tasks, 'requires']);
    expect({ ...(db.prepare('SELECT role, template, capabilities FROM employees').get() as object) }).toEqual({ role: 'serbest metin', template: null, capabilities: null });
    expect({ ...(db.prepare('SELECT title, requires FROM tasks').get() as object) }).toEqual({ title: 'Rapor', requires: null });
    expect(migrateDown(db, 17)).toBe(17);
    expect(columns(db, 'employees')).toEqual(employees);
    expect(columns(db, 'tasks')).toEqual(tasks);
    expect(db.prepare('SELECT name FROM employees').get()).toMatchObject({ name: 'Ada' });
    expect(db.prepare('SELECT title FROM tasks').get()).toMatchObject({ title: 'Rapor' });
    expect(migrateUp(db, upTo(18))).toBe(18);
  });

  it('v19 adds the blueprints and their install steps, empty (plans from before have none); v19 down restores v18 exactly', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(18));
    db.prepare("INSERT INTO plans (id, title, goal, approach, people, steps, risks, status, version, proposed_by, created_at, updated_at) VALUES ('p1', 'Eski plan', 'g', 'a', '', '[]', '', 'approved', 1, 'c', 1, 1)").run();
    expect(migrateUp(db, upTo(19))).toBe(19);
    expect(tables(db)).toEqual(V19_TABLES);
    expect(columns(db, 'blueprints')).toEqual(['plan_id', 'json', 'profile_version', 'created_by', 'created_at', 'updated_at']);
    expect(columns(db, 'blueprint_steps')).toEqual(['plan_id', 'step', 'ref', 'outcome', 'at']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM blueprints').get()).toMatchObject({ n: 0 });
    // One record per plan and step.
    db.prepare("INSERT INTO blueprint_steps (plan_id, step, ref, outcome, at) VALUES ('p1', 'role:yazar', 'e1', 'done', 1)").run();
    expect(() => db.prepare("INSERT INTO blueprint_steps (plan_id, step, ref, outcome, at) VALUES ('p1', 'role:yazar', 'e2', 'done', 2)").run()).toThrow(/UNIQUE/);
    expect(migrateDown(db, 18)).toBe(18);
    expect(tables(db)).toEqual(V15_TABLES);
    expect(db.prepare('SELECT title FROM plans').get()).toMatchObject({ title: 'Eski plan' });
    expect(migrateUp(db, upTo(19))).toBe(19);
  });

  it('v20 adds the KPI readings, empty; v20 down restores v19 exactly and keeps the goals and their KPIs', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(19));
    db.prepare(`INSERT INTO goals (id, title, why, done, kpis, status, created_by, created_at) VALUES ('g1', 'h', 'n', '["d"]', '[{"name":"k"}]', 'active', 'c', 1)`).run();
    migrateUp(db, upTo(20));
    expect(appliedVersion(db)).toBe(20);
    expect(tables(db)).toEqual(V20_TABLES);
    expect(columns(db, 'kpi_readings')).toEqual(['id', 'goal_id', 'kpi', 'value', 'unit', 'target', 'direction', 'source', 'period_start', 'recorded_at', 'recorded_by', 'note']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM kpi_readings').get()).toMatchObject({ n: 0 });
    // No value is a reading too: the office found nothing to measure in the window.
    db.prepare("INSERT INTO kpi_readings (goal_id, kpi, value, unit, target, direction, source, recorded_at, recorded_by) VALUES ('g1', 'k', NULL, '%', 70, 'atLeast', 'office', 2, 'office')").run();
    expect(migrateDown(db, 19)).toBe(19);
    expect(tables(db)).toEqual(V19_TABLES);
    expect({ ...(db.prepare('SELECT title, kpis FROM goals').get() as object) }).toEqual({ title: 'h', kpis: '[{"name":"k"}]' });
    expect(migrateUp(db, upTo(20))).toBe(20);
  });

  it('v21 adds the search index beside the tables it reads, empty (the office fills it on start); its triggers keep the full-text table in step; v21 down drops only it', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(20));
    db.prepare("INSERT INTO notes (ts, by_id, title, text, tags, source, ft_title, ft_text, ft_tags) VALUES (1, 'a', 'Not', 'kota', '[]', NULL, 'not', 'kota', '')").run();
    db.prepare("INSERT INTO decisions (id, ts, by_id, title, chosen, reason, alternatives) VALUES ('d1', 1, 'c', 'Karar', 'kota', 'r', '[]')").run();
    db.prepare("INSERT INTO playbook (topic, version, text, by_id, reason, ts) VALUES ('Test', 1, 'kota', 'c', '', 1)").run();
    db.prepare("INSERT INTO company_profile (id, version, section, json, assumed, by, ts) VALUES ('p1', 1, 'identity', '{}', 0, 'c', 1)").run();
    const sources = () => ['notes', 'decisions', 'playbook', 'company_profile'].map((x) => (db.prepare(`SELECT COUNT(*) AS n FROM ${x}`).get() as { n: number }).n);
    expect(migrateUp(db, upTo(21))).toBe(21);
    expect(tables(db)).toEqual(V21_TABLES);
    expect(columns(db, 'search_index')).toEqual(['id', 'kind', 'ref', 'title', 'body', 'tags', 'ft_title', 'ft_body', 'ft_tags', 'ts']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM search_index').get()).toMatchObject({ n: 0 });
    expect(sources()).toEqual([1, 1, 1, 1]);
    const found = (word: string) => (db.prepare('SELECT rowid FROM search_fts WHERE search_fts MATCH ?').all(word) as unknown[]).length;
    const add = db.prepare("INSERT INTO search_index (kind, ref, title, body, tags, ft_title, ft_body, ft_tags, ts) VALUES ('note', '1', 'Not', 'kota', '', 'not', 'kota', '', 1)");
    add.run();
    expect(found('kota')).toBe(1);
    expect(() => add.run()).toThrow(/UNIQUE/);
    db.prepare("UPDATE search_index SET body = 'arama', ft_body = 'arama' WHERE ref = '1'").run();
    expect([found('kota'), found('arama')]).toEqual([0, 1]);
    db.prepare("DELETE FROM search_index WHERE ref = '1'").run();
    expect(found('arama')).toBe(0);
    expect(migrateDown(db, 20)).toBe(20);
    expect(tables(db)).toEqual(V20_TABLES);
    expect(sources()).toEqual([1, 1, 1, 1]);
    expect(migrateUp(db, upTo(21))).toBe(21);
  });

  it('v22 adds the approvals (B9a), empty, with their two lookups; v22 down drops only them and restores v21 exactly', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(21));
    db.prepare("INSERT INTO tasks (id, plan_id, title, description, done, requester, assignee, priority, depends_on, status, chain_depth, created_at) VALUES ('t1', NULL, 'İş', '', '[]', 'owner', 'a', 3, '[]', 'waiting', 0, 1)").run();
    const before = db.prepare("SELECT sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
    expect(migrateUp(db)).toBe(22);
    expect(tables(db)).toEqual(V22_TABLES);
    expect(columns(db, 'approvals')).toEqual(['id', 'employee_id', 'task_id', 'kind', 'tool', 'target', 'fingerprint', 'summary', 'scope', 'status', 'requested_at', 'decided_at', 'decided_by', 'decided_via', 'expires_at', 'used_at', 'note']);
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'approvals' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
    expect(indexes).toEqual(['approvals_lookup', 'approvals_status']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM approvals').get()).toMatchObject({ n: 0 });
    db.prepare("INSERT INTO approvals (id, employee_id, task_id, kind, tool, target, fingerprint, summary, scope, status, requested_at) VALUES ('a1', 'e', 't1', 'publish', 'Bash', 'git push origin', 'f', 'neden', 'call', 'pending', 1)").run();
    expect(migrateDown(db, 21)).toBe(21);
    expect(tables(db)).toEqual(V21_TABLES);
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toMatchObject({ n: 1 });
    expect(migrateUp(db)).toBe(22);
  });
});
