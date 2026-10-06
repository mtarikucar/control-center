export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'core tables',
    up: `
      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        model TEXT NOT NULL,
        character_id TEXT NOT NULL,
        desk_index INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        session_started INTEGER NOT NULL DEFAULT 0,
        lifecycle TEXT NOT NULL,
        limit_resets_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id TEXT,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_employee_seq ON events (employee_id, seq);
      CREATE INDEX IF NOT EXISTS events_type_ts ON events (type, ts);
      CREATE TABLE IF NOT EXISTS quota (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        status TEXT NOT NULL,
        five_hour TEXT,
        seven_day TEXT,
        updated_at INTEGER NOT NULL
      );`,
    down: `
      DROP TABLE IF EXISTS quota;
      DROP INDEX IF EXISTS events_type_ts;
      DROP INDEX IF EXISTS events_employee_seq;
      DROP TABLE IF EXISTS events;
      DROP TABLE IF EXISTS employees;`,
  },
  {
    version: 2,
    name: 'company: roles, plans, tasks, notices',
    up: `
      ALTER TABLE employees ADD COLUMN title TEXT NOT NULL DEFAULT '';
      ALTER TABLE employees ADD COLUMN team TEXT NOT NULL DEFAULT '';
      ALTER TABLE employees ADD COLUMN kind TEXT NOT NULL DEFAULT 'member';
      ALTER TABLE employees ADD COLUMN reports_to TEXT;
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        approach TEXT NOT NULL,
        people TEXT NOT NULL,
        steps TEXT NOT NULL,
        quota_pct REAL,
        usd REAL,
        days REAL,
        risks TEXT NOT NULL,
        status TEXT NOT NULL,
        version INTEGER NOT NULL,
        proposed_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        approved_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        plan_id TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        done TEXT NOT NULL,
        requester TEXT NOT NULL,
        assignee TEXT NOT NULL,
        priority INTEGER NOT NULL,
        depends_on TEXT NOT NULL,
        status TEXT NOT NULL,
        chain_depth INTEGER NOT NULL,
        note TEXT,
        result TEXT,
        nudged INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS tasks_assignee_status ON tasks (assignee, status);
      CREATE INDEX IF NOT EXISTS tasks_plan ON tasks (plan_id);
      CREATE INDEX IF NOT EXISTS tasks_requester_created ON tasks (requester, created_at);
      CREATE TABLE IF NOT EXISTS notices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        delivered_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS notices_pending ON notices (employee_id, delivered_at);`,
    down: `
      DROP INDEX IF EXISTS notices_pending;
      DROP TABLE IF EXISTS notices;
      DROP INDEX IF EXISTS tasks_requester_created;
      DROP INDEX IF EXISTS tasks_plan;
      DROP INDEX IF EXISTS tasks_assignee_status;
      DROP TABLE IF EXISTS tasks;
      DROP TABLE IF EXISTS plans;
      ALTER TABLE employees DROP COLUMN reports_to;
      ALTER TABLE employees DROP COLUMN kind;
      ALTER TABLE employees DROP COLUMN team;
      ALTER TABLE employees DROP COLUMN title;`,
  },
  {
    version: 3,
    name: 'company memory: decisions, playbook, notes, employee files, task kind',
    up: `
      ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'work';
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        by_id TEXT NOT NULL,
        title TEXT NOT NULL,
        chosen TEXT NOT NULL,
        reason TEXT NOT NULL,
        alternatives TEXT NOT NULL,
        plan_id TEXT,
        reverts TEXT
      );
      CREATE INDEX IF NOT EXISTS decisions_ts ON decisions (ts);
      CREATE INDEX IF NOT EXISTS decisions_reverts ON decisions (reverts);
      CREATE TABLE IF NOT EXISTS playbook (
        topic TEXT NOT NULL,
        version INTEGER NOT NULL,
        text TEXT NOT NULL,
        by_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        ts INTEGER NOT NULL,
        PRIMARY KEY (topic, version)
      );
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        by_id TEXT NOT NULL,
        title TEXT NOT NULL,
        text TEXT NOT NULL,
        tags TEXT NOT NULL,
        source TEXT
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        title, text, tags, content = 'notes', content_rowid = 'id', tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts (rowid, title, text, tags) VALUES (new.id, new.title, new.text, new.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts (notes_fts, rowid, title, text, tags) VALUES ('delete', old.id, old.title, old.text, old.tags);
      END;
      CREATE TABLE IF NOT EXISTS employee_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        employee_id TEXT NOT NULL,
        by_id TEXT NOT NULL,
        text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS employee_notes_employee ON employee_notes (employee_id, ts);`,
    down: `
      DROP INDEX IF EXISTS employee_notes_employee;
      DROP TABLE IF EXISTS employee_notes;
      DROP TRIGGER IF EXISTS notes_ad;
      DROP TRIGGER IF EXISTS notes_ai;
      DROP TABLE IF EXISTS notes_fts;
      DROP TABLE IF EXISTS notes;
      DROP TABLE IF EXISTS playbook;
      DROP INDEX IF EXISTS decisions_reverts;
      DROP INDEX IF EXISTS decisions_ts;
      DROP TABLE IF EXISTS decisions;
      ALTER TABLE tasks DROP COLUMN kind;`,
  },
];
