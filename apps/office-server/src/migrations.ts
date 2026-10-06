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
];
