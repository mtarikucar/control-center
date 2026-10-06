# Company Phase 2 — Company Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The company remembers: a decision log the owner can undo, a versioned playbook of working methods, searchable knowledge notes, an archive of every hand-in, an employee file per person, and a hand-over before anyone leaves.

**Architecture:** Migration v3 adds `decisions`, `playbook`, `notes` (+ FTS5 index), `employee_notes` and `tasks.kind`. A `Memory` service (`company/memory.ts`) owns the rules over four small stores (`company/memory-store.ts`); `Company.finish` archives the outputs (`company/archive.ts`) and turns what was learned into a note. Employees use it through new office tools; the owner through new routes and Company-view tabs. The office guide moves from the role card into `office-guide.md`, rewritten on every session start, so rule changes reach every desk. "İşten çıkar" first gives a hand-over task; the Dispatcher lets the person go once it is handed in.

**Tech Stack:** as phase 1 — Node 24 type stripping, node:sqlite (FTS5 verified: `unicode61 remove_diacritics 2` folds ç/ş/ğ/ö/ü and İ/i), Vitest 3, React 19, zustand.

**Spec:** `docs/superpowers/specs/2026-10-06-company-design.md` (§5 Şirket hafızası, §3.4 işten çıkarma, §7 tools, §8 screen, §9 data, §12 phase 2).

## Global Constraints

- Node 24 type stripping: no enums, no parameter properties, `import type` for types, `.ts` extensions in imports.
- Every migration is reversible: `up` + `down`, `down` removes exactly what `up` added, round trip (up → down → up) tested.
- Tool descriptions in English (read by the model); tool results, errors and UI text in Turkish.
- Commits: plain conventional commits, no AI trailer.
- Never run the real claude on port 4319; the real-claude test is opt-in (`OFFICE_SMOKE=1`) with temp data dirs; clean `~/.claude/projects/-tmp-cc-*` afterwards.
- `assets/` stays untracked.

## Spec rulings (decided here)

- **Search:** notes go through FTS5 (prefix match on every word, all words required, user text can never be FTS syntax); decisions, playbook and finished tasks are few, so they are matched in code with Turkish case/diacritic folding. Results are newest first.
- **Hand-over:** "İşten çıkar" creates a priority-1 `handover` task that is delivered at the next idle moment even if another task is open; when it is handed in the Dispatcher fires the employee and their open tasks go back to the coordinator (phase 1 `releaseTasksOf`). "Hemen çıkar" (`?now=1`) skips it. A cancelled or skipped hand-over is `cancelled`.
- **Office guide file:** the role card imports `@office-guide.md`; `prepareDesk` rewrites it for the employee's kind at every start. Cards without the import get it appended once (v1 cards; no phase-1 cards exist outside tests — phase 1 was never run on the owner's data).
- **"Özet değişti" line:** a task delivery carries "Şirket özeti değişti; briefRead ile oku." when the brief changed since the employee's previous task started (from the brief file's mtime; no new state).
- **Archive limit:** 100 MB per hand-in; what does not fit or cannot be found is listed in `teslim.md` with the reason; the hand-in never fails because of the archive.

## Review Focus

1. A search containing FTS syntax (`"`, `*`, `-`, `NEAR(`, `:`, parentheses) or only punctuation never throws an SQL error: it searches the words or says it needs a word (Task 2, Task 4).
2. Reverting a decision twice, or reverting a revert, fails with a clear Turkish error and records nothing (Task 4).
3. Outputs that are missing, a directory, outside the desk, too big, or two with the same file name still produce an archive and a `teslim.md` that says what happened to each (Task 5).
4. Pressing "İşten çıkar" twice gives one hand-over task; "Hemen çıkar" during a hand-over cancels it; a stopped employee's hand-over waits and "Hemen çıkar" still works (Task 6).
5. A desk card from v1 gets the guide and brief imports exactly once, and a card the owner edited keeps its text (Task 3).

## File Structure

```
packages/shared/src/
  memory.ts          NEW Decision, PlaybookEntry, Note, EmployeeNote, MemoryHit, EmployeeFile
  company.ts         + TASK_KINDS/TaskKind, Task.kind, TaskResult.archive?
  events.ts          + decision.recorded, playbook.updated, note.written
  index.ts           + export memory.ts
apps/office-server/src/
  migrations.ts      + v3
  company/store.ts   tasks.kind
  company/text.ts    NEW clean(), lines() shared by Company and Memory
  company/memory-store.ts NEW DecisionStore, PlaybookStore, NoteStore (FTS), EmployeeNoteStore, ftsQuery()
  company/memory.ts  NEW Memory service
  company/archive.ts NEW archiveTask()
  company/roles.ts   guide mentions the memory tools
  company/company.ts finish → archive + learned note; beginHandover, handedOver, briefUpdatedAt; releaseTasksOf cancels hand-overs
  company/dispatcher.ts hand-over delivery and letting go; "özet değişti" line; sweep on decision.recorded
  desk.ts            office-guide.md import + file
  mcp/tools.ts       memory tools
  api.ts, main.ts    memory routes, hand-over on DELETE, wiring
apps/office-web/src/
  net/api.ts, store/reducers.ts (memoryRev), ui/EventItem.tsx
  ui/MemoryTabs.tsx  NEW Kararlar / El kitabı / Notlar tabs
  ui/CompanyView.tsx + the three tabs
  ui/FireControls.tsx NEW İşten çıkar dialog (hand-over / now) and the leaving banner
  ui/EmployeeFile.tsx NEW the employee file section in the panel
  ui/Panel.tsx       uses FireControls and EmployeeFile
```

---

### Task 1: Shared types, migration v3, task kind

**Files:**
- Create: `packages/shared/src/memory.ts`
- Modify: `packages/shared/src/company.ts`, `packages/shared/src/events.ts`, `packages/shared/src/index.ts`, `apps/office-server/src/migrations.ts`, `apps/office-server/src/company/store.ts`
- Test: `apps/office-server/test/db.test.ts`, `apps/office-server/test/company-store.test.ts`; web fixtures (`apps/office-web/src/store/reducers.test.ts`, `apps/office-web/src/ui/CompanyView.test.tsx`)

**Interfaces:**
- Produces: `Decision`, `PlaybookEntry`, `Note`, `EmployeeNote`, `MemoryHit`, `EmployeeFile`; `TASK_KINDS`, `TaskKind`, `Task.kind`, `TaskResult.archive?: string`; events `decision.recorded {decision}`, `playbook.updated {topic, version, reason}`, `note.written {id, title, tags}`; `NewTask.kind?: TaskKind`.

- [ ] **Step 1: Write the failing tests**

Replace `apps/office-server/test/db.test.ts` with:

```ts
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
```

Append to `apps/office-server/test/company-store.test.ts` (inside `describe('TaskStore', …)`):

```ts
  it('keeps the task kind, work by default', () => {
    const { tasks } = stores();
    expect(tasks.create(task()).kind).toBe('work');
    const handover = tasks.create(task({ kind: 'handover' }));
    expect(tasks.get(handover.id).kind).toBe('handover');
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/db.test.ts test/company-store.test.ts`
Expected: FAIL — version 2 instead of 3; `kind` undefined.

- [ ] **Step 3: Shared types**

Create `packages/shared/src/memory.ts`:

```ts
import type { Employee } from './employee.ts';

/** A choice the company made: what was chosen, why, and what else was on the table. `reverts` = the decision it undoes. */
export interface Decision {
  id: string;
  ts: number;
  /** An employee id, or OWNER for the owner's reverts. */
  by: string;
  title: string;
  chosen: string;
  reason: string;
  alternatives: string[];
  planId: string | null;
  reverts: string | null;
}

/** One version of a playbook topic: how the company does something (testing, releases, video production…). */
export interface PlaybookEntry {
  topic: string;
  version: number;
  text: string;
  by: string;
  reason: string;
  ts: number;
}

export interface Note {
  id: number;
  ts: number;
  by: string;
  title: string;
  text: string;
  tags: string[];
  /** Where it came from: `task:<id>` for what a hand-in taught; null for a note written directly. */
  source: string | null;
}

export interface EmployeeNote {
  id: number;
  ts: number;
  employeeId: string;
  by: string;
  text: string;
}

/** One search result across the company's memory. */
export interface MemoryHit {
  kind: 'note' | 'decision' | 'playbook' | 'task';
  id: string;
  title: string;
  snippet: string;
  ts: number;
}

/** What the company knows about one employee: the coordinator's notes and their track record. */
export interface EmployeeFile {
  employee: Employee;
  notes: EmployeeNote[];
  finished: number;
  recent: Array<{ id: string; title: string; summary: string; finishedAt: number | null }>;
}
```

In `packages/shared/src/company.ts`:
- add before `export interface Task`:

```ts
/** `handover`: the task "İşten çıkar" gives — write down what you know before you leave. */
export const TASK_KINDS = ['work', 'handover'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
```

- add `kind: TaskKind;` to `Task` right after `planId: string | null;`
- add to `TaskResult` after `learned: string;`:

```ts
  /** Where the office archived the hand-in, relative to the data folder (set by the office). */
  archive?: string;
```

In `packages/shared/src/events.ts`: add `import type { Decision } from './memory.ts';` and, before `| { type: 'error'; message: string };`:

```ts
  | { type: 'decision.recorded'; decision: Decision }
  | { type: 'playbook.updated'; topic: string; version: number; reason: string }
  | { type: 'note.written'; id: number; title: string; tags: string[] }
```

`packages/shared/src/index.ts`: add `export * from './memory.ts';`.

- [ ] **Step 4: Migration v3**

Append to `MIGRATIONS` in `apps/office-server/src/migrations.ts`:

```ts
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
```

- [ ] **Step 5: Task kind in the store**

In `apps/office-server/src/company/store.ts`:
- import `TaskKind` in the `@cc/shared` type import;
- `TaskRow` gains `kind: string;`; `taskFromRow` gains `kind: r.kind as TaskKind,` after `planId`;
- `NewTask` gains `/** Default 'work'. */ kind?: TaskKind;`
- in `create`, build the task as `const task: Task = { ...t, kind: t.kind ?? 'work', id: randomUUID(), status: 'waiting', note: null, result: null, nudged: false, createdAt: this.#now(), startedAt: null, finishedAt: null };` and insert the kind:

```ts
    this.#db
      .prepare(
        `INSERT INTO tasks (id, plan_id, title, description, done, requester, assignee, priority, depends_on, status, chain_depth,
           note, result, nudged, created_at, started_at, finished_at, kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, NULL, NULL, ?)`,
      )
      .run(task.id, task.planId, task.title, task.description, JSON.stringify(task.done), task.requester, task.assignee, task.priority, JSON.stringify(task.dependsOn), task.status, task.chainDepth, task.createdAt, task.kind);
```

- [ ] **Step 6: Web fixtures**

Add `kind: 'work',` after `planId` in the `task()` fixtures of `apps/office-web/src/store/reducers.test.ts` and `apps/office-web/src/ui/CompanyView.test.tsx`.

- [ ] **Step 7: Run the tests, typecheck, commit**

Run: `pnpm --filter @cc/office-server exec vitest run test/db.test.ts test/company-store.test.ts && pnpm test && pnpm typecheck`
Expected: PASS. (If the FTS shadow-table names differ in this SQLite build, read them from the failure and correct `V3_TABLES` — the set FTS5 creates for an external-content table is `_config`, `_data`, `_docsize`, `_idx`.)

```bash
git add packages/shared apps/office-server/src/migrations.ts apps/office-server/src/company/store.ts apps/office-server/test apps/office-web/src
git commit -m "feat(memory): decisions, playbook, notes and employee files in the data model

Migration v3 (reversible) adds the decisions, playbook, notes (with an FTS5
index kept in step by triggers) and employee_notes tables and a task kind
(work or handover); the shared types and events for them."
```

---

### Task 2: Memory stores

**Files:**
- Create: `apps/office-server/src/company/memory-store.ts`
- Test: `apps/office-server/test/memory-store.test.ts`

**Interfaces:**
- Consumes: `Db`, `NotFoundError`; shared memory types (Task 1).
- Produces:
  - `type NewDecision = Omit<Decision, 'id' | 'ts'>`; `class DecisionStore { constructor(db, now?); create(d: NewDecision): Decision; get(id): Decision; list(o?: { planId?: string; limit?: number }): Decision[] /* newest first */; revertOf(id): Decision | null }`
  - `class PlaybookStore { constructor(db, now?); write(e: { topic: string; text: string; by: string; reason: string }): PlaybookEntry; latest(topic): PlaybookEntry | null; topics(): PlaybookEntry[] /* newest version per topic, by name */; history(topic): PlaybookEntry[] /* newest first */ }`
  - `class NoteStore { constructor(db, now?); create(n: Omit<Note, 'id' | 'ts'>): Note; list(limit?): Note[] /* newest first */; search(query: string, limit?): Array<{ note: Note; snippet: string }> }`
  - `class EmployeeNoteStore { constructor(db, now?); add(n: { employeeId: string; by: string; text: string }): EmployeeNote; list(employeeId: string): EmployeeNote[] /* oldest first */ }`
  - `function ftsQuery(query: string): string | null`

- [ ] **Step 1: Write the failing test**

Create `apps/office-server/test/memory-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { migrateUp, openDb } from '../src/db.ts';
import { DecisionStore, EmployeeNoteStore, NoteStore, PlaybookStore, ftsQuery } from '../src/company/memory-store.ts';

function stores() {
  const db = openDb(':memory:');
  migrateUp(db);
  let t = 1_000;
  const now = () => (t += 1);
  return { decisions: new DecisionStore(db, now), playbook: new PlaybookStore(db, now), notes: new NoteStore(db, now), employeeNotes: new EmployeeNoteStore(db, now) };
}

describe('DecisionStore', () => {
  it('records decisions newest first and finds the record that reverts one', () => {
    const { decisions } = stores();
    const a = decisions.create({ by: 'c', title: 'Ses aracı', chosen: 'ElevenLabs', reason: 'Türkçe iyi', alternatives: ['Polly', 'kendi sesimiz'], planId: 'p1', reverts: null });
    const b = decisions.create({ by: 'c', title: 'Kurgu', chosen: 'CapCut', reason: 'hızlı', alternatives: [], planId: null, reverts: null });
    expect(decisions.get(a.id)).toEqual(a);
    expect(decisions.list().map((d) => d.id)).toEqual([b.id, a.id]);
    expect(decisions.list({ planId: 'p1' }).map((d) => d.id)).toEqual([a.id]);
    expect(decisions.revertOf(a.id)).toBeNull();
    const r = decisions.create({ by: 'owner', title: 'Geri alındı: Ses aracı', chosen: 'Geri alındı', reason: 'x', alternatives: [], planId: 'p1', reverts: a.id });
    expect(decisions.revertOf(a.id)?.id).toBe(r.id);
    expect(() => decisions.get('nope')).toThrow(/Karar bulunamadı/);
  });
});

describe('PlaybookStore', () => {
  it('versions each topic and lists the newest version of every topic', () => {
    const { playbook } = stores();
    expect(playbook.write({ topic: 'Test', text: 'birim', by: 'c', reason: 'ilk' }).version).toBe(1);
    expect(playbook.write({ topic: 'Test', text: 'birim + uçtan uca', by: 'c', reason: 'e2e eklendi' }).version).toBe(2);
    playbook.write({ topic: 'Sürüm', text: 'etiketle', by: 'c', reason: '' });
    expect(playbook.latest('Test')).toMatchObject({ version: 2, text: 'birim + uçtan uca' });
    expect(playbook.latest('Yok')).toBeNull();
    expect(playbook.topics().map((p) => [p.topic, p.version])).toEqual([['Sürüm', 1], ['Test', 2]]);
    expect(playbook.history('Test').map((p) => p.version)).toEqual([2, 1]);
  });
});

describe('NoteStore', () => {
  it('finds notes by any word, prefix and Turkish letters folded, best match first', () => {
    const { notes } = stores();
    const a = notes.create({ by: 'e1', title: 'Seslendirme aracı', text: 'ElevenLabs Türkçe sesleri iyi; ücretli plan gerekiyor.', tags: ['video'], source: null });
    notes.create({ by: 'e2', title: 'Test prosedürü', text: 'Önce birim testleri, sonra uçtan uca.', tags: [], source: 'task:t1' });
    expect(notes.search('turkce').map((h) => h.note.id)).toEqual([a.id]);
    expect(notes.search('seslendir').map((h) => h.note.id)).toEqual([a.id]);
    expect(notes.search('ÜCRETLİ plan')[0]?.snippet).toContain('ücretli');
    expect(notes.search('test uçtan')).toHaveLength(1);
    expect(notes.search('video')).toHaveLength(1);
    expect(notes.list().map((n) => n.title)).toEqual(['Test prosedürü', 'Seslendirme aracı']);
    expect(notes.list()[0]).toMatchObject({ tags: [], source: 'task:t1' });
  });

  it('review focus: FTS syntax in a query is searched as words, never an SQL error', () => {
    const { notes } = stores();
    notes.create({ by: 'e1', title: 'NEAR plan', text: 'a "quoted" word', tags: [], source: null });
    for (const q of ['"', '*', '-plan', 'NEAR(', 'title:plan', '(plan) OR', 'a"b', '***']) expect(() => notes.search(q)).not.toThrow();
    expect(notes.search('(plan) OR')).toHaveLength(1);
    expect(notes.search('*')).toEqual([]);
    expect(ftsQuery('  ')).toBeNull();
    expect(ftsQuery('ses aracı')).toBe('"ses"* "aracı"*');
  });
});

describe('EmployeeNoteStore', () => {
  it('keeps notes per employee, oldest first', () => {
    const { employeeNotes } = stores();
    employeeNotes.add({ employeeId: 'e1', by: 'c', text: 'Testte çok iyi.' });
    employeeNotes.add({ employeeId: 'e2', by: 'c', text: 'başka' });
    employeeNotes.add({ employeeId: 'e1', by: 'c', text: 'Belgeleri aceleye getiriyor.' });
    expect(employeeNotes.list('e1').map((n) => n.text)).toEqual(['Testte çok iyi.', 'Belgeleri aceleye getiriyor.']);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/memory-store.test.ts`
Expected: FAIL — cannot resolve `../src/company/memory-store.ts`.

- [ ] **Step 3: Implement the stores**

Create `apps/office-server/src/company/memory-store.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { Decision, EmployeeNote, Note, PlaybookEntry } from '@cc/shared';
import type { Db } from '../db.ts';
import { NotFoundError } from '../errors.ts';

/**
 * A user's query as an FTS5 expression that cannot be a syntax error: every word quoted and prefix-matched, all
 * required. Null when the query has no words.
 */
export function ftsQuery(query: string): string | null {
  const words = query.normalize('NFC').split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 8);
  return words.length ? words.map((w) => `"${w}"*`).join(' ') : null;
}

interface DecisionRow {
  id: string;
  ts: number;
  by_id: string;
  title: string;
  chosen: string;
  reason: string;
  alternatives: string;
  plan_id: string | null;
  reverts: string | null;
}

const decisionFromRow = (r: DecisionRow): Decision => ({
  id: r.id,
  ts: r.ts,
  by: r.by_id,
  title: r.title,
  chosen: r.chosen,
  reason: r.reason,
  alternatives: JSON.parse(r.alternatives) as string[],
  planId: r.plan_id,
  reverts: r.reverts,
});

export type NewDecision = Omit<Decision, 'id' | 'ts'>;

export class DecisionStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  create(d: NewDecision): Decision {
    const decision: Decision = { ...d, id: randomUUID(), ts: this.#now() };
    this.#db
      .prepare('INSERT INTO decisions (id, ts, by_id, title, chosen, reason, alternatives, plan_id, reverts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(decision.id, decision.ts, decision.by, decision.title, decision.chosen, decision.reason, JSON.stringify(decision.alternatives), decision.planId, decision.reverts);
    return decision;
  }

  get(id: string): Decision {
    const row = this.#db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as unknown as DecisionRow | undefined;
    if (!row) throw new NotFoundError(`Karar bulunamadı: ${id}`);
    return decisionFromRow(row);
  }

  list(o: { planId?: string; limit?: number } = {}): Decision[] {
    const limit = o.limit ?? 200;
    const rows = (
      o.planId !== undefined
        ? this.#db.prepare('SELECT * FROM decisions WHERE plan_id = ? ORDER BY ts DESC, rowid DESC LIMIT ?').all(o.planId, limit)
        : this.#db.prepare('SELECT * FROM decisions ORDER BY ts DESC, rowid DESC LIMIT ?').all(limit)
    ) as unknown as DecisionRow[];
    return rows.map(decisionFromRow);
  }

  revertOf(id: string): Decision | null {
    const row = this.#db.prepare('SELECT * FROM decisions WHERE reverts = ? LIMIT 1').get(id) as unknown as DecisionRow | undefined;
    return row ? decisionFromRow(row) : null;
  }
}

interface PlaybookRow {
  topic: string;
  version: number;
  text: string;
  by_id: string;
  reason: string;
  ts: number;
}

const entryFromRow = (r: PlaybookRow): PlaybookEntry => ({ topic: r.topic, version: r.version, text: r.text, by: r.by_id, reason: r.reason, ts: r.ts });

export class PlaybookStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  write(e: { topic: string; text: string; by: string; reason: string }): PlaybookEntry {
    const row = this.#db.prepare('SELECT MAX(version) AS v FROM playbook WHERE topic = ?').get(e.topic) as unknown as { v: number | null };
    const entry: PlaybookEntry = { ...e, version: (row.v ?? 0) + 1, ts: this.#now() };
    this.#db
      .prepare('INSERT INTO playbook (topic, version, text, by_id, reason, ts) VALUES (?, ?, ?, ?, ?, ?)')
      .run(entry.topic, entry.version, entry.text, entry.by, entry.reason, entry.ts);
    return entry;
  }

  latest(topic: string): PlaybookEntry | null {
    const row = this.#db.prepare('SELECT * FROM playbook WHERE topic = ? ORDER BY version DESC LIMIT 1').get(topic) as unknown as PlaybookRow | undefined;
    return row ? entryFromRow(row) : null;
  }

  topics(): PlaybookEntry[] {
    const rows = this.#db
      .prepare(
        `SELECT p.* FROM playbook p
           JOIN (SELECT topic, MAX(version) AS v FROM playbook GROUP BY topic) m ON p.topic = m.topic AND p.version = m.v
         ORDER BY p.topic`,
      )
      .all() as unknown as PlaybookRow[];
    return rows.map(entryFromRow);
  }

  history(topic: string): PlaybookEntry[] {
    const rows = this.#db.prepare('SELECT * FROM playbook WHERE topic = ? ORDER BY version DESC').all(topic) as unknown as PlaybookRow[];
    return rows.map(entryFromRow);
  }
}

interface NoteRow {
  id: number;
  ts: number;
  by_id: string;
  title: string;
  text: string;
  tags: string;
  source: string | null;
}

const noteFromRow = (r: NoteRow): Note => ({ id: r.id, ts: r.ts, by: r.by_id, title: r.title, text: r.text, tags: JSON.parse(r.tags) as string[], source: r.source });

export class NoteStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  create(n: Omit<Note, 'id' | 'ts'>): Note {
    const ts = this.#now();
    const r = this.#db
      .prepare('INSERT INTO notes (ts, by_id, title, text, tags, source) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ts, n.by, n.title, n.text, JSON.stringify(n.tags), n.source);
    return { ...n, id: Number(r.lastInsertRowid), ts };
  }

  list(limit = 100): Note[] {
    const rows = this.#db.prepare('SELECT * FROM notes ORDER BY ts DESC, id DESC LIMIT ?').all(limit) as unknown as NoteRow[];
    return rows.map(noteFromRow);
  }

  search(query: string, limit = 20): Array<{ note: Note; snippet: string }> {
    const match = ftsQuery(query);
    if (!match) return [];
    const rows = this.#db
      .prepare(
        `SELECT n.*, snippet(notes_fts, -1, '«', '»', '…', 14) AS snip
           FROM notes_fts JOIN notes n ON n.id = notes_fts.rowid
          WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(match, limit) as unknown as Array<NoteRow & { snip: string }>;
    return rows.map((r) => ({ note: noteFromRow(r), snippet: r.snip.replace(/[«»]/g, '') }));
  }
}

interface EmployeeNoteRow {
  id: number;
  ts: number;
  employee_id: string;
  by_id: string;
  text: string;
}

export class EmployeeNoteStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  add(n: { employeeId: string; by: string; text: string }): EmployeeNote {
    const ts = this.#now();
    const r = this.#db.prepare('INSERT INTO employee_notes (ts, employee_id, by_id, text) VALUES (?, ?, ?, ?)').run(ts, n.employeeId, n.by, n.text);
    return { ...n, id: Number(r.lastInsertRowid), ts };
  }

  list(employeeId: string): EmployeeNote[] {
    const rows = this.#db.prepare('SELECT * FROM employee_notes WHERE employee_id = ? ORDER BY ts, id').all(employeeId) as unknown as EmployeeNoteRow[];
    return rows.map((r) => ({ id: r.id, ts: r.ts, employeeId: r.employee_id, by: r.by_id, text: r.text }));
  }
}
```

(The snippet markers `«»` are only there so FTS5 has something to wrap the match with; they are stripped, the employee gets plain text.)

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @cc/office-server exec vitest run test/memory-store.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/office-server/src/company/memory-store.ts apps/office-server/test/memory-store.test.ts
git commit -m "feat(memory): stores for decisions, playbook versions, notes and employee files

Notes are searched through FTS5 with every word prefix-matched and quoted, so a
query can never be an FTS syntax error; Turkish letters are folded."
```

---

### Task 3: The office guide on its own file

**Files:**
- Modify: `apps/office-server/src/desk.ts`, `apps/office-server/src/company/roles.ts`
- Test: `apps/office-server/test/desk.test.ts`, `apps/office-server/test/company.test.ts`

**Interfaces:**
- Produces: `GUIDE_FILE = 'office-guide.md'`, `guideText(kind: EmployeeKind): string` (desk.ts); `roleCard` imports `@office-guide.md` instead of inlining the guide; `prepareDesk` writes `office-guide.md` for the employee's kind at every call and appends a missing import once; `writeRoleCard` writes the card and the guide.

- [ ] **Step 1: Write the failing tests**

In `apps/office-server/test/desk.test.ts`:
- change the import from `../src/desk.ts` to `import { GUIDE_FILE, deskDir, prepareDesk, roleCard, writeRoleCard } from '../src/desk.ts';`
- replace the whole `describe('role card', …)` block with:

```ts
describe('role card', () => {
  it('names the person and their job, and imports the office guide and the company brief', () => {
    const card = roleCard(person());
    expect(card).toContain('# Ada — Testçi');
    expect(card).toContain('ekibin: Kalite');
    expect(card).toContain('Testleri yazar.');
    expect(card).toContain('@office-guide.md');
    expect(card).toContain('@company-brief.md');
    expect(card).not.toContain('taskFinish');
  });

  it('writes the guide for the employee’s kind on the desk at every start', () => {
    const dataDir = tempDir();
    const dir = prepareDesk(dataDir, person());
    const guide = () => readFileSync(join(dir, GUIDE_FILE), 'utf8');
    expect(guide()).toContain('taskFinish');
    expect(guide()).toContain('taskPass');
    expect(guide()).toContain('memorySearch');
    expect(guide()).toContain('noteWrite');
    expect(guide()).not.toContain('planPropose');
    prepareDesk(dataDir, person({ kind: 'coordinator', title: 'Koordinatör' }));
    expect(guide()).toContain('planPropose');
    expect(guide()).toMatch(/sahibi kartı onaylamadan/i);
    expect(guide()).toContain('employeeNote');
    prepareDesk(dataDir, person({ kind: 'lead' }));
    expect(guide()).toContain('decisionRecord');
    expect(guide()).not.toContain('planPropose');
  });
});
```

- in `describe('desk', …)` replace the first test ("copies the company brief onto the desk and keeps a card the owner edited") with:

```ts
  it('copies the company brief onto the desk and keeps a card the owner edited', () => {
    const dataDir = tempDir();
    const e = person();
    const dir = prepareDesk(dataDir, e);
    expect(readFileSync(join(dir, BRIEF_FILE), 'utf8')).toBe(DEFAULT_BRIEF);
    const edited = 'elle yazılmış kart\n\n@office-guide.md\n\n@company-brief.md\n';
    writeFileSync(join(dir, 'CLAUDE.md'), edited);
    prepareDesk(dataDir, e);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(edited);
  });
```

- replace the second test ("gives a desk from before the company its brief once…") with:

```ts
  it('review focus: gives a desk from before the company its guide and brief once, without rewriting the card', () => {
    const dataDir = tempDir();
    const e = person();
    const dir = deskDir(dataDir, e.slug);
    prepareDesk(dataDir, e);
    writeFileSync(join(dir, 'CLAUDE.md'), '# Ada\n\neski kart\n');
    prepareDesk(dataDir, e);
    prepareDesk(dataDir, e);
    const card = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    expect(card.startsWith('# Ada\n\neski kart\n')).toBe(true);
    expect(card.match(/@company-brief\.md/g)).toHaveLength(1);
    expect(card.match(/@office-guide\.md/g)).toHaveLength(1);
  });
```

- extend the "rewrites the card when the coordinator changes it" test with, at its end:

```ts
    writeRoleCard(dataDir, { ...e, kind: 'coordinator' });
    expect(readFileSync(join(deskDir(dataDir, e.slug), GUIDE_FILE), 'utf8')).toContain('planPropose');
```

In `apps/office-server/test/company.test.ts` change the three reads of `'CLAUDE.md'` that expect `planPropose` (in "hires a coordinator once…" and "makes an employee coordinator…") to read `'office-guide.md'` instead: `readFileSync(join(deskDir(t.dataDir, c.slug), 'office-guide.md'), 'utf8')` and `readFileSync(join(deskDir(t.dataDir, ada.slug), 'office-guide.md'), 'utf8')`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/desk.test.ts test/company.test.ts`
Expected: FAIL — `GUIDE_FILE` is not exported; no `office-guide.md`.

- [ ] **Step 3: The guide mentions the memory**

In `apps/office-server/src/company/roles.ts` replace `MEMBER`, `LEAD` and `COORDINATOR` with:

```ts
const MEMBER = `- Sana verilen işler "Görev" başlığıyla bir mesaj olarak gelir. İş bitince \`taskFinish\` aracıyla teslim et:
  kısa özet, ürettiğin dosyalar (outputs; ofis bunları arşive kopyalar), öğrendiklerin (learned; şirket notlarına
  geçer). Takılırsan \`taskUpdate\` ile durumu "blocked" yap ve nedenini yaz.
- Başka birinin yapması gereken bir iş çıkarsa \`taskPass\` ile ona görev pasla (ne, neden, bitti tanımı).
  Kimin ne yaptığını \`officeStatus\` gösterir; \`myTasks\` kendi sıranı listeler.
- Şirketin hafızası var: bir işe başlamadan \`memorySearch\` ile daha önce öğrenilenlere, \`playbookRead\` ile
  çalışma yöntemlerine, \`decisionsRead\` ile verilmiş kararlara bak. Başkasının işine yarayacak bir şey öğrenince
  \`noteWrite\` ile yaz.
- Şirket özeti aşağıdadır; güncelini \`briefRead\` okur.`;

const LEAD = `- Ekip liderisin: ekibine \`taskCreate\` ile iş açar, \`taskAssign\` ve \`taskReprioritize\` ile dağıtır, sıralarsın.
- Bir yöntem netleşince ya da değişince \`playbookUpdate\` ile el kitabına yaz (konu, metin, neden). Önemli bir seçim
  yapınca \`decisionRecord\` ile kaydet: ne seçildi, neden, hangi alternatifler vardı.`;

const COORDINATOR = `- Sen şirketin koordinatörüsün; sahibi seninle konuşur. Bir ihtiyaç gelince önce \`planPropose\` ile bir plan kartı aç:
  hedef, yaklaşım, kimler (mevcutlar ve işe alınacaklar), görev taslağı, tahmini kota payı, para ve süre, riskler.
  Sahibiyle tartış, \`planRevise\` ile güncelle. Sahibi kartı onaylamadan işe başlama.
- Onay gelince görevleri \`taskCreate\` ile aç ve doğru kişilere ver; gerekiyorsa \`hire\` ile çalışan al — rol kartını,
  modeli ve karakteri sen seçersin. Masa sayısı sınırlıdır; kimseyi işten çıkaramazsın, bunu yalnız sahibi yapar.
- Model seçimi: muhakeme, mimari ve araştırma kararları → fable; karmaşık geliştirme → opus; rutin yazılım ve yazı →
  sonnet; basit, tekrarlı işler → haiku.
- Küçük değişikliklere sen karar ver, \`decisionRecord\` ile kaydet ve \`reportToOwner\` ile bildir. Hedef ya da kapsam
  değişiyorsa, harcama onaylanan bütçeyi aşıyorsa ya da süre ciddi uzuyorsa sahibine \`planRevise\` ile yeni bir sürüm
  getir ve onay bekle. Sahibi bir kararı geri alırsa sana haber gelir; gereğini yap.
- Şirket özetini \`briefUpdate\` ile güncel tut: misyon, süren planlar, kim ne yapıyor, temel kurallar.
- Her çalışan hakkındaki gözlemlerini \`employeeNote\` ile çalışan dosyasına yaz (kim neyde iyi, neye dikkat); işi
  verirken bu dosyalara bak.
- Bir plan bitince ve günde bir kez kısa bir özetle \`reportToOwner\` kullan.`;
```

- [ ] **Step 4: Desk**

Replace `apps/office-server/src/desk.ts` with:

```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Employee, EmployeeKind } from '@cc/shared';
import { BRIEF_FILE, readBrief } from './company/brief.ts';
import { officeGuide } from './company/roles.ts';

export function deskDir(dataDir: string, slug: string): string {
  return join(dataDir, 'desks', slug);
}

/** The office's working rules for one kind of employee, kept current on every desk (headless claude imports only from the desk). */
export const GUIDE_FILE = 'office-guide.md';
const GUIDE_IMPORT = `@${GUIDE_FILE}`;
const BRIEF_IMPORT = `@${BRIEF_FILE}`;

export function guideText(kind: EmployeeKind): string {
  return `# Ofiste nasıl çalışırsın\n\n${officeGuide(kind)}\n`;
}

export function roleCard(e: Pick<Employee, 'name' | 'role' | 'title' | 'team' | 'kind'>): string {
  return `# ${e.name}${e.title ? ` — ${e.title}` : ''}

Sen bu ofiste çalışan ${e.name} adlı bir çalışansın${e.team ? `; ekibin: ${e.team}` : ''}. Bu klasör senin masan: dosyalarını
burada tutar, işlerini burada yaparsın.

## Rolün

${e.role}

## Ofiste nasıl çalışırsın

${GUIDE_IMPORT}

## Şirket

${BRIEF_IMPORT}
`;
}

/**
 * Idempotent: creates the desk and its role card once (never rewrites a card the owner or coordinator edited), gives a
 * card from before the company each import once, and refreshes the office guide and the brief copy on the desk.
 */
export function prepareDesk(dataDir: string, e: Employee): string {
  const dir = deskDir(dataDir, e.slug);
  mkdirSync(dir, { recursive: true });
  const card = join(dir, 'CLAUDE.md');
  if (!existsSync(card)) writeFileSync(card, roleCard(e));
  else {
    const text = readFileSync(card, 'utf8');
    if (!text.includes(GUIDE_IMPORT)) appendFileSync(card, `\n## Ofiste nasıl çalışırsın\n\n${GUIDE_IMPORT}\n`);
    if (!text.includes(BRIEF_IMPORT)) appendFileSync(card, `\n## Şirket\n\n${BRIEF_IMPORT}\n`);
  }
  writeFileSync(join(dir, GUIDE_FILE), guideText(e.kind));
  writeFileSync(join(dir, BRIEF_FILE), readBrief(dataDir));
  return dir;
}

/** The coordinator changed someone's role card (or their kind): write the card and their guide out again. */
export function writeRoleCard(dataDir: string, e: Employee): void {
  const dir = deskDir(dataDir, e.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'CLAUDE.md'), roleCard(e));
  writeFileSync(join(dir, GUIDE_FILE), guideText(e.kind));
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @cc/office-server exec vitest run test/desk.test.ts test/company.test.ts && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src/desk.ts apps/office-server/src/company/roles.ts apps/office-server/test/desk.test.ts apps/office-server/test/company.test.ts
git commit -m "feat(memory): the office guide lives in its own file, kept current on every desk

The role card imports office-guide.md, written for the employee's kind at every
session start, so a change to the office's rules reaches everyone; the guide now
points at the company memory (memorySearch, noteWrite, playbook, decisions,
employee files)."
```

---

### Task 4: The Memory service

**Files:**
- Create: `apps/office-server/src/company/text.ts`, `apps/office-server/src/company/memory.ts`
- Modify: `apps/office-server/src/company/company.ts` (import `clean`, `lines` from `./text.ts` instead of its own copies)
- Test: `apps/office-server/test/memory.test.ts`

**Interfaces:**
- Consumes: the stores (Task 2), `Roster`, `EventStore`, `NoticeStore`, `PlanStore`, `TaskStore`, `slugify` (`../roster.ts`), `OWNER`.
- Produces:
  - `text.ts`: `clean(value: string | undefined, label: string, max: number, required: boolean): string`, `lines(items: string[] | undefined, label: string, maxItems: number, itemMax: number): string[]`, `fold(s: string): string`, `words(s: string): string[]`
  - `interface MemoryDeps { roster; events; notices; tasks; plans; decisions; playbook; notes; employeeNotes; dataDir: string }`
  - `class Memory` with: `recordDecision(by, d: { title; chosen; reason; alternatives?: string[]; planId?: string | null }): Decision`, `decisions(o?: { query?: string; planId?: string; limit?: number }): Decision[]`, `revertDecision(id): Decision`, `updatePlaybook(by, p: { topic; text; reason?: string }): PlaybookEntry`, `playbookTopics(): PlaybookEntry[]`, `playbookTopic(topic): PlaybookEntry`, `playbookHistory(topic): PlaybookEntry[]`, `writeNote(by, n: { title; text; tags?: string[]; source?: string | null }): Note`, `notes(query?: string, limit?: number): Array<{ note: Note; snippet: string }>`, `search(query: string, limit?: number): MemoryHit[]`, `learnedFrom(task: Task, result: TaskResult): Note | null`, `addEmployeeNote(by, employeeId, text): EmployeeNote`, `employeeFile(id): EmployeeFile`

- [ ] **Step 1: Write the failing test**

Create `apps/office-server/test/memory.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type StoredEvent } from '@cc/shared';
import { Company } from '../src/company/company.ts';
import { Memory } from '../src/company/memory.ts';
import { DecisionStore, EmployeeNoteStore, NoteStore, PlaybookStore } from '../src/company/memory-store.ts';
import { NoticeStore, PlanStore, TaskStore } from '../src/company/store.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make() {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const tasks = new TaskStore(s.db);
  const plans = new PlanStore(s.db);
  const notices = new NoticeStore(s.db);
  const memory = new Memory({
    roster: s.roster, events: s.events, notices, tasks, plans, dataDir: s.dataDir,
    decisions: new DecisionStore(s.db), playbook: new PlaybookStore(s.db), notes: new NoteStore(s.db), employeeNotes: new EmployeeNoteStore(s.db),
  });
  const company = new Company({ roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => f.engine.hire(i), characters: () => ['coder'] });
  const c = company.hireCoordinator();
  const ada = company.hire(c.id, { name: 'Ada', role: 'r' });
  return { ...s, tasks, plans, notices, memory, company, c, ada };
}

const ofType = (events: StoredEvent[], type: string) => events.filter((e) => e.event.type === type);

describe('Memory — decisions', () => {
  it('records the coordinator’s and leads’ decisions, refuses members, and filters by words and plan', () => {
    const t = make();
    const plan = t.company.propose(t.c.id, { title: 'Video', goal: 'g', approach: 'a' });
    const d = t.memory.recordDecision(t.c.id, { title: 'Ses aracı', chosen: 'ElevenLabs', reason: 'Türkçe sesleri iyi', alternatives: ['Polly'], planId: plan.id });
    expect(d).toMatchObject({ by: t.c.id, alternatives: ['Polly'], planId: plan.id, reverts: null });
    expect(ofType(t.events.list({ limit: 500 }), 'decision.recorded')).toHaveLength(1);
    expect(() => t.memory.recordDecision(t.ada.id, { title: 'x', chosen: 'y', reason: 'z' })).toThrow(/koordinatör ya da ekip lideri/);
    t.roster.update(t.ada.id, { kind: 'lead' });
    t.memory.recordDecision(t.ada.id, { title: 'Kurgu', chosen: 'CapCut', reason: 'hızlı' });
    expect(t.memory.decisions({ query: 'turkce' }).map((x) => x.title)).toEqual(['Ses aracı']);
    expect(t.memory.decisions({ planId: plan.id })).toHaveLength(1);
    expect(t.memory.decisions().map((x) => x.title)).toEqual(['Kurgu', 'Ses aracı']);
    expect(() => t.memory.recordDecision(t.c.id, { title: 'x', chosen: 'y', reason: 'z', planId: 'nope' })).toThrow(/Plan bulunamadı/);
  });

  it('review focus: the owner reverts a decision once; the coordinator is told; a revert cannot be reverted', () => {
    const t = make();
    const d = t.memory.recordDecision(t.c.id, { title: 'Ses aracı', chosen: 'ElevenLabs', reason: 'iyi' });
    const r = t.memory.revertDecision(d.id);
    expect(r).toMatchObject({ by: OWNER, reverts: d.id });
    expect(t.notices.pending(t.c.id).at(-1)?.text).toContain('Ses aracı');
    expect(() => t.memory.revertDecision(d.id)).toThrow(/zaten geri alındı/);
    expect(() => t.memory.revertDecision(r.id)).toThrow(/geri alma; geri alınamaz/);
    expect(t.memory.decisions()).toHaveLength(2);
  });
});

describe('Memory — playbook', () => {
  it('versions a topic, writes its file, matches topic names loosely and lists topics when one is missing', () => {
    const t = make();
    expect(() => t.memory.playbookTopic('Test')).toThrow(/Henüz hiç konu yazılmadı/);
    t.memory.updatePlaybook(t.c.id, { topic: 'Test prosedürü', text: 'Önce birim testleri.', reason: 'ilk' });
    const second = t.memory.updatePlaybook(t.c.id, { topic: 'test PROSEDÜRÜ', text: 'Birim, sonra uçtan uca.', reason: 'e2e eklendi' });
    expect(second).toMatchObject({ topic: 'Test prosedürü', version: 2 });
    expect(t.memory.playbookTopic('TEST prosedürü').text).toBe('Birim, sonra uçtan uca.');
    expect(t.memory.playbookHistory('test prosedürü').map((p) => p.version)).toEqual([2, 1]);
    const file = join(t.dataDir, 'company', 'playbook', 'test-proseduru.md');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('uçtan uca');
    expect(() => t.memory.playbookTopic('Sürüm')).toThrow(/Konular: Test prosedürü/);
    expect(() => t.memory.updatePlaybook(t.ada.id, { topic: 'x', text: 'y' })).toThrow(/koordinatör ya da ekip lideri/);
    expect(ofType(t.events.list({ limit: 500 }), 'playbook.updated')).toHaveLength(2);
  });
});

describe('Memory — notes and search', () => {
  it('anyone writes notes; search finds notes, decisions, playbook topics and finished work, newest first', () => {
    const t = make();
    t.memory.writeNote(t.ada.id, { title: 'Seslendirme', text: 'ElevenLabs Türkçe sesleri iyi.', tags: ['Video', 'ses'] });
    t.memory.recordDecision(t.c.id, { title: 'Ses aracı seçimi', chosen: 'ElevenLabs', reason: 'Türkçe' });
    t.memory.updatePlaybook(t.c.id, { topic: 'Video üretimi', text: 'Ses için ElevenLabs kullan.' });
    const task = t.company.createTask(t.c.id, { assignee: t.ada.id, title: 'Ses denemesi' });
    t.company.start(task.id);
    t.company.finish(t.ada.id, task.id, { summary: 'ElevenLabs ile 3 ses denendi.', outputs: [], learned: '' });
    const hits = t.memory.search('elevenlabs');
    expect(hits.map((h) => h.kind).sort()).toEqual(['decision', 'note', 'playbook', 'task']);
    expect([...hits].sort((a, b) => b.ts - a.ts)).toEqual(hits);
    expect(t.memory.notes('türkçe')[0]?.note.tags).toEqual(['video', 'ses']);
    expect(t.memory.notes()).toHaveLength(1);
    expect(() => t.memory.search(' "*" ')).toThrow(/en az bir kelime/);
    expect(ofType(t.events.list({ limit: 500 }), 'note.written')).toHaveLength(1);
  });

  it('turns what a hand-in taught into a note, and nothing when it taught nothing', () => {
    const t = make();
    const task = t.company.createTask(t.c.id, { assignee: t.ada.id, title: 'Kurulum' });
    const note = t.memory.learnedFrom(task, { summary: 's', outputs: [], learned: 'pnpm 9 gerekiyor.' });
    expect(note).toMatchObject({ by: t.ada.id, title: 'Öğrenilen: Kurulum', text: 'pnpm 9 gerekiyor.', source: `task:${task.id}` });
    expect(t.memory.learnedFrom(task, { summary: 's', outputs: [], learned: '  ' })).toBeNull();
  });
});

describe('Memory — employee files', () => {
  it('keeps the coordinator’s notes and the track record of each employee, also after they leave', async () => {
    const t = make();
    t.memory.addEmployeeNote(t.c.id, t.ada.id, 'Testte çok iyi.');
    expect(() => t.memory.addEmployeeNote(t.ada.id, t.ada.id, 'x')).toThrow(/Yalnız koordinatör/);
    for (const title of ['bir', 'iki']) {
      const task = t.company.createTask(t.c.id, { assignee: t.ada.id, title });
      t.company.start(task.id);
      t.company.finish(t.ada.id, task.id, { summary: `${title} bitti`, outputs: [], learned: '' });
    }
    t.roster.update(t.ada.id, { lifecycle: 'archived' });
    const file = t.memory.employeeFile(t.ada.id);
    expect(file.notes.map((n) => n.text)).toEqual(['Testte çok iyi.']);
    expect(file.finished).toBe(2);
    expect(file.recent.map((r) => r.title)).toEqual(['iki', 'bir']);
    expect(file.employee.lifecycle).toBe('archived');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/memory.test.ts`
Expected: FAIL — cannot resolve `../src/company/memory.ts`.

- [ ] **Step 3: Shared text helpers**

Create `apps/office-server/src/company/text.ts`:

```ts
import { ValidationError } from '../errors.ts';

export function clean(value: string | undefined, label: string, max: number, required: boolean): string {
  const text = (value ?? '').trim();
  if (required && !text) throw new ValidationError(`${label} boş olamaz.`);
  if (text.length > max) throw new ValidationError(`${label} en fazla ${max} karakter olabilir.`);
  return text;
}

export function lines(items: string[] | undefined, label: string, maxItems: number, itemMax: number): string[] {
  const out = (items ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (out.length > maxItems) throw new ValidationError(`${label} en fazla ${maxItems} madde olabilir.`);
  for (const item of out) if (item.length > itemMax) throw new ValidationError(`${label} maddeleri en fazla ${itemMax} karakter olabilir.`);
  return out;
}

/** Turkish-aware case and diacritic folding for matching in code ("İSTANBUL", "istanbul", "Türkçe" ≈ "turkce"). */
export function fold(s: string): string {
  return s.toLocaleLowerCase('tr').normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i');
}

export function words(s: string): string[] {
  return fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 8);
}
```

In `apps/office-server/src/company/company.ts` delete its local `clean` and `lines` functions and add `import { clean, lines } from './text.ts';`.

- [ ] **Step 4: Implement the service**

Create `apps/office-server/src/company/memory.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Decision, Employee, EmployeeFile, EmployeeNote, MemoryHit, Note, OfficeEvent, PlaybookEntry, Task, TaskResult } from '@cc/shared';
import { OWNER } from '@cc/shared';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.ts';
import type { EventStore } from '../event-store.ts';
import { slugify, type Roster } from '../roster.ts';
import type { DecisionStore, EmployeeNoteStore, NoteStore, PlaybookStore } from './memory-store.ts';
import type { NoticeStore, PlanStore, TaskStore } from './store.ts';
import { clean, fold, lines, words } from './text.ts';

export interface MemoryDeps {
  roster: Roster;
  events: EventStore;
  notices: NoticeStore;
  tasks: TaskStore;
  plans: PlanStore;
  decisions: DecisionStore;
  playbook: PlaybookStore;
  notes: NoteStore;
  employeeNotes: EmployeeNoteStore;
  dataDir: string;
}

function matches(haystack: string, ws: string[]): boolean {
  const h = fold(haystack);
  return ws.every((w) => h.includes(w));
}

function snippetOf(text: string, ws: string[], width = 180): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = Math.max(0, fold(flat).indexOf(ws[0] ?? ''));
  const start = Math.max(0, at - 50);
  return `${start > 0 ? '…' : ''}${flat.slice(start, start + width)}${start + width < flat.length ? '…' : ''}`;
}

/** The company's memory: decisions, the playbook, knowledge notes and employee files (spec §5). */
export class Memory {
  readonly #d: MemoryDeps;

  constructor(d: MemoryDeps) {
    this.#d = d;
  }

  // ── decisions ─────────────────────────────────────────────────────────────

  recordDecision(by: string, d: { title: string; chosen: string; reason: string; alternatives?: string[]; planId?: string | null }): Decision {
    this.#assertLeadOrCoordinator(by);
    const planId = d.planId ?? null;
    if (planId !== null) this.#d.plans.get(planId);
    const decision = this.#d.decisions.create({
      by,
      title: clean(d.title, 'Karar başlığı', 160, true),
      chosen: clean(d.chosen, 'Seçilen', 2000, true),
      reason: clean(d.reason, 'Gerekçe', 4000, true),
      alternatives: lines(d.alternatives, 'Alternatifler', 12, 500),
      planId,
      reverts: null,
    });
    this.#emit(by, { type: 'decision.recorded', decision });
    return decision;
  }

  decisions(o: { query?: string; planId?: string; limit?: number } = {}): Decision[] {
    const all = this.#d.decisions.list({ planId: o.planId, limit: 500 });
    const ws = o.query ? words(o.query) : [];
    const found = ws.length ? all.filter((x) => matches(`${x.title} ${x.chosen} ${x.reason} ${x.alternatives.join(' ')}`, ws)) : all;
    return found.slice(0, o.limit ?? 50);
  }

  /** The owner undoes a decision: a new record says so, and the coordinator is told to act on it (spec §5.2). */
  revertDecision(id: string): Decision {
    const target = this.#d.decisions.get(id);
    if (target.reverts !== null) throw new ConflictError('Bu kayıt zaten bir geri alma; geri alınamaz.');
    if (this.#d.decisions.revertOf(id)) throw new ConflictError('Bu karar zaten geri alındı.');
    const revert = this.#d.decisions.create({
      by: OWNER,
      title: `Geri alındı: ${target.title}`,
      chosen: 'Geri alındı',
      reason: 'Sahibi bu kararı geri aldı.',
      alternatives: [],
      planId: target.planId,
      reverts: target.id,
    });
    const coordinator = this.#coordinator();
    if (coordinator) {
      this.#d.notices.add(
        coordinator.id,
        `Sahibi şu kararı geri aldı: “${target.title}” (seçilen: ${target.chosen}). Gereğini yap; büyük bir değişiklikse planRevise ile sahibine getir.`,
      );
    }
    this.#emit(coordinator?.id ?? null, { type: 'decision.recorded', decision: revert });
    return revert;
  }

  // ── playbook ──────────────────────────────────────────────────────────────

  updatePlaybook(by: string, p: { topic: string; text: string; reason?: string }): PlaybookEntry {
    this.#assertLeadOrCoordinator(by);
    const asked = clean(p.topic, 'Konu', 60, true);
    // The same topic written differently ("test prosedürü" / "Test Prosedürü") is one topic, spelled as first written.
    const topic = this.#findTopic(asked)?.topic ?? asked;
    const entry = this.#d.playbook.write({ topic, text: clean(p.text, 'El kitabı metni', 20000, true), by, reason: clean(p.reason, 'Gerekçe', 500, false) });
    const dir = join(this.#d.dataDir, 'company', 'playbook');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${slugify(topic)}.md`), `# ${topic}\n\n${entry.text}\n`);
    this.#emit(by, { type: 'playbook.updated', topic, version: entry.version, reason: entry.reason });
    return entry;
  }

  playbookTopics(): PlaybookEntry[] {
    return this.#d.playbook.topics();
  }

  playbookTopic(topic: string): PlaybookEntry {
    const found = this.#findTopic(topic);
    if (found) return found;
    const names = this.#d.playbook.topics().map((t) => t.topic);
    throw new NotFoundError(`El kitabında “${topic}” konusu yok.${names.length ? ` Konular: ${names.join(', ')}.` : ' Henüz hiç konu yazılmadı.'}`);
  }

  playbookHistory(topic: string): PlaybookEntry[] {
    return this.#d.playbook.history(this.playbookTopic(topic).topic);
  }

  // ── notes and search ──────────────────────────────────────────────────────

  writeNote(by: string, n: { title: string; text: string; tags?: string[]; source?: string | null }): Note {
    this.#d.roster.get(by);
    const note = this.#d.notes.create({
      by,
      title: clean(n.title, 'Not başlığı', 160, true),
      text: clean(n.text, 'Not metni', 8000, true),
      tags: lines(n.tags, 'Etiketler', 8, 30).map((t) => t.toLocaleLowerCase('tr')),
      source: n.source ?? null,
    });
    this.#emit(by, { type: 'note.written', id: note.id, title: note.title, tags: note.tags });
    return note;
  }

  notes(query?: string, limit = 50): Array<{ note: Note; snippet: string }> {
    return query?.trim() ? this.#d.notes.search(query, limit) : this.#d.notes.list(limit).map((note) => ({ note, snippet: '' }));
  }

  /** Everything the company knows that mentions every word of the query: notes, decisions, playbook topics, finished work. */
  search(query: string, limit = 10): MemoryHit[] {
    const ws = words(query);
    if (ws.length === 0) throw new ValidationError('Arama için en az bir kelime yaz.');
    const hits: MemoryHit[] = this.#d.notes.search(query, limit).map(({ note, snippet }) => ({ kind: 'note', id: String(note.id), title: note.title, snippet, ts: note.ts }));
    for (const x of this.#d.decisions.list({ limit: 500 })) {
      const body = `${x.chosen}. ${x.reason}${x.alternatives.length ? ` (alternatifler: ${x.alternatives.join(', ')})` : ''}`;
      if (matches(`${x.title} ${body}`, ws)) hits.push({ kind: 'decision', id: x.id, title: x.title, snippet: snippetOf(body, ws), ts: x.ts });
    }
    for (const p of this.#d.playbook.topics()) {
      if (matches(`${p.topic} ${p.text}`, ws)) hits.push({ kind: 'playbook', id: p.topic, title: p.topic, snippet: snippetOf(p.text, ws), ts: p.ts });
    }
    for (const t of this.#d.tasks.list({ statuses: ['done'], limit: 100_000 })) {
      if (!t.result) continue;
      const body = `${t.result.summary} ${t.result.learned}`.trim();
      if (matches(`${t.title} ${body}`, ws)) hits.push({ kind: 'task', id: t.id, title: t.title, snippet: snippetOf(body, ws), ts: t.finishedAt ?? t.createdAt });
    }
    return hits.sort((a, b) => b.ts - a.ts).slice(0, limit);
  }

  /** What a hand-in taught goes to the notes, so the next person who searches finds it. */
  learnedFrom(task: Task, result: TaskResult): Note | null {
    if (!result.learned.trim()) return null;
    return this.writeNote(task.assignee, { title: `Öğrenilen: ${task.title}`.slice(0, 160), text: result.learned, tags: ['görev'], source: `task:${task.id}` });
  }

  // ── employee files ────────────────────────────────────────────────────────

  addEmployeeNote(by: string, employeeId: string, text: string): EmployeeNote {
    if (this.#d.roster.get(by).kind !== 'coordinator') throw new ForbiddenError('Yalnız koordinatör bunu yapabilir.');
    const employee = this.#d.roster.get(employeeId);
    return this.#d.employeeNotes.add({ employeeId: employee.id, by, text: clean(text, 'Not', 2000, true) });
  }

  employeeFile(id: string): EmployeeFile {
    const employee = this.#d.roster.get(id);
    const done = this.#d.tasks.list({ assignee: id, statuses: ['done'], limit: 100_000 });
    return {
      employee,
      notes: this.#d.employeeNotes.list(id),
      finished: done.length,
      recent: done
        .slice(-5)
        .reverse()
        .map((t) => ({ id: t.id, title: t.title, summary: t.result?.summary ?? '', finishedAt: t.finishedAt })),
    };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  #findTopic(topic: string): PlaybookEntry | null {
    const wanted = fold(topic.trim());
    return this.#d.playbook.topics().find((t) => fold(t.topic) === wanted) ?? null;
  }

  #coordinator(): Employee | null {
    return this.#d.roster.list().find((e) => e.kind === 'coordinator') ?? null;
  }

  #assertLeadOrCoordinator(by: string): void {
    const kind = this.#d.roster.get(by).kind;
    if (kind !== 'lead' && kind !== 'coordinator') throw new ForbiddenError('Yalnız koordinatör ya da ekip lideri bunu yapabilir.');
  }

  #emit(employeeId: string | null, event: OfficeEvent): void {
    this.#d.events.append(employeeId, event);
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @cc/office-server exec vitest run test/memory.test.ts && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src/company/text.ts apps/office-server/src/company/memory.ts apps/office-server/src/company/company.ts apps/office-server/test/memory.test.ts
git commit -m "feat(memory): the company's memory service

Decisions recorded by the coordinator and leads, reverted once by the owner
(the coordinator is told); a versioned playbook per topic, mirrored to
company/playbook/<topic>.md; notes anyone writes; one search across notes,
decisions, playbook and finished work; what a hand-in taught becomes a note;
employee files with the coordinator's notes and the track record."
```

---

### Task 5: The archive, and hand-ins that feed the memory

**Files:**
- Create: `apps/office-server/src/company/archive.ts`
- Modify: `apps/office-server/src/company/company.ts`
- Test: `apps/office-server/test/archive.test.ts`, `apps/office-server/test/company.test.ts`

**Interfaces:**
- Consumes: `slugify`, `deskDir`, `Memory.learnedFrom` (Task 4).
- Produces:
  - `ARCHIVE_LIMIT_BYTES = 100 * 1024 * 1024`; `archiveTask(o: { dataDir: string; desk: string; task: Task; result: TaskResult; planTitle: string | null; by: string; now: number; limitBytes?: number }): string` — the archive folder (absolute)
  - `CompanyDeps.memory?: Memory`; `Company.finish` stores `result.archive` (relative to the data folder) and calls `memory.learnedFrom`.

- [ ] **Step 1: Write the failing tests**

Create `apps/office-server/test/archive.test.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Task } from '@cc/shared';
import { archiveTask } from '../src/company/archive.ts';
import { tempDir } from './helpers.ts';

const task = (over: Partial<Task> = {}): Task => ({
  id: 'a1b2c3d4-0000-0000-0000-000000000000', kind: 'work', planId: null, title: 'Tanıtım metni', description: '', done: [], requester: 'owner',
  assignee: 'e1', priority: 3, dependsOn: [], status: 'in_progress', chainDepth: 0, note: null, result: null, nudged: false, createdAt: 1,
  startedAt: 1, finishedAt: null, ...over,
});

describe('archiveTask', () => {
  it('copies the outputs into company/archive/<plan>/<date>-<id>-<title>/ and writes teslim.md', () => {
    const dataDir = tempDir();
    const desk = join(dataDir, 'desks', 'ada');
    mkdirSync(join(desk, 'out'), { recursive: true });
    writeFileSync(join(desk, 'metin.md'), 'merhaba');
    writeFileSync(join(desk, 'out', 'a.txt'), 'a');
    const dir = archiveTask({ dataDir, desk, task: task(), result: { summary: 'Metin hazır.', outputs: ['metin.md', 'out'], learned: 'Kısa cümleler iyi.' }, planTitle: 'Lansman Planı', by: 'Ada', now: Date.UTC(2026, 9, 6) });
    expect(dir).toBe(join(dataDir, 'company', 'archive', 'lansman-plani', '2026-10-06-a1b2c3d4-tanitim-metni'));
    expect(readFileSync(join(dir, 'metin.md'), 'utf8')).toBe('merhaba');
    expect(readFileSync(join(dir, 'out', 'a.txt'), 'utf8')).toBe('a');
    const teslim = readFileSync(join(dir, 'teslim.md'), 'utf8');
    expect(teslim).toContain('# Tanıtım metni');
    expect(teslim).toContain('Metin hazır.');
    expect(teslim).toContain('Kısa cümleler iyi.');
    expect(teslim).toContain('metin.md → metin.md');
  });

  it('review focus: missing, outside-the-desk, too big and same-named outputs still give an archive that says what happened', () => {
    const dataDir = tempDir();
    const desk = join(dataDir, 'desks', 'ada');
    const elsewhere = tempDir();
    mkdirSync(join(desk, 'b'), { recursive: true });
    writeFileSync(join(desk, 'rapor.md'), 'r1');
    writeFileSync(join(desk, 'b', 'rapor.md'), 'r2');
    writeFileSync(join(elsewhere, 'dis.txt'), 'dış');
    writeFileSync(join(desk, 'buyuk.bin'), Buffer.alloc(2048));
    const dir = archiveTask({
      dataDir, desk, task: task(), planTitle: null, by: 'Ada', now: 0, limitBytes: 1024,
      result: { summary: 's', outputs: ['rapor.md', 'b/rapor.md', join(elsewhere, 'dis.txt'), 'yok.md', 'buyuk.bin', dataDir], learned: '' },
    });
    expect(dir).toContain(join('archive', 'plansiz'));
    expect(readFileSync(join(dir, 'rapor.md'), 'utf8')).toBe('r1');
    expect(readFileSync(join(dir, '2-rapor.md'), 'utf8')).toBe('r2');
    expect(readFileSync(join(dir, 'dis.txt'), 'utf8')).toBe('dış');
    expect(existsSync(join(dir, 'buyuk.bin'))).toBe(false);
    const teslim = readFileSync(join(dir, 'teslim.md'), 'utf8');
    expect(teslim).toContain('yok.md — bulunamadı');
    expect(teslim).toContain('buyuk.bin — arşive sığmadı');
    expect(teslim).toMatch(/kopyalanamadı|arşive sığmadı/);
  });
});
```

Append to `apps/office-server/test/company.test.ts`:

```ts
describe('Company — hand-ins feed the memory', () => {
  it('archives the outputs, records where, and turns what was learned into a note', async () => {
    const { Memory } = await import('../src/company/memory.ts');
    const { DecisionStore, EmployeeNoteStore, NoteStore, PlaybookStore } = await import('../src/company/memory-store.ts');
    const s = setup();
    const f = fakeEngine(s);
    cleanups.push(f.cleanup, s.cleanup);
    const tasks = new TaskStore(s.db);
    const plans = new PlanStore(s.db);
    const notices = new NoticeStore(s.db);
    const notes = new NoteStore(s.db);
    const memory = new Memory({ roster: s.roster, events: s.events, notices, tasks, plans, dataDir: s.dataDir, decisions: new DecisionStore(s.db), playbook: new PlaybookStore(s.db), notes, employeeNotes: new EmployeeNoteStore(s.db) });
    const company = new Company({ roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => f.engine.hire(i), characters: () => ['coder'], memory });
    const ada = company.hire(OWNER, { name: 'Ada', role: 'r' });
    writeFileSync(join(deskDir(s.dataDir, ada.slug), 'not.md'), 'içerik');
    const task = company.createTask(OWNER, { assignee: ada.id, title: 'Not yaz' });
    company.start(task.id);
    const done = company.finish(ada.id, task.id, { summary: 'Yazıldı.', outputs: ['not.md'], learned: 'Başlık önce gelir.' });
    expect(done.result?.archive).toMatch(/^company\/archive\/plansiz\//);
    expect(readFileSync(join(s.dataDir, done.result!.archive!, 'not.md'), 'utf8')).toBe('içerik');
    expect(notes.list()[0]).toMatchObject({ title: 'Öğrenilen: Not yaz', text: 'Başlık önce gelir.', source: `task:${task.id}` });
  });
});
```

(Add `writeFileSync` to the `node:fs` import at the top of `company.test.ts`.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/archive.test.ts test/company.test.ts`
Expected: FAIL — cannot resolve `../src/company/archive.ts`; `result.archive` undefined.

- [ ] **Step 3: The archive**

Create `apps/office-server/src/company/archive.ts`:

```ts
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import type { Task, TaskResult } from '@cc/shared';
import { slugify } from '../roster.ts';

/** What one hand-in may copy into the archive; the rest stays where it is and teslim.md says so. */
export const ARCHIVE_LIMIT_BYTES = 100 * 1024 * 1024;

/** Bytes under `path`, counting no further than `budget` (links count as nothing: they are copied as links). */
function sizeOf(path: string, budget: number): number {
  const st = lstatSync(path);
  if (!st.isDirectory()) return st.isSymbolicLink() ? 0 : st.size;
  let total = 0;
  for (const entry of readdirSync(path)) {
    total += sizeOf(join(path, entry), budget - total);
    if (total > budget) break;
  }
  return total;
}

/**
 * Copies a hand-in's outputs to company/archive/<plan or "plansiz">/<date>-<task id>-<title>/ and writes teslim.md:
 * what was done, what was learned, and what happened to each output. Never throws for an output it cannot copy.
 */
export function archiveTask(o: { dataDir: string; desk: string; task: Task; result: TaskResult; planTitle: string | null; by: string; now: number; limitBytes?: number }): string {
  const limit = o.limitBytes ?? ARCHIVE_LIMIT_BYTES;
  const day = new Date(o.now).toISOString().slice(0, 10);
  const dir = join(o.dataDir, 'company', 'archive', o.planTitle ? slugify(o.planTitle) : 'plansiz', `${day}-${o.task.id.slice(0, 8)}-${slugify(o.task.title)}`);
  mkdirSync(dir, { recursive: true });
  let budget = limit;
  const used = new Set<string>(['teslim.md']);
  const report: string[] = [];
  for (const output of o.result.outputs) {
    const src = isAbsolute(output) ? output : resolve(o.desk, output);
    if (!existsSync(src)) {
      report.push(`- ${output} — bulunamadı`);
      continue;
    }
    let size: number;
    try {
      size = sizeOf(src, budget);
    } catch {
      report.push(`- ${output} — okunamadı`);
      continue;
    }
    if (size > budget) {
      report.push(`- ${output} — arşive sığmadı (bir teslimde en fazla ${Math.round(limit / 1024 / 1024) || limit} ${limit >= 1024 * 1024 ? 'MB' : 'bayt'}); yerinde: ${src}`);
      continue;
    }
    const base = basename(src) || 'cikti';
    let name = base;
    for (let n = 2; used.has(name); n += 1) name = `${n}-${base}`;
    used.add(name);
    try {
      cpSync(src, join(dir, name), { recursive: true, dereference: false, force: true });
      budget -= size;
      report.push(`- ${output} → ${name}`);
    } catch (err) {
      report.push(`- ${output} — kopyalanamadı: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const body = [
    `# ${o.task.title}`,
    '',
    `Teslim eden: ${o.by} · ${new Date(o.now).toISOString()}`,
    `Plan: ${o.planTitle ?? '—'}`,
    `Görev no: ${o.task.id}`,
    '',
    '## Özet',
    '',
    o.result.summary,
    '',
    ...(o.result.learned ? ['## Öğrenilenler', '', o.result.learned, ''] : []),
    '## Çıktılar',
    '',
    ...(report.length ? report : ['- (yok)']),
    '',
  ];
  writeFileSync(join(dir, 'teslim.md'), body.join('\n'));
  return dir;
}
```

(An output that is a folder containing the archive itself — e.g. the data folder — is refused by `cpSync` ("subdirectory of self") and reported as "kopyalanamadı"; if it is bigger than the budget it is reported as "arşive sığmadı". Either way the test's last line holds.)

- [ ] **Step 4: Hand-ins feed the memory**

In `apps/office-server/src/company/company.ts`:
- imports: `import { relative } from 'node:path';`, `import { archiveTask } from './archive.ts';`, `import type { Memory } from './memory.ts';`
- `CompanyDeps` gains:

```ts
  /** The company memory: a hand-in's lesson becomes a note (absent in tests that do not care). */
  memory?: Memory;
```

- in `finish`, replace the line `const next = this.#d.tasks.update(taskId, { status: 'done', result: handed, finishedAt: this.#now() });` with:

```ts
    const finishedAt = this.#now();
    let archived: TaskResult = handed;
    try {
      const assignee = this.#d.roster.get(task.assignee);
      const planTitle = task.planId ? this.#d.plans.get(task.planId).title : null;
      const dir = archiveTask({ dataDir: this.#d.dataDir, desk: deskDir(this.#d.dataDir, assignee.slug), task, result: handed, planTitle, by: assignee.name, now: finishedAt });
      archived = { ...handed, archive: relative(this.#d.dataDir, dir) };
    } catch {
      // The archive never blocks a hand-in: the result is kept in the database either way.
    }
    const next = this.#d.tasks.update(taskId, { status: 'done', result: archived, finishedAt });
```

- right after `this.#taskEvent('finished', next);` add `this.#d.memory?.learnedFrom(next, handed);`

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @cc/office-server exec vitest run test/archive.test.ts test/company.test.ts && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src/company/archive.ts apps/office-server/src/company/company.ts apps/office-server/test/archive.test.ts apps/office-server/test/company.test.ts
git commit -m "feat(memory): every hand-in is archived and what it taught becomes a note

taskFinish copies the outputs to company/archive/<plan>/<date>-<task>/ with a
teslim.md (summary, lessons, what happened to each output: copied, missing, too
big); the result records where. The archive never blocks a hand-in."
```
