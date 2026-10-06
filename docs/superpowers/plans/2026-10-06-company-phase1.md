# Company Phase 1 — Coordinator and Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A coordinator-led office: the owner discusses plan cards with one coordinator, approves them, and the coordinator hires, creates and assigns tasks that the office delivers to employees, who pass work to each other and hand it in — all visible in a Company view.

**Architecture:** office-server gains a `company/` layer (SQLite stores for plans, tasks and notices; a `Company` service with the business rules; a `Dispatcher` that hands the next task or pending notices to an employee whenever it becomes idle) and an `mcp/` layer (a dependency-free streamable-HTTP MCP endpoint at `/mcp`, per-employee bearer tokens issued at every session start, and the office tools). Every employee session gets `--mcp-config` pointing at `/mcp`. office-web shows plan cards with Onayla/Vazgeç in the coordinator's panel and a Company view (org chart, task board).

**Tech Stack:** Node 24 (native TS type stripping), `node:sqlite`, `ws`, Vitest 3; React 19, zustand 5, @testing-library/react. No new dependencies (the MCP protocol subset is implemented by hand; verified against Claude Code 2.1.291).

**Spec:** `docs/superpowers/specs/2026-10-06-company-design.md` (this plan = §12 phase 1). Background: `docs/superpowers/specs/2026-10-06-office-v1-design.md`.

**Continues in:** `docs/superpowers/plans/2026-10-06-company-phase1-part-2.md` (Tasks 7–12).

## Global Constraints

- TypeScript must run under Node's type stripping: no `enum`, no parameter properties, `import type` for types, `.ts` extensions in relative imports (`erasableSyntaxOnly`).
- Every schema migration ships `up` + `down`; `down` removes exactly what `up` added; the round trip up → down → up is tested.
- User-facing copy is Turkish; tool descriptions (read by the model) are English; tool results and errors are Turkish.
- All employees, the coordinator included, run with permissions skipped (`--permission-mode bypassPermissions`); office tools are called without approval (verified with a spike: claude haiku called an HTTP MCP tool, no denials).
- Local only: `/mcp` is served on 127.0.0.1 behind the existing Host check; it needs a valid per-employee bearer token.
- Commits: plain conventional messages, no AI attribution or trailers.
- Do not push to the remote.
- Fake claude cannot call MCP tools: tool behaviour is tested over HTTP with real tokens; the office side (delivery, notices) with fake claude.

## Spec rulings made while planning

- Spec §3.1 says the office creates the coordinator when it is empty. Ruling: the Company view offers **Koordinatör işe al** (one click) instead of hiring silently — an automatic hire would add an unrequested employee to every new office and to every test office. Cost if wrong: the owner clicks once.
- Spec §7 lists `taskStart`. Ruling: dropped — the office starts a task when it delivers it (Dispatcher). Cost if wrong: one more tool later.
- Model labels in the hire form name the family, not a version ("Fable — en güçlü"): the aliases always resolve to the newest version, so a version number would go stale.

## Review Focus

1. An employee whose turn ends without calling `taskFinish` gets **exactly one** reminder, never a loop (Task 8).
2. Two tasks created while an employee is becoming idle: the employee never holds two tasks in progress (Task 8).
3. A token from a previous session, a made-up token, or a fired employee's token gets 401 and changes nothing (Tasks 5 and 7).
4. Approving a plan twice, declining an approved plan, or creating a task for a draft plan fails with a clear Turkish error (Task 4).
5. A pass chain deeper than 5, or more than 30 tasks a day from one employee, is refused and the coordinator is told (Task 4).

## File Structure

```
packages/shared/src/
  employee.ts        + fable alias, EMPLOYEE_KINDS, Employee.title/team/kind/reportsTo, HireInput fields
  company.ts         NEW Task, Plan, statuses, change kinds
  events.ts          + task.changed, plan.changed, company.report, brief.updated, role.changed; snapshot tasks/plans
  index.ts           + export company.ts
apps/office-server/src/
  migrations.ts      + v2 (employee columns, plans, tasks, notices)
  roster.ts          new columns in create/update/fromRow
  desk.ts            role card with office guide + @company-brief.md; prepareDesk copies the brief; writeRoleCard
  company/brief.ts   NEW brief file: read, write to company/ and every desk
  company/roles.ts   NEW COORDINATOR_ROLE text, officeGuide(kind)
  company/store.ts   NEW TaskStore, PlanStore, NoticeStore
  company/company.ts NEW Company service (rules, limits, events, notices)
  company/dispatcher.ts NEW delivery of tasks and notices to idle employees
  company/characters.ts NEW character ids from assets/3d/manifest.json
  mcp/tokens.ts      NEW TokenRegistry
  mcp/protocol.ts    NEW JSON-RPC handling for /mcp
  mcp/tools.ts       NEW office tools
  claude/args.ts     sessionArgs gets mcpConfig
  engine.ts          tokens + --mcp-config at start, revoke on fire, ready(id)
  api.ts             /mcp, plan approve/decline, coordinator routes, snapshot tasks/plans
  main.ts            wiring
apps/office-server/test/
  db.test.ts, roster.test.ts, desk.test.ts (updated)
  company-store.test.ts, company.test.ts, mcp-protocol.test.ts, mcp-tools.test.ts,
  dispatcher.test.ts, company-api.test.ts (NEW), engine.test.ts (updated), company.smoke.real.test.ts (NEW, opt-in)
apps/office-web/src/
  store/reducers.ts, store/office.ts, net/api.ts, ui/labels.ts, ui/HireDialog.tsx, ui/EventItem.tsx, ui/TopBar.tsx, App.tsx
  ui/PlanCard.tsx, ui/CompanyView.tsx (NEW) + tests; styles.css
```

---

### Task 1: Shared types, migration v2, roster fields

**Files:**
- Modify: `packages/shared/src/employee.ts`, `packages/shared/src/events.ts`, `packages/shared/src/index.ts`
- Create: `packages/shared/src/company.ts`
- Modify: `apps/office-server/src/migrations.ts`, `apps/office-server/src/roster.ts`
- Test: `apps/office-server/test/db.test.ts`, `apps/office-server/test/roster.test.ts`

**Interfaces:**
- Produces: `EMPLOYEE_KINDS`, `EmployeeKind`, `Employee.{title,team,kind,reportsTo}`, `HireInput.{title,team,kind,reportsTo}`; `Task`, `TaskStatus`, `TaskResult`, `Plan`, `PlanStatus`, `TaskChange`, `PlanChange`; events `task.changed {change, task}`, `plan.changed {change, plan}`, `company.report {text}`, `brief.updated`, `role.changed {kind, title, team}`; `OfficeSnapshot.tasks?`, `OfficeSnapshot.plans?`; `EmployeePatch` adds `title`, `team`, `kind`, `reportsTo`, `role`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/office-server/test/db.test.ts` (inside the `describe`), and change the two existing `toBe(1)` / table expectations to the v2 set:

```ts
  it('v2 adds the company tables and employee columns, and v2 down restores v1 exactly', () => {
    const db = openDb(':memory:');
    migrateUp(db);
    expect(appliedVersion(db)).toBe(2);
    expect(tables(db)).toEqual(['employees', 'events', 'notices', 'plans', 'quota', 'schema_migrations', 'tasks']);
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
    expect(db.prepare('SELECT title, team, kind, reports_to FROM employees').get()).toEqual({ title: '', team: '', kind: 'member', reports_to: null });
  });
```

Add the import `import { MIGRATIONS } from '../src/migrations.ts';` and update the first three tests: `expect(migrateUp(db)).toBe(2)` and the full table list `['employees', 'events', 'notices', 'plans', 'quota', 'schema_migrations', 'tasks']` wherever the v1 list was expected after a full `migrateUp`.

Append to `apps/office-server/test/roster.test.ts`:

```ts
describe('Roster — company fields', () => {
  it('stores title, team, kind and who someone reports to, with member defaults', () => {
    const s = setup();
    const lead = s.roster.create({ name: 'Ada', role: 'r', title: 'Koordinatör', team: 'Yönetim', kind: 'coordinator' });
    const dev = s.roster.create({ name: 'Can', role: 'r', reportsTo: lead.id });
    expect(s.roster.get(lead.id)).toMatchObject({ title: 'Koordinatör', team: 'Yönetim', kind: 'coordinator', reportsTo: null });
    expect(s.roster.get(dev.id)).toMatchObject({ title: '', team: '', kind: 'member', reportsTo: lead.id });
    s.cleanup();
  });

  it('refuses an unknown kind and over-long titles', () => {
    const s = setup();
    expect(() => s.roster.create({ name: 'Ada', role: 'r', kind: 'boss' as never })).toThrow(/Bilinmeyen çalışan türü/);
    expect(() => s.roster.create({ name: 'Ada', role: 'r', title: 'x'.repeat(81) })).toThrow(/Unvan/);
    s.cleanup();
  });

  it('updates the role card fields', () => {
    const s = setup();
    const e = s.roster.create({ name: 'Ada', role: 'eski rol' });
    const next = s.roster.update(e.id, { role: 'yeni rol', title: 'Testçi', team: 'Kalite', kind: 'lead', reportsTo: null });
    expect(next).toMatchObject({ role: 'yeni rol', title: 'Testçi', team: 'Kalite', kind: 'lead' });
    expect(s.roster.get(e.id)).toMatchObject({ role: 'yeni rol', title: 'Testçi', team: 'Kalite', kind: 'lead' });
    s.cleanup();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/db.test.ts test/roster.test.ts`
Expected: FAIL — version 1 instead of 2, missing tables, `title`/`kind` undefined.

- [ ] **Step 3: Shared types**

`packages/shared/src/employee.ts` — replace `MODEL_ALIASES` and extend the interfaces:

```ts
/** Claude Code model aliases: each always resolves to the newest model of its family. */
export const MODEL_ALIASES = ['fable', 'opus', 'sonnet', 'haiku'] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];

/** Who someone is in the company: the coordinator (one per office), a team lead, or a member. */
export const EMPLOYEE_KINDS = ['coordinator', 'lead', 'member'] as const;
export type EmployeeKind = (typeof EMPLOYEE_KINDS)[number];
```

Add to `Employee` (after `characterId`):

```ts
  /** Job title written by the coordinator, e.g. "Testçi". Empty when none. */
  title: string;
  team: string;
  kind: EmployeeKind;
  /** The lead or coordinator this employee reports to; null = the coordinator (or nobody, for the coordinator). */
  reportsTo: string | null;
```

Add to `HireInput`:

```ts
  title?: string;
  team?: string;
  kind?: EmployeeKind;
  reportsTo?: string | null;
```

Create `packages/shared/src/company.ts`:

```ts
export const TASK_STATUSES = ['waiting', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskResult {
  summary: string;
  /** Paths of the files the work produced (relative to the employee's desk or absolute). */
  outputs: string[];
  learned: string;
}

/** The id the office uses for the owner wherever a task or plan names who asked. */
export const OWNER = 'owner';

export interface Task {
  id: string;
  planId: string | null;
  title: string;
  description: string;
  /** Definition of done, one item per line. */
  done: string[];
  /** An employee id, or OWNER. */
  requester: string;
  assignee: string;
  /** 1 = most urgent … 5 = whenever. */
  priority: number;
  dependsOn: string[];
  status: TaskStatus;
  /** How many passes deep this task is (a task passed while working on a passed task is one deeper). */
  chainDepth: number;
  note: string | null;
  result: TaskResult | null;
  /** The office reminded the assignee once that this task is still open. */
  nudged: boolean;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export const PLAN_STATUSES = ['draft', 'approved', 'done', 'declined'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export interface Plan {
  id: string;
  title: string;
  goal: string;
  approach: string;
  /** Who works on it: existing employees and roles to hire, in the coordinator's words. */
  people: string;
  /** Draft tasks, one per line. */
  steps: string[];
  /** Estimated share of the weekly subscription quota (%), money (USD) and time (days). */
  quotaPct: number | null;
  usd: number | null;
  days: number | null;
  risks: string;
  status: PlanStatus;
  version: number;
  proposedBy: string;
  createdAt: number;
  updatedAt: number;
  approvedAt: number | null;
}

export type TaskChange = 'created' | 'assigned' | 'started' | 'updated' | 'finished' | 'reprioritized';
export type PlanChange = 'proposed' | 'revised' | 'approved' | 'declined' | 'done';
```

In `packages/shared/src/events.ts`: change the first line to `import type { Employee, EmployeeKind, Lifecycle } from './employee.ts';`, add `import type { Plan, PlanChange, Task, TaskChange } from './company.ts';`, then add these members to the `OfficeEvent` union, just before `| { type: 'error'; message: string };`:

```ts
  | { type: 'task.changed'; change: TaskChange; task: Task }
  | { type: 'plan.changed'; change: PlanChange; plan: Plan }
  | { type: 'company.report'; text: string }
  | { type: 'brief.updated' }
  | { type: 'role.changed'; kind: EmployeeKind; title: string; team: string }
```

and extend `OfficeSnapshot`:

```ts
  /** Open tasks and the most recent finished ones (absent from servers without the company layer). */
  tasks?: Task[];
  plans?: Plan[];
```

`packages/shared/src/index.ts`: add `export * from './company.ts';`.

- [ ] **Step 4: Migration v2**

Append to `MIGRATIONS` in `apps/office-server/src/migrations.ts`:

```ts
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
```

- [ ] **Step 5: Roster columns**

In `apps/office-server/src/roster.ts`:
- import `EMPLOYEE_KINDS` and `type EmployeeKind` from `@cc/shared` (next to `MODEL_ALIASES`);
- add to `Row`: `title: string; team: string; kind: string; reports_to: string | null;`
- add to `fromRow`: `title: r.title, team: r.team, kind: r.kind as EmployeeKind, reportsTo: r.reports_to,`
- replace `EmployeePatch`:

```ts
export type EmployeePatch = Partial<
  Pick<Employee, 'lifecycle' | 'sessionStarted' | 'limitResetsAt' | 'lastError' | 'role' | 'title' | 'team' | 'kind' | 'reportsTo'>
>;
```

- in `create`, after the `characterId` line:

```ts
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (title.length > 80) throw new ValidationError('Unvan en fazla 80 karakter olabilir.');
    const team = typeof input.team === 'string' ? input.team.trim() : '';
    if (team.length > 40) throw new ValidationError('Ekip adı en fazla 40 karakter olabilir.');
    const kind = input.kind ?? 'member';
    if (!(EMPLOYEE_KINDS as readonly unknown[]).includes(kind)) throw new ValidationError(`Bilinmeyen çalışan türü: ${String(kind)}`);
    const reportsTo = typeof input.reportsTo === 'string' && input.reportsTo ? input.reportsTo : null;
```

- add `title, team, kind, reportsTo,` to the `employee` object literal (after `characterId`), and change the INSERT to:

```ts
    this.#db
      .prepare(
        `INSERT INTO employees (id, slug, name, role, model, character_id, desk_index, session_id, session_started,
           lifecycle, limit_resets_at, last_error, created_at, title, team, kind, reports_to)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        employee.id,
        employee.slug,
        employee.name,
        employee.role,
        employee.model,
        employee.characterId,
        employee.deskIndex,
        employee.sessionId,
        0,
        employee.lifecycle,
        null,
        null,
        employee.createdAt,
        employee.title,
        employee.team,
        employee.kind,
        employee.reportsTo,
      );
```

- replace `update`:

```ts
  update(id: string, patch: EmployeePatch): Employee {
    const next = { ...this.get(id), ...patch };
    this.#db
      .prepare(
        `UPDATE employees SET lifecycle = ?, session_started = ?, limit_resets_at = ?, last_error = ?, role = ?, title = ?,
           team = ?, kind = ?, reports_to = ? WHERE id = ?`,
      )
      .run(next.lifecycle, next.sessionStarted ? 1 : 0, next.limitResetsAt, next.lastError, next.role, next.title, next.team, next.kind, next.reportsTo, id);
    return next;
  }
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `pnpm --filter @cc/office-server exec vitest run test/db.test.ts test/roster.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean. (Web code compiles: the new `Employee` fields are only read later; tests that build `Employee` literals get the fields in Task 10.)

If the typecheck fails on web test fixtures that build `Employee` objects, add `title: '', team: '', kind: 'member', reportsTo: null,` to those fixtures now (`apps/office-web/src/**/*.test.ts*`).

- [ ] **Step 7: Run every server test, then commit**

Run: `pnpm --filter @cc/office-server test`
Expected: PASS.

```bash
git add packages/shared apps/office-server/src/migrations.ts apps/office-server/src/roster.ts apps/office-server/test apps/office-web/src
git commit -m "feat(company): roles, plans, tasks and notices in the data model

Migration v2 (reversible) adds title, team, kind and reports_to to employees and
the plans, tasks and notices tables; the shared types and events for them; the
fable model alias."
```

---

### Task 2: Company stores

**Files:**
- Create: `apps/office-server/src/company/store.ts`
- Test: `apps/office-server/test/company-store.test.ts`

**Interfaces:**
- Consumes: `Db` (`../db.ts`), `NotFoundError` (`../errors.ts`), `Task`, `Plan`, `TaskStatus`, `PlanStatus` (`@cc/shared`).
- Produces:
  - `interface NewTask { planId: string | null; title: string; description: string; done: string[]; requester: string; assignee: string; priority: number; dependsOn: string[]; chainDepth: number }`
  - `type TaskPatch = Partial<Pick<Task, 'assignee' | 'priority' | 'status' | 'note' | 'result' | 'nudged' | 'startedAt' | 'finishedAt'>>`
  - `class TaskStore { constructor(db: Db, now?: () => number); create(t: NewTask): Task; get(id: string): Task; list(o?: { assignee?: string; planId?: string; statuses?: TaskStatus[]; limit?: number }): Task[]; update(id: string, patch: TaskPatch): Task; nextFor(assignee: string): Task | null; inProgressOf(assignee: string): Task | null; createdSince(requester: string, since: number): number; openInPlan(planId: string): number }`
  - `interface NewPlan { title: string; goal: string; approach: string; people: string; steps: string[]; quotaPct: number | null; usd: number | null; days: number | null; risks: string; proposedBy: string }`
  - `type PlanPatch = Partial<Omit<Plan, 'id' | 'createdAt' | 'proposedBy'>>`
  - `class PlanStore { constructor(db: Db, now?: () => number); create(p: NewPlan): Plan; get(id: string): Plan; list(limit?: number): Plan[]; update(id: string, patch: PlanPatch): Plan }`
  - `class NoticeStore { constructor(db: Db, now?: () => number); add(employeeId: string, text: string): void; pending(employeeId: string): Array<{ id: number; text: string }>; markDelivered(ids: number[]): void }`

- [ ] **Step 1: Write the failing test**

Create `apps/office-server/test/company-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { migrateUp, openDb } from '../src/db.ts';
import { NoticeStore, PlanStore, TaskStore, type NewTask } from '../src/company/store.ts';

function stores() {
  const db = openDb(':memory:');
  migrateUp(db);
  let t = 1_000;
  const now = () => (t += 1);
  return { tasks: new TaskStore(db, now), plans: new PlanStore(db, now), notices: new NoticeStore(db, now) };
}

const task = (over: Partial<NewTask> = {}): NewTask => ({
  planId: null, title: 'Yaz', description: 'd', done: ['bitti'], requester: 'owner', assignee: 'e1', priority: 3,
  dependsOn: [], chainDepth: 0, ...over,
});

describe('TaskStore', () => {
  it('creates and reads a task with its lists intact', () => {
    const { tasks } = stores();
    const created = tasks.create(task({ done: ['a', 'b'], dependsOn: [] }));
    expect(tasks.get(created.id)).toEqual(created);
    expect(created).toMatchObject({ status: 'waiting', done: ['a', 'b'], note: null, result: null, nudged: false, startedAt: null });
  });

  it('gives the most urgent waiting task first, then the oldest, and skips tasks whose dependencies are not done', () => {
    const { tasks } = stores();
    const later = tasks.create(task({ title: 'sonra', priority: 3 }));
    const urgent = tasks.create(task({ title: 'acil', priority: 1 }));
    const blocked = tasks.create(task({ title: 'bekleyen', priority: 1, dependsOn: [later.id] }));
    expect(tasks.nextFor('e1')?.id).toBe(urgent.id);
    tasks.update(urgent.id, { status: 'done' });
    expect(tasks.nextFor('e1')?.id).toBe(later.id);
    tasks.update(later.id, { status: 'done' });
    expect(tasks.nextFor('e1')?.id).toBe(blocked.id);
    expect(tasks.nextFor('someone-else')).toBeNull();
  });

  it('knows what is in progress, what one person opened lately and how much of a plan is open', () => {
    const { tasks } = stores();
    const a = tasks.create(task({ requester: 'e2', planId: 'p1' }));
    tasks.create(task({ requester: 'e2', planId: 'p1' }));
    expect(tasks.inProgressOf('e1')).toBeNull();
    tasks.update(a.id, { status: 'in_progress', startedAt: 5 });
    expect(tasks.inProgressOf('e1')?.id).toBe(a.id);
    expect(tasks.createdSince('e2', 0)).toBe(2);
    expect(tasks.createdSince('e2', 10_000)).toBe(0);
    expect(tasks.openInPlan('p1')).toBe(2);
    tasks.update(a.id, { status: 'done', result: { summary: 's', outputs: ['x.md'], learned: '' } });
    expect(tasks.openInPlan('p1')).toBe(1);
    expect(tasks.get(a.id).result).toEqual({ summary: 's', outputs: ['x.md'], learned: '' });
  });

  it('lists by assignee, plan and status', () => {
    const { tasks } = stores();
    tasks.create(task({ assignee: 'e1', planId: 'p1' }));
    const b = tasks.create(task({ assignee: 'e2', planId: 'p1' }));
    tasks.update(b.id, { status: 'blocked' });
    expect(tasks.list({ assignee: 'e2' }).map((t) => t.id)).toEqual([b.id]);
    expect(tasks.list({ planId: 'p1' })).toHaveLength(2);
    expect(tasks.list({ statuses: ['blocked'] }).map((t) => t.id)).toEqual([b.id]);
  });

  it('says so in Turkish when a task does not exist', () => {
    expect(() => stores().tasks.get('nope')).toThrow(/Görev bulunamadı/);
  });
});

describe('PlanStore', () => {
  it('creates a draft at version 1 and updates it, newest first in the list', () => {
    const { plans } = stores();
    const first = plans.create({ title: 'A', goal: 'g', approach: 'a', people: 'p', steps: ['1', '2'], quotaPct: 10, usd: null, days: 2, risks: '', proposedBy: 'c' });
    expect(first).toMatchObject({ status: 'draft', version: 1, steps: ['1', '2'], approvedAt: null });
    const second = plans.create({ title: 'B', goal: 'g', approach: 'a', people: 'p', steps: [], quotaPct: null, usd: 5, days: null, risks: 'r', proposedBy: 'c' });
    const approved = plans.update(first.id, { status: 'approved', approvedAt: 7 });
    expect(approved).toMatchObject({ status: 'approved', approvedAt: 7 });
    expect(approved.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(plans.list().map((p) => p.id)).toEqual([second.id, first.id]);
    expect(() => plans.get('nope')).toThrow(/Plan bulunamadı/);
  });
});

describe('NoticeStore', () => {
  it('keeps notices until they are delivered', () => {
    const { notices } = stores();
    notices.add('e1', 'bir');
    notices.add('e1', 'iki');
    notices.add('e2', 'başka');
    const pending = notices.pending('e1');
    expect(pending.map((n) => n.text)).toEqual(['bir', 'iki']);
    notices.markDelivered(pending.map((n) => n.id));
    expect(notices.pending('e1')).toEqual([]);
    expect(notices.pending('e2')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/company-store.test.ts`
Expected: FAIL — cannot resolve `../src/company/store.ts`.

- [ ] **Step 3: Implement the stores**

Create `apps/office-server/src/company/store.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { Plan, PlanStatus, Task, TaskResult, TaskStatus } from '@cc/shared';
import type { Db } from '../db.ts';
import { NotFoundError } from '../errors.ts';

interface TaskRow {
  id: string;
  plan_id: string | null;
  title: string;
  description: string;
  done: string;
  requester: string;
  assignee: string;
  priority: number;
  depends_on: string;
  status: string;
  chain_depth: number;
  note: string | null;
  result: string | null;
  nudged: number;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

function taskFromRow(r: TaskRow): Task {
  return {
    id: r.id,
    planId: r.plan_id,
    title: r.title,
    description: r.description,
    done: JSON.parse(r.done) as string[],
    requester: r.requester,
    assignee: r.assignee,
    priority: r.priority,
    dependsOn: JSON.parse(r.depends_on) as string[],
    status: r.status as TaskStatus,
    chainDepth: r.chain_depth,
    note: r.note,
    result: r.result ? (JSON.parse(r.result) as TaskResult) : null,
    nudged: r.nudged === 1,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

export interface NewTask {
  planId: string | null;
  title: string;
  description: string;
  done: string[];
  requester: string;
  assignee: string;
  priority: number;
  dependsOn: string[];
  chainDepth: number;
}

export type TaskPatch = Partial<Pick<Task, 'assignee' | 'priority' | 'status' | 'note' | 'result' | 'nudged' | 'startedAt' | 'finishedAt'>>;

const OPEN = "('waiting', 'in_progress', 'blocked')";

export class TaskStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  create(t: NewTask): Task {
    const task: Task = { ...t, id: randomUUID(), status: 'waiting', note: null, result: null, nudged: false, createdAt: this.#now(), startedAt: null, finishedAt: null };
    this.#db
      .prepare(
        `INSERT INTO tasks (id, plan_id, title, description, done, requester, assignee, priority, depends_on, status, chain_depth,
           note, result, nudged, created_at, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, NULL, NULL)`,
      )
      .run(task.id, task.planId, task.title, task.description, JSON.stringify(task.done), task.requester, task.assignee, task.priority, JSON.stringify(task.dependsOn), task.status, task.chainDepth, task.createdAt);
    return task;
  }

  get(id: string): Task {
    const row = this.#db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as unknown as TaskRow | undefined;
    if (!row) throw new NotFoundError(`Görev bulunamadı: ${id}`);
    return taskFromRow(row);
  }

  list(o: { assignee?: string; planId?: string; statuses?: TaskStatus[]; limit?: number } = {}): Task[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (o.assignee !== undefined) {
      where.push('assignee = ?');
      params.push(o.assignee);
    }
    if (o.planId !== undefined) {
      where.push('plan_id = ?');
      params.push(o.planId);
    }
    if (o.statuses && o.statuses.length > 0) {
      where.push(`status IN (${o.statuses.map(() => '?').join(', ')})`);
      params.push(...o.statuses);
    }
    const sql = `SELECT * FROM tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at LIMIT ?`;
    const rows = this.#db.prepare(sql).all(...params, o.limit ?? 1000) as unknown as TaskRow[];
    return rows.map(taskFromRow);
  }

  update(id: string, patch: TaskPatch): Task {
    const next = { ...this.get(id), ...patch };
    this.#db
      .prepare('UPDATE tasks SET assignee = ?, priority = ?, status = ?, note = ?, result = ?, nudged = ?, started_at = ?, finished_at = ? WHERE id = ?')
      .run(next.assignee, next.priority, next.status, next.note, next.result ? JSON.stringify(next.result) : null, next.nudged ? 1 : 0, next.startedAt, next.finishedAt, id);
    return next;
  }

  /** The assignee's next task: waiting, every dependency done; most urgent first (1 = most urgent), then oldest. */
  nextFor(assignee: string): Task | null {
    const rows = this.#db
      .prepare("SELECT * FROM tasks WHERE assignee = ? AND status = 'waiting' ORDER BY priority, created_at")
      .all(assignee) as unknown as TaskRow[];
    for (const row of rows) {
      const task = taskFromRow(row);
      const ready = task.dependsOn.every((dep) => {
        const d = this.#db.prepare('SELECT status FROM tasks WHERE id = ?').get(dep) as unknown as { status: string } | undefined;
        return d === undefined || d.status === 'done' || d.status === 'cancelled';
      });
      if (ready) return task;
    }
    return null;
  }

  /** The task the assignee is on now: the one started last (the Dispatcher keeps it to one at a time). */
  inProgressOf(assignee: string): Task | null {
    const row = this.#db
      .prepare("SELECT * FROM tasks WHERE assignee = ? AND status = 'in_progress' ORDER BY started_at DESC, rowid DESC LIMIT 1")
      .get(assignee) as unknown as TaskRow | undefined;
    return row ? taskFromRow(row) : null;
  }

  createdSince(requester: string, since: number): number {
    const row = this.#db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE requester = ? AND created_at >= ?').get(requester, since) as unknown as { n: number };
    return row.n;
  }

  openInPlan(planId: string): number {
    const row = this.#db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE plan_id = ? AND status IN ${OPEN}`).get(planId) as unknown as { n: number };
    return row.n;
  }
}

interface PlanRow {
  id: string;
  title: string;
  goal: string;
  approach: string;
  people: string;
  steps: string;
  quota_pct: number | null;
  usd: number | null;
  days: number | null;
  risks: string;
  status: string;
  version: number;
  proposed_by: string;
  created_at: number;
  updated_at: number;
  approved_at: number | null;
}

function planFromRow(r: PlanRow): Plan {
  return {
    id: r.id,
    title: r.title,
    goal: r.goal,
    approach: r.approach,
    people: r.people,
    steps: JSON.parse(r.steps) as string[],
    quotaPct: r.quota_pct,
    usd: r.usd,
    days: r.days,
    risks: r.risks,
    status: r.status as PlanStatus,
    version: r.version,
    proposedBy: r.proposed_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    approvedAt: r.approved_at,
  };
}

export interface NewPlan {
  title: string;
  goal: string;
  approach: string;
  people: string;
  steps: string[];
  quotaPct: number | null;
  usd: number | null;
  days: number | null;
  risks: string;
  proposedBy: string;
}

export type PlanPatch = Partial<Omit<Plan, 'id' | 'createdAt' | 'proposedBy'>>;

export class PlanStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  create(p: NewPlan): Plan {
    const at = this.#now();
    const plan: Plan = { ...p, id: randomUUID(), status: 'draft', version: 1, createdAt: at, updatedAt: at, approvedAt: null };
    this.#write(plan, true);
    return plan;
  }

  get(id: string): Plan {
    const row = this.#db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as unknown as PlanRow | undefined;
    if (!row) throw new NotFoundError(`Plan bulunamadı: ${id}`);
    return planFromRow(row);
  }

  list(limit = 100): Plan[] {
    const rows = this.#db.prepare('SELECT * FROM plans ORDER BY created_at DESC LIMIT ?').all(limit) as unknown as PlanRow[];
    return rows.map(planFromRow);
  }

  update(id: string, patch: PlanPatch): Plan {
    const next: Plan = { ...this.get(id), ...patch, updatedAt: this.#now() };
    this.#write(next, false);
    return next;
  }

  #write(p: Plan, insert: boolean): void {
    const values = [p.title, p.goal, p.approach, p.people, JSON.stringify(p.steps), p.quotaPct, p.usd, p.days, p.risks, p.status, p.version, p.updatedAt, p.approvedAt];
    if (insert) {
      this.#db
        .prepare(
          `INSERT INTO plans (title, goal, approach, people, steps, quota_pct, usd, days, risks, status, version, updated_at, approved_at, id, proposed_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(...values, p.id, p.proposedBy, p.createdAt);
    } else {
      this.#db
        .prepare(
          `UPDATE plans SET title = ?, goal = ?, approach = ?, people = ?, steps = ?, quota_pct = ?, usd = ?, days = ?, risks = ?, status = ?,
             version = ?, updated_at = ?, approved_at = ? WHERE id = ?`,
        )
        .run(...values, p.id);
    }
  }
}

export class NoticeStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  add(employeeId: string, text: string): void {
    this.#db.prepare('INSERT INTO notices (employee_id, text, created_at, delivered_at) VALUES (?, ?, ?, NULL)').run(employeeId, text, this.#now());
  }

  pending(employeeId: string): Array<{ id: number; text: string }> {
    return this.#db.prepare('SELECT id, text FROM notices WHERE employee_id = ? AND delivered_at IS NULL ORDER BY id').all(employeeId) as unknown as Array<{ id: number; text: string }>;
  }

  markDelivered(ids: number[]): void {
    const at = this.#now();
    for (const id of ids) this.#db.prepare('UPDATE notices SET delivered_at = ? WHERE id = ?').run(at, id);
  }
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @cc/office-server exec vitest run test/company-store.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/office-server/src/company/store.ts apps/office-server/test/company-store.test.ts
git commit -m "feat(company): stores for plans, tasks and notices

Tasks come out of a queue most urgent first, then oldest, skipping those whose
dependencies are not done; notices wait until they are delivered."
```

---

### Task 3: Role cards and the company brief

**Files:**
- Create: `apps/office-server/src/company/roles.ts`, `apps/office-server/src/company/brief.ts`
- Modify: `apps/office-server/src/desk.ts`
- Test: `apps/office-server/test/desk.test.ts`

**Interfaces:**
- Consumes: `Employee`, `EmployeeKind` (`@cc/shared`).
- Produces:
  - `roles.ts`: `COORDINATOR_ROLE: string`, `officeGuide(kind: EmployeeKind): string`
  - `brief.ts`: `DEFAULT_BRIEF: string`, `BRIEF_FILE = 'company-brief.md'`, `briefPath(dataDir: string): string`, `readBrief(dataDir: string): string`, `writeBrief(dataDir: string, text: string, deskDirs: string[]): void`
  - `desk.ts`: `roleCard(e: Pick<Employee, 'name' | 'role' | 'title' | 'team' | 'kind'>): string`, `prepareDesk(dataDir: string, e: Employee): string` (now also copies the brief and upgrades v1 cards once), `writeRoleCard(dataDir: string, e: Employee): void`

- [ ] **Step 1: Write the failing tests**

Replace the role-card tests in `apps/office-server/test/desk.test.ts` with (keep the file's existing imports of `existsSync`, `readFileSync`, `writeFileSync`, `join`, `tempDir`; add the new imports):

```ts
import { BRIEF_FILE, DEFAULT_BRIEF, readBrief, writeBrief } from '../src/company/brief.ts';
import { deskDir, prepareDesk, roleCard, writeRoleCard } from '../src/desk.ts';

const person = (over: Partial<Employee> = {}): Employee => ({
  id: 'e1', slug: 'ada', name: 'Ada', role: 'Testleri yazar.', model: 'haiku', characterId: 'coder', title: 'Testçi', team: 'Kalite',
  kind: 'member', reportsTo: null, deskIndex: 0, sessionId: 's', sessionStarted: false, lifecycle: 'stopped', limitResetsAt: null,
  lastError: null, createdAt: 1, ...over,
});

describe('role card', () => {
  it('names the person and their job, explains the office tools and imports the company brief', () => {
    const card = roleCard(person());
    expect(card).toContain('# Ada — Testçi');
    expect(card).toContain('ekibin: Kalite');
    expect(card).toContain('Testleri yazar.');
    expect(card).toContain('taskFinish');
    expect(card).toContain('taskPass');
    expect(card).toContain('@company-brief.md');
    expect(card).not.toContain('planPropose');
  });

  it("gives the coordinator the coordinator's way of working", () => {
    const card = roleCard(person({ kind: 'coordinator', title: 'Koordinatör' }));
    expect(card).toContain('planPropose');
    expect(card).toContain('sahibi kartı onaylamadan');
    expect(card).toContain('hire');
  });
});

describe('desk', () => {
  it('copies the company brief onto the desk and keeps a card the owner edited', () => {
    const dataDir = tempDir();
    const e = person();
    const dir = prepareDesk(dataDir, e);
    expect(readFileSync(join(dir, BRIEF_FILE), 'utf8')).toBe(DEFAULT_BRIEF);
    writeFileSync(join(dir, 'CLAUDE.md'), 'elle yazılmış kart\n\n@company-brief.md\n');
    prepareDesk(dataDir, e);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('elle yazılmış kart\n\n@company-brief.md\n');
  });

  it('gives a desk from before the company its brief once, without rewriting the card', () => {
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
  });

  it('rewrites the card when the coordinator changes it', () => {
    const dataDir = tempDir();
    const e = person();
    prepareDesk(dataDir, e);
    writeRoleCard(dataDir, { ...e, role: 'Artık sürüm çıkarır.' });
    expect(readFileSync(join(deskDir(dataDir, e.slug), 'CLAUDE.md'), 'utf8')).toContain('Artık sürüm çıkarır.');
  });
});

describe('company brief', () => {
  it('starts with a default, and an update reaches the company folder and every desk', () => {
    const dataDir = tempDir();
    expect(readBrief(dataDir)).toBe(DEFAULT_BRIEF);
    const a = prepareDesk(dataDir, person());
    const b = prepareDesk(dataDir, person({ id: 'e2', slug: 'can', name: 'Can' }));
    writeBrief(dataDir, '# Özet\n\nMisyon: iyi yazılım.\n', [a, b]);
    expect(readBrief(dataDir)).toContain('Misyon');
    for (const dir of [a, b]) expect(readFileSync(join(dir, BRIEF_FILE), 'utf8')).toContain('Misyon');
    expect(existsSync(join(dataDir, 'company', 'brief.md'))).toBe(true);
  });
});
```

(`Employee` comes from `import type { Employee } from '@cc/shared';`.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/desk.test.ts`
Expected: FAIL — cannot resolve `../src/company/brief.ts`.

- [ ] **Step 3: Roles and brief**

Create `apps/office-server/src/company/roles.ts`:

```ts
import type { EmployeeKind } from '@cc/shared';

/** The role card of a coordinator hired from the Company view (the coordinator rewrites the rest of the company). */
export const COORDINATOR_ROLE = `Şirketin koordinatörüsün. Sahibinin ihtiyaçlarını anlar, nasıl çözüleceğine dair plan önerir, onaylanan
planı görevlere bölüp doğru kişilere dağıtırsın. Gerekirse yeni çalışan alırsın; ekibin iş tanımlarını ve çalışma
yöntemlerini sen yazar, iş ilerledikçe değiştirirsin. Kota ve bütçeyi gözetir, öncelikleri buna göre sıralarsın. İşler
yürürken ilerlemeyi izler, sorunları çözer, sahibine raporlarsın.`;

const MEMBER = `- Sana verilen işler "Görev" başlığıyla bir mesaj olarak gelir. İş bitince \`taskFinish\` aracıyla teslim et:
  kısa özet, ürettiğin dosyalar, öğrendiklerin. Takılırsan \`taskUpdate\` ile durumu "blocked" yap ve nedenini yaz.
- Başka birinin yapması gereken bir iş çıkarsa \`taskPass\` ile ona görev pasla (ne, neden, bitti tanımı).
  Kimin ne yaptığını \`officeStatus\` gösterir; \`myTasks\` kendi sıranı listeler.
- Şirket özeti aşağıdadır; güncelini \`briefRead\` okur.`;

const LEAD = `- Ekip liderisin: ekibine \`taskCreate\` ile iş açar, \`taskAssign\` ve \`taskReprioritize\` ile dağıtır, sıralarsın.`;

const COORDINATOR = `- Sen şirketin koordinatörüsün; sahibi seninle konuşur. Bir ihtiyaç gelince önce \`planPropose\` ile bir plan kartı aç:
  hedef, yaklaşım, kimler (mevcutlar ve işe alınacaklar), görev taslağı, tahmini kota payı, para ve süre, riskler.
  Sahibiyle tartış, \`planRevise\` ile güncelle. Sahibi kartı onaylamadan işe başlama.
- Onay gelince görevleri \`taskCreate\` ile aç ve doğru kişilere ver; gerekiyorsa \`hire\` ile çalışan al — rol kartını,
  modeli ve karakteri sen seçersin. Masa sayısı sınırlıdır; kimseyi işten çıkaramazsın, bunu yalnız sahibi yapar.
- Model seçimi: muhakeme, mimari ve araştırma kararları → fable; karmaşık geliştirme → opus; rutin yazılım ve yazı →
  sonnet; basit, tekrarlı işler → haiku.
- Küçük değişikliklere sen karar ver ve \`reportToOwner\` ile bildir. Hedef ya da kapsam değişiyorsa, harcama onaylanan
  bütçeyi aşıyorsa ya da süre ciddi uzuyorsa sahibine \`planRevise\` ile yeni bir sürüm getir ve onay bekle.
- Şirket özetini \`briefUpdate\` ile güncel tut: misyon, süren planlar, kim ne yapıyor, temel kurallar.
- Bir plan bitince ve günde bir kez kısa bir özetle \`reportToOwner\` kullan.`;

/** How someone works with the office: the tools they have and the rules that come with them. */
export function officeGuide(kind: EmployeeKind): string {
  if (kind === 'coordinator') return `${MEMBER}\n${LEAD.replace('Ekip liderisin', 'Ekip lideri gibi de çalışırsın')}\n${COORDINATOR}`;
  if (kind === 'lead') return `${MEMBER}\n${LEAD}`;
  return MEMBER;
}
```

Create `apps/office-server/src/company/brief.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The file every desk imports from its role card (headless claude does not load imports from outside the desk). */
export const BRIEF_FILE = 'company-brief.md';

export const DEFAULT_BRIEF = `# Şirket özeti

Henüz yazılmadı. Koordinatör burada şirketin misyonunu, süren planları, kimin ne yaptığını ve temel kuralları tutar.
`;

export function briefPath(dataDir: string): string {
  return join(dataDir, 'company', 'brief.md');
}

export function readBrief(dataDir: string): string {
  const file = briefPath(dataDir);
  return existsSync(file) ? readFileSync(file, 'utf8') : DEFAULT_BRIEF;
}

/** Writes the brief and the copy on every desk given. */
export function writeBrief(dataDir: string, text: string, deskDirs: string[]): void {
  mkdirSync(join(dataDir, 'company'), { recursive: true });
  writeFileSync(briefPath(dataDir), text);
  for (const dir of deskDirs) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, BRIEF_FILE), text);
  }
}
```

- [ ] **Step 4: Desk**

Replace `apps/office-server/src/desk.ts`:

```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Employee } from '@cc/shared';
import { BRIEF_FILE, readBrief } from './company/brief.ts';
import { officeGuide } from './company/roles.ts';

export function deskDir(dataDir: string, slug: string): string {
  return join(dataDir, 'desks', slug);
}

const BRIEF_IMPORT = `@${BRIEF_FILE}`;

export function roleCard(e: Pick<Employee, 'name' | 'role' | 'title' | 'team' | 'kind'>): string {
  return `# ${e.name}${e.title ? ` — ${e.title}` : ''}

Sen bu ofiste çalışan ${e.name} adlı bir çalışansın${e.team ? `; ekibin: ${e.team}` : ''}. Bu klasör senin masan: dosyalarını
burada tutar, işlerini burada yaparsın.

## Rolün

${e.role}

## Ofiste nasıl çalışırsın

${officeGuide(e.kind)}

## Şirket

${BRIEF_IMPORT}
`;
}

/**
 * Idempotent: creates the desk and its role card once (never overwrites a card the owner or coordinator edited),
 * keeps the desk's copy of the company brief current, and gives a card from before the company its brief import.
 */
export function prepareDesk(dataDir: string, e: Employee): string {
  const dir = deskDir(dataDir, e.slug);
  mkdirSync(dir, { recursive: true });
  const card = join(dir, 'CLAUDE.md');
  if (!existsSync(card)) writeFileSync(card, roleCard(e));
  else if (!readFileSync(card, 'utf8').includes(BRIEF_IMPORT)) appendFileSync(card, `\n## Şirket\n\n${BRIEF_IMPORT}\n`);
  writeFileSync(join(dir, BRIEF_FILE), readBrief(dataDir));
  return dir;
}

/** The coordinator changed someone's role card (or made them coordinator): write it out again. */
export function writeRoleCard(dataDir: string, e: Employee): void {
  const dir = deskDir(dataDir, e.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'CLAUDE.md'), roleCard(e));
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @cc/office-server exec vitest run test/desk.test.ts && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: PASS (engine tests read the card through `prepareDesk`; they keep passing).

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src/company/roles.ts apps/office-server/src/company/brief.ts apps/office-server/src/desk.ts apps/office-server/test/desk.test.ts
git commit -m "feat(company): role cards that explain the office, and the company brief on every desk

Each card names the job, explains the office tools by kind (member, lead,
coordinator) and imports company-brief.md, a copy of the brief kept on the desk
because headless claude does not load imports from outside it. Cards from
before the company get the import once."
```

---

### Task 4: Company service

**Files:**
- Create: `apps/office-server/src/company/company.ts`
- Test: `apps/office-server/test/company.test.ts`

**Interfaces:**
- Consumes: `Roster` (`../roster.ts`), `EventStore` (`../event-store.ts`), `TaskStore`, `PlanStore`, `NoticeStore` (Task 2), `writeRoleCard`, `deskDir`, `prepareDesk` (Task 3, `../desk.ts`), `readBrief`, `writeBrief` (Task 3), `COORDINATOR_ROLE` (Task 3), `ConflictError`, `ForbiddenError`, `ValidationError` (`../errors.ts`), `OWNER` (`@cc/shared`).
- Produces:
  - `LIMITS = { chainDepth: 5, perDay: 30, perPlanOpen: 60 }`
  - `interface CompanyDeps { roster: Roster; events: EventStore; tasks: TaskStore; plans: PlanStore; notices: NoticeStore; dataDir: string; hire: (input: HireInput) => Employee; characters: () => string[]; now?: () => number }`
  - `interface TaskInput { assignee: string; title: string; description?: string; done?: string[]; priority?: number; planId?: string | null; dependsOn?: string[] }`
  - `interface PlanDraft { title: string; goal: string; approach: string; people?: string; steps?: string[]; quotaPct?: number | null; usd?: number | null; days?: number | null; risks?: string }`
  - `class Company` with: `coordinator(): Employee | null`, `status(): StatusLine[]` where `StatusLine = { id: string; name: string; title: string; team: string; kind: EmployeeKind; lifecycle: Lifecycle; task: string | null }`, `hire(by: string, input: HireInput): Employee`, `hireCoordinator(model?: ModelAlias): Employee` (default `'fable'`), `appointCoordinator(id: string): Employee`, `editRoleCard(by: string, id: string, patch: { title?: string; team?: string; role?: string }): Employee`, `createTask(by: string, input: TaskInput): Task`, `assign(by: string, taskId: string, assignee: string): Task`, `reprioritize(by: string, taskId: string, priority: number): Task`, `start(taskId: string): Task`, `update(by: string, taskId: string, u: { note?: string; blocked?: boolean }): Task`, `finish(by: string, taskId: string, result: TaskResult): Task`, `propose(by: string, draft: PlanDraft): Plan`, `revise(by: string, planId: string, draft: Partial<PlanDraft>): Plan`, `approve(planId: string): Plan`, `decline(planId: string): Plan`, `report(by: string, text: string): void`, `brief(): string`, `updateBrief(by: string, text: string): void`, `nameOf(id: string): string`

- [ ] **Step 1: Write the failing test**

Create `apps/office-server/test/company.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type StoredEvent } from '@cc/shared';
import { Company, LIMITS } from '../src/company/company.ts';
import { NoticeStore, PlanStore, TaskStore } from '../src/company/store.ts';
import { deskDir } from '../src/desk.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make(characters: string[] = ['coder', 'designer']) {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const tasks = new TaskStore(s.db);
  const plans = new PlanStore(s.db);
  const notices = new NoticeStore(s.db);
  const company = new Company({ roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => f.engine.hire(i), characters: () => characters });
  return { ...s, engine: f.engine, tasks, plans, notices, company };
}

const ofType = (events: StoredEvent[], type: string) => events.filter((e) => e.event.type === type);

describe('Company — people', () => {
  it('hires a coordinator once, on Fable, with the coordinator card', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    expect(c).toMatchObject({ kind: 'coordinator', model: 'fable', name: 'Koordinatör' });
    expect(t.company.coordinator()?.id).toBe(c.id);
    expect(readFileSync(join(deskDir(t.dataDir, c.slug), 'CLAUDE.md'), 'utf8')).toContain('planPropose');
    expect(() => t.company.hireCoordinator()).toThrow(/zaten bir koordinatör/);
  });

  it('makes an employee coordinator and the previous one a member, rewriting both cards', () => {
    const t = make();
    const old = t.company.hireCoordinator();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const next = t.company.appointCoordinator(ada.id);
    expect(next.kind).toBe('coordinator');
    expect(t.roster.get(old.id).kind).toBe('member');
    expect(readFileSync(join(deskDir(t.dataDir, ada.slug), 'CLAUDE.md'), 'utf8')).toContain('planPropose');
    expect(ofType(t.events.list({ limit: 500 }), 'role.changed')).toHaveLength(2);
  });

  it('hires members only, and picks the least used character when none or an unknown one is given', () => {
    const t = make(['coder', 'designer']);
    const c = t.company.hireCoordinator();
    const a = t.company.hire(c.id, { name: 'Ada', role: 'r', kind: 'coordinator', characterId: 'coder' });
    const b = t.company.hire(c.id, { name: 'Can', role: 'r' });
    const d = t.company.hire(c.id, { name: 'Ece', role: 'r', characterId: 'no-such-model' });
    expect(a.kind).toBe('member');
    expect(b.characterId).toBe('designer');
    expect(['coder', 'designer']).toContain(d.characterId);
    expect(c.characterId).toBe('coder');
  });

  it('lets the coordinator rewrite a role card and announces it', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'eski' });
    const next = t.company.editRoleCard(c.id, ada.id, { title: 'Testçi', team: 'Kalite', role: 'Testleri yazar.' });
    expect(next).toMatchObject({ title: 'Testçi', team: 'Kalite', role: 'Testleri yazar.' });
    expect(readFileSync(join(deskDir(t.dataDir, ada.slug), 'CLAUDE.md'), 'utf8')).toContain('Testleri yazar.');
    expect(() => t.company.editRoleCard(ada.id, c.id, { role: 'x' })).toThrow(/Yalnız koordinatör/);
  });
});

describe('Company — tasks', () => {
  it('creates a task that waits in the assignee queue and is announced', () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'README yaz', done: ['README.md var'] });
    expect(task).toMatchObject({ status: 'waiting', requester: OWNER, priority: 3, chainDepth: 0 });
    const ev = ofType(t.events.list({ limit: 500 }), 'task.changed').at(-1)!;
    expect(ev.employeeId).toBe(ada.id);
    expect(ev.event).toMatchObject({ change: 'created', task: { id: task.id } });
  });

  it('refuses an unknown assignee, an empty title and a priority outside 1–5', () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    expect(() => t.company.createTask(OWNER, { assignee: 'nobody', title: 'x' })).toThrow(/bulunamadı/);
    expect(() => t.company.createTask(OWNER, { assignee: ada.id, title: '  ' })).toThrow(/Başlık/);
    expect(() => t.company.createTask(OWNER, { assignee: ada.id, title: 'x', priority: 9 })).toThrow(/Öncelik/);
  });

  it('review focus: a pass chain deeper than the limit is refused and the coordinator is told', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const [a, b] = [t.company.hire(c.id, { name: 'Ada', role: 'r' }), t.company.hire(c.id, { name: 'Can', role: 'r' })];
    let holder = a;
    let other = b;
    let current = t.company.createTask(OWNER, { assignee: a.id, title: 'kök' });
    t.company.start(current.id);
    for (let depth = 1; depth <= LIMITS.chainDepth; depth += 1) {
      current = t.company.createTask(holder.id, { assignee: other.id, title: `pas ${depth}` });
      expect(current.chainDepth).toBe(depth);
      t.company.start(current.id);
      [holder, other] = [other, holder];
    }
    expect(() => t.company.createTask(holder.id, { assignee: other.id, title: 'bir fazla' })).toThrow(/zincir/);
    expect(t.notices.pending(c.id).some((n) => n.text.includes('zincir'))).toBe(true);
  });

  it('review focus: more than the daily limit from one employee is refused', () => {
    const t = make();
    const [a, b] = [t.company.hire(OWNER, { name: 'Ada', role: 'r' }), t.company.hire(OWNER, { name: 'Can', role: 'r' })];
    for (let i = 0; i < LIMITS.perDay; i += 1) t.company.createTask(a.id, { assignee: b.id, title: `iş ${i}` });
    expect(() => t.company.createTask(a.id, { assignee: b.id, title: 'bir fazla' })).toThrow(/günde/);
  });

  it('starts, blocks and finishes; only the assignee or the coordinator hands it in; requester and coordinator hear', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const [a, b] = [t.company.hire(c.id, { name: 'Ada', role: 'r' }), t.company.hire(c.id, { name: 'Can', role: 'r' })];
    const task = t.company.createTask(a.id, { assignee: b.id, title: 'çevir' });
    expect(t.company.start(task.id)).toMatchObject({ status: 'in_progress' });
    expect(t.company.update(b.id, task.id, { blocked: true, note: 'dosya yok' })).toMatchObject({ status: 'blocked', note: 'dosya yok' });
    expect(t.notices.pending(c.id).at(-1)?.text).toContain('takıldı');
    expect(t.company.update(b.id, task.id, { blocked: false })).toMatchObject({ status: 'in_progress' });
    expect(() => t.company.finish(a.id, task.id, { summary: 's', outputs: [], learned: '' })).toThrow(/Yalnız/);
    const done = t.company.finish(b.id, task.id, { summary: 'çevrildi', outputs: ['tr.md'], learned: '' });
    expect(done).toMatchObject({ status: 'done', result: { summary: 'çevrildi' } });
    expect(t.notices.pending(a.id).at(-1)?.text).toContain('çevrildi');
    expect(t.notices.pending(c.id).at(-1)?.text).toContain('çevrildi');
  });

  it('assigns and reprioritises waiting tasks only, and only for the coordinator', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const [a, b] = [t.company.hire(c.id, { name: 'Ada', role: 'r' }), t.company.hire(c.id, { name: 'Can', role: 'r' })];
    const task = t.company.createTask(c.id, { assignee: a.id, title: 'x' });
    expect(t.company.assign(c.id, task.id, b.id).assignee).toBe(b.id);
    expect(t.company.reprioritize(c.id, task.id, 1).priority).toBe(1);
    expect(() => t.company.assign(a.id, task.id, a.id)).toThrow(/Yalnız koordinatör/);
    t.company.start(task.id);
    expect(() => t.company.assign(c.id, task.id, a.id)).toThrow(/sürüyor/);
  });
});

describe('Company — plans', () => {
  it('proposes a draft, revises it to a new version, and the owner approves it; the coordinator hears', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const plan = t.company.propose(c.id, { title: 'Tanıtım videosu', goal: 'g', approach: 'a', steps: ['senaryo', 'çekim'], usd: 20 });
    expect(plan).toMatchObject({ status: 'draft', version: 1, steps: ['senaryo', 'çekim'], usd: 20, proposedBy: c.id });
    const revised = t.company.revise(c.id, plan.id, { usd: 35, risks: 'kota' });
    expect(revised).toMatchObject({ version: 2, usd: 35, risks: 'kota', status: 'draft' });
    const approved = t.company.approve(plan.id);
    expect(approved.status).toBe('approved');
    expect(t.notices.pending(c.id).at(-1)?.text).toContain('onaylandı');
    const changes = ofType(t.events.list({ limit: 500 }), 'plan.changed').map((e) => (e.event as { change: string }).change);
    expect(changes).toEqual(['proposed', 'revised', 'approved']);
  });

  it('review focus: a second approval, declining an approved plan and tasks for a draft plan fail clearly', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const plan = t.company.propose(c.id, { title: 'P', goal: 'g', approach: 'a' });
    expect(() => t.company.createTask(c.id, { assignee: c.id, title: 'x', planId: plan.id })).toThrow(/onaylanmadı/);
    t.company.approve(plan.id);
    expect(() => t.company.approve(plan.id)).toThrow(/taslak/);
    expect(() => t.company.decline(plan.id)).toThrow(/taslak/);
  });

  it('a revision of an approved plan goes back to draft and needs approval again', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const plan = t.company.propose(c.id, { title: 'P', goal: 'g', approach: 'a' });
    t.company.approve(plan.id);
    expect(t.company.revise(c.id, plan.id, { days: 9 })).toMatchObject({ status: 'draft', version: 2 });
  });

  it('marks a plan done when its last open task is handed in, and tells the coordinator to report', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    const plan = t.company.propose(c.id, { title: 'P', goal: 'g', approach: 'a' });
    t.company.approve(plan.id);
    const task = t.company.createTask(c.id, { assignee: ada.id, title: 'tek iş', planId: plan.id });
    t.company.start(task.id);
    t.company.finish(ada.id, task.id, { summary: 'tamam', outputs: [], learned: '' });
    expect(t.plans.get(plan.id).status).toBe('done');
    expect(t.notices.pending(c.id).at(-1)?.text).toContain('sahibine raporla');
  });

  it('only the coordinator proposes plans and reports to the owner', () => {
    const t = make();
    t.company.hireCoordinator();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    expect(() => t.company.propose(ada.id, { title: 'P', goal: 'g', approach: 'a' })).toThrow(/Yalnız koordinatör/);
    expect(() => t.company.report(ada.id, 'rapor')).toThrow(/Yalnız koordinatör/);
  });
});

describe('Company — brief and status', () => {
  it('updates the brief on every desk and lists who does what', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r', title: 'Yazar' });
    t.company.updateBrief(c.id, '# Özet\n\nMisyon: iyi yazılım.\n');
    expect(readFileSync(join(deskDir(t.dataDir, ada.slug), 'company-brief.md'), 'utf8')).toContain('Misyon');
    const task = t.company.createTask(c.id, { assignee: ada.id, title: 'Blog yazısı' });
    t.company.start(task.id);
    expect(t.company.status().find((l) => l.id === ada.id)).toMatchObject({ name: 'Ada', title: 'Yazar', kind: 'member', task: 'Blog yazısı' });
    expect(() => t.company.updateBrief(ada.id, 'x')).toThrow(/Yalnız koordinatör/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/company.test.ts`
Expected: FAIL — cannot resolve `../src/company/company.ts`.

- [ ] **Step 3: Implement the service**

Create `apps/office-server/src/company/company.ts`:

```ts
import type { Employee, EmployeeKind, HireInput, Lifecycle, ModelAlias, OfficeEvent, Plan, Task, TaskResult } from '@cc/shared';
import { OWNER } from '@cc/shared';
import { deskDir, writeRoleCard } from '../desk.ts';
import { ConflictError, ForbiddenError, ValidationError } from '../errors.ts';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';
import { readBrief, writeBrief } from './brief.ts';
import { COORDINATOR_ROLE } from './roles.ts';
import type { NoticeStore, PlanStore, TaskStore } from './store.ts';

/** The constitution's loop guards (spec §4.6). */
export const LIMITS = { chainDepth: 5, perDay: 30, perPlanOpen: 60 } as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const BRIEF_MAX = 8000;

export interface CompanyDeps {
  roster: Roster;
  events: EventStore;
  tasks: TaskStore;
  plans: PlanStore;
  notices: NoticeStore;
  dataDir: string;
  /** Hires and starts a session (Engine.hire). */
  hire: (input: HireInput) => Employee;
  /** Character ids from the asset manifest. */
  characters: () => string[];
  now?: () => number;
}

export interface TaskInput {
  assignee: string;
  title: string;
  description?: string;
  done?: string[];
  priority?: number;
  planId?: string | null;
  dependsOn?: string[];
}

export interface PlanDraft {
  title: string;
  goal: string;
  approach: string;
  people?: string;
  steps?: string[];
  quotaPct?: number | null;
  usd?: number | null;
  days?: number | null;
  risks?: string;
}

export interface StatusLine {
  id: string;
  name: string;
  title: string;
  team: string;
  kind: EmployeeKind;
  lifecycle: Lifecycle;
  task: string | null;
}

function clean(value: string | undefined, label: string, max: number, required: boolean): string {
  const text = (value ?? '').trim();
  if (required && !text) throw new ValidationError(`${label} boş olamaz.`);
  if (text.length > max) throw new ValidationError(`${label} en fazla ${max} karakter olabilir.`);
  return text;
}

function lines(items: string[] | undefined, label: string, maxItems: number, itemMax: number): string[] {
  const out = (items ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (out.length > maxItems) throw new ValidationError(`${label} en fazla ${maxItems} madde olabilir.`);
  for (const item of out) if (item.length > itemMax) throw new ValidationError(`${label} maddeleri en fazla ${itemMax} karakter olabilir.`);
  return out;
}

function amount(value: number | null | undefined, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new ValidationError(`${label} sıfır ya da pozitif bir sayı olmalı.`);
  return value;
}

export class Company {
  readonly #d: CompanyDeps;
  readonly #now: () => number;

  constructor(d: CompanyDeps) {
    this.#d = d;
    this.#now = d.now ?? Date.now;
  }

  // ── people ────────────────────────────────────────────────────────────────

  coordinator(): Employee | null {
    return this.#d.roster.list().find((e) => e.kind === 'coordinator') ?? null;
  }

  nameOf(id: string): string {
    if (id === OWNER) return 'sahibi';
    try {
      return this.#d.roster.get(id).name;
    } catch {
      return id;
    }
  }

  status(): StatusLine[] {
    return this.#d.roster.list().map((e) => ({
      id: e.id,
      name: e.name,
      title: e.title,
      team: e.team,
      kind: e.kind,
      lifecycle: e.lifecycle,
      task: this.#d.tasks.inProgressOf(e.id)?.title ?? null,
    }));
  }

  /** The owner or the coordinator hires a member; the character is the given one if the manifest has it, else the least used. */
  hire(by: string, input: HireInput): Employee {
    if (by !== OWNER) this.#assertCoordinator(by);
    const characters = this.#d.characters();
    const characterId = input.characterId && characters.includes(input.characterId) ? input.characterId : this.#leastUsedCharacter(characters);
    return this.#d.hire({ ...input, kind: 'member', characterId });
  }

  /** Fable by default: planning and judgement are the hardest work in the company. */
  hireCoordinator(model: ModelAlias = 'fable'): Employee {
    if (this.coordinator()) throw new ConflictError('Ofiste zaten bir koordinatör var.');
    const characters = this.#d.characters();
    const characterId = characters.includes('manager') ? 'manager' : this.#leastUsedCharacter(characters);
    const hired = this.#d.hire({ name: 'Koordinatör', role: COORDINATOR_ROLE, model, title: 'Koordinatör', kind: 'coordinator', characterId });
    this.#emit(hired.id, { type: 'role.changed', kind: hired.kind, title: hired.title, team: hired.team });
    return hired;
  }

  appointCoordinator(id: string): Employee {
    const target = this.#d.roster.get(id);
    if (target.lifecycle === 'archived') throw new ConflictError('Bu çalışan işten çıkarıldı.');
    const previous = this.coordinator();
    if (previous && previous.id !== id) {
      const demoted = this.#d.roster.update(previous.id, { kind: 'member' });
      writeRoleCard(this.#d.dataDir, demoted);
      this.#emit(demoted.id, { type: 'role.changed', kind: demoted.kind, title: demoted.title, team: demoted.team });
    }
    const next = this.#d.roster.update(id, { kind: 'coordinator', reportsTo: null });
    writeRoleCard(this.#d.dataDir, next);
    this.#emit(next.id, { type: 'role.changed', kind: next.kind, title: next.title, team: next.team });
    return next;
  }

  editRoleCard(by: string, id: string, patch: { title?: string; team?: string; role?: string }): Employee {
    this.#assertCoordinator(by);
    const current = this.#d.roster.get(id);
    const next = this.#d.roster.update(id, {
      title: patch.title === undefined ? current.title : clean(patch.title, 'Unvan', 80, false),
      team: patch.team === undefined ? current.team : clean(patch.team, 'Ekip adı', 40, false),
      role: patch.role === undefined ? current.role : clean(patch.role, 'Rol tanımı', 4000, true),
    });
    writeRoleCard(this.#d.dataDir, next);
    this.#emit(id, { type: 'role.changed', kind: next.kind, title: next.title, team: next.team });
    return next;
  }

  // ── tasks ─────────────────────────────────────────────────────────────────

  createTask(by: string, input: TaskInput): Task {
    const assignee = this.#d.roster.get(input.assignee);
    if (assignee.lifecycle === 'archived') throw new ConflictError(`${assignee.name} işten çıkarıldı; ona görev verilemez.`);
    const title = clean(input.title, 'Başlık', 120, true);
    const description = clean(input.description, 'Açıklama', 4000, false);
    const done = lines(input.done, 'Bitti tanımı', 12, 300);
    const priority = input.priority ?? 3;
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) throw new ValidationError('Öncelik 1 (en acil) ile 5 arasında bir tam sayı olmalı.');
    const planId = input.planId ?? null;
    if (planId !== null) {
      const plan = this.#d.plans.get(planId);
      if (plan.status !== 'approved') throw new ConflictError(`“${plan.title}” planı henüz onaylanmadı; görevleri onaydan sonra aç.`);
      if (this.#d.tasks.openInPlan(planId) >= LIMITS.perPlanOpen) throw new ConflictError(`Bu planda en fazla ${LIMITS.perPlanOpen} açık görev olabilir.`);
    }
    const dependsOn = (input.dependsOn ?? []).filter(Boolean);
    for (const dep of dependsOn) this.#d.tasks.get(dep);
    const chainDepth = by === OWNER ? 0 : (this.#d.tasks.inProgressOf(by)?.chainDepth ?? -1) + 1;
    if (chainDepth > LIMITS.chainDepth) {
      this.#tellCoordinator(by, `${this.nameOf(by)} “${title}” görevini paslayamadı: görev zinciri ${LIMITS.chainDepth} halkayı geçti. Zinciri sen çöz.`);
      throw new ConflictError(`Görev zinciri en fazla ${LIMITS.chainDepth} halka olabilir; bu işi koordinatöre bırak.`);
    }
    const isCoordinator = by !== OWNER && this.#d.roster.get(by).kind === 'coordinator';
    if (by !== OWNER && !isCoordinator && this.#d.tasks.createdSince(by, this.#now() - DAY_MS) >= LIMITS.perDay) {
      this.#tellCoordinator(by, `${this.nameOf(by)} bugün ${LIMITS.perDay} görev açtı ve sınıra geldi.`);
      throw new ConflictError(`Bir çalışan günde en fazla ${LIMITS.perDay} görev açabilir.`);
    }
    const task = this.#d.tasks.create({ planId, title, description, done, requester: by, assignee: assignee.id, priority, dependsOn, chainDepth: Math.max(0, chainDepth) });
    this.#taskEvent('created', task);
    return task;
  }

  assign(by: string, taskId: string, assignee: string): Task {
    this.#assertCoordinator(by);
    const task = this.#d.tasks.get(taskId);
    if (task.status === 'in_progress') throw new ConflictError('Bu görev şu an sürüyor; bitmeden başkasına verilemez.');
    if (task.status === 'done' || task.status === 'cancelled') throw new ConflictError('Bu görev kapandı.');
    const target = this.#d.roster.get(assignee);
    if (target.lifecycle === 'archived') throw new ConflictError(`${target.name} işten çıkarıldı.`);
    const next = this.#d.tasks.update(taskId, { assignee: target.id, status: 'waiting', nudged: false });
    this.#taskEvent('assigned', next);
    return next;
  }

  reprioritize(by: string, taskId: string, priority: number): Task {
    this.#assertCoordinator(by);
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) throw new ValidationError('Öncelik 1 (en acil) ile 5 arasında bir tam sayı olmalı.');
    const next = this.#d.tasks.update(taskId, { priority });
    this.#taskEvent('reprioritized', next);
    return next;
  }

  /** The office hands the task to its assignee (Dispatcher). */
  start(taskId: string): Task {
    const next = this.#d.tasks.update(taskId, { status: 'in_progress', startedAt: this.#now(), nudged: false });
    this.#taskEvent('started', next);
    return next;
  }

  update(by: string, taskId: string, u: { note?: string; blocked?: boolean }): Task {
    const task = this.#d.tasks.get(taskId);
    if (task.assignee !== by) throw new ForbiddenError('Yalnız görevi üstlenen durumunu güncelleyebilir.');
    const note = u.note === undefined ? task.note : clean(u.note, 'Not', 2000, false) || null;
    let status = task.status;
    if (u.blocked === true) status = 'blocked';
    if (u.blocked === false && task.status === 'blocked') status = 'in_progress';
    const next = this.#d.tasks.update(taskId, { note, status });
    if (status === 'blocked' && task.status !== 'blocked') {
      this.#tellCoordinator(by, `${this.nameOf(by)} “${task.title}” görevinde takıldı${note ? `: ${note}` : '.'}`);
    }
    this.#taskEvent('updated', next);
    return next;
  }

  finish(by: string, taskId: string, result: TaskResult): Task {
    const task = this.#d.tasks.get(taskId);
    const coordinator = this.coordinator();
    if (task.assignee !== by && coordinator?.id !== by) throw new ForbiddenError('Yalnız görevi üstlenen ya da koordinatör teslim edebilir.');
    if (task.status === 'done' || task.status === 'cancelled') throw new ConflictError('Bu görev zaten kapandı.');
    const handed: TaskResult = {
      summary: (result.summary ?? '').trim().slice(0, 4000),
      outputs: (result.outputs ?? []).map((o) => String(o).trim()).filter(Boolean).slice(0, 30),
      learned: (result.learned ?? '').trim().slice(0, 4000),
    };
    if (!handed.summary) throw new ValidationError('Teslim özeti boş olamaz.');
    const next = this.#d.tasks.update(taskId, { status: 'done', result: handed, finishedAt: this.#now() });
    const line = `Görev bitti: “${task.title}” (${this.nameOf(task.assignee)}): ${handed.summary}`;
    if (task.requester !== OWNER && task.requester !== by) this.#d.notices.add(task.requester, line);
    if (coordinator && coordinator.id !== by && coordinator.id !== task.requester) this.#d.notices.add(coordinator.id, line);
    this.#taskEvent('finished', next);
    if (task.planId) this.#maybeFinishPlan(task.planId);
    return next;
  }

  // ── plans ─────────────────────────────────────────────────────────────────

  propose(by: string, draft: PlanDraft): Plan {
    this.#assertCoordinator(by);
    const plan = this.#d.plans.create({ ...this.#draft(draft), proposedBy: by });
    this.#emit(by, { type: 'plan.changed', change: 'proposed', plan });
    return plan;
  }

  revise(by: string, planId: string, draft: Partial<PlanDraft>): Plan {
    this.#assertCoordinator(by);
    const current = this.#d.plans.get(planId);
    if (current.status === 'done' || current.status === 'declined') throw new ConflictError('Bu plan kapandı; yeni bir plan öner.');
    const merged = this.#draft({
      title: draft.title ?? current.title,
      goal: draft.goal ?? current.goal,
      approach: draft.approach ?? current.approach,
      people: draft.people ?? current.people,
      steps: draft.steps ?? current.steps,
      quotaPct: draft.quotaPct === undefined ? current.quotaPct : draft.quotaPct,
      usd: draft.usd === undefined ? current.usd : draft.usd,
      days: draft.days === undefined ? current.days : draft.days,
      risks: draft.risks ?? current.risks,
    });
    // A revision of an approved plan is a new proposal: it waits for the owner again (rule B, big change).
    const plan = this.#d.plans.update(planId, { ...merged, version: current.version + 1, status: 'draft', approvedAt: null });
    this.#emit(by, { type: 'plan.changed', change: 'revised', plan });
    return plan;
  }

  approve(planId: string): Plan {
    const current = this.#d.plans.get(planId);
    if (current.status !== 'draft') throw new ConflictError('Yalnız taslak bir plan onaylanabilir.');
    const plan = this.#d.plans.update(planId, { status: 'approved', approvedAt: this.#now() });
    this.#d.notices.add(current.proposedBy, `Plan onaylandı: “${plan.title}” (sürüm ${plan.version}). Görevleri aç ve dağıt.`);
    this.#emit(current.proposedBy, { type: 'plan.changed', change: 'approved', plan });
    return plan;
  }

  decline(planId: string): Plan {
    const current = this.#d.plans.get(planId);
    if (current.status !== 'draft') throw new ConflictError('Yalnız taslak bir plan reddedilebilir.');
    const plan = this.#d.plans.update(planId, { status: 'declined' });
    this.#d.notices.add(current.proposedBy, `Sahibi planı onaylamadı: “${plan.title}”. Ne istediğini sor, gerekirse yeni bir plan öner.`);
    this.#emit(current.proposedBy, { type: 'plan.changed', change: 'declined', plan });
    return plan;
  }

  report(by: string, text: string): void {
    this.#assertCoordinator(by);
    this.#emit(by, { type: 'company.report', text: clean(text, 'Rapor', 6000, true) });
  }

  // ── brief ─────────────────────────────────────────────────────────────────

  brief(): string {
    return readBrief(this.#d.dataDir);
  }

  updateBrief(by: string, text: string): void {
    this.#assertCoordinator(by);
    const body = clean(text, 'Şirket özeti', BRIEF_MAX, true);
    writeBrief(this.#d.dataDir, `${body}\n`, this.#d.roster.list().map((e) => deskDir(this.#d.dataDir, e.slug)));
    this.#emit(by, { type: 'brief.updated' });
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  #draft(d: PlanDraft): Omit<Plan, 'id' | 'status' | 'version' | 'proposedBy' | 'createdAt' | 'updatedAt' | 'approvedAt'> {
    return {
      title: clean(d.title, 'Plan başlığı', 120, true),
      goal: clean(d.goal, 'Hedef', 2000, true),
      approach: clean(d.approach, 'Yaklaşım', 6000, true),
      people: clean(d.people, 'Kimler', 2000, false),
      steps: lines(d.steps, 'Görev taslağı', 40, 300),
      quotaPct: amount(d.quotaPct, 'Kota payı'),
      usd: amount(d.usd, 'Para'),
      days: amount(d.days, 'Süre'),
      risks: clean(d.risks, 'Riskler', 2000, false),
    };
  }

  #maybeFinishPlan(planId: string): void {
    const plan = this.#d.plans.get(planId);
    if (plan.status !== 'approved' || this.#d.tasks.openInPlan(planId) > 0) return;
    const done = this.#d.plans.update(planId, { status: 'done' });
    this.#d.notices.add(plan.proposedBy, `“${plan.title}” planının bütün görevleri bitti. Sonucu reportToOwner ile sahibine raporla.`);
    this.#emit(plan.proposedBy, { type: 'plan.changed', change: 'done', plan: done });
  }

  #leastUsedCharacter(characters: string[]): string {
    if (characters.length === 0) return 'voxel';
    const counts = new Map(characters.map((c) => [c, 0]));
    for (const e of this.#d.roster.list()) if (counts.has(e.characterId)) counts.set(e.characterId, (counts.get(e.characterId) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[1] - b[1] || characters.indexOf(a[0]) - characters.indexOf(b[0]))[0]![0];
  }

  #assertCoordinator(by: string): void {
    if (this.#d.roster.get(by).kind !== 'coordinator') throw new ForbiddenError('Yalnız koordinatör bunu yapabilir.');
  }

  #tellCoordinator(about: string, text: string): void {
    const c = this.coordinator();
    if (c && c.id !== about) this.#d.notices.add(c.id, text);
  }

  #taskEvent(change: 'created' | 'assigned' | 'started' | 'updated' | 'finished' | 'reprioritized', task: Task): void {
    this.#emit(task.assignee, { type: 'task.changed', change, task });
  }

  #emit(employeeId: string, event: OfficeEvent): void {
    this.#d.events.append(employeeId, event);
  }
}
```


- [ ] **Step 4: Run the test**

Run: `pnpm --filter @cc/office-server exec vitest run test/company.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Run every server test and commit**

Run: `pnpm --filter @cc/office-server test`
Expected: PASS.

```bash
git add apps/office-server/src/company/company.ts apps/office-server/test/company.test.ts
git commit -m "feat(company): the company's rules in one service

Coordinator (one; hired from the Company view or appointed), members hired by
the owner or the coordinator with the least used character, role cards the
coordinator rewrites; tasks with a definition of done, passing with chain and
daily limits, blocked/finished notices to the requester and the coordinator;
plan cards proposed, revised (an approved plan goes back to draft), approved or
declined by the owner, done when their last task is; the company brief."
```

---

### Task 5: The /mcp endpoint and tokens

**Files:**
- Create: `apps/office-server/src/mcp/tokens.ts`, `apps/office-server/src/mcp/protocol.ts`
- Modify: `apps/office-server/src/api.ts`
- Test: `apps/office-server/test/mcp-protocol.test.ts`

**Interfaces:**
- Consumes: `Roster` (`../roster.ts`), `statusOf` (`../errors.ts`: 4xx for the office's own errors, 500 otherwise), `Employee`, `EmployeeKind` (`@cc/shared`).
- Produces:
  - `class TokenRegistry { issue(employeeId: string): string; resolve(token: string): string | null; revoke(employeeId: string): void }`
  - `interface McpTool { name: string; description: string; inputSchema: Record<string, unknown>; kinds: EmployeeKind[]; run(ctx: { employee: Employee }, args: Record<string, unknown>): string | Promise<string> }`
  - `function handleMcp(o: { method: string; authorization: string | undefined; body: unknown; tokens: TokenRegistry; roster: Roster; tools: McpTool[] }): Promise<{ status: number; body?: unknown }>`
  - `ApiDeps.mcp?: { tokens: TokenRegistry; tools: McpTool[] }`

- [ ] **Step 1: Write the failing test**

Create `apps/office-server/test/mcp-protocol.test.ts`:

```ts
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api.ts';
import { ValidationError } from '../src/errors.ts';
import { TokenRegistry } from '../src/mcp/tokens.ts';
import type { McpTool } from '../src/mcp/protocol.ts';
import { QuotaTracker } from '../src/quota.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const tools: McpTool[] = [
  { name: 'echo', description: 'Echo back.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, kinds: ['member', 'lead', 'coordinator'], run: ({ employee }, args) => `${employee.name}: ${String(args.text)}` },
  { name: 'boss', description: 'Coordinator only.', inputSchema: { type: 'object', properties: {} }, kinds: ['coordinator'], run: () => 'ok' },
  { name: 'fails', description: 'Always invalid.', inputSchema: { type: 'object', properties: {} }, kinds: ['member', 'coordinator'], run: () => { throw new ValidationError('Bu girdi geçersiz.'); } },
];

async function start() {
  const s = setup();
  const f = fakeEngine(s);
  const tokens = new TokenRegistry();
  const quota = new QuotaTracker(s.db, s.events);
  const api = createApi({ engine: f.engine, roster: s.roster, events: s.events, quota, mcp: { tokens, tools } }, { allowedOrigins: [] });
  await new Promise<void>((resolve) => api.server.listen(0, '127.0.0.1', resolve));
  const port = (api.server.address() as AddressInfo).port;
  cleanups.push(() => api.close(), f.cleanup, s.cleanup);
  const member = s.roster.create({ name: 'Ada', role: 'r' });
  const boss = s.roster.create({ name: 'Koor', role: 'r', kind: 'coordinator' });
  return { port, tokens, member, boss, memberToken: tokens.issue(member.id), bossToken: tokens.issue(boss.id) };
}

function mcp(port: number, body: unknown, token?: string, method = 'POST'): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (token) headers.authorization = `Bearer ${token}`;
    const req = httpRequest({ host: '127.0.0.1', port, method, path: '/mcp', headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    if (method === 'POST') req.write(JSON.stringify(body));
    req.end();
  });
}

describe('/mcp', () => {
  it('initializes with the version the client asked for and acknowledges notifications', async () => {
    const t = await start();
    const init = await mcp(t.port, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'claude-code', version: 'x' } } }, t.memberToken);
    expect(init.status).toBe(200);
    expect(init.body).toMatchObject({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'office' } } });
    expect((await mcp(t.port, { jsonrpc: '2.0', method: 'notifications/initialized' }, t.memberToken)).status).toBe(202);
    expect((await mcp(t.port, { jsonrpc: '2.0', id: 2, method: 'ping' }, t.memberToken)).body).toEqual({ jsonrpc: '2.0', id: 2, result: {} });
  });

  it('lists only the tools the caller may use', async () => {
    const t = await start();
    const names = async (token: string) => (await mcp(t.port, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, token)).body.result.tools.map((x: { name: string }) => x.name);
    expect(await names(t.memberToken)).toEqual(['echo', 'fails']);
    expect(await names(t.bossToken)).toEqual(['echo', 'boss', 'fails']);
  });

  it('calls a tool as the token’s employee and turns office errors into tool errors the model can read', async () => {
    const t = await start();
    const ok = await mcp(t.port, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'merhaba' } } }, t.memberToken);
    expect(ok.body.result).toEqual({ content: [{ type: 'text', text: 'Ada: merhaba' }] });
    const bad = await mcp(t.port, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'fails', arguments: {} } }, t.memberToken);
    expect(bad.body.result).toEqual({ content: [{ type: 'text', text: 'Bu girdi geçersiz.' }], isError: true });
    const forbidden = await mcp(t.port, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'boss', arguments: {} } }, t.memberToken);
    expect(forbidden.body.error).toMatchObject({ code: -32602 });
  });

  it('review focus: refuses missing, made-up and revoked tokens', async () => {
    const t = await start();
    const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    expect((await mcp(t.port, list)).status).toBe(401);
    expect((await mcp(t.port, list, 'made-up')).status).toBe(401);
    t.tokens.revoke(t.member.id);
    expect((await mcp(t.port, list, t.memberToken)).status).toBe(401);
  });

  it('answers unknown methods (and Claude Code’s server/discover probe) with method-not-found, and has no event stream', async () => {
    const t = await start();
    expect((await mcp(t.port, { jsonrpc: '2.0', id: 9, method: 'server/discover' }, t.memberToken)).body.error).toMatchObject({ code: -32601 });
    expect((await mcp(t.port, { jsonrpc: '2.0', id: 9, method: 'resources/list' }, t.memberToken)).body.error).toMatchObject({ code: -32601 });
    expect((await mcp(t.port, null, t.memberToken, 'GET')).status).toBe(405);
  });
});

describe('TokenRegistry', () => {
  it('gives every session a fresh token and forgets the previous one', () => {
    const tokens = new TokenRegistry();
    const first = tokens.issue('e1');
    const second = tokens.issue('e1');
    expect(first).not.toBe(second);
    expect(tokens.resolve(first)).toBeNull();
    expect(tokens.resolve(second)).toBe('e1');
    tokens.revoke('e1');
    expect(tokens.resolve(second)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/mcp-protocol.test.ts`
Expected: FAIL — cannot resolve `../src/mcp/tokens.ts`.

- [ ] **Step 3: Tokens and protocol**

Create `apps/office-server/src/mcp/tokens.ts`:

```ts
import { randomBytes } from 'node:crypto';

/** Bearer tokens for the office tools: one per running session, so a token from a past session stops working. */
export class TokenRegistry {
  readonly #byToken = new Map<string, string>();
  readonly #byEmployee = new Map<string, string>();

  issue(employeeId: string): string {
    this.revoke(employeeId);
    const token = randomBytes(24).toString('hex');
    this.#byToken.set(token, employeeId);
    this.#byEmployee.set(employeeId, token);
    return token;
  }

  resolve(token: string): string | null {
    return this.#byToken.get(token) ?? null;
  }

  revoke(employeeId: string): void {
    const token = this.#byEmployee.get(employeeId);
    if (token) this.#byToken.delete(token);
    this.#byEmployee.delete(employeeId);
  }
}
```

Create `apps/office-server/src/mcp/protocol.ts`:

```ts
import type { Employee, EmployeeKind } from '@cc/shared';
import { statusOf } from '../errors.ts';
import type { Roster } from '../roster.ts';
import type { TokenRegistry } from './tokens.ts';

export interface McpTool {
  name: string;
  /** Read by the model: English, precise about when to call the tool. */
  description: string;
  inputSchema: Record<string, unknown>;
  kinds: EmployeeKind[];
  run(ctx: { employee: Employee }, args: Record<string, unknown>): string | Promise<string>;
}

interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const isRequest = (b: unknown): b is RpcRequest =>
  typeof b === 'object' && b !== null && !Array.isArray(b) && (b as RpcRequest).jsonrpc === '2.0' && typeof (b as RpcRequest).method === 'string';

/**
 * The office's MCP endpoint: the subset of streamable HTTP that Claude Code uses (JSON responses, no event stream,
 * no sessions). Verified against Claude Code 2.1.291: server/discover (answered not-found) → initialize →
 * notifications/initialized → GET (405) → tools/list → tools/call.
 */
export async function handleMcp(o: {
  method: string;
  authorization: string | undefined;
  body: unknown;
  tokens: TokenRegistry;
  roster: Roster;
  tools: McpTool[];
}): Promise<{ status: number; body?: unknown }> {
  if (o.method !== 'POST') return { status: 405 };
  const token = /^Bearer\s+(\S+)$/i.exec(o.authorization ?? '')?.[1];
  const employeeId = token ? o.tokens.resolve(token) : null;
  let employee: Employee | null = null;
  if (employeeId) {
    try {
      employee = o.roster.get(employeeId);
    } catch {
      employee = null;
    }
  }
  if (!employee || employee.lifecycle === 'archived') return { status: 401, body: { error: 'Geçersiz ofis jetonu.' } };
  if (!isRequest(o.body)) return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } } };
  const req = o.body;
  if (req.id === undefined) return { status: 202 };
  const reply = (result: unknown) => ({ status: 200, body: { jsonrpc: '2.0', id: req.id, result } });
  const fail = (code: number, message: string) => ({ status: 200, body: { jsonrpc: '2.0', id: req.id, error: { code, message } } });
  const allowed = o.tools.filter((t) => t.kinds.includes(employee.kind));

  switch (req.method) {
    case 'initialize':
      return reply({
        protocolVersion: typeof req.params?.protocolVersion === 'string' ? req.params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'office', version: '1.0.0' },
        instructions: 'control-center ofis araçları: görevler, paslama, teslim ve (koordinatör için) plan, işe alma ve dağıtım.',
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: allowed.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    case 'tools/call': {
      const name = typeof req.params?.name === 'string' ? req.params.name : '';
      const tool = allowed.find((t) => t.name === name);
      if (!tool) return fail(-32602, `Bilinmeyen ya da bu çalışana kapalı araç: ${name}`);
      const args = typeof req.params?.arguments === 'object' && req.params.arguments !== null ? (req.params.arguments as Record<string, unknown>) : {};
      try {
        return reply({ content: [{ type: 'text', text: await tool.run({ employee }, args) }] });
      } catch (err) {
        // The office's own errors (validation, conflict, not found, forbidden) are meant for the model to read and act on.
        const message = statusOf(err) < 500 && err instanceof Error ? err.message : `Araç çalışırken beklenmeyen bir hata oldu: ${err instanceof Error ? err.message : String(err)}`;
        return reply({ content: [{ type: 'text', text: message }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${req.method}`);
  }
}
```

- [ ] **Step 4: Mount it in the API**

In `apps/office-server/src/api.ts`:
- imports: `import { handleMcp, type McpTool } from './mcp/protocol.ts';` and `import type { TokenRegistry } from './mcp/tokens.ts';`
- `ApiDeps` gains `mcp?: { tokens: TokenRegistry; tools: McpTool[] };`
- in `route`, right after `const url = …;` and **before** the content-type check:

```ts
  if (url.pathname === '/mcp' && d.mcp) {
    // Claude Code sends JSON; a GET (event stream) is answered 405 inside handleMcp.
    const body = method === 'POST' ? await readJson(req) : null;
    const out = await handleMcp({ method, authorization: req.headers.authorization, body, tokens: d.mcp.tokens, roster: d.roster, tools: d.mcp.tools });
    if (out.body === undefined) return sendEmpty(res, out.status);
    return sendJson(res, out.status, out.body);
  }
```

(`checkRequest` already ran above it, so the Host check covers `/mcp`; Claude Code sends no Origin.)

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @cc/office-server exec vitest run test/mcp-protocol.test.ts && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src/mcp apps/office-server/src/api.ts apps/office-server/test/mcp-protocol.test.ts
git commit -m "feat(mcp): the office tool endpoint, with a token per session

POST /mcp speaks the part of streamable HTTP that Claude Code uses (JSON
replies, no event stream): initialize echoes the client's protocol version,
tools are listed and called per employee kind, office errors come back as tool
errors the model can read. Tokens are per session; missing, made-up or revoked
ones get 401."
```

---

### Task 6: The office tools

**Files:**
- Create: `apps/office-server/src/mcp/tools.ts`
- Test: `apps/office-server/test/mcp-tools.test.ts`

**Interfaces:**
- Consumes: `Company` (Task 4), `McpTool` (Task 5), `Roster`, `TaskStore` (Task 2), `MODEL_ALIASES`, `type ModelAlias` (`@cc/shared`), `ValidationError`, `NotFoundError`.
- Produces: `function officeTools(o: { company: Company; roster: Roster; tasks: TaskStore; characters: () => string[] }): McpTool[]` with tools `myTasks`, `taskFinish`, `taskUpdate`, `taskPass`, `officeStatus`, `briefRead` (everyone) and `taskCreate`, `taskAssign`, `taskReprioritize`, `planPropose`, `planRevise`, `hire`, `editRoleCard`, `briefUpdate`, `reportToOwner` (coordinator).

- [ ] **Step 1: Write the failing test**

Create `apps/office-server/test/mcp-tools.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type Employee } from '@cc/shared';
import { Company } from '../src/company/company.ts';
import { NoticeStore, PlanStore, TaskStore } from '../src/company/store.ts';
import type { McpTool } from '../src/mcp/protocol.ts';
import { officeTools } from '../src/mcp/tools.ts';
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
  const characters = () => ['coder', 'designer'];
  const company = new Company({ roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => f.engine.hire(i), characters });
  const tools = officeTools({ company, roster: s.roster, tasks, characters });
  const call = async (employee: Employee, name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.find((t: McpTool) => t.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    if (!tool.kinds.includes(employee.kind)) throw new Error(`closed: ${name}`);
    return tool.run({ employee: s.roster.get(employee.id) }, args);
  };
  return { ...s, tasks, plans, company, tools, call };
}

describe('office tools', () => {
  it('splits the tools between everyone and the coordinator', () => {
    const t = make();
    const forMember = t.tools.filter((x) => x.kinds.includes('member')).map((x) => x.name).sort();
    expect(forMember).toEqual(['briefRead', 'myTasks', 'officeStatus', 'taskFinish', 'taskPass', 'taskUpdate']);
    const coordinatorOnly = t.tools.filter((x) => !x.kinds.includes('member')).map((x) => x.name).sort();
    expect(coordinatorOnly).toEqual(['briefUpdate', 'editRoleCard', 'hire', 'planPropose', 'planRevise', 'reportToOwner', 'taskAssign', 'taskCreate', 'taskReprioritize']);
    for (const tool of t.tools) expect(tool.inputSchema).toMatchObject({ type: 'object' });
  });

  it('lets an employee see their queue, pass work to a colleague and hand in their own task', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const can = t.company.hire(OWNER, { name: 'Can', role: 'r' });
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'Rapor yaz', done: ['rapor.md'] });
    expect(await t.call(ada, 'myTasks')).toContain('Rapor yaz');
    const passed = await t.call(ada, 'taskPass', { to: can.id, title: 'Grafikleri çiz', description: 'rapor için', done: ['grafik.png'], priority: 2 });
    expect(passed).toContain('Can');
    expect(t.tasks.list({ assignee: can.id })[0]).toMatchObject({ title: 'Grafikleri çiz', requester: ada.id, priority: 2 });
    t.company.start(task.id);
    const handed = await t.call(ada, 'taskFinish', { taskId: task.id, summary: 'Rapor hazır.', outputs: ['rapor.md'], learned: 'Veriler eksikti.' });
    expect(handed).toContain('teslim');
    expect(t.tasks.get(task.id)).toMatchObject({ status: 'done', result: { summary: 'Rapor hazır.', outputs: ['rapor.md'] } });
  });

  it('also finds a colleague by name when passing work', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    t.company.hire(OWNER, { name: 'Can Yıldız', role: 'r' });
    await t.call(ada, 'taskPass', { to: 'can yıldız', title: 'x' });
    expect(t.tasks.list().some((x) => x.title === 'x')).toBe(true);
    await expect(t.call(ada, 'taskPass', { to: 'kimse', title: 'x' })).rejects.toThrow(/bulunamadı/);
  });

  it('marks a task blocked with a reason', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'x' });
    t.company.start(task.id);
    await t.call(ada, 'taskUpdate', { taskId: task.id, blocked: true, note: 'şifre yok' });
    expect(t.tasks.get(task.id)).toMatchObject({ status: 'blocked', note: 'şifre yok' });
  });

  it('lets the coordinator propose a plan, hire with a model and character, open and hand out tasks', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const plan = await t.call(c, 'planPropose', { title: 'Lansman', goal: 'g', approach: 'a', people: 'bir yazar', steps: ['metin', 'görsel'], quotaPct: 10, usd: 25, days: 3, risks: 'kota' });
    expect(plan).toContain('onay');
    const draft = t.plans.list()[0]!;
    expect(draft).toMatchObject({ title: 'Lansman', steps: ['metin', 'görsel'], usd: 25 });
    await t.call(c, 'planRevise', { planId: draft.id, usd: 30 });
    expect(t.plans.get(draft.id)).toMatchObject({ version: 2, usd: 30 });
    t.company.approve(draft.id);
    const hired = await t.call(c, 'hire', { name: 'Ece', title: 'Yazar', team: 'İçerik', role: 'Metin yazar.', model: 'sonnet', characterId: 'designer' });
    expect(hired).toContain('Ece');
    const ece = t.roster.list().find((e) => e.name === 'Ece')!;
    expect(ece).toMatchObject({ title: 'Yazar', team: 'İçerik', model: 'sonnet', characterId: 'designer', kind: 'member' });
    await t.call(c, 'taskCreate', { assignee: ece.id, title: 'Lansman metni', planId: draft.id, priority: 1 });
    const created = t.tasks.list({ assignee: ece.id })[0]!;
    await t.call(c, 'taskReprioritize', { taskId: created.id, priority: 2 });
    expect(t.tasks.get(created.id).priority).toBe(2);
    await expect(t.call(c, 'hire', { name: 'X', role: 'r', model: 'gpt-9' })).rejects.toThrow(/model/);
  });

  it('lists the company and reads and updates the brief', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r', title: 'Yazar' });
    expect(await t.call(ada, 'officeStatus')).toMatch(/Koordinatör[\s\S]*Ada — Yazar/);
    await t.call(c, 'briefUpdate', { text: '# Özet\n\nMisyon: test.' });
    expect(await t.call(ada, 'briefRead')).toContain('Misyon: test.');
    await t.call(c, 'reportToOwner', { text: 'Bugün iki görev bitti.' });
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'company.report')).toBe(true);
  });

  it('rejects arguments of the wrong type in Turkish', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    await expect(t.call(ada, 'taskFinish', { taskId: 42 })).rejects.toThrow(/taskId/);
    await expect(t.call(ada, 'taskPass', { to: 'x', title: 'y', done: 'tek madde' })).rejects.toThrow(/done/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/mcp-tools.test.ts`
Expected: FAIL — cannot resolve `../src/mcp/tools.ts`.

- [ ] **Step 3: Implement the tools**

Create `apps/office-server/src/mcp/tools.ts`:

```ts
import { MODEL_ALIASES, type Employee, type EmployeeKind, type ModelAlias, type Task } from '@cc/shared';
import type { Company } from '../company/company.ts';
import type { TaskStore } from '../company/store.ts';
import { NotFoundError, ValidationError } from '../errors.ts';
import type { Roster } from '../roster.ts';
import type { McpTool } from './protocol.ts';

const EVERYONE: EmployeeKind[] = ['member', 'lead', 'coordinator'];
const COORDINATOR: EmployeeKind[] = ['coordinator'];

type Args = Record<string, unknown>;

function str(args: Args, key: string, required = true): string {
  const v = args[key];
  if (v === undefined || v === null) {
    if (required) throw new ValidationError(`${key} gerekli.`);
    return '';
  }
  if (typeof v !== 'string') throw new ValidationError(`${key} metin olmalı.`);
  return v;
}

function optStr(args: Args, key: string): string | undefined {
  return args[key] === undefined || args[key] === null ? undefined : str(args, key);
}

function list(args: Args, key: string): string[] | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new ValidationError(`${key} metinlerden oluşan bir liste olmalı.`);
  return v as string[];
}

function num(args: Args, key: string): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ValidationError(`${key} sayı olmalı.`);
  return v;
}

function bool(args: Args, key: string): boolean | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') throw new ValidationError(`${key} true ya da false olmalı.`);
  return v;
}

const STATUS_TR: Record<Task['status'], string> = { waiting: 'bekliyor', in_progress: 'sürüyor', blocked: 'takıldı', done: 'bitti', cancelled: 'iptal' };

function taskLine(t: Task, company: Company): string {
  const done = t.done.length ? ` — bitti tanımı: ${t.done.join('; ')}` : '';
  return `• [${STATUS_TR[t.status]}] ${t.id} “${t.title}” (öncelik ${t.priority}, isteyen ${company.nameOf(t.requester)})${done}`;
}

const s = (description: string) => ({ type: 'string', description });
const strings = (description: string) => ({ type: 'array', items: { type: 'string' }, description });
const integer = (description: string, minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum, description });
const number = (description: string) => ({ type: 'number', minimum: 0, description });
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });

export function officeTools(o: { company: Company; roster: Roster; tasks: TaskStore; characters: () => string[] }): McpTool[] {
  const { company, roster, tasks } = o;

  /** A colleague by id or by name (case and Turkish dotted/dotless i insensitive). */
  const findPerson = (who: string): Employee => {
    const people = roster.list();
    const byId = people.find((e) => e.id === who);
    if (byId) return byId;
    const norm = (x: string) => x.toLocaleLowerCase('tr').trim();
    const byName = people.filter((e) => norm(e.name) === norm(who));
    if (byName.length === 1) return byName[0]!;
    throw new NotFoundError(`Çalışan bulunamadı: ${who}. officeStatus ile ofistekileri görebilirsin.`);
  };

  const characterList = () => [...o.characters(), 'voxel'];

  return [
    {
      name: 'myTasks',
      description: 'List your own tasks (open ones first, then the last finished). Call it when you need to know what is on your plate.',
      inputSchema: object({}),
      kinds: EVERYONE,
      run: ({ employee }) => {
        const mine = tasks.list({ assignee: employee.id });
        const open = mine.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
        const finished = mine.filter((t) => t.status === 'done').slice(-5);
        if (mine.length === 0) return 'Sende hiç görev yok.';
        return [`Açık görevlerin (${open.length}):`, ...open.map((t) => taskLine(t, company)), finished.length ? 'Son bitenler:' : '', ...finished.map((t) => taskLine(t, company))].filter(Boolean).join('\n');
      },
    },
    {
      name: 'taskFinish',
      description: 'Hand in a task you finished: a short summary of the result, the files you produced, and what you learned. Always call this when a task is done.',
      inputSchema: object({ taskId: s('The task id from the task message.'), summary: s('What was done, in 1–5 sentences.'), outputs: strings('Files you produced (paths).'), learned: s('Anything worth remembering for later work.') }, ['taskId', 'summary']),
      kinds: EVERYONE,
      run: ({ employee }, args) => {
        const task = company.finish(employee.id, str(args, 'taskId'), { summary: str(args, 'summary'), outputs: list(args, 'outputs') ?? [], learned: optStr(args, 'learned') ?? '' });
        return `“${task.title}” teslim edildi. İsteyen ve koordinatör haberdar edildi.`;
      },
    },
    {
      name: 'taskUpdate',
      description: 'Update one of your tasks: add a progress note, or mark it blocked (blocked: true, with the reason in note) / unblocked (blocked: false). The coordinator is told when you are blocked.',
      inputSchema: object({ taskId: s('The task id.'), note: s('Progress note or the reason you are blocked.'), blocked: { type: 'boolean', description: 'true = you cannot continue; false = you can again.' } }, ['taskId']),
      kinds: EVERYONE,
      run: ({ employee }, args) => {
        const task = company.update(employee.id, str(args, 'taskId'), { note: optStr(args, 'note'), blocked: bool(args, 'blocked') });
        return `“${task.title}” güncellendi: ${STATUS_TR[task.status]}.`;
      },
    },
    {
      name: 'taskPass',
      description: 'Pass a piece of work to a colleague (by id or name). It goes to the end of their queue; they are not interrupted. Say what, why and when it counts as done.',
      inputSchema: object({ to: s('Colleague id or name.'), title: s('Short title.'), description: s('What is needed and why.'), done: strings('Definition of done, one item each.'), priority: integer('1 = most urgent … 5 = whenever (default 3).', 1, 5) }, ['to', 'title']),
      kinds: EVERYONE,
      run: ({ employee }, args) => {
        // Arguments first: a malformed call should say what is malformed, not that a person was not found.
        const input = { title: str(args, 'title'), description: optStr(args, 'description'), done: list(args, 'done'), priority: num(args, 'priority') };
        const to = findPerson(str(args, 'to'));
        const task = company.createTask(employee.id, { assignee: to.id, ...input });
        return `“${task.title}” ${to.name} adlı çalışanın sırasına eklendi (görev ${task.id}).`;
      },
    },
    {
      name: 'officeStatus',
      description: 'See who works in the office: role, team, state and current task. Use it to find the right person to pass work to.',
      inputSchema: object({}),
      kinds: EVERYONE,
      run: () => {
        const kindTr: Record<EmployeeKind, string> = { coordinator: 'koordinatör', lead: 'ekip lideri', member: 'çalışan' };
        return company
          .status()
          .map((l) => `• ${l.name}${l.title ? ` — ${l.title}` : ''} (${kindTr[l.kind]}${l.team ? `, ${l.team}` : ''}; ${l.lifecycle}) id ${l.id}${l.task ? ` — şu an: “${l.task}”` : ''}`)
          .join('\n');
      },
    },
    {
      name: 'briefRead',
      description: 'Read the current company brief (mission, running plans, who does what, ground rules).',
      inputSchema: object({}),
      kinds: EVERYONE,
      run: () => company.brief(),
    },
    {
      name: 'taskCreate',
      description: 'Open a task for someone (coordinator). With planId it belongs to an approved plan. Use dependsOn for "start when that part is done".',
      inputSchema: object({ assignee: s('Employee id or name.'), title: s('Short title.'), description: s('What is needed and why.'), done: strings('Definition of done.'), priority: integer('1 = most urgent … 5 = whenever.', 1, 5), planId: s('Id of the approved plan this belongs to.'), dependsOn: strings('Task ids that must be done first.') }, ['assignee', 'title']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const input = { title: str(args, 'title'), description: optStr(args, 'description'), done: list(args, 'done'), priority: num(args, 'priority'), planId: optStr(args, 'planId') ?? null, dependsOn: list(args, 'dependsOn') };
        const to = findPerson(str(args, 'assignee'));
        const task = company.createTask(employee.id, { assignee: to.id, ...input });
        return `Görev açıldı: ${task.id} “${task.title}” → ${to.name}.`;
      },
    },
    {
      name: 'taskAssign',
      description: 'Give a waiting or blocked task to someone else (coordinator).',
      inputSchema: object({ taskId: s('The task id.'), assignee: s('Employee id or name.') }, ['taskId', 'assignee']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const to = findPerson(str(args, 'assignee'));
        const task = company.assign(employee.id, str(args, 'taskId'), to.id);
        return `“${task.title}” artık ${to.name} adlı çalışanda.`;
      },
    },
    {
      name: 'taskReprioritize',
      description: 'Change a task’s priority (coordinator): 1 = most urgent … 5 = whenever.',
      inputSchema: object({ taskId: s('The task id.'), priority: integer('New priority.', 1, 5) }, ['taskId', 'priority']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const priority = num(args, 'priority');
        if (priority === undefined) throw new ValidationError('priority gerekli.');
        const task = company.reprioritize(employee.id, str(args, 'taskId'), priority);
        return `“${task.title}” önceliği ${task.priority}.`;
      },
    },
    {
      name: 'planPropose',
      description: 'Propose a plan card to the owner before starting any work they asked for: goal, approach, who works on it (existing people and roles to hire), draft tasks, estimates (share of weekly quota %, money in USD, days) and risks. The owner approves it on screen.',
      inputSchema: object({ title: s('Plan title.'), goal: s('What the owner wants to achieve.'), approach: s('How you will do it.'), people: s('Who works on it.'), steps: strings('Draft tasks, one each.'), quotaPct: number('Estimated share of the weekly Claude quota, %.'), usd: number('Estimated money to spend, USD.'), days: number('Estimated days.'), risks: s('What could go wrong.') }, ['title', 'goal', 'approach']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const plan = company.propose(employee.id, { title: str(args, 'title'), goal: str(args, 'goal'), approach: str(args, 'approach'), people: optStr(args, 'people'), steps: list(args, 'steps'), quotaPct: num(args, 'quotaPct') ?? null, usd: num(args, 'usd') ?? null, days: num(args, 'days') ?? null, risks: optStr(args, 'risks') });
        return `Plan kartı açıldı (${plan.id}). Sahibinin onayını bekle; onay gelince sana haber verilecek.`;
      },
    },
    {
      name: 'planRevise',
      description: 'Revise a plan card (only the fields you pass change). Revising an approved plan sends it back to the owner for approval.',
      inputSchema: object({ planId: s('The plan id.'), title: s('Plan title.'), goal: s('Goal.'), approach: s('Approach.'), people: s('Who.'), steps: strings('Draft tasks.'), quotaPct: number('Quota share, %.'), usd: number('Money, USD.'), days: number('Days.'), risks: s('Risks.') }, ['planId']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const plan = company.revise(employee.id, str(args, 'planId'), { title: optStr(args, 'title'), goal: optStr(args, 'goal'), approach: optStr(args, 'approach'), people: optStr(args, 'people'), steps: list(args, 'steps'), quotaPct: num(args, 'quotaPct'), usd: num(args, 'usd'), days: num(args, 'days'), risks: optStr(args, 'risks') });
        return `Plan güncellendi: sürüm ${plan.version}, sahibinin onayını bekliyor.`;
      },
    },
    {
      name: 'hire',
      description: `Hire a new employee (coordinator): name, job title, team, the role card text (responsibilities, how to work, what "done" means), the model (${MODEL_ALIASES.join(', ')}) and the look (characterId). Desks are limited.`,
      inputSchema: {
        ...object({ name: s('Name.'), title: s('Job title.'), team: s('Team.'), role: s('Role card: responsibilities and way of working.'), model: { type: 'string', enum: [...MODEL_ALIASES] }, characterId: { type: 'string', enum: characterList(), description: 'Look in the 3D office.' } }, ['name', 'role', 'model']),
      },
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const model = str(args, 'model') as ModelAlias;
        if (!(MODEL_ALIASES as readonly string[]).includes(model)) throw new ValidationError(`Bilinmeyen model: ${model}. Seçenekler: ${MODEL_ALIASES.join(', ')}.`);
        const hired = company.hire(employee.id, { name: str(args, 'name'), role: str(args, 'role'), title: optStr(args, 'title'), team: optStr(args, 'team'), model, characterId: optStr(args, 'characterId'), reportsTo: null });
        return `İşe alındı: ${hired.name} (${hired.id}), masa ${hired.deskIndex + 1}, model ${hired.model}.`;
      },
    },
    {
      name: 'editRoleCard',
      description: 'Rewrite someone’s role card (coordinator): title, team and/or the role text. It takes effect when their session next loads it.',
      inputSchema: object({ employee: s('Employee id or name.'), title: s('Job title.'), team: s('Team.'), role: s('Role card text.') }, ['employee']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const who = findPerson(str(args, 'employee'));
        const next = company.editRoleCard(employee.id, who.id, { title: optStr(args, 'title'), team: optStr(args, 'team'), role: optStr(args, 'role') });
        return `${next.name} adlı çalışanın rol kartı güncellendi.`;
      },
    },
    {
      name: 'briefUpdate',
      description: 'Replace the company brief (coordinator): mission, running plans, who does what, ground rules. Keep it short (max ~2 pages); every desk gets the new copy.',
      inputSchema: object({ text: s('The whole brief, in Markdown.') }, ['text']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        company.updateBrief(employee.id, str(args, 'text'));
        return 'Şirket özeti güncellendi ve bütün masalara dağıtıldı.';
      },
    },
    {
      name: 'reportToOwner',
      description: 'Report to the owner (coordinator): a finished plan, a small change you decided, a daily summary, or a request that needs them.',
      inputSchema: object({ text: s('The report.') }, ['text']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        company.report(employee.id, str(args, 'text'));
        return 'Rapor sahibine iletildi.';
      },
    },
  ];
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @cc/office-server exec vitest run test/mcp-tools.test.ts && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/office-server/src/mcp/tools.ts apps/office-server/test/mcp-tools.test.ts
git commit -m "feat(mcp): the office tools

Everyone: myTasks, taskFinish, taskUpdate, taskPass (by id or name),
officeStatus, briefRead. The coordinator also: taskCreate, taskAssign,
taskReprioritize, planPropose, planRevise, hire (model and look), editRoleCard,
briefUpdate, reportToOwner. Arguments are checked with Turkish errors."
```
