# Company Phase 3 — Budget and Constitution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The company runs within the owner's limits: a constitution the owner edits (team size, the owner's share of the Claude quota, a monthly money cap, loop limits, idle sleep), money recorded against plans, a reserve that keeps the owner's quota share free, employees who sleep when idle and wake for work, and the coordinator able to see the budget and change someone's model.

**Architecture:** Migration v4 adds `constitution` (key → JSON value), `spend`, and per-task Claude usage (`tasks.cost_usd`, `tasks.tokens`). A `Budget` service (`company/budget.ts`) owns the constitution, records spending (warning on the monthly cap and plan overruns), charges each finished turn to the employee's running task, and computes the owner's reserve from the live quota. The Engine gains `sleep`/`wake` (a `sleeping` lifecycle: process closed, session kept). The Dispatcher starts only priority-1 work while the reserve is in force, puts idle people to sleep (reserve, or idle for `idleSleepMinutes`), wakes sleepers when work arrives, and sweeps on a timer. New tools (`recordSpend`, `budgetStatus`, `setModel`, `sleep`, `wake`), owner routes, and Company-view tabs Bütçe and Anayasa.

**Tech Stack:** as phases 1–2.

**Spec:** `docs/superpowers/specs/2026-10-06-company-design.md` (§3.3 model, §3.4 sleep, §4.6 limits, §6 budget, §7 tools, §8 screen, §12 phase 3).

## Global Constraints

- Node 24 type stripping: no enums, no parameter properties, `import type` for types, `.ts` extensions in imports.
- Every migration is reversible: `up` + `down`, `down` removes exactly what `up` added, round trip tested.
- Tool descriptions in English; tool results, errors and UI text in Turkish.
- Commits: plain conventional commits, no AI trailer.
- Real claude only opt-in (`OFFICE_SMOKE=1`), temp data dirs, never port 4319; clean `~/.claude/projects/-tmp-cc-*` afterwards.

## Spec rulings (decided here)

- **Constitution keys** (defaults): `maxEmployees` 8 (1 … desk count; the coordinator counts), `ownerReservePct` 25 (0 … 90), `monthlyUsdCap` null (none) or ≥ 0, `chainDepth` 5 (1 … 20), `tasksPerDay` 30 (1 … 500), `openTasksPerPlan` 60 (1 … 500), `idleSleepMinutes` 30 (0 = never, … 1440). Lowering `maxEmployees` below the current headcount only stops new hires.
- **Reserve:** in force when the 5-hour or 7-day utilization (a window whose reset time has passed counts as 0) is at least `100 − ownerReservePct` %. Then the Dispatcher starts only priority-1 and hand-over tasks, idle members sleep (the coordinator stays up to talk to the owner), and the coordinator gets one notice when it starts and one when it ends. Running turns are never interrupted. A 60-second tick re-evaluates, so the office comes back by itself when the window resets.
- **Sleeping** is a lifecycle of its own (`sleeping`): the process is closed, the session and desk stay; the scene shows the faded desk (existing default). Unlike `stopped` (the owner's hold) the office wakes a sleeper when a task for them can start, and the coordinator also for notices; the owner's message wakes anyone (existing `send` behaviour). Only an idle employee can be put to sleep.
- **Plan cost:** the Claude usage of each finished turn (`turn.finished.costUsd`, already a delta) is charged to the employee's running task; a plan's Claude cost is the sum over its tasks. Money is what `recordSpend` records. Both show next to the approved budget. The quota share per plan stays an estimate (the quota is shared; it cannot be split exactly).
- **`setModel`** (coordinator) updates the model and reloads the session (`--resume` + the new `--model`), keeping memory; the real-claude test verifies the new model is in use.
- `budget.changed` is emitted on spending, constitution changes and reserve transitions — not on every turn; the Budget tab also refreshes every 15 s while open.

## Review Focus

1. A constitution value of the wrong type or out of range (negative, fractional where an integer is needed, a string, `maxEmployees` above the desk count, an unknown key) is refused with a Turkish error and changes nothing (Task 4).
2. While the reserve is in force, a priority-1 task and a hand-over still start; nothing running is interrupted; when the window resets the waiting work starts and sleepers wake without anyone touching anything (Task 5).
3. Putting a working employee to sleep is refused; a sleeping employee the owner writes to wakes and gets the message; a sleeping employee survives an office restart still asleep (Task 3).
4. `recordSpend` with a zero, negative, non-number or absurd amount, or an unknown plan, is refused; overrunning the monthly cap or a plan's approved money warns in the reply and tells the coordinator, but is still recorded (Task 4).
5. A turn of an employee with no running task charges nothing and does not throw; a turn while a hand-over runs charges the hand-over (Task 4).

## File Structure

```
packages/shared/src/
  budget.ts          NEW Constitution, DEFAULT_CONSTITUTION, Spend, ReserveState, BudgetSummary
  employee.ts        + 'sleeping' lifecycle
  events.ts          + spend.recorded, budget.changed, model.changed; snapshot budget?
  index.ts           + export budget.ts
apps/office-server/src/
  migrations.ts      + v4
  company/budget-store.ts NEW ConstitutionStore, SpendStore
  company/store.ts   TaskStore.charge(), costByPlan()
  company/budget.ts  NEW Budget service
  company/company.ts limits and headcount from the constitution; setModel
  company/dispatcher.ts reserve, sleep/wake, tick
  roster.ts          model in EmployeePatch
  engine.ts          sleep(), wake()
  mcp/tools.ts       recordSpend, budgetStatus, setModel, sleep, wake
  company/roles.ts   guide lines for money and budget
  api.ts, main.ts    budget routes, constitution, snapshot, wiring
apps/office-web/src/
  ui/labels.ts       Uyuyor; canStop/canResume
  store/reducers.ts  budget, model.changed
  net/api.ts         budget(), setConstitution(), spending()
  ui/BudgetTabs.tsx  NEW Bütçe and Anayasa tabs
  ui/CompanyView.tsx + the two tabs
  ui/PlanCard.tsx    spent next to approved
  ui/TopBar.tsx      reserve badge
  ui/EventItem.tsx   spend and model lines
```

---

### Task 1: Shared types, migration v4, the sleeping lifecycle

**Files:**
- Create: `packages/shared/src/budget.ts`
- Modify: `packages/shared/src/employee.ts`, `packages/shared/src/events.ts`, `packages/shared/src/index.ts`, `apps/office-server/src/migrations.ts`, `apps/office-web/src/ui/labels.ts`
- Test: `apps/office-server/test/db.test.ts`

**Interfaces:**
- Produces: `Constitution`, `DEFAULT_CONSTITUTION`, `Spend`, `ReserveState`, `BudgetSummary`; `Lifecycle` gains `'sleeping'`; events `spend.recorded {spend}`, `budget.changed {budget}`, `model.changed {model}`; `OfficeSnapshot.budget?: BudgetSummary`.

- [ ] **Step 1: Write the failing tests**

In `apps/office-server/test/db.test.ts`:
- add after `V3_TABLES`:

```ts
const V4_TABLES = [...V3_TABLES, 'constitution', 'spend'].sort();
```

- in "applies every migration up", "round-trips up → down → up" and "is a no-op when run twice…", change every `3` returned by a full `migrateUp` to `4` and every `V3_TABLES` expected after a full `migrateUp` to `V4_TABLES`;
- in "v3 adds the memory tables…": replace its first `migrateUp(db)` after the insert with `migrateUp(db, upTo(3))`, keep the rest, and change its last line to `expect(migrateUp(db, upTo(3))).toBe(3);`
- append:

```ts
  it('v4 adds the constitution, spending and task usage; v4 down restores v3 and keeps tasks', () => {
    const db = openDb(':memory:');
    migrateUp(db, upTo(3));
    db.prepare(
      `INSERT INTO tasks (id, plan_id, title, description, done, requester, assignee, priority, depends_on, status, chain_depth, created_at)
       VALUES ('t1', NULL, 'eski', '', '[]', 'owner', 'e1', 3, '[]', 'waiting', 0, 1)`,
    ).run();
    migrateUp(db);
    expect(tables(db)).toEqual(V4_TABLES);
    expect({ ...(db.prepare('SELECT cost_usd, tokens FROM tasks').get() as object) }).toEqual({ cost_usd: 0, tokens: 0 });
    expect(migrateDown(db, 3)).toBe(3);
    expect(tables(db)).toEqual(V3_TABLES);
    expect(columns(db, 'tasks')).not.toContain('cost_usd');
    expect(db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toMatchObject({ n: 1 });
    expect(migrateUp(db)).toBe(4);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/db.test.ts`
Expected: FAIL — version 3 instead of 4.

- [ ] **Step 3: Shared types**

Create `packages/shared/src/budget.ts`:

```ts
/** The owner's fixed limits (spec §4.6, §6). */
export interface Constitution {
  /** Employees at most, the coordinator included (never more than the desks). */
  maxEmployees: number;
  /** Share of the Claude quota kept for the owner: above 100 − this %, the office starts only urgent work. */
  ownerReservePct: number;
  /** Money the company may spend in a calendar month, USD; null = no cap. */
  monthlyUsdCap: number | null;
  chainDepth: number;
  tasksPerDay: number;
  openTasksPerPlan: number;
  /** Someone with nothing to do sleeps after this many idle minutes (0 = never). */
  idleSleepMinutes: number;
}

export const DEFAULT_CONSTITUTION: Constitution = {
  maxEmployees: 8,
  ownerReservePct: 25,
  monthlyUsdCap: null,
  chainDepth: 5,
  tasksPerDay: 30,
  openTasksPerPlan: 60,
  idleSleepMinutes: 30,
};

/** Money an employee spent on an outside service (the office cannot see it; they record it). */
export interface Spend {
  id: string;
  ts: number;
  by: string;
  service: string;
  usd: number;
  purpose: string;
  planId: string | null;
}

export interface ReserveState {
  /** The owner's share is being kept: the office starts only priority-1 work and lets idle people sleep. */
  active: boolean;
  /** Usage at or above which the reserve applies, %. */
  limitPct: number;
  fiveHourPct: number | null;
  sevenDayPct: number | null;
}

export interface BudgetSummary {
  constitution: Constitution;
  reserve: ReserveState;
  /** This calendar month (local time): recorded spending. */
  month: { key: string; usd: number };
  /** Per plan: money recorded with recordSpend, and the Claude usage of its tasks (USD equivalent). */
  plans: Record<string, { spentUsd: number; claudeUsd: number }>;
}
```

In `packages/shared/src/employee.ts` add `'sleeping',` to `LIFECYCLES` right after `'stopped',`.

In `packages/shared/src/events.ts`: add `import type { BudgetSummary, Spend } from './budget.ts';`, add `ModelAlias` to the `./employee.ts` type import, and before `| { type: 'error'; message: string };`:

```ts
  | { type: 'spend.recorded'; spend: Spend }
  | { type: 'budget.changed'; budget: BudgetSummary }
  | { type: 'model.changed'; model: ModelAlias }
```

and in `OfficeSnapshot` after `plans?: Plan[];`:

```ts
  /** The constitution, the reserve and the money (absent from servers without the company layer). */
  budget?: BudgetSummary;
```

`packages/shared/src/index.ts`: add `export * from './budget.ts';`.

`apps/office-web/src/ui/labels.ts`: add `sleeping: 'Uyuyor',` to `LABELS` after `stopped`.

- [ ] **Step 4: Migration v4**

Append to `MIGRATIONS` in `apps/office-server/src/migrations.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests, typecheck, commit**

Run: `pnpm --filter @cc/office-server exec vitest run test/db.test.ts && pnpm test && pnpm typecheck`
Expected: PASS.

```bash
git add packages/shared apps/office-server/src/migrations.ts apps/office-server/test/db.test.ts apps/office-web/src/ui/labels.ts
git commit -m "feat(budget): constitution, spending and task usage in the data model

Migration v4 (reversible) adds the constitution and spend tables and each
task's Claude usage; shared types for the constitution, spending, the reserve
and the budget summary; a sleeping lifecycle."
```

---

### Task 2: Budget stores

**Files:**
- Create: `apps/office-server/src/company/budget-store.ts`
- Modify: `apps/office-server/src/company/store.ts`
- Test: `apps/office-server/test/budget-store.test.ts`

**Interfaces:**
- Produces:
  - `class ConstitutionStore { constructor(db); get(): Constitution; set(patch: Partial<Constitution>): Constitution }` (missing keys read as `DEFAULT_CONSTITUTION`)
  - `class SpendStore { constructor(db, now?); create(s: Omit<Spend, 'id' | 'ts'>): Spend; list(o?: { planId?: string; since?: number; limit?: number }): Spend[] /* newest first */; total(o?: { planId?: string; since?: number }): number; byPlan(): Record<string, number> }`
  - `TaskStore.charge(id: string, usd: number, tokens: number): void`, `TaskStore.costByPlan(): Record<string, number>`

- [ ] **Step 1: Write the failing test**

Create `apps/office-server/test/budget-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONSTITUTION } from '@cc/shared';
import { migrateUp, openDb } from '../src/db.ts';
import { ConstitutionStore, SpendStore } from '../src/company/budget-store.ts';
import { TaskStore } from '../src/company/store.ts';

function stores() {
  const db = openDb(':memory:');
  migrateUp(db);
  let t = 1_000;
  const now = () => (t += 10);
  return { constitution: new ConstitutionStore(db), spend: new SpendStore(db, now), tasks: new TaskStore(db, now) };
}

describe('ConstitutionStore', () => {
  it('starts from the defaults and keeps what the owner changed', () => {
    const { constitution } = stores();
    expect(constitution.get()).toEqual(DEFAULT_CONSTITUTION);
    expect(constitution.set({ ownerReservePct: 40, monthlyUsdCap: 50 })).toEqual({ ...DEFAULT_CONSTITUTION, ownerReservePct: 40, monthlyUsdCap: 50 });
    expect(constitution.set({ monthlyUsdCap: null }).monthlyUsdCap).toBeNull();
    expect(constitution.get().ownerReservePct).toBe(40);
  });
});

describe('SpendStore', () => {
  it('records spending newest first and totals it by plan and since a time', () => {
    const { spend } = stores();
    const a = spend.create({ by: 'e1', service: 'ElevenLabs', usd: 5, purpose: 'ses', planId: 'p1' });
    spend.create({ by: 'e1', service: 'Canva', usd: 12.5, purpose: 'görsel', planId: 'p1' });
    spend.create({ by: 'e2', service: 'Alan adı', usd: 10, purpose: 'site', planId: null });
    expect(spend.list().map((s) => s.service)).toEqual(['Alan adı', 'Canva', 'ElevenLabs']);
    expect(spend.list({ planId: 'p1' })).toHaveLength(2);
    expect(spend.total()).toBe(27.5);
    expect(spend.total({ planId: 'p1' })).toBe(17.5);
    expect(spend.total({ since: a.ts + 1 })).toBe(22.5);
    expect(spend.byPlan()).toEqual({ p1: 17.5 });
  });
});

describe('TaskStore — Claude usage', () => {
  it('adds each turn to the task and sums it per plan', () => {
    const { tasks } = stores();
    const base = { title: 'x', description: '', done: [], requester: 'owner', assignee: 'e1', priority: 3, dependsOn: [], chainDepth: 0 };
    const a = tasks.create({ ...base, planId: 'p1' });
    const b = tasks.create({ ...base, planId: 'p1' });
    const c = tasks.create({ ...base, planId: null });
    tasks.charge(a.id, 0.25, 1000);
    tasks.charge(a.id, 0.25, 500);
    tasks.charge(b.id, 0.1, 10);
    tasks.charge(c.id, 9, 9);
    expect(tasks.costByPlan()).toEqual({ p1: 0.6 });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/budget-store.test.ts`
Expected: FAIL — cannot resolve `../src/company/budget-store.ts`.

- [ ] **Step 3: Implement**

Create `apps/office-server/src/company/budget-store.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { DEFAULT_CONSTITUTION, type Constitution, type Spend } from '@cc/shared';
import type { Db } from '../db.ts';

export class ConstitutionStore {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  get(): Constitution {
    const rows = this.#db.prepare('SELECT key, value FROM constitution').all() as unknown as Array<{ key: string; value: string }>;
    const stored: Record<string, unknown> = {};
    for (const r of rows) stored[r.key] = JSON.parse(r.value);
    const out = { ...DEFAULT_CONSTITUTION };
    for (const key of Object.keys(DEFAULT_CONSTITUTION) as Array<keyof Constitution>) {
      if (key in stored) (out as Record<string, unknown>)[key] = stored[key];
    }
    return out;
  }

  set(patch: Partial<Constitution>): Constitution {
    const write = this.#db.prepare('INSERT INTO constitution (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
    for (const [key, value] of Object.entries(patch)) write.run(key, JSON.stringify(value));
    return this.get();
  }
}

interface SpendRow {
  id: string;
  ts: number;
  by_id: string;
  service: string;
  usd: number;
  purpose: string;
  plan_id: string | null;
}

const spendFromRow = (r: SpendRow): Spend => ({ id: r.id, ts: r.ts, by: r.by_id, service: r.service, usd: r.usd, purpose: r.purpose, planId: r.plan_id });

/** Sums of money are kept to the cent. */
const cents = (n: number) => Math.round(n * 100) / 100;

export class SpendStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  create(s: Omit<Spend, 'id' | 'ts'>): Spend {
    const spend: Spend = { ...s, id: randomUUID(), ts: this.#now() };
    this.#db
      .prepare('INSERT INTO spend (id, ts, by_id, service, usd, purpose, plan_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(spend.id, spend.ts, spend.by, spend.service, spend.usd, spend.purpose, spend.planId);
    return spend;
  }

  list(o: { planId?: string; since?: number; limit?: number } = {}): Spend[] {
    const { where, params } = this.#filter(o);
    const rows = this.#db.prepare(`SELECT * FROM spend ${where} ORDER BY ts DESC, rowid DESC LIMIT ?`).all(...params, o.limit ?? 200) as unknown as SpendRow[];
    return rows.map(spendFromRow);
  }

  total(o: { planId?: string; since?: number } = {}): number {
    const { where, params } = this.#filter(o);
    const row = this.#db.prepare(`SELECT COALESCE(SUM(usd), 0) AS n FROM spend ${where}`).get(...params) as unknown as { n: number };
    return cents(row.n);
  }

  byPlan(): Record<string, number> {
    const rows = this.#db.prepare('SELECT plan_id, SUM(usd) AS n FROM spend WHERE plan_id IS NOT NULL GROUP BY plan_id').all() as unknown as Array<{ plan_id: string; n: number }>;
    return Object.fromEntries(rows.map((r) => [r.plan_id, cents(r.n)]));
  }

  #filter(o: { planId?: string; since?: number }): { where: string; params: Array<string | number> } {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (o.planId !== undefined) {
      clauses.push('plan_id = ?');
      params.push(o.planId);
    }
    if (o.since !== undefined) {
      clauses.push('ts >= ?');
      params.push(o.since);
    }
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }
}
```

In `apps/office-server/src/company/store.ts` add to `TaskStore` (before `createdSince`):

```ts
  /** One finished turn's Claude usage, added to the task the employee was on. */
  charge(id: string, usd: number, tokens: number): void {
    this.#db.prepare('UPDATE tasks SET cost_usd = cost_usd + ?, tokens = tokens + ? WHERE id = ?').run(usd, tokens, id);
  }

  costByPlan(): Record<string, number> {
    const rows = this.#db.prepare('SELECT plan_id, SUM(cost_usd) AS n FROM tasks WHERE plan_id IS NOT NULL GROUP BY plan_id').all() as unknown as Array<{ plan_id: string; n: number }>;
    return Object.fromEntries(rows.map((r) => [r.plan_id, Math.round(r.n * 100) / 100]));
  }
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @cc/office-server exec vitest run test/budget-store.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/office-server/src/company/budget-store.ts apps/office-server/src/company/store.ts apps/office-server/test/budget-store.test.ts
git commit -m "feat(budget): stores for the constitution, spending and task usage"
```

---

### Task 3: Sleep and wake in the engine; model changes in the roster

**Files:**
- Modify: `apps/office-server/src/engine.ts`, `apps/office-server/src/roster.ts`
- Test: `apps/office-server/test/engine-company.test.ts`, `apps/office-server/test/roster.test.ts`

**Interfaces:**
- Produces: `Engine.sleep(id): Promise<Employee>` (idle only; closes the process, lifecycle `sleeping`), `Engine.wake(id): Employee` (a sleeper starts again with the same session; anyone else unchanged); `EmployeePatch` gains `model`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/office-server/test/roster.test.ts` (inside `describe('Roster — company fields', …)`):

```ts
  it('changes the model', () => {
    const s = setup();
    const e = s.roster.create({ name: 'Ada', role: 'r', model: 'haiku' });
    expect(s.roster.update(e.id, { model: 'opus' }).model).toBe('opus');
    expect(s.roster.get(e.id).model).toBe('opus');
    s.cleanup();
  });
```

Append to `apps/office-server/test/engine-company.test.ts` (inside its `describe`):

```ts
  it('review focus: sleeps only when idle, wakes with the same session, and a message wakes a sleeper', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    await readArgv(t.argvLog, 1);
    t.engine.send(e.id, 'SLOW iş');
    await expect(t.engine.sleep(e.id)).rejects.toThrow(/Yalnız boştaki/);
    await until(() => t.engine.ready(e.id), 8000);
    expect((await t.engine.sleep(e.id)).lifecycle).toBe('sleeping');
    expect(t.engine.ready(e.id)).toBe(false);
    expect((await t.engine.sleep(e.id)).lifecycle).toBe('sleeping');
    const before = (await readArgv(t.argvLog, 1)).length;
    expect(t.engine.wake(e.id).lifecycle).toBe('idle');
    const runs = await readArgv(t.argvLog, before + 1);
    expect(runs.at(-1)!.args).toContain('--resume');
    await t.engine.sleep(e.id);
    t.engine.send(e.id, 'uyan');
    await waitFor(t.events, (x) => x.employeeId === e.id && x.event.type === 'message.assistant' && x.event.text.includes('uyan'), { timeoutMs: 8000 });
  });

  it('review focus: a sleeper stays asleep across an office restart', async () => {
    const t = make();
    const e = t.engine.hire({ name: 'Ada', role: 'r' });
    await until(() => t.engine.ready(e.id));
    await t.engine.sleep(e.id);
    const before = (await readArgv(t.argvLog, 1)).length;
    t.engine.recover();
    await new Promise((r) => setTimeout(r, 300));
    expect(t.roster.get(e.id).lifecycle).toBe('sleeping');
    expect(await readArgv(t.argvLog, 1)).toHaveLength(before);
  });
```

(The fake claude echoes each message as `echo: <text>`, so the assistant text contains `uyan`.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/engine-company.test.ts test/roster.test.ts`
Expected: FAIL — `sleep` is not a function; model unchanged.

- [ ] **Step 3: Roster**

In `apps/office-server/src/roster.ts`:
- `EmployeePatch` gains `'model'` in its `Pick` list;
- `update` writes it:

```ts
  update(id: string, patch: EmployeePatch): Employee {
    const next = { ...this.get(id), ...patch };
    this.#db
      .prepare(
        `UPDATE employees SET lifecycle = ?, session_started = ?, limit_resets_at = ?, last_error = ?, role = ?, title = ?,
           team = ?, kind = ?, reports_to = ?, model = ? WHERE id = ?`,
      )
      .run(next.lifecycle, next.sessionStarted ? 1 : 0, next.limitResetsAt, next.lastError, next.role, next.title, next.team, next.kind, next.reportsTo, next.model, id);
    return next;
  }
```

- [ ] **Step 4: Engine**

In `apps/office-server/src/engine.ts`, next to `stop`, add:

```ts
  /** Closes an idle employee's session to free the machine; their next task or message starts it again (same session). */
  sleep(id: string): Promise<Employee> {
    return this.#exclusive(id, async () => {
      const employee = this.#roster.get(id);
      if (employee.lifecycle === 'sleeping') return employee;
      if (employee.lifecycle !== 'idle' || this.#runtime(id).turnActive) throw new ConflictError('Yalnız boştaki bir çalışan uyutulabilir; işi bitince uyut.');
      await this.#halt(id);
      return this.#setLifecycle(this.#roster.get(id), 'sleeping', 'uyutuldu');
    });
  }

  /** A sleeper starts again with the same session; anyone else is left as they are. */
  wake(id: string): Employee {
    const employee = this.#roster.get(id);
    if (employee.lifecycle !== 'sleeping') return employee;
    this.#assertNotBusy(this.#runtime(id));
    return this.#start(employee, 'uyandı');
  }
```

(`send` already starts a closed session — `if (!rt.proc || rt.proc.exited) this.#start(…)` — so a message wakes a sleeper; `recover` only starts `idle`/`starting` employees, so a sleeper stays asleep; `resume` works for a sleeper as for a stopped employee.)

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @cc/office-server exec vitest run test/engine-company.test.ts test/roster.test.ts && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src/engine.ts apps/office-server/src/roster.ts apps/office-server/test/engine-company.test.ts apps/office-server/test/roster.test.ts
git commit -m "feat(engine): employees can sleep and wake; the model can change

sleep closes an idle employee's session (lifecycle sleeping) and keeps it; wake,
resume or a message starts it again with the same session; a sleeper stays
asleep across an office restart."
```

---

### Task 4: The Budget service, and the company within the constitution

**Files:**
- Create: `apps/office-server/src/company/budget.ts`
- Modify: `apps/office-server/src/company/company.ts`, `apps/office-server/test/company-helpers.ts`
- Test: `apps/office-server/test/budget.test.ts`, `apps/office-server/test/company.test.ts`

**Interfaces:**
- Consumes: the stores (Task 2), `QuotaTracker.state()/usageAll()`, `Roster`, `EventStore`, `NoticeStore`, `PlanStore`, `TaskStore`, `clean` (`./text.ts`).
- Produces:
  - `interface BudgetDeps { constitution: ConstitutionStore; spend: SpendStore; tasks: TaskStore; plans: PlanStore; roster: Roster; events: EventStore; notices: NoticeStore; quota: { state(): QuotaState | null; usageAll?(ids: string[]): Record<string, EmployeeUsage> }; deskCount: number; now?: () => number }`
  - `class Budget { constitution(): Constitution; setConstitution(patch: Record<string, unknown>): Constitution; reserve(): ReserveState; reserveActive(): boolean; checkReserve(): void; recordSpend(by, s: { service: string; usd: number; purpose: string; planId?: string | null }): { spend: Spend; warnings: string[] }; spending(planId?: string): Spend[]; chargeTurn(employeeId: string, usd: number, tokens: number): void; summary(): BudgetSummary; status(): string; watch(): () => void }`
  - `CompanyDeps.constitution?: () => Constitution` (limits and headcount); `Company.setModel(by: string, id: string, model: ModelAlias): Employee`
  - `companyFor(…)` also returns `budget` and `setQuota(q: QuotaState | null)`.

- [ ] **Step 1: Write the failing tests**

Create `apps/office-server/test/budget.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONSTITUTION, OWNER, type QuotaState } from '@cc/shared';
import { companyFor } from './company-helpers.ts';
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
  return { ...s, ...companyFor(s, f), engine: f.engine };
}

const quota = (five: number, seven = 0.1, resetsIn = 3_600_000): QuotaState => ({
  status: 'allowed',
  fiveHour: { utilization: five, resetsAt: Date.now() + resetsIn },
  sevenDay: { utilization: seven, resetsAt: Date.now() + resetsIn },
  updatedAt: Date.now(),
});

describe('Budget — constitution', () => {
  it('starts from the defaults and takes the owner’s changes', () => {
    const t = make();
    expect(t.budget.constitution()).toEqual(DEFAULT_CONSTITUTION);
    expect(t.budget.setConstitution({ ownerReservePct: 40, monthlyUsdCap: 100, maxEmployees: 5 })).toMatchObject({ ownerReservePct: 40, monthlyUsdCap: 100, maxEmployees: 5 });
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'budget.changed')).toBe(true);
  });

  it('review focus: refuses wrong types, out-of-range values and unknown keys, changing nothing', () => {
    const t = make();
    for (const bad of [
      { maxEmployees: 9 }, { maxEmployees: 0 }, { maxEmployees: 2.5 }, { ownerReservePct: -1 }, { ownerReservePct: 95 }, { ownerReservePct: '25' },
      { monthlyUsdCap: -5 }, { chainDepth: 0 }, { tasksPerDay: 501 }, { idleSleepMinutes: 1441 }, { salary: 10 },
    ]) {
      expect(() => t.budget.setConstitution(bad), JSON.stringify(bad)).toThrow(/Anayasa|anayasa/);
    }
    expect(t.budget.constitution()).toEqual(DEFAULT_CONSTITUTION);
  });
});

describe('Budget — the owner’s reserve', () => {
  it('is in force at 100 − the owner’s share, tells the coordinator once each way, and ends when the window resets', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    t.setQuota(quota(0.5));
    t.budget.checkReserve();
    expect(t.budget.reserveActive()).toBe(false);
    t.setQuota(quota(0.8));
    t.budget.checkReserve();
    t.budget.checkReserve();
    expect(t.budget.reserve()).toMatchObject({ active: true, limitPct: 75, fiveHourPct: 80 });
    expect(t.notices.pending(c.id).filter((n) => n.text.includes('kota payı devrede'))).toHaveLength(1);
    t.setQuota(quota(0.8, 0.1, -1000));
    t.budget.checkReserve();
    expect(t.budget.reserve()).toMatchObject({ active: false, fiveHourPct: 0 });
    expect(t.notices.pending(c.id).at(-1)?.text).toMatch(/serbest/);
  });

  it('never applies when the owner keeps no share', () => {
    const t = make();
    t.budget.setConstitution({ ownerReservePct: 0 });
    t.setQuota(quota(1));
    expect(t.budget.reserveActive()).toBe(false);
  });
});

describe('Budget — money', () => {
  it('review focus: records spending, warns past the monthly cap and the plan’s money, and tells the coordinator', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    const plan = t.company.propose(c.id, { title: 'Video', goal: 'g', approach: 'a', usd: 20 });
    t.company.approve(plan.id);
    t.budget.setConstitution({ monthlyUsdCap: 30 });
    expect(t.budget.recordSpend(ada.id, { service: 'ElevenLabs', usd: 15, purpose: 'ses', planId: plan.id }).warnings).toEqual([]);
    const over = t.budget.recordSpend(ada.id, { service: 'Canva', usd: 16, purpose: 'görsel', planId: plan.id });
    expect(over.warnings.join(' ')).toMatch(/aylık sınırı/);
    expect(over.warnings.join(' ')).toMatch(/onaylanan \$20/);
    expect(t.notices.pending(c.id).at(-1)?.text).toMatch(/aylık sınırı/);
    expect(t.budget.summary()).toMatchObject({ month: { usd: 31 }, plans: { [plan.id]: { spentUsd: 31 } } });
    expect(t.budget.spending(plan.id)).toHaveLength(2);
    for (const bad of [0, -3, Number.NaN, 2_000_000, '5' as unknown as number]) {
      expect(() => t.budget.recordSpend(ada.id, { service: 's', usd: bad, purpose: 'p' })).toThrow(/Tutar/);
    }
    expect(() => t.budget.recordSpend(ada.id, { service: 's', usd: 1, purpose: 'p', planId: 'nope' })).toThrow(/Plan bulunamadı/);
  });
});

describe('Budget — Claude usage per plan', () => {
  it('review focus: charges a turn to the running task, nothing without one, and the hand-over too', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    t.budget.chargeTurn(ada.id, 1, 100);
    const plan = t.company.propose(c.id, { title: 'P', goal: 'g', approach: 'a' });
    t.company.approve(plan.id);
    const task = t.company.createTask(c.id, { assignee: ada.id, title: 'iş', planId: plan.id });
    t.company.start(task.id);
    t.budget.chargeTurn(ada.id, 0.4, 1000);
    expect(t.budget.summary().plans[plan.id]).toEqual({ spentUsd: 0, claudeUsd: 0.4 });
    const handover = t.company.beginHandover(ada.id);
    t.company.start(handover.id);
    expect(() => t.budget.chargeTurn(ada.id, 0.2, 10)).not.toThrow();
  });

  it('charges finished turns as they happen once watching', async () => {
    const t = make();
    const stop = t.budget.watch();
    cleanups.push(stop);
    const c = t.company.hireCoordinator();
    const plan = t.company.propose(c.id, { title: 'P', goal: 'g', approach: 'a' });
    t.company.approve(plan.id);
    const task = t.company.createTask(c.id, { assignee: c.id, title: 'iş', planId: plan.id });
    t.company.start(task.id);
    t.events.append(c.id, { type: 'turn.finished', ok: true, subtype: 'success', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 }, costUsd: 0.05, numTurns: 1, queuedTurns: 0 });
    expect(t.budget.summary().plans[plan.id]?.claudeUsd).toBe(0.05);
  });
});

describe('Budget — status for the coordinator', () => {
  it('says the quota, the reserve, the month and every running plan in Turkish', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const plan = t.company.propose(c.id, { title: 'Video', goal: 'g', approach: 'a', usd: 20, quotaPct: 10 });
    t.company.approve(plan.id);
    t.setQuota(quota(0.3));
    const text = t.budget.status();
    expect(text).toContain('5 saat %30');
    expect(text).toContain('sınır %75');
    expect(text).toContain('Bu ay harcanan: $0');
    expect(text).toContain('“Video”');
  });
});
```

Append to `apps/office-server/test/company.test.ts`:

```ts
describe('Company — within the constitution', () => {
  it('refuses a hire past maxEmployees and uses the constitution’s loop limits', async () => {
    const { companyFor } = await import('./company-helpers.ts');
    const s = setup();
    const f = fakeEngine(s);
    cleanups.push(f.cleanup, s.cleanup);
    const t = companyFor(s, f);
    t.budget.setConstitution({ maxEmployees: 2, tasksPerDay: 1 });
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    expect(() => t.company.hire(c.id, { name: 'Can', role: 'r' })).toThrow(/en fazla 2 çalışan/);
    expect(() => t.company.hire(OWNER, { name: 'Can', role: 'r' })).toThrow(/en fazla 2 çalışan/);
    t.company.createTask(ada.id, { assignee: c.id, title: 'bir' });
    expect(() => t.company.createTask(ada.id, { assignee: c.id, title: 'iki' })).toThrow(/günde en fazla 1/);
  });

  it('lets the coordinator change someone’s model and reloads their session', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r', model: 'haiku' });
    expect(t.company.setModel(c.id, ada.id, 'sonnet').model).toBe('sonnet');
    expect(t.reloaded).toContain(ada.id);
    expect(t.events.list({ limit: 500 }).some((e) => e.employeeId === ada.id && e.event.type === 'model.changed')).toBe(true);
    expect(() => t.company.setModel(c.id, ada.id, 'gpt' as never)).toThrow(/Bilinmeyen model/);
    expect(() => t.company.setModel(ada.id, c.id, 'haiku')).toThrow(/Yalnız koordinatör/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/budget.test.ts test/company.test.ts`
Expected: FAIL — `companyFor` has no `budget`; `setModel` is not a function.

- [ ] **Step 3: The Budget service**

Create `apps/office-server/src/company/budget.ts`:

```ts
import { DEFAULT_CONSTITUTION, type BudgetSummary, type Constitution, type EmployeeUsage, type OfficeEvent, type QuotaState, type QuotaWindow, type ReserveState, type Spend } from '@cc/shared';
import { ValidationError } from '../errors.ts';
import type { EventStore } from '../event-store.ts';
import type { Roster } from '../roster.ts';
import type { ConstitutionStore, SpendStore } from './budget-store.ts';
import type { NoticeStore, PlanStore, TaskStore } from './store.ts';
import { clean } from './text.ts';

export interface BudgetDeps {
  constitution: ConstitutionStore;
  spend: SpendStore;
  tasks: TaskStore;
  plans: PlanStore;
  roster: Roster;
  events: EventStore;
  notices: NoticeStore;
  quota: { state(): QuotaState | null; usageAll?(ids: string[]): Record<string, EmployeeUsage> };
  /** Desks in the office: the most employees the constitution may allow. */
  deskCount: number;
  now?: () => number;
}

const RULES: Record<keyof Constitution, { label: string; min: number; max: (desks: number) => number; integer: boolean; nullable?: boolean }> = {
  maxEmployees: { label: 'Çalışan sınırı', min: 1, max: (desks) => desks, integer: true },
  ownerReservePct: { label: 'Sahibinin kota payı (%)', min: 0, max: () => 90, integer: true },
  monthlyUsdCap: { label: 'Aylık para sınırı (USD)', min: 0, max: () => 1_000_000, integer: false, nullable: true },
  chainDepth: { label: 'Paslama zinciri', min: 1, max: () => 20, integer: true },
  tasksPerDay: { label: 'Günlük görev sınırı', min: 1, max: () => 500, integer: true },
  openTasksPerPlan: { label: 'Plan başına açık görev', min: 1, max: () => 500, integer: true },
  idleSleepMinutes: { label: 'Boşta uyuma süresi (dk)', min: 0, max: () => 1440, integer: true },
};

const money = (n: number) => `$${(Math.round(n * 100) / 100).toString()}`;

/** A window whose reset time has passed is a fresh window: 0 %. */
function pctOf(w: QuotaWindow | null, now: number): number | null {
  if (!w) return null;
  return w.resetsAt <= now ? 0 : Math.round(w.utilization * 100);
}

/** The owner's limits and the company's money and quota (spec §6). */
export class Budget {
  readonly #d: BudgetDeps;
  readonly #now: () => number;
  #wasActive = false;

  constructor(d: BudgetDeps) {
    this.#d = d;
    this.#now = d.now ?? Date.now;
  }

  constitution(): Constitution {
    return this.#d.constitution.get();
  }

  /** The owner changes the constitution; every value is checked before anything is written. */
  setConstitution(patch: Record<string, unknown>): Constitution {
    const checked: Partial<Constitution> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULT_CONSTITUTION)) throw new ValidationError(`Bilinmeyen anayasa maddesi: ${key}`);
      const rule = RULES[key as keyof Constitution];
      if (value === null && rule.nullable) {
        (checked as Record<string, unknown>)[key] = null;
        continue;
      }
      const max = rule.max(this.#d.deskCount);
      if (typeof value !== 'number' || !Number.isFinite(value) || (rule.integer && !Number.isInteger(value)) || value < rule.min || value > max) {
        throw new ValidationError(`Anayasa: ${rule.label} ${rule.min} ile ${max} arasında ${rule.integer ? 'bir tam sayı' : 'bir sayı'} olmalı${rule.nullable ? ' (ya da boş)' : ''}.`);
      }
      (checked as Record<string, unknown>)[key] = value;
    }
    const next = this.#d.constitution.set(checked);
    this.#announce();
    this.checkReserve();
    return next;
  }

  reserve(): ReserveState {
    const c = this.constitution();
    const limitPct = 100 - c.ownerReservePct;
    const q = this.#d.quota.state();
    const now = this.#now();
    const fiveHourPct = pctOf(q?.fiveHour ?? null, now);
    const sevenDayPct = pctOf(q?.sevenDay ?? null, now);
    const active = c.ownerReservePct > 0 && [fiveHourPct, sevenDayPct].some((p) => p !== null && p >= limitPct);
    return { active, limitPct, fiveHourPct, sevenDayPct };
  }

  reserveActive(): boolean {
    return this.reserve().active;
  }

  /** When the reserve starts or ends: the coordinator is told once, and the screen hears. */
  checkReserve(): void {
    const r = this.reserve();
    if (r.active === this.#wasActive) return;
    this.#wasActive = r.active;
    const coordinator = this.#d.roster.list().find((e) => e.kind === 'coordinator');
    if (coordinator) {
      const used = Math.max(r.fiveHourPct ?? 0, r.sevenDayPct ?? 0);
      this.#d.notices.add(
        coordinator.id,
        r.active
          ? `Sahibinin kota payı devrede: kullanım %${used}, sınır %${r.limitPct}. Ofis yalnız öncelik 1 görevleri başlatıyor, boştakiler uyuyor; pencere açılınca kendiliğinden döner. Gerekirse öncelikleri yeniden sırala.`
          : 'Sahibinin kota payı serbest kaldı: ofis normal çalışmaya döndü.',
      );
    }
    this.#announce();
  }

  recordSpend(by: string, s: { service: string; usd: number; purpose: string; planId?: string | null }): { spend: Spend; warnings: string[] } {
    this.#d.roster.get(by);
    if (typeof s.usd !== 'number' || !Number.isFinite(s.usd) || s.usd <= 0 || s.usd > 1_000_000) throw new ValidationError('Tutar sıfırdan büyük bir sayı olmalı (USD).');
    const planId = s.planId ?? null;
    const plan = planId !== null ? this.#d.plans.get(planId) : null;
    const spend = this.#d.spend.create({
      by,
      service: clean(s.service, 'Servis', 80, true),
      usd: Math.round(s.usd * 100) / 100,
      purpose: clean(s.purpose, 'Ne için', 500, true),
      planId,
    });
    this.#emit(by, { type: 'spend.recorded', spend });
    const warnings: string[] = [];
    const c = this.constitution();
    const month = this.#d.spend.total({ since: this.#monthStart() });
    if (c.monthlyUsdCap !== null && month > c.monthlyUsdCap) {
      warnings.push(`Bu ayın harcaması ${money(month)} ile aylık sınırı (${money(c.monthlyUsdCap)}) aştı; koordinatör sahibine getirmeli.`);
    }
    if (plan && plan.usd !== null) {
      const spent = this.#d.spend.total({ planId: plan.id });
      if (spent > plan.usd) warnings.push(`“${plan.title}” planının harcaması ${money(spent)} ile onaylanan ${money(plan.usd)} bütçeyi aştı: bu büyük bir değişiklik, planRevise ile sahibine getirilmeli.`);
    }
    const coordinator = this.#d.roster.list().find((e) => e.kind === 'coordinator');
    if (warnings.length && coordinator && coordinator.id !== by) this.#d.notices.add(coordinator.id, warnings.join(' '));
    this.#announce();
    return { spend, warnings };
  }

  spending(planId?: string): Spend[] {
    return this.#d.spend.list({ planId, limit: 200 });
  }

  /** A finished turn's Claude usage goes to the task the employee is on (nothing when they are on none). */
  chargeTurn(employeeId: string, usd: number, tokens: number): void {
    const task = this.#d.tasks.inProgressOf(employeeId);
    if (task && (usd > 0 || tokens > 0)) this.#d.tasks.charge(task.id, usd, tokens);
  }

  summary(): BudgetSummary {
    const spent = this.#d.spend.byPlan();
    const claude = this.#d.tasks.costByPlan();
    const plans: BudgetSummary['plans'] = {};
    for (const id of new Set([...Object.keys(spent), ...Object.keys(claude)])) plans[id] = { spentUsd: spent[id] ?? 0, claudeUsd: claude[id] ?? 0 };
    return { constitution: this.constitution(), reserve: this.reserve(), month: { key: this.#monthKey(), usd: this.#d.spend.total({ since: this.#monthStart() }) }, plans };
  }

  /** What the coordinator reads with budgetStatus. */
  status(): string {
    const r = this.reserve();
    const c = this.constitution();
    const s = this.summary();
    const pct = (p: number | null) => (p === null ? '—' : `%${p}`);
    const lines = [
      `Kota: 5 saat ${pct(r.fiveHourPct)}, 7 gün ${pct(r.sevenDayPct)} (sahibinin payı %${c.ownerReservePct} → sınır %${r.limitPct})${r.active ? '. PAY DEVREDE: yalnız öncelik 1 görevler başlıyor.' : '.'}`,
      `Bu ay harcanan: ${money(s.month.usd)}${c.monthlyUsdCap !== null ? ` / sınır ${money(c.monthlyUsdCap)}` : ''}.`,
    ];
    const running = this.#d.plans.list().filter((p) => p.status === 'approved');
    if (running.length) {
      lines.push('Süren planlar:');
      for (const p of running) {
        const b = s.plans[p.id] ?? { spentUsd: 0, claudeUsd: 0 };
        lines.push(
          `• “${p.title}”: para ${money(b.spentUsd)}${p.usd !== null ? ` / ${money(p.usd)}` : ''} · Claude kullanımı ~${money(b.claudeUsd)}${p.quotaPct !== null ? ` · tahmini kota %${p.quotaPct}` : ''}`,
        );
      }
    }
    const people = this.#d.roster.list();
    const usage = this.#d.quota.usageAll?.(people.map((e) => e.id)) ?? {};
    const top = people
      .map((e) => ({ name: e.name, usd: usage[e.id]?.today.costUsd ?? 0 }))
      .filter((x) => x.usd > 0)
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 5);
    if (top.length) lines.push(`Bugün en çok kullananlar: ${top.map((x) => `${x.name} ~${money(x.usd)}`).join(', ')}.`);
    return lines.join('\n');
  }

  /** Charges finished turns and re-checks the reserve when a new quota reading arrives. */
  watch(): () => void {
    return this.#d.events.subscribe((stored) => {
      const ev = stored.event;
      if (ev.type === 'turn.finished' && stored.employeeId) {
        const u = ev.usage;
        this.chargeTurn(stored.employeeId, ev.costUsd, u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheCreationTokens);
      } else if (ev.type === 'quota.updated') this.checkReserve();
    });
  }

  #monthStart(): number {
    const d = new Date(this.#now());
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }

  #monthKey(): string {
    const d = new Date(this.#now());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  #announce(): void {
    this.#emit(null, { type: 'budget.changed', budget: this.summary() });
  }

  #emit(employeeId: string | null, event: OfficeEvent): void {
    this.#d.events.append(employeeId, event);
  }
}
```

- [ ] **Step 4: The company within the constitution**

In `apps/office-server/src/company/company.ts`:
- imports: `MODEL_ALIASES` and `DEFAULT_CONSTITUTION` from `@cc/shared` (value import next to `OWNER`), `type Constitution` and `type ModelAlias` in the type import;
- replace `export const LIMITS = …` with:

```ts
/** The constitution's loop guards by default (spec §4.6); the owner changes them in the constitution. */
export const LIMITS = {
  chainDepth: DEFAULT_CONSTITUTION.chainDepth,
  perDay: DEFAULT_CONSTITUTION.tasksPerDay,
  perPlanOpen: DEFAULT_CONSTITUTION.openTasksPerPlan,
} as const;
```

- `CompanyDeps` gains:

```ts
  /** The owner's constitution (team size, loop limits); absent: the defaults. */
  constitution?: () => Constitution;
```

- add a private helper `#rules(): Constitution { return this.#d.constitution?.() ?? DEFAULT_CONSTITUTION; }`
- in `createTask` read the limits from it: `const rules = this.#rules();` at the top, and replace `LIMITS.perPlanOpen` with `rules.openTasksPerPlan`, `LIMITS.chainDepth` with `rules.chainDepth` (three places) and `LIMITS.perDay` with `rules.tasksPerDay` (three places);
- in `hire` and `hireCoordinator`, before calling `this.#d.hire`, add `this.#assertRoom();` with:

```ts
  #assertRoom(): void {
    const max = this.#rules().maxEmployees;
    if (this.#d.roster.list().length >= max) throw new ConflictError(`Anayasa en fazla ${max} çalışan diyor; yeni biri için sahibine getir.`);
  }
```

- add, after `editRoleCard`:

```ts
  /** The coordinator (or the owner) moves someone to another model; their session goes on with it, memory kept. */
  setModel(by: string, id: string, model: ModelAlias): Employee {
    if (by !== OWNER) this.#assertCoordinator(by);
    if (!(MODEL_ALIASES as readonly string[]).includes(model)) throw new ValidationError(`Bilinmeyen model: ${String(model)}. Seçenekler: ${MODEL_ALIASES.join(', ')}.`);
    const current = this.#d.roster.get(id);
    if (current.lifecycle === 'archived') throw new ConflictError(`${current.name} işten çıkarıldı.`);
    if (current.model === model) return current;
    const next = this.#d.roster.update(id, { model });
    this.#emit(id, { type: 'model.changed', model });
    this.#d.reload?.(id);
    return next;
  }
```

- [ ] **Step 5: The test helper**

In `apps/office-server/test/company-helpers.ts`:
- imports: `import type { QuotaState } from '@cc/shared';`, `import { Budget } from '../src/company/budget.ts';`, `import { ConstitutionStore, SpendStore } from '../src/company/budget-store.ts';`
- before the `Company`:

```ts
  let quotaState: QuotaState | null = null;
  const budget = new Budget({
    constitution: new ConstitutionStore(s.db), spend: new SpendStore(s.db), tasks, plans, roster: s.roster, events: s.events, notices,
    quota: { state: () => quotaState }, deskCount: 8,
  });
```

- pass `constitution: () => budget.constitution()` to the `Company`;
- return `{ tasks, plans, notices, memory, company, reloaded, budget, setQuota: (q: QuotaState | null) => { quotaState = q; } }`.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @cc/office-server exec vitest run test/budget.test.ts test/company.test.ts && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/office-server/src/company/budget.ts apps/office-server/src/company/company.ts apps/office-server/test/company-helpers.ts apps/office-server/test/budget.test.ts apps/office-server/test/company.test.ts
git commit -m "feat(budget): the budget service, and a company within the constitution

The owner's constitution is checked key by key; the reserve follows the live
quota and tells the coordinator when it starts and ends; spending is recorded
with warnings past the monthly cap or a plan's money; each finished turn's
Claude usage goes to the running task. Hiring stops at maxEmployees, the loop
limits come from the constitution, and the coordinator can change a model."
```

---

### Task 5: The Dispatcher keeps the reserve and lets idle people sleep

**Files:**
- Modify: `apps/office-server/src/company/dispatcher.ts`
- Test: `apps/office-server/test/dispatcher.test.ts`

**Interfaces:**
- Consumes: `Budget.reserveActive/constitution/checkReserve` (Task 4), `Engine.sleep/wake` (Task 3).
- Produces: `DispatchEngine` gains `sleep(id): Promise<unknown>` and `wake(id): unknown`; `DispatcherDeps` gains `budget?: { reserveActive(): boolean; constitution(): Constitution; checkReserve(): void }`, `now?: () => number`, `tickMs?: number` (default 60 000). Behaviour: while the reserve is in force only priority-1 and hand-over tasks start and idle members sleep; a sleeper with a task that may start (or a coordinator with notices) is woken; someone idle with nothing to do sleeps after `idleSleepMinutes`; a timer re-checks the reserve and sweeps; sweeps also on `quota.updated` and `budget.changed`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/office-server/test/dispatcher.test.ts`:

```ts
describe('Dispatcher — reserve and sleep', () => {
  function makeBudgeted(o: { idleSleepMinutes?: number } = {}) {
    const s = setup();
    const f = fakeEngine(s);
    const c = companyFor(s, f);
    if (o.idleSleepMinutes !== undefined) c.budget.setConstitution({ idleSleepMinutes: o.idleSleepMinutes });
    let clock = Date.now();
    const stop = new Dispatcher({
      events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine: f.engine,
      budget: c.budget, now: () => clock, tickMs: 50,
    }).start();
    cleanups.push(stop, f.cleanup, s.cleanup);
    return { ...s, ...c, engine: f.engine, advance: (ms: number) => (clock += ms) };
  }
  const high = () => ({ status: 'allowed', fiveHour: { utilization: 0.9, resetsAt: Date.now() + 3_600_000 }, sevenDay: null, updatedAt: Date.now() });

  it('review focus: in the reserve only priority 1 starts, idle members sleep, and everything resumes when it ends', async () => {
    const t = makeBudgeted();
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r' });
    await until(() => t.engine.ready(ada.id));
    t.setQuota(high());
    t.budget.checkReserve();
    const routine = t.company.createTask(coord.id, { assignee: ada.id, title: 'Rutin', priority: 3 });
    await until(() => t.roster.get(ada.id).lifecycle === 'sleeping', 8000);
    expect(t.tasks.get(routine.id).status).toBe('waiting');
    expect(t.roster.get(coord.id).lifecycle).not.toBe('sleeping');
    const urgent = t.company.createTask(coord.id, { assignee: ada.id, title: 'Acil', priority: 1 });
    await until(() => t.tasks.get(urgent.id).status === 'in_progress', 8000);
    t.company.finish(ada.id, urgent.id, { summary: 'tamam', outputs: [], learned: '' });
    t.setQuota(null);
    await until(() => t.tasks.get(routine.id).status === 'in_progress', 8000);
  });

  it('review focus: someone idle with nothing to do sleeps after the constitution’s minutes, and a task wakes them', async () => {
    const t = makeBudgeted({ idleSleepMinutes: 1 });
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    await until(() => t.engine.ready(ada.id));
    await sleep(200);
    expect(t.roster.get(ada.id).lifecycle).toBe('idle');
    t.advance(61_000);
    await until(() => t.roster.get(ada.id).lifecycle === 'sleeping', 8000);
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'Uyanınca' });
    await until(() => t.tasks.get(task.id).status === 'in_progress', 8000);
    expect(systemMessages(t.events.list({ limit: 5000 }), ada.id).some((m) => m.includes('## Görev: Uyanınca'))).toBe(true);
  });

  it('a sleeping coordinator wakes for its notices; a sleeping member waits for real work', async () => {
    const t = makeBudgeted();
    const coord = t.company.hireCoordinator();
    const ada = t.company.hire(coord.id, { name: 'Ada', role: 'r' });
    await until(() => t.engine.ready(ada.id) && t.engine.ready(coord.id));
    await t.engine.sleep(coord.id);
    await t.engine.sleep(ada.id);
    t.notices.add(ada.id, 'Bilgi: toplantı yok.');
    const plan = t.company.propose(coord.id, { title: 'P', goal: 'g', approach: 'a' });
    t.company.approve(plan.id);
    await until(() => systemMessages(t.events.list({ limit: 5000 }), coord.id).some((m) => m.includes('Plan onaylandı')), 8000);
    await sleep(300);
    expect(t.roster.get(ada.id).lifecycle).toBe('sleeping');
  });

  it('does not wake someone the owner stopped, even with work', async () => {
    const t = makeBudgeted();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    await t.engine.stop(ada.id);
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'x' });
    await sleep(300);
    expect(t.roster.get(ada.id).lifecycle).toBe('stopped');
    expect(t.tasks.get(task.id).status).toBe('waiting');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @cc/office-server exec vitest run test/dispatcher.test.ts`
Expected: FAIL — `budget` is not used; Ada never sleeps.

- [ ] **Step 3: Implement**

In `apps/office-server/src/company/dispatcher.ts`:
- import `type Constitution` and `type Employee` from `@cc/shared`;
- `DispatchEngine` gains:

```ts
  sleep(id: string): Promise<unknown>;
  wake(id: string): unknown;
```

- `DispatcherDeps` gains:

```ts
  /** The owner's reserve and the constitution (absent: no reserve, no idle sleep). */
  budget?: { reserveActive(): boolean; constitution(): Constitution; checkReserve(): void };
  now?: () => number;
  /** How often the reserve is re-checked and everyone swept again (the quota resets on its own clock). */
  tickMs?: number;
```

- fields: `readonly #now: () => number;`, `readonly #idleSince = new Map<string, number>();` (set `this.#now = d.now ?? Date.now;` in the constructor)
- replace `start()` with:

```ts
  start(): () => void {
    const off = this.#d.events.subscribe((stored) => {
      const ev = stored.event;
      if (ev.type === 'lifecycle.changed' && stored.employeeId) {
        if (ev.to === 'idle') this.#idleSince.set(stored.employeeId, this.#now());
        else this.#idleSince.delete(stored.employeeId);
        if (ev.to === 'idle') this.#schedule(stored.employeeId);
      } else if (['task.changed', 'plan.changed', 'decision.recorded', 'quota.updated', 'budget.changed'].includes(ev.type)) this.#scheduleSweep();
    });
    const timer = setInterval(() => {
      this.#d.budget?.checkReserve();
      this.#scheduleSweep();
    }, this.#d.tickMs ?? 60_000);
    timer.unref();
    this.#scheduleSweep();
    return () => {
      off();
      clearInterval(timer);
    };
  }
```

- at the top of `#consider`, before `if (!this.#d.engine.ready(id)) return;`:

```ts
    const employee = this.#person(id);
    if (!employee) return;
    if (employee.lifecycle === 'sleeping') {
      if (this.#hasWorkFor(employee)) this.#wake(id);
      return;
    }
```

- in `#consider`, change `if (next) started = this.#d.company.start(next.id);` to `if (next && this.#mayStart(next)) started = this.#d.company.start(next.id);`
- replace `if (!body && pending.length === 0) return;` with:

```ts
    if (!body && pending.length === 0) {
      this.#maybeSleep(employee, focus);
      return;
    }
```

- add the helpers:

```ts
  #person(id: string): Employee | null {
    try {
      return this.#d.roster.get(id);
    } catch {
      return null;
    }
  }

  #reserve(): boolean {
    return this.#d.budget?.reserveActive() ?? false;
  }

  /** While the owner's share is kept, only urgent work and hand-overs start. */
  #mayStart(task: Task): boolean {
    return !this.#reserve() || task.priority === 1 || task.kind === 'handover';
  }

  /** A sleeper wakes for a task that may start now; the coordinator also for its notices (they are its work). */
  #hasWorkFor(e: Employee): boolean {
    if (this.#d.tasks.list({ assignee: e.id, statuses: ['waiting'] }).some((t) => t.kind === 'handover')) return true;
    const next = this.#d.tasks.nextFor(e.id);
    if (next && this.#mayStart(next)) return true;
    return e.kind === 'coordinator' && this.#d.notices.pending(e.id).length > 0;
  }

  #wake(id: string): void {
    try {
      this.#d.engine.wake(id);
    } catch {
      // Busy with an owner's action: the next sweep tries again.
    }
  }

  /** Nothing to do: in the reserve members sleep at once; otherwise after the constitution's idle minutes. */
  #maybeSleep(e: Employee, focus: Task | null): void {
    if (focus) return;
    if (this.#reserve() && e.kind !== 'coordinator') {
      void this.#d.engine.sleep(e.id).catch(() => undefined);
      return;
    }
    const minutes = this.#d.budget?.constitution().idleSleepMinutes ?? 0;
    if (minutes <= 0) return;
    const since = this.#idleSince.get(e.id);
    if (since === undefined) {
      this.#idleSince.set(e.id, this.#now());
      return;
    }
    if (this.#now() - since >= minutes * 60_000) void this.#d.engine.sleep(e.id).catch(() => undefined);
  }
```

(`focus` in `#consider` is `Task | undefined`; pass `focus ?? null`.)

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @cc/office-server exec vitest run test/dispatcher.test.ts && pnpm --filter @cc/office-server test && pnpm typecheck`
Expected: PASS. Run `test/dispatcher.test.ts` three times; it must pass each time.

- [ ] **Step 5: Commit**

```bash
git add apps/office-server/src/company/dispatcher.ts apps/office-server/test/dispatcher.test.ts
git commit -m "feat(budget): the office keeps the owner's share and lets idle people sleep

While the reserve is in force only priority-1 work and hand-overs start and idle
members sleep; a timer notices when the quota window resets. Someone with
nothing to do sleeps after the constitution's idle minutes; a task that may
start wakes them, and the coordinator also wakes for its notices."
```
