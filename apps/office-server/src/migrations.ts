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
        source TEXT,
        ft_title TEXT NOT NULL,
        ft_text TEXT NOT NULL,
        ft_tags TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        ft_title, ft_text, ft_tags, content = 'notes', content_rowid = 'id', tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts (rowid, ft_title, ft_text, ft_tags) VALUES (new.id, new.ft_title, new.ft_text, new.ft_tags);
      END;
      CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts (notes_fts, rowid, ft_title, ft_text, ft_tags) VALUES ('delete', old.id, old.ft_title, old.ft_text, old.ft_tags);
      END;
      CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_fts (notes_fts, rowid, ft_title, ft_text, ft_tags) VALUES ('delete', old.id, old.ft_title, old.ft_text, old.ft_tags);
        INSERT INTO notes_fts (rowid, ft_title, ft_text, ft_tags) VALUES (new.id, new.ft_title, new.ft_text, new.ft_tags);
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
      DROP TRIGGER IF EXISTS notes_au;
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
  {
    version: 4,
    name: 'budget: constitution, spending, task usage',
    up: `
      CREATE TABLE IF NOT EXISTS constitution (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS spend (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        by_id TEXT NOT NULL,
        service TEXT NOT NULL,
        usd REAL NOT NULL,
        purpose TEXT NOT NULL,
        plan_id TEXT
      );
      CREATE INDEX IF NOT EXISTS spend_ts ON spend (ts);
      CREATE INDEX IF NOT EXISTS spend_plan ON spend (plan_id);
      ALTER TABLE tasks ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0;
      ALTER TABLE tasks ADD COLUMN tokens INTEGER NOT NULL DEFAULT 0;`,
    down: `
      ALTER TABLE tasks DROP COLUMN tokens;
      ALTER TABLE tasks DROP COLUMN cost_usd;
      DROP INDEX IF EXISTS spend_plan;
      DROP INDEX IF EXISTS spend_ts;
      DROP TABLE IF EXISTS spend;
      DROP TABLE IF EXISTS constitution;`,
  },
  {
    version: 5,
    name: 'proposals, approved plan snapshots',
    up: `
      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        by_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        text TEXT NOT NULL,
        usd REAL,
        plan_id TEXT,
        status TEXT NOT NULL,
        routed_to TEXT,
        decided_by TEXT,
        note TEXT,
        decided_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS proposals_status ON proposals (status, ts);
      ALTER TABLE plans ADD COLUMN approved_snapshot TEXT;`,
    down: `
      ALTER TABLE plans DROP COLUMN approved_snapshot;
      DROP INDEX IF EXISTS proposals_status;
      DROP TABLE IF EXISTS proposals;`,
  },
  {
    version: 6,
    name: 'notice kinds and topics',
    // Notices written before kinds existed stay decisions: they keep opening a turn, as they did.
    up: `
      ALTER TABLE notices ADD COLUMN kind TEXT NOT NULL DEFAULT 'decision';
      ALTER TABLE notices ADD COLUMN topic TEXT NOT NULL DEFAULT '';`,
    down: `
      ALTER TABLE notices DROP COLUMN topic;
      ALTER TABLE notices DROP COLUMN kind;`,
  },
  {
    version: 7,
    name: 'task difficulty',
    up: `ALTER TABLE tasks ADD COLUMN difficulty TEXT;`,
    down: `ALTER TABLE tasks DROP COLUMN difficulty;`,
  },
  {
    version: 8,
    name: 'coordination craft: plan method, task review',
    // Tasks and plans from before stay as they were: no reviewer, round 0, no method.
    up: `
      ALTER TABLE plans ADD COLUMN method TEXT;
      ALTER TABLE tasks ADD COLUMN reviewer TEXT;
      ALTER TABLE tasks ADD COLUMN review_of TEXT;
      ALTER TABLE tasks ADD COLUMN round INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS tasks_review_of ON tasks (review_of);`,
    down: `
      DROP INDEX IF EXISTS tasks_review_of;
      ALTER TABLE tasks DROP COLUMN round;
      ALTER TABLE tasks DROP COLUMN review_of;
      ALTER TABLE tasks DROP COLUMN reviewer;
      ALTER TABLE plans DROP COLUMN method;`,
  },
  {
    version: 9,
    name: 'coordinator as project manager: goals, company state, a plan’s goal',
    up: `
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        why TEXT NOT NULL,
        done TEXT NOT NULL,
        status TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        closed_at INTEGER,
        note TEXT
      );
      CREATE INDEX IF NOT EXISTS goals_status ON goals (status, created_at);
      CREATE TABLE IF NOT EXISTS company_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      ALTER TABLE plans ADD COLUMN goal_id TEXT;
      ALTER TABLE plans ADD COLUMN approved_by TEXT;`,
    down: `
      ALTER TABLE plans DROP COLUMN approved_by;
      ALTER TABLE plans DROP COLUMN goal_id;
      DROP TABLE IF EXISTS company_state;
      DROP INDEX IF EXISTS goals_status;
      DROP TABLE IF EXISTS goals;`,
  },
  {
    version: 10,
    name: 'office scheduler: task times, parked status, schedules',
    // Tasks from before: no time, never parked, not from a routine.
    up: `
      ALTER TABLE tasks ADD COLUMN not_before INTEGER;
      ALTER TABLE tasks ADD COLUMN due_at INTEGER;
      ALTER TABLE tasks ADD COLUMN parked_reason TEXT;
      ALTER TABLE tasks ADD COLUMN park_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tasks ADD COLUMN schedule_id TEXT;
      ALTER TABLE tasks ADD COLUMN overdue_notified INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS tasks_not_before ON tasks (status, not_before);
      CREATE INDEX IF NOT EXISTS tasks_schedule ON tasks (schedule_id, status);
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        done TEXT NOT NULL,
        assignee TEXT NOT NULL,
        reviewer TEXT,
        plan_id TEXT,
        priority INTEGER NOT NULL,
        difficulty TEXT,
        cron TEXT NOT NULL,
        until_at INTEGER,
        status TEXT NOT NULL,
        next_run_at INTEGER,
        last_run_at INTEGER,
        last_task_id TEXT,
        skip_count INTEGER NOT NULL DEFAULT 0,
        fail_count INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        note TEXT
      );
      CREATE INDEX IF NOT EXISTS schedules_due ON schedules (status, next_run_at);`,
    down: `
      DROP INDEX IF EXISTS schedules_due;
      DROP TABLE IF EXISTS schedules;
      DROP INDEX IF EXISTS tasks_schedule;
      DROP INDEX IF EXISTS tasks_not_before;
      ALTER TABLE tasks DROP COLUMN overdue_notified;
      ALTER TABLE tasks DROP COLUMN schedule_id;
      ALTER TABLE tasks DROP COLUMN park_count;
      ALTER TABLE tasks DROP COLUMN parked_reason;
      ALTER TABLE tasks DROP COLUMN due_at;
      ALTER TABLE tasks DROP COLUMN not_before;`,
  },
  {
    version: 11,
    name: 'stall recovery: when a task was last reminded',
    // Tasks from before: no time; one already reminded counts as reminded long ago, so it is reminded again.
    up: `ALTER TABLE tasks ADD COLUMN nudged_at INTEGER;`,
    down: `ALTER TABLE tasks DROP COLUMN nudged_at;`,
  },
  {
    // feat/company-profile also takes 12: whichever merges second becomes 13 (spec 2026-10-08-goal-kpis-design §5).
    version: 12,
    name: 'goal KPIs',
    // Goals from before: no KPIs.
    up: `ALTER TABLE goals ADD COLUMN kpis TEXT NOT NULL DEFAULT '[]';`,
    down: `ALTER TABLE goals DROP COLUMN kpis;`,
  },
];
