# Coordinator Craft — Stage 2 (the project manager and the living loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The coordinator runs the project as its PM in a loop that keeps itself going: it sets goals from the company's mission, starts plans under them without waiting for the owner (full autonomy by default, reversible in the constitution), the office's own code watches the project and wakes the coordinator only when a decision is due, and the owner sees everything and can stop a plan, drop a goal or pause the whole company at any moment.

**Architecture:** Migration v9 adds `goals`, `company_state` (key/value: paused, rest, pulse markers) and `plans.goal_id / approved_by`; plans get the status `stopped`. The constitution gains `autonomy` ('free' | 'plans', default 'free'), `activeGoals` (3) and `pulseHours` (6). `Company` gains goals, autonomy-aware `propose`/`revise`, owner controls (`stopPlan`, `stopGoal`, `pause`, `resume`) and `restUntil`. A pure `Pulse` (run on the dispatcher's 60 s tick, no model) leaves the coordinator decision notices when a goal has no running plan or the company has neither goals nor work; a paused company delivers nothing. New tools: `goalSet`, `goalsRead`, `restUntil`. The web gets a Hedefler tab, "Koordinatör başlattı" and Durdur on plan cards, Duraklat / Sürdür in the top bar, and the three new constitution fields.

**Tech Stack:** as stage 1.

**Spec:** `docs/superpowers/specs/2026-10-07-coordinator-craft-design.md` (§1 items 6–8, §2 Serbestlik and Sahibinin sözü, §6, §7, §8 stage 2, §9, §10, §11, §12; stage 2 of §13).

**Base:** `main` after stage 1 is merged (migration v8). This plan's migration is v9.

## Global Constraints

- Node 24 type stripping: no enums, no parameter properties, `import type` for types, `.ts` extensions in imports.
- Every migration is reversible: `up` + `down`, `down` removes exactly what `up` added and touches no data, round trip tested.
- Tool descriptions in English; tool results, errors, guides and UI text in Turkish.
- Commits: plain conventional commits as the user, no AI trailer or marker of any kind.
- Real claude only opt-in (`OFFICE_SMOKE=1`), temp data dirs, never port 4319; clean `~/.claude/projects/-tmp-cc-*` afterwards.
- The pulse runs in the office's code only; it never opens a turn by itself — it leaves decision notices, which the dispatcher delivers by its existing rules (never interrupting, waking a sleeping coordinator).
- Purchases, irreversible actions and budget limits stay with the owner at every autonomy level.

## Spec rulings (decided here)

- **Autonomy default 'free'** (the owner's decision). Tests that exercise the owner's approval set `autonomy: 'plans'` explicitly (`companyFor` does, and so does every test that builds `Company` without a budget, through the `PLANS_ONLY` constitution helper).
- **A plan started by the coordinator** (`free`): `propose` creates it `approved` with `approvedBy: 'coordinator'` and emits `proposed` then `approved`; no `plan.approved` notice (the coordinator just started it; the tool's reply says so). `revise` in `free` keeps the plan `approved` (version + 1, no snapshot, emits `revised`). Under `plans` everything is as before (`approvedBy: 'owner'` on the owner's approval).
- **Goals:** `goalSet` (coordinator) creates (title, why, ≥ 1 done item; at most `activeGoals` active) or updates (any field; status `done` / `dropped` closes it, `active` reopens it within the limit). A plan may name an active goal (`goalId`). The owner stops a goal from the screen: it becomes `dropped` with the note "Sahibi durdurdu" and its running plans stop.
- **Stopping a plan** (owner): status `stopped`; its open tasks (waiting, in progress, in review, blocked, and open review tasks) are cancelled; whoever holds a started one hears `task.cancelled`; the coordinator hears `plan.stopped`. A stopped plan takes no new tasks and no revision; the coordinator proposes a new one if needed.
- **Pause:** `company_state.paused`. While paused the dispatcher delivers nothing (no task, no notice, no reminder, no wake) and the pulse is silent; running turns finish; the owner's messages still reach anyone (they go straight to the engine). Resume sweeps at once.
- **Pulse** (each tick, skipped with no coordinator, while paused, or during the owner's reserve):
  - *Goal idle:* an active goal with no running plan (`draft` or `approved`) → decision `pulse.goal_idle`, once per "episode" (marker = the goal's latest plan id, or `none`): a new plan for the goal that later ends re-arms it.
  - *No goal:* no active goal, no running plan and no open task → decision `pulse.no_goal`, at most once every `pulseHours` hours (`0` = never), and not before `restUntil`.
- **`restUntil(hours, reason)`** (coordinator, 1–168 h): records why there is nothing worth doing; the "no goal" notice waits until then. A new goal clears it.
- **Snapshot:** `goals` (active + the last 20 closed) and `paused`.
- **Where the company's state lives:** the spec (§8) puts `paused` and `restUntil` in the constitution's key/value table; they are state, not rules (the constitution store only reads its own keys and the Anayasa form lists them all), so they go to a new `company_state` key/value table in v9, with the pulse's markers. Same shape, one more table.

## Review Focus

1. A plan stopped while a task of it is in review: the review task is cancelled too, and a later `reviewDecide` on it is refused — nothing reopens or completes a stopped plan (Task 4).
2. Switching autonomy at runtime: a plan proposed as a draft under `plans`, then autonomy set to `free` — the owner can still approve or decline that draft; a revision of it under `free` starts it (Task 3).
3. A pulse after an office restart must not repeat notices it already left: the markers live in the database (Task 5).
4. A paused company: a sleeping coordinator is not woken by pulse or notices; resuming delivers what waited, once (Task 4, Task 5).
5. Malformed goal input from a model — `done` as a string, empty why, unknown status, an id that does not exist, a sixth active goal — gets a clear Turkish error and stores nothing (Task 2).

---

## File Structure

```
packages/shared/src/company.ts            MODIFY  Goal types, PLAN_STATUSES + 'stopped', Plan.goalId/approvedBy, PlanChange + 'stopped', AUTONOMY_LEVELS
packages/shared/src/budget.ts             MODIFY  autonomy, activeGoals, pulseHours
packages/shared/src/events.ts             MODIFY  goal.changed, company.paused; snapshot goals/paused
apps/office-server/src/migrations.ts      MODIFY  v9
apps/office-server/src/company/goal-store.ts   CREATE  GoalStore, CompanyStateStore
apps/office-server/src/company/store.ts   MODIFY  plans.goal_id / approved_by
apps/office-server/src/company/budget.ts  MODIFY  validation of the three keys
apps/office-server/src/company/company.ts MODIFY  goals, autonomy, stop/pause, restUntil
apps/office-server/src/company/pulse.ts   CREATE  the pulse
apps/office-server/src/company/notices.ts MODIFY  topics
apps/office-server/src/company/dispatcher.ts   MODIFY  pause, pulse on the tick
apps/office-server/src/company/craft/pm.md     CREATE  the coordinator's PM part of the core
apps/office-server/src/company/craft.ts   MODIFY  pmText
apps/office-server/src/company/roles.ts   MODIFY  coordinator guide: autonomy-aware, pm.md
apps/office-server/src/mcp/tools.ts       MODIFY  goalSet, goalsRead, restUntil; planPropose goalId and replies
apps/office-server/src/api.ts             MODIFY  stop plan / goal, pause / resume, snapshot
apps/office-server/src/main.ts            MODIFY  wiring
apps/office-web/src/...                   MODIFY  store, api, labels, GoalsTab (new), PlanCard, TopBar, BudgetTabs, EventItem, CompanyView, styles
tests: db, goal-store, budget, goals (new), autonomy (new), owner-control (new), pulse (new), dispatcher, mcp-tools, company-api, web; pm.smoke.real.test.ts (new, opt-in)
```

---

### Task 1: Types, constitution keys, migration v9, stores

**Files:**
- Modify: `packages/shared/src/company.ts`, `packages/shared/src/budget.ts`, `packages/shared/src/events.ts`
- Modify: `apps/office-server/src/migrations.ts`, `apps/office-server/src/company/store.ts`, `apps/office-server/src/company/budget.ts`
- Create: `apps/office-server/src/company/goal-store.ts`
- Test: `apps/office-server/test/db.test.ts`, `apps/office-server/test/goal-store.test.ts` (new), `apps/office-server/test/budget.test.ts`

**Interfaces:**
- Produces: `Goal`, `GoalStatus`, `GOAL_STATUSES`, `GoalChange`, `AUTONOMY_LEVELS`, `Autonomy`; `Plan.goalId?: string | null`, `Plan.approvedBy?: 'owner' | 'coordinator' | null`; `PlanStatus` incl. `'stopped'`; `PlanChange` incl. `'stopped'`; `Constitution.autonomy/activeGoals/pulseHours`; events `goal.changed { change, goal }`, `company.paused { paused }`; `OfficeSnapshot.goals?`, `OfficeSnapshot.paused?`.
- Produces (server): `GoalStore` (`create(g: NewGoal): Goal`, `get(id)`, `list(o?: { statuses?: GoalStatus[]; limit?: number })`, `update(id, patch: GoalPatch)`, `activeCount()`); `CompanyStateStore` (`get(key): string | null`, `set(key, value: string | null)`, `paused(): boolean`, `setPaused(b)`, `restUntil(): number`, `setRest(until, reason)`); `NewPlan.goalId?`, `NewPlan.approvedBy?`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/office-server/test/db.test.ts` (inside `describe('migrations')`) and change the three top-level `toBe(8)` to `toBe(9)`; the v8 test's last line becomes `expect(migrateUp(db, upTo(8))).toBe(8);`:

```ts
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
    expect(migrateUp(db)).toBe(9);
  });
```

(The two whole-schema table lists at the top of the file — `V5_TABLES` used by "applies every migration up" and "round-trips" — gain `'company_state'` and `'goals'`: define `const V9_TABLES = [...V5_TABLES, 'company_state', 'goals'].sort();` and use it in those two tests.)

Create `apps/office-server/test/goal-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { migrateUp, openDb } from '../src/db.ts';
import { CompanyStateStore, GoalStore } from '../src/company/goal-store.ts';
import { PlanStore } from '../src/company/store.ts';

function stores() {
  const db = openDb(':memory:');
  migrateUp(db);
  let t = 1_000;
  const now = () => (t += 1);
  return { goals: new GoalStore(db, now), state: new CompanyStateStore(db), plans: new PlanStore(db, now) };
}

describe('GoalStore', () => {
  it('creates, reads, lists by status, updates and counts the active goals', () => {
    const { goals } = stores();
    const a = goals.create({ title: 'Lansman', why: 'Müşteri bulmak', done: ['site yayında'], createdBy: 'c' });
    expect(a).toMatchObject({ status: 'active', closedAt: null, note: null, done: ['site yayında'] });
    expect(goals.get(a.id)).toEqual(a);
    const b = goals.create({ title: 'Destek', why: 'Memnuniyet', done: ['yanıt < 1 gün'], createdBy: 'c' });
    expect(goals.activeCount()).toBe(2);
    const closed = goals.update(b.id, { status: 'done', closedAt: 5000, note: 'bitti' });
    expect(closed).toMatchObject({ status: 'done', closedAt: 5000, note: 'bitti' });
    expect(goals.activeCount()).toBe(1);
    expect(goals.list({ statuses: ['active'] }).map((g) => g.id)).toEqual([a.id]);
    expect(goals.list().map((g) => g.id)).toEqual([a.id, b.id]);
    expect(() => goals.get('yok')).toThrow(/Hedef bulunamadı/);
  });
});

describe('CompanyStateStore', () => {
  it('keeps the pause, the rest and any marker; null removes a key', () => {
    const { state } = stores();
    expect(state.paused()).toBe(false);
    state.setPaused(true);
    expect(state.paused()).toBe(true);
    expect(state.restUntil()).toBe(0);
    state.setRest(9000, 'değerli iş yok');
    expect(state.restUntil()).toBe(9000);
    expect(state.get('restReason')).toBe('değerli iş yok');
    state.set('pulse.goal.g1', 'none');
    expect(state.get('pulse.goal.g1')).toBe('none');
    state.set('pulse.goal.g1', null);
    expect(state.get('pulse.goal.g1')).toBeNull();
  });
});

describe('PlanStore — goal and who started it (v9)', () => {
  it('stores a plan’s goal and who approved it; an old plan has neither', () => {
    const { plans } = stores();
    const p = plans.create({ title: 'P', goal: 'g', approach: 'a', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '', proposedBy: 'c', goalId: 'g1' });
    expect(plans.get(p.id)).toMatchObject({ goalId: 'g1', approvedBy: null });
    plans.update(p.id, { status: 'approved', approvedBy: 'coordinator' });
    expect(plans.get(p.id)).toMatchObject({ status: 'approved', approvedBy: 'coordinator', goalId: 'g1' });
    const old = plans.create({ title: 'Eski', goal: 'g', approach: 'a', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '', proposedBy: 'c' });
    expect(plans.get(old.id)).toMatchObject({ goalId: null, approvedBy: null });
  });
});
```

Append to `apps/office-server/test/budget.test.ts` (it has a `make()` returning `budget`; use it as the file's other constitution tests do):

```ts
  it('the PM keys: autonomy free by default, the active-goal limit and the pulse interval, validated in Turkish', () => {
    const t = make();
    expect(t.budget.constitution()).toMatchObject({ autonomy: 'free', activeGoals: 3, pulseHours: 6 });
    expect(t.budget.setConstitution({ autonomy: 'plans', activeGoals: 5, pulseHours: 0 })).toMatchObject({ autonomy: 'plans', activeGoals: 5, pulseHours: 0 });
    expect(() => t.budget.setConstitution({ autonomy: 'yarım' })).toThrow(/Serbestlik/);
    expect(() => t.budget.setConstitution({ activeGoals: 0 })).toThrow(/aktif hedef/);
    expect(() => t.budget.setConstitution({ pulseHours: 200 })).toThrow(/Nabız/);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/office-server && npx vitest run test/db.test.ts test/goal-store.test.ts test/budget.test.ts`
Expected: FAIL — `migrateUp` returns 8, `Cannot find module '../src/company/goal-store.ts'`, unknown constitution key `autonomy`.

- [ ] **Step 3: Shared types**

In `packages/shared/src/company.ts` replace the `PLAN_STATUSES` line and add, after `PlanMethod`:

```ts
export const PLAN_STATUSES = ['draft', 'approved', 'done', 'declined', 'stopped'] as const;
```

```ts
/** How free the coordinator is (spec §6.2): 'free' starts its plans at once; 'plans' waits for the owner on each. */
export const AUTONOMY_LEVELS = ['free', 'plans'] as const;
export type Autonomy = (typeof AUTONOMY_LEVELS)[number];

export const GOAL_STATUSES = ['active', 'done', 'dropped'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];
/** A lasting aim above the plans (spec §6.1): why it matters to the mission and when it counts as reached. */
export interface Goal {
  id: string;
  title: string;
  why: string;
  done: string[];
  status: GoalStatus;
  createdBy: string;
  createdAt: number;
  closedAt: number | null;
  note: string | null;
}
/** `set`: opened; `updated`: changed or reopened; `closed`: done or dropped by the coordinator; `stopped`: by the owner. */
export type GoalChange = 'set' | 'updated' | 'closed' | 'stopped';
```

In `interface Plan`, after `method?`:

```ts
  /** The goal it serves (spec §6.1), if any. */
  goalId?: string | null;
  /** Who started it: the owner's approval, or the coordinator itself under full autonomy (spec §6.2). */
  approvedBy?: 'owner' | 'coordinator' | null;
```

Replace the `PlanChange` line:

```ts
/** `reopened`: a done plan got a new task. `kept`: the owner declined a revision; the plan goes on as approved. `stopped`: by the owner. */
export type PlanChange = 'proposed' | 'revised' | 'approved' | 'declined' | 'done' | 'reopened' | 'kept' | 'stopped';
```

In `packages/shared/src/budget.ts`: import `type Autonomy` from `./company.ts`; add to `Constitution` (after `difficultyModelsEnabled`):

```ts
  /** 'free': the coordinator sets goals and starts its plans without waiting (spec §6.2); 'plans': each plan waits for the owner. */
  autonomy: Autonomy;
  /** Goals active at once, at most (spec §6.1). */
  activeGoals: number;
  /** With neither goals nor work, the coordinator is told at most this often, hours; 0 = never (spec §6.3). */
  pulseHours: number;
```

and to `DEFAULT_CONSTITUTION`: `autonomy: 'free', activeGoals: 3, pulseHours: 6,`.

In `packages/shared/src/events.ts`: extend the imports with `Goal, GoalChange`; add to the `OfficeEvent` union:

```ts
  | { type: 'goal.changed'; change: GoalChange; goal: Goal }
  | { type: 'company.paused'; paused: boolean }
```

and to `OfficeSnapshot`:

```ts
  /** Active goals and the last closed ones. */
  goals?: Goal[];
  /** The owner paused the company: nothing is handed out. */
  paused?: boolean;
```

- [ ] **Step 4: Migration v9**

Append to `MIGRATIONS`:

```ts
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
```

- [ ] **Step 5: Stores**

Create `apps/office-server/src/company/goal-store.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { Goal, GoalStatus } from '@cc/shared';
import type { Db } from '../db.ts';
import { NotFoundError } from '../errors.ts';

interface GoalRow {
  id: string;
  title: string;
  why: string;
  done: string;
  status: string;
  created_by: string;
  created_at: number;
  closed_at: number | null;
  note: string | null;
}

const goalFromRow = (r: GoalRow): Goal => ({
  id: r.id, title: r.title, why: r.why, done: JSON.parse(r.done) as string[], status: r.status as GoalStatus, createdBy: r.created_by,
  createdAt: r.created_at, closedAt: r.closed_at, note: r.note,
});

export interface NewGoal {
  title: string;
  why: string;
  done: string[];
  createdBy: string;
}

export type GoalPatch = Partial<Pick<Goal, 'title' | 'why' | 'done' | 'status' | 'closedAt' | 'note'>>;

export class GoalStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  create(g: NewGoal): Goal {
    const goal: Goal = { ...g, id: randomUUID(), status: 'active', createdAt: this.#now(), closedAt: null, note: null };
    this.#db
      .prepare('INSERT INTO goals (id, title, why, done, status, created_by, created_at, closed_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)')
      .run(goal.id, goal.title, goal.why, JSON.stringify(goal.done), goal.status, goal.createdBy, goal.createdAt);
    return goal;
  }

  get(id: string): Goal {
    const row = this.#db.prepare('SELECT * FROM goals WHERE id = ?').get(id) as unknown as GoalRow | undefined;
    if (!row) throw new NotFoundError(`Hedef bulunamadı: ${id}`);
    return goalFromRow(row);
  }

  /** Oldest first. */
  list(o: { statuses?: GoalStatus[]; limit?: number } = {}): Goal[] {
    const where = o.statuses?.length ? `WHERE status IN (${o.statuses.map(() => '?').join(', ')})` : '';
    const rows = this.#db.prepare(`SELECT * FROM goals ${where} ORDER BY created_at LIMIT ?`).all(...(o.statuses ?? []), o.limit ?? 1000) as unknown as GoalRow[];
    return rows.map(goalFromRow);
  }

  update(id: string, patch: GoalPatch): Goal {
    const next = { ...this.get(id), ...patch };
    this.#db
      .prepare('UPDATE goals SET title = ?, why = ?, done = ?, status = ?, closed_at = ?, note = ? WHERE id = ?')
      .run(next.title, next.why, JSON.stringify(next.done), next.status, next.closedAt, next.note, id);
    return next;
  }

  activeCount(): number {
    return (this.#db.prepare("SELECT COUNT(*) AS n FROM goals WHERE status = 'active'").get() as unknown as { n: number }).n;
  }
}

/** Small lasting facts about the company itself (paused, resting, the pulse's markers): survive a restart. */
export class CompanyStateStore {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  get(key: string): string | null {
    const row = this.#db.prepare('SELECT value FROM company_state WHERE key = ?').get(key) as unknown as { value: string } | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string | null): void {
    if (value === null) this.#db.prepare('DELETE FROM company_state WHERE key = ?').run(key);
    else this.#db.prepare('INSERT INTO company_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  paused(): boolean {
    return this.get('paused') === 'true';
  }

  setPaused(paused: boolean): void {
    this.set('paused', paused ? 'true' : null);
  }

  /** Until when the coordinator rests (no "no goal" pulse), epoch ms; 0 = not resting. */
  restUntil(): number {
    return Number(this.get('restUntil') ?? '0') || 0;
  }

  setRest(until: number, reason: string): void {
    this.set('restUntil', until > 0 ? String(until) : null);
    this.set('restReason', until > 0 ? reason : null);
  }
}
```

In `apps/office-server/src/company/store.ts` (`PlanStore`): `PlanRow` gets `goal_id: string | null; approved_by: string | null;`; `planFromRow` gets `goalId: r.goal_id ?? null, approvedBy: (r.approved_by as Plan['approvedBy']) ?? null,`; `NewPlan` gets `goalId?: string | null; approvedBy?: 'owner' | 'coordinator' | null;`; `create` spreads `goalId: p.goalId ?? null, approvedBy: p.approvedBy ?? null`; `#write` appends `p.goalId ?? null, p.approvedBy ?? null` to `values` and the columns `goal_id, approved_by` to both the INSERT (before `id, proposed_by, created_at`, with two more `?`) and the UPDATE (`…, method = ?, goal_id = ?, approved_by = ? WHERE id = ?`).

- [ ] **Step 6: Constitution validation**

In `apps/office-server/src/company/budget.ts`:

- `NumberKey` excludes also `'autonomy'`: `type NumberKey = Exclude<keyof Constitution, 'digestHours' | 'coordinatorModels' | 'difficultyModels' | 'autonomy' | SwitchKey>;`
- `RULES` gets:

```ts
  activeGoals: { label: 'En fazla aktif hedef', min: 1, max: () => 10, integer: true },
  pulseHours: { label: 'Nabız aralığı (saat)', min: 0, max: () => 168, integer: true },
```

- in `setConstitution`, before the `SWITCHES` branch:

```ts
      if (key === 'autonomy') {
        if (!(AUTONOMY_LEVELS as readonly unknown[]).includes(value)) throw new ValidationError('Anayasa: Serbestlik free (tam serbest) ya da plans (planlar sahibine) olmalı.');
        checked.autonomy = value as Autonomy;
        continue;
      }
```

(import `AUTONOMY_LEVELS, type Autonomy` from `@cc/shared`).

- [ ] **Step 7: Run the tests and the type check**

Run: `cd apps/office-server && npx vitest run test/db.test.ts test/goal-store.test.ts test/budget.test.ts && cd ../.. && pnpm -r --if-present typecheck`
Expected: PASS; typecheck clean (the web's `PLAN_STATUS_LABELS` needs `stopped: 'Durduruldu'` and `EventItem`'s `PLAN_CHANGE` needs `stopped: 'durduruldu'` — add both now).

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src apps/office-server/src apps/office-server/test apps/office-web/src/ui/labels.ts apps/office-web/src/ui/EventItem.tsx
git commit -m "feat(company): migration v9 — goals, the company's own state, a plan's goal and who started it"
```

---

### Task 2: Goals

**Files:**
- Modify: `apps/office-server/src/company/company.ts` (deps `goals?`, `state?`; `goalSet`, `goals`; `propose` takes `goalId`)
- Modify: `apps/office-server/src/mcp/tools.ts` (`goalSet`, `goalsRead`; `planPropose.goalId`)
- Modify: `apps/office-server/test/company-helpers.ts` (wire the stores)
- Test: `apps/office-server/test/goals.test.ts` (new), `apps/office-server/test/mcp-tools.test.ts`

**Interfaces:**
- Consumes: `GoalStore`, `CompanyStateStore`, `Goal` (Task 1).
- Produces: `CompanyDeps.goals?: GoalStore`, `CompanyDeps.state?: CompanyStateStore`; `Company.goalSet(by, input: GoalInput): Goal` with `GoalInput = { goalId?: string; title?: string; why?: string; done?: string[]; status?: string; note?: string }`; `Company.goals(): Goal[]` (active, then the last 20 closed); `PlanDraft.goalId?: string | null`; test helper `companyFor` returns `goals`, `state`.

- [ ] **Step 1: Write the failing tests**

Create `apps/office-server/test/goals.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { companyFor, METHOD } from './company-helpers.ts';
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
  const c = companyFor(s, f);
  const coordinator = c.company.hireCoordinator('sonnet');
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r' });
  return { ...s, ...c, coordinator, ada };
}

const GOAL = { title: 'İlk müşteriler', why: 'Misyon: küçük işletmelere ulaşmak', done: ['10 görüşme', '2 ödeme yapan müşteri'] };

describe('goals (spec §6.1)', () => {
  it('the coordinator sets a goal with why and a definition of done; the screen hears', () => {
    const t = make();
    const goal = t.company.goalSet(t.coordinator.id, GOAL);
    expect(goal).toMatchObject({ ...GOAL, status: 'active', createdBy: t.coordinator.id });
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'goal.changed' && e.event.change === 'set' && e.event.goal.id === goal.id)).toBe(true);
    expect(t.company.goals().map((g) => g.id)).toEqual([goal.id]);
  });

  it('refuses a goal without why or done items, malformed input, and anyone but the coordinator', () => {
    const t = make();
    expect(() => t.company.goalSet(t.coordinator.id, { ...GOAL, why: ' ' })).toThrow(/Neden/);
    expect(() => t.company.goalSet(t.coordinator.id, { ...GOAL, done: [] })).toThrow(/bitti tanımı/);
    expect(() => t.company.goalSet(t.coordinator.id, { ...GOAL, done: 'iki müşteri' as unknown as string[] })).toThrow(/liste/);
    expect(() => t.company.goalSet(t.coordinator.id, { goalId: 'yok', status: 'done' })).toThrow(/Hedef bulunamadı/);
    expect(() => t.company.goalSet(t.ada.id, GOAL)).toThrow(/koordinatör/);
    expect(t.goals.list()).toHaveLength(0);
  });

  it('keeps at most the constitution’s number of active goals; closing one makes room; reopening counts again', () => {
    const t = make();
    const ids = [1, 2, 3].map((n) => t.company.goalSet(t.coordinator.id, { ...GOAL, title: `Hedef ${n}` }).id);
    expect(() => t.company.goalSet(t.coordinator.id, { ...GOAL, title: 'Hedef 4' })).toThrow(/En fazla 3 aktif hedef/);
    const closed = t.company.goalSet(t.coordinator.id, { goalId: ids[0], status: 'done', note: 'ulaşıldı' });
    expect(closed).toMatchObject({ status: 'done', note: 'ulaşıldı' });
    expect(closed.closedAt).not.toBeNull();
    t.company.goalSet(t.coordinator.id, { ...GOAL, title: 'Hedef 4' });
    expect(() => t.company.goalSet(t.coordinator.id, { goalId: ids[0], status: 'active' })).toThrow(/En fazla 3 aktif hedef/);
    expect(() => t.company.goalSet(t.coordinator.id, { goalId: ids[1], status: 'bekliyor' })).toThrow(/active, done ya da dropped/);
  });

  it('a plan may serve an active goal; not a closed one or one that does not exist', () => {
    const t = make();
    const goal = t.company.goalSet(t.coordinator.id, GOAL);
    const plan = t.company.propose(t.coordinator.id, { title: 'Görüşmeler', goal: 'g', approach: 'a', method: METHOD, goalId: goal.id });
    expect(plan.goalId).toBe(goal.id);
    t.company.goalSet(t.coordinator.id, { goalId: goal.id, status: 'dropped' });
    expect(() => t.company.propose(t.coordinator.id, { title: 'P2', goal: 'g', approach: 'a', method: METHOD, goalId: goal.id })).toThrow(/aktif değil/);
    expect(() => t.company.propose(t.coordinator.id, { title: 'P3', goal: 'g', approach: 'a', method: METHOD, goalId: 'yok' })).toThrow(/Hedef bulunamadı/);
  });
});
```

In `apps/office-server/test/mcp-tools.test.ts`: the coordinator-only list gains `'goalSet'` and `'restUntil'` (alphabetical; `restUntil` arrives in Task 5 — add only `'goalSet'` now), and the lead list gains `'goalsRead'` (alphabetical, after `'decisionRecord'`); append:

```ts
  it('lets the coordinator set goals and anyone in charge read them with their plans', async () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    expect(await t.call(c, 'goalSet', { title: 'Lansman', why: 'Misyon', done: ['site yayında'] })).toMatch(/Hedef açıldı/);
    const goal = t.goals.list()[0]!;
    await t.call(c, 'planPropose', { title: 'Site', goal: 'g', approach: 'a', method: METHOD, goalId: goal.id });
    const read = await t.call(c, 'goalsRead');
    expect(read).toContain('Lansman');
    expect(read).toContain('Site');
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/office-server && npx vitest run test/goals.test.ts`
Expected: FAIL — `goalSet is not a function` / `t.goals` undefined.

- [ ] **Step 3: Test helper wiring**

In `apps/office-server/test/company-helpers.ts`: import `CompanyStateStore, GoalStore` from `../src/company/goal-store.ts`; create `const goals = new GoalStore(s.db, now); const state = new CompanyStateStore(s.db);`; pass `goals, state` to `new Company({...})`; return them.

- [ ] **Step 4: Company**

In `apps/office-server/src/company/company.ts`: import `type Goal, GOAL_STATUSES, type GoalStatus` from `@cc/shared` and `type { CompanyStateStore, GoalStore } from './goal-store.ts'`; add to `CompanyDeps`:

```ts
  /** Goals and the company's own state (stage 2; absent in tests that do not care). */
  goals?: GoalStore;
  state?: CompanyStateStore;
```

add to `PlanDraft`: `goalId?: string | null;` and export:

```ts
export interface GoalInput {
  goalId?: string;
  title?: string;
  why?: string;
  done?: string[];
  status?: string;
  note?: string;
}
```

Add a goals section (after the plans section):

```ts
  // ── goals ─────────────────────────────────────────────────────────────────

  /** The coordinator opens, changes or closes a goal (spec §6.1). */
  goalSet(by: string, input: GoalInput): Goal {
    this.#assertCoordinator(by);
    const store = this.#goals();
    if (input.done !== undefined && !(Array.isArray(input.done) && input.done.every((d) => typeof d === 'string'))) {
      throw new ValidationError('Hedefin bitti tanımı (done) metinlerden oluşan bir liste olmalı.');
    }
    if (input.status !== undefined && !(GOAL_STATUSES as readonly string[]).includes(input.status)) throw new ValidationError('Hedef durumu active, done ya da dropped olmalı.');
    const status = input.status as GoalStatus | undefined;
    if (!input.goalId) {
      this.#assertGoalRoom();
      const goal = store.create({
        title: clean(input.title, 'Hedef başlığı', 160, true),
        why: clean(input.why, 'Neden (misyona bağı)', 2000, true),
        done: this.#goalDone(input.done),
        createdBy: by,
      });
      this.#d.state?.setRest(0, '');
      this.#emit(by, { type: 'goal.changed', change: 'set', goal });
      return goal;
    }
    const current = store.get(input.goalId);
    if (status === 'active' && current.status !== 'active') this.#assertGoalRoom();
    const closing = status !== undefined && status !== 'active' && current.status === 'active';
    const goal = store.update(current.id, {
      title: input.title === undefined ? current.title : clean(input.title, 'Hedef başlığı', 160, true),
      why: input.why === undefined ? current.why : clean(input.why, 'Neden (misyona bağı)', 2000, true),
      done: input.done === undefined ? current.done : this.#goalDone(input.done),
      status: status ?? current.status,
      closedAt: closing ? this.#now() : status === 'active' ? null : current.closedAt,
      note: input.note === undefined ? current.note : clean(input.note, 'Not', 2000, false) || null,
    });
    this.#emit(by, { type: 'goal.changed', change: closing ? 'closed' : 'updated', goal });
    return goal;
  }

  /** Active goals first (oldest first), then the last 20 closed. */
  goals(): Goal[] {
    if (!this.#d.goals) return [];
    return [...this.#d.goals.list({ statuses: ['active'] }), ...this.#d.goals.list({ statuses: ['done', 'dropped'] }).slice(-20)];
  }

  #goals(): GoalStore {
    if (!this.#d.goals) throw new ConflictError('Bu ofiste hedefler açık değil.');
    return this.#d.goals;
  }

  #goalDone(done: string[] | undefined): string[] {
    const items = lines(done, 'Hedefin bitti tanımı', 12, 300);
    if (items.length === 0) throw new ValidationError('Hedefin en az bir maddelik bitti tanımı (done) olmalı: neye ulaşınca hedef tamam?');
    return items;
  }

  /** Checked before anything is written: one more active goal must fit the constitution's limit. */
  #assertGoalRoom(): void {
    const max = this.#rules().activeGoals;
    if (this.#goals().activeCount() >= max) throw new ConflictError(`En fazla ${max} aktif hedef olabilir; önce birini kapat (goalSet: status done ya da dropped).`);
  }
```

In `propose`, after `const fields = this.#draft(draft);` add:

```ts
    const goalId = this.#goalOf(draft.goalId);
```

and pass `goalId` to `plans.create`. Add the helper:

```ts
  /** A plan names an active goal, or none. */
  #goalOf(id: string | null | undefined): string | null {
    if (id === undefined || id === null || id === '') return null;
    const goal = this.#goals().get(id);
    if (goal.status !== 'active') throw new ConflictError(`“${goal.title}” hedefi aktif değil; plana aktif bir hedef ver ya da hedefsiz öner.`);
    return goal.id;
  }
```

- [ ] **Step 5: Tools**

In `apps/office-server/src/mcp/tools.ts`, add after `planRetro`:

```ts
    {
      name: 'goalSet',
      description:
        'Open, change or close a goal (coordinator) — the lasting aims above the plans, taken from the company mission: a title, why it serves the mission, and a measurable definition of done. Without goalId it opens a new one; with goalId it changes it (status done or dropped closes it, active reopens it). Keep few goals active.',
      inputSchema: object({ goalId: s('The goal to change; omit to open a new one.'), title: s('Goal title.'), why: s('Why it matters to the mission.'), done: strings('When it counts as reached, one measurable item each.'), status: { type: 'string', enum: ['active', 'done', 'dropped'] }, note: s('A note, e.g. why it was closed.') }),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const goal = company.goalSet(employee.id, { goalId: optStr(args, 'goalId'), title: optStr(args, 'title'), why: optStr(args, 'why'), done: args.done as string[] | undefined, status: optStr(args, 'status'), note: optStr(args, 'note') });
        if (!optStr(args, 'goalId')) return `Hedef açıldı (${goal.id}): “${goal.title}”. Planlarını planPropose ile goalId vererek başlat.`;
        return `Hedef güncellendi: “${goal.title}” (${goal.status}).`;
      },
    },
    {
      name: 'goalsRead',
      description: 'Read the company’s goals (coordinator or team lead): each active goal with why, its definition of done and its plans; then the recently closed ones.',
      inputSchema: object({}),
      kinds: LEADS,
      run: () => {
        const goals = company.goals();
        if (goals.length === 0) return 'Henüz hedef yok.';
        const plansOf = (id: string) => plans().filter((p) => p.goalId === id);
        return goals
          .map((g) => {
            const own = plansOf(g.id).map((p) => `   - ${p.title} [${p.status}]`).join('\n');
            return `• ${g.id} “${g.title}” [${g.status}] — neden: ${g.why}\n   bitti: ${g.done.join('; ')}${own ? `\n${own}` : ''}`;
          })
          .join('\n');
      },
    },
```

`plans()` above is a small accessor: add `plans: () => Plan[]` to `officeTools`' options (`plans: () => c.plans.list()` in tests and `() => plans.list()` in `main.ts`; import `type Plan`). In `planPropose` add `goalId: s('The active goal this plan serves (from goalSet / goalsRead).')` to the schema and `goalId: optStr(args, 'goalId') ?? null` to the draft.

Update both `officeTools({...})` call sites in tests (`mcp-tools.test.ts`, `company.smoke.real.test.ts`, `craft.smoke.real.test.ts`) and `main.ts` to pass `plans`.

- [ ] **Step 6: Wire `main.ts`**

In `apps/office-server/src/main.ts`: `const goals = new GoalStore(db); const state = new CompanyStateStore(db);`, pass `goals, state` to `new Company({...})`, and `plans: () => plans.list()` to `officeTools`.

- [ ] **Step 7: Run the whole server suite and the type check**

Run: `cd apps/office-server && npx vitest run > /tmp/cc-s2t2.log 2>&1; tail -6 /tmp/cc-s2t2.log; cd ../.. && pnpm -r --if-present typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add apps/office-server/src apps/office-server/test
git commit -m "feat(company): goals above the plans — why each serves the mission, when it is reached, a few at a time"
```

---

### Task 3: Full autonomy — the coordinator starts its own plans

**Files:**
- Modify: `apps/office-server/src/company/company.ts` (`propose`, `revise`, `approve`)
- Create: `apps/office-server/src/company/craft/pm.md`
- Modify: `apps/office-server/src/company/craft.ts` (`pmText`), `apps/office-server/src/company/roles.ts`
- Modify: `apps/office-server/src/mcp/tools.ts` (`planPropose` / `planRevise` replies)
- Modify: `apps/office-server/test/company-helpers.ts` (`PLANS_ONLY`, `companyFor` sets `autonomy: 'plans'`), tests that build `Company` without a budget
- Test: `apps/office-server/test/autonomy.test.ts` (new), `apps/office-server/test/craft.test.ts`

**Interfaces:**
- Consumes: `Constitution.autonomy` (Task 1), goals (Task 2).
- Produces: `Plan.approvedBy` set by `approve` ('owner') and by `propose`/`revise` under `free` ('coordinator'); `pmText(): string` from `craft.ts`; test helper `PLANS_ONLY: () => Constitution`.

- [ ] **Step 1: Write the failing tests**

Create `apps/office-server/test/autonomy.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make(autonomy: 'free' | 'plans') {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f);
  c.budget.setConstitution({ autonomy });
  const coordinator = c.company.hireCoordinator('sonnet');
  return { ...s, ...c, coordinator };
}

const DRAFT = { title: 'Site', goal: 'g', approach: 'a', method: METHOD };

describe('autonomy (spec §6.2)', () => {
  it('free: a proposed plan starts at once, marked as started by the coordinator, with no notice to itself', () => {
    const t = make('free');
    const plan = t.company.propose(t.coordinator.id, DRAFT);
    expect(plan).toMatchObject({ status: 'approved', approvedBy: 'coordinator' });
    expect(plan.approvedAt).not.toBeNull();
    const changes = t.events.list({ limit: 500 }).flatMap((e) => (e.event.type === 'plan.changed' ? [e.event.change] : []));
    expect(changes).toEqual(['proposed', 'approved']);
    expect(t.notices.pending(t.coordinator.id).some((n) => n.topic === 'plan.approved')).toBe(false);
    const task = t.company.createTask(t.coordinator.id, { assignee: t.coordinator.id, title: 'iş', planId: plan.id });
    expect(task.planId).toBe(plan.id);
  });

  it('free: a revision goes on at once (new version, still approved, no snapshot)', () => {
    const t = make('free');
    const plan = t.company.propose(t.coordinator.id, DRAFT);
    const revised = t.company.revise(t.coordinator.id, plan.id, { days: 3 });
    expect(revised).toMatchObject({ status: 'approved', version: 2, days: 3, approvedBy: 'coordinator' });
    expect(t.plans.approvedSnapshot(plan.id)).toBeNull();
  });

  it('plans: as before — a draft waits for the owner, who approves it as the owner', () => {
    const t = make('plans');
    const plan = t.company.propose(t.coordinator.id, DRAFT);
    expect(plan).toMatchObject({ status: 'draft', approvedBy: null });
    expect(t.company.approve(plan.id)).toMatchObject({ status: 'approved', approvedBy: 'owner' });
    expect(t.notices.pending(t.coordinator.id).some((n) => n.topic === 'plan.approved')).toBe(true);
  });

  it('review focus: a draft from before autonomy was set free can still be approved or declined by the owner; revising it under free starts it', () => {
    const t = make('plans');
    const a = t.company.propose(t.coordinator.id, { ...DRAFT, title: 'A' });
    const b = t.company.propose(t.coordinator.id, { ...DRAFT, title: 'B' });
    t.budget.setConstitution({ autonomy: 'free' });
    expect(t.company.approve(a.id)).toMatchObject({ status: 'approved', approvedBy: 'owner' });
    expect(t.company.revise(t.coordinator.id, b.id, { days: 1 })).toMatchObject({ status: 'approved', approvedBy: 'coordinator' });
  });
});
```

Append to `apps/office-server/test/craft.test.ts` (import `pmText`):

```ts
  it('the coordinator’s guide says it is the project manager and how autonomy works; leads and members do not get it', () => {
    expect(pmText()).toContain('goalSet');
    expect(pmText()).toContain('restUntil');
    expect(officeGuide('coordinator')).toContain(pmText());
    expect(officeGuide('lead')).not.toContain(pmText());
    expect(officeGuide('coordinator')).toMatch(/sahibi kartı onaylamadan/i);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/office-server && npx vitest run test/autonomy.test.ts test/craft.test.ts`
Expected: FAIL — the free plan stays `draft`; `pmText` is not exported.

- [ ] **Step 3: Existing tests keep the owner's approval**

In `apps/office-server/test/company-helpers.ts` add:

```ts
/** The owner approves each plan (autonomy 'plans'): for tests about the approval flow, which the default 'free' skips. */
export const PLANS_ONLY = (): import('@cc/shared').Constitution => ({ ...DEFAULT_CONSTITUTION, autonomy: 'plans' });
```

(import `DEFAULT_CONSTITUTION` from `@cc/shared`), and at the end of `companyFor`, before `return`, call `budget.setConstitution({ autonomy: 'plans' });`.

Then every test that builds `Company` without a `constitution` gets `constitution: PLANS_ONLY` (run once from the repo root):

```bash
python3 - <<'EOF'
import re, pathlib
for p in sorted(pathlib.Path('apps/office-server/test').glob('*.ts')):
    s = p.read_text()
    n = re.sub(r"new Company\(\{(?![^)]*constitution)", "new Company({ constitution: PLANS_ONLY,", s)
    if n == s:
        continue
    if 'PLANS_ONLY' not in s:
        m = re.search(r"^import \{([^}]*)\} from '\./company-helpers\.ts';", n, flags=re.M)
        if m:
            n = n.replace(m.group(0), f"import {{{m.group(1).rstrip()}, PLANS_ONLY }} from './company-helpers.ts';")
        else:
            first = re.search(r"^import .*?;\n", n, flags=re.M | re.S)
            n = n[: first.end()] + "import { PLANS_ONLY } from './company-helpers.ts';\n" + n[first.end():]
    p.write_text(n)
    print('updated', p)
EOF
```

- [ ] **Step 4: Company**

In `propose`, replace the body after the goal check with:

```ts
    const free = this.#rules().autonomy === 'free';
    const plan = this.#d.plans.create({ ...fields, method: planMethod(draft.method), goalId, proposedBy: by });
    this.#emit(by, { type: 'plan.changed', change: 'proposed', plan });
    // Full autonomy (spec §6.2): the coordinator's plan starts now; the owner sees it and may stop it.
    if (!free) return plan;
    const started = this.#d.plans.update(plan.id, { status: 'approved', approvedAt: this.#now(), approvedBy: 'coordinator' });
    this.#emit(by, { type: 'plan.changed', change: 'approved', plan: started });
    return started;
```

In `revise`, after the `declined` check add `if (current.status === 'stopped') throw new ConflictError('Bu plan durduruldu; yeni bir plan öner.');`, and replace the snapshot-and-update tail with:

```ts
    const free = this.#rules().autonomy === 'free';
    if (free) {
      // Full autonomy: the revision goes on at once, as the coordinator's.
      const plan = this.#d.plans.update(planId, { ...merged, method, version: current.version + 1, status: 'approved', approvedAt: current.approvedAt ?? this.#now(), approvedBy: 'coordinator' });
      this.#d.plans.clearApproved(planId);
      this.#emit(by, { type: 'plan.changed', change: 'revised', plan });
      return plan;
    }
    // A revision of an approved (or finished) plan is a new proposal: it waits for the owner again (rule B, big change).
    // Rule B: the approved version is kept until the owner decides on the revision (only the first revision saves it).
    if (current.status === 'approved' || current.status === 'done') this.#d.plans.saveApproved(planId);
    const plan = this.#d.plans.update(planId, { ...merged, method, version: current.version + 1, status: 'draft', approvedAt: null });
    this.#emit(by, { type: 'plan.changed', change: 'revised', plan });
    return plan;
```

In `approve`, the update becomes `this.#d.plans.update(planId, { status: 'approved', approvedAt: this.#now(), approvedBy: 'owner' })`.

- [ ] **Step 5: The PM part of the core**

Create `apps/office-server/src/company/craft/pm.md`:

```md
## Proje yöneticisi sensin

Sen bu şirketin proje yöneticisisin: projeyi kendin yürütürsün, sahibi seni beklemez.

- **Hedefler.** Şirket özetindeki misyondan hedefler çıkar (`goalSet`): her birinin bir nedeni (misyona bağı) ve
  ölçülebilir bitti tanımı olsun. Aynı anda az hedef tut; ulaşılanı `status: done`, vazgeçileni `dropped` ile kapat.
  Hedefleri ve planlarını `goalsRead` gösterir.
- **Döngü.** Hedef → plan (`planPropose`, `goalId` ile) → dağıt → incele → kabul et → değerlendir (`planRetro`) →
  sıradaki iş. Gelen her teslimi hedefe göre kontrol et.
- **Serbestlik.** Anayasada serbestlik "tam serbest" ise (varsayılan) planın önerdiğin anda başlar; sahibi kartı görür,
  isterse durdurur. "Planlar sahibine" ise sahibi kartı onaylamadan işe başlama. Hangisi olduğunu `planPropose`'un
  yanıtı söyler. Satın alma, geri alınamaz işler ve bütçe sınırları her durumda sahibindedir.
- **Sahibinin sözü önce gelir.** Sahibinin istediği iş senin hedeflerinden önce gelir; gerekirse bir hedefi beklet.
- **Nabız.** Ofis projeyi izler ve yalnız karar gerektiğinde sana not bırakır: bir hedefin süren planı kalmadığında,
  hiç hedef ve iş yokken. Değerli iş yoksa iş icat etme: `restUntil` ile ne zamana kadar ve neden dinlendiğini yaz.
- **Durdurulan iş.** Sahibi bir planı ya da hedefi durdurursa açık görevler iptal olur; durdurulan plan yeniden
  başlamaz, gerekiyorsa yeni bir plan öner.
```

In `craft.ts` add:

```ts
/** The coordinator's part of the core: the project manager in a living loop (spec §6). */
export function pmText(): string {
  return read('pm.md');
}
```

In `roles.ts`: import `pmText`; in `COORDINATOR` the last sentence of the first bullet becomes:

```ts
  taslağı, tahmini kota payı, para ve süre, riskler. Sahibiyle tartış, \`planRevise\` ile güncelle. Serbestlik
  "planlar sahibine" ise sahibi kartı onaylamadan işe başlama; "tam serbest" ise plan hemen başlar.
```

and `officeGuide` pushes `craft(pmText)` for the coordinator only:

```ts
  if (kind !== 'member') parts.push(craft(coordinationText));
  if (kind === 'coordinator') parts.push(craft(pmText));
```

- [ ] **Step 6: Tool replies**

In `apps/office-server/src/mcp/tools.ts`, `planPropose` returns:

```ts
        if (plan.status === 'approved') return `Plan başladı (${plan.id}): tam serbestsin, sahibini beklemiyorsun. Görevleri taskCreate ile aç ve dağıt; sahibi kartı görüyor ve isterse durdurabilir.`;
        return `Plan kartı açıldı (${plan.id}). Sahibinin onayını bekle; onay gelince sana haber verilecek.`;
```

and `planRevise` returns:

```ts
        return plan.status === 'approved' ? `Plan güncellendi: sürüm ${plan.version}, sürüyor.` : `Plan güncellendi: sürüm ${plan.version}, sahibinin onayını bekliyor.`;
```

- [ ] **Step 7: Run the whole server suite**

Run: `cd apps/office-server && npx vitest run > /tmp/cc-s2t3.log 2>&1; tail -6 /tmp/cc-s2t3.log`
Expected: all pass. A remaining failure in a test that proposes and then approves a plan means that test's `Company` was built by a path the script did not rewrite: give it `constitution: PLANS_ONLY` by hand.

- [ ] **Step 8: Commit**

```bash
git add apps/office-server/src apps/office-server/test
git commit -m "feat(company): full autonomy by default — the coordinator starts its own plans; the owner sees and can stop them"
```

---

### Task 4: The owner stops a plan, a goal, or the whole company

**Files:**
- Modify: `apps/office-server/src/company/company.ts` (`stopPlan`, `stopGoal`, `pause`, `resume`, `paused`; `createTask` refuses a stopped plan)
- Modify: `apps/office-server/src/company/notices.ts` (topics)
- Modify: `apps/office-server/src/company/dispatcher.ts` (paused: deliver nothing)
- Modify: `apps/office-server/src/api.ts` (routes, snapshot)
- Test: `apps/office-server/test/owner-control.test.ts` (new), `apps/office-server/test/dispatcher.test.ts`, `apps/office-server/test/company-api.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `Company.stopPlan(planId: string): Plan`, `Company.stopGoal(goalId: string): Goal`, `Company.pause(): void`, `Company.resume(): void`, `Company.paused(): boolean`; notice topics `plan.stopped`, `goal.stopped`, `task.cancelled` (decision); routes `POST /api/plans/:id/stop`, `POST /api/goals/:id/stop`, `POST /api/company/pause`, `POST /api/company/resume`; snapshot `goals`, `paused`.

- [ ] **Step 1: Write the failing tests**

Create `apps/office-server/test/owner-control.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { companyFor, METHOD } from './company-helpers.ts';
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
  const c = companyFor(s, f);
  c.budget.setConstitution({ autonomy: 'free' });
  const coordinator = c.company.hireCoordinator('sonnet');
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r' });
  const can = c.company.hire(coordinator.id, { name: 'Can', role: 'r' });
  const goal = c.company.goalSet(coordinator.id, { title: 'Lansman', why: 'misyon', done: ['site'] });
  const plan = c.company.propose(coordinator.id, { title: 'Site', goal: 'g', approach: 'a', method: METHOD, goalId: goal.id });
  return { ...s, ...c, coordinator, ada, can, goal, plan };
}

describe('the owner’s controls (spec §6.4)', () => {
  it('stopping a plan cancels its open work — waiting, running, in review and the review itself — and tells who must stop', () => {
    const t = make();
    const waiting = t.company.createTask(t.coordinator.id, { assignee: t.can.id, title: 'bekleyen', planId: t.plan.id });
    const running = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'süren', planId: t.plan.id });
    t.company.start(running.id);
    const reviewed = t.company.createTask(t.coordinator.id, { assignee: t.can.id, title: 'incelenen', planId: t.plan.id, reviewer: t.ada.id });
    t.company.finish(t.can.id, reviewed.id, { summary: 'bitti', outputs: [], learned: '' });
    const review = t.tasks.list({ assignee: t.ada.id }).find((x) => x.kind === 'review')!;
    const stopped = t.company.stopPlan(t.plan.id);
    expect(stopped.status).toBe('stopped');
    for (const id of [waiting.id, running.id, reviewed.id, review.id]) expect(t.tasks.get(id).status).toBe('cancelled');
    expect(t.notices.pending(t.ada.id).some((n) => n.topic === 'task.cancelled' && n.text.includes('süren'))).toBe(true);
    expect(t.notices.pending(t.coordinator.id).find((n) => n.topic === 'plan.stopped')?.kind).toBe('decision');
    expect(() => t.company.reviewDecide(t.ada.id, review.id, { decision: 'approve' })).toThrow(/karara bağlandı|incelemede değil/);
    expect(() => t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'yeni', planId: t.plan.id })).toThrow(/durduruldu/);
    expect(() => t.company.revise(t.coordinator.id, t.plan.id, { days: 1 })).toThrow(/durduruldu/);
    expect(() => t.company.stopPlan(t.plan.id)).toThrow(/zaten/);
  });

  it('stopping a goal drops it and stops its running plans, with one notice to the coordinator', () => {
    const t = make();
    const goal = t.company.stopGoal(t.goal.id);
    expect(goal).toMatchObject({ status: 'dropped', note: 'Sahibi durdurdu' });
    expect(t.plans.get(t.plan.id).status).toBe('stopped');
    const notices = t.notices.pending(t.coordinator.id).filter((n) => n.topic === 'goal.stopped' || n.topic === 'plan.stopped');
    expect(notices.map((n) => n.topic)).toEqual(['goal.stopped']);
  });

  it('pausing: the company says it is paused, the screen hears, and resuming clears it', () => {
    const t = make();
    t.company.pause();
    expect(t.company.paused()).toBe(true);
    t.company.resume();
    expect(t.company.paused()).toBe(false);
    const seen = t.events.list({ limit: 500 }).flatMap((e) => (e.event.type === 'company.paused' ? [e.event.paused] : []));
    expect(seen).toEqual([true, false]);
    expect(OWNER).toBe('owner');
  });
});
```

In `apps/office-server/test/dispatcher.test.ts` append (the file's `make()` builds `Company` without the stage-2 stores; this block builds its own with `companyFor`):

```ts
describe('Dispatcher — a paused company', () => {
  it('hands out nothing while paused — no task, no notice, no wake — and delivers what waited, once, on resume', async () => {
    const s = setup();
    const f = fakeEngine(s);
    const c = companyFor(s, f);
    const dispatcher = new Dispatcher({ events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine: f.engine, budget: c.budget });
    const stop = dispatcher.start();
    cleanups.push(stop, f.cleanup, s.cleanup);
    const ada = c.company.hire(OWNER, { name: 'Ada', role: 'r' });
    await until(() => f.engine.ready(ada.id), 8000);
    c.company.pause();
    const task = c.company.createTask(OWNER, { assignee: ada.id, title: 'Duraklatılmışken' });
    await sleep(600);
    expect(c.tasks.get(task.id).status).toBe('waiting');
    expect(systemMessages(s.events.list({ limit: 5000 }), ada.id)).toHaveLength(0);
    c.company.resume();
    await waitFor(s.events, (e) => e.employeeId === ada.id && e.event.type === 'message.user' && e.event.text.includes('Duraklatılmışken'));
    await sleep(300);
    expect(systemMessages(s.events.list({ limit: 5000 }), ada.id).filter((m) => m.includes('Duraklatılmışken'))).toHaveLength(1);
  });
});
```

(add `companyFor` to the file's imports from `./company-helpers.ts`).

In `apps/office-server/test/company-api.test.ts` append:

```ts
  it('lets the owner stop a plan and a goal and pause the company, and shows goals and the pause in the snapshot', async () => {
    const t = await start();
    t.budget.setConstitution({ autonomy: 'free' });
    const c = t.company.hireCoordinator();
    const goal = t.company.goalSet(c.id, { title: 'Lansman', why: 'misyon', done: ['site'] });
    const plan = t.company.propose(c.id, { method: METHOD, title: 'Site', goal: 'g', approach: 'a', goalId: goal.id });
    expect((await call(t.port, 'POST', `/api/plans/${plan.id}/stop`)).body).toMatchObject({ id: plan.id, status: 'stopped' });
    expect((await call(t.port, 'POST', `/api/plans/${plan.id}/stop`)).status).toBe(409);
    expect((await call(t.port, 'POST', `/api/goals/${goal.id}/stop`)).body).toMatchObject({ status: 'dropped' });
    expect((await call(t.port, 'POST', '/api/company/pause')).status).toBe(200);
    let office = await call(t.port, 'GET', '/api/office');
    expect(office.body).toMatchObject({ paused: true });
    expect(office.body.goals.map((g: { title: string }) => g.title)).toEqual(['Lansman']);
    expect((await call(t.port, 'POST', '/api/company/resume')).status).toBe(200);
    office = await call(t.port, 'GET', '/api/office');
    expect(office.body.paused).toBe(false);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/office-server && npx vitest run test/owner-control.test.ts`
Expected: FAIL — `stopPlan is not a function`.

- [ ] **Step 3: Notice topics**

Add to `NOTICE_TOPICS`:

```ts
  /** The owner stopped a plan: its open work was cancelled. */
  'plan.stopped': 'decision',
  /** The owner stopped a goal (and its running plans). */
  'goal.stopped': 'decision',
  /** A task you hold was cancelled (its plan was stopped): stop working on it. */
  'task.cancelled': 'decision',
```

- [ ] **Step 4: Company**

Add (after `retro`):

```ts
  /** The owner stops a running plan (spec §6.4): its open work is cancelled; it never starts again. */
  stopPlan(planId: string, o: { quiet?: boolean } = {}): Plan {
    const plan = this.#d.plans.get(planId);
    if (plan.status === 'stopped') throw new ConflictError('Bu plan zaten durduruldu.');
    if (plan.status !== 'approved' && plan.status !== 'draft') throw new ConflictError('Yalnız süren ya da onay bekleyen bir plan durdurulabilir.');
    const at = this.#now();
    for (const task of this.#d.tasks.list({ planId, statuses: ['waiting', 'in_progress', 'review', 'blocked'] })) {
      const holder = this.#person(task.assignee);
      if (holder && holder.lifecycle !== 'archived' && (task.status === 'in_progress' || task.status === 'blocked')) {
        this.#d.notices.add(holder.id, 'task.cancelled', `“${task.title}” görevi (no ${task.id}) iptal edildi: sahibi “${plan.title}” planını durdurdu. Üzerinde çalışmayı bırak.`);
      }
      this.#taskEvent('updated', this.#d.tasks.update(task.id, { status: 'cancelled', finishedAt: at }));
    }
    this.#d.plans.clearApproved(planId);
    const stopped = this.#d.plans.update(planId, { status: 'stopped' });
    const desk = this.#planDesk(stopped);
    if (!o.quiet) {
      this.#d.notices.add(desk, 'plan.stopped', `Sahibi “${plan.title}” planını durdurdu; açık görevleri iptal edildi. Durdurulan plan yeniden başlamaz; gerekiyorsa yeni bir plan öner.`);
    }
    this.#emit(desk, { type: 'plan.changed', change: 'stopped', plan: stopped });
    return stopped;
  }

  /** The owner stops a goal: it is dropped and its running plans stop (one notice for all). */
  stopGoal(goalId: string): Goal {
    const store = this.#goals();
    const current = store.get(goalId);
    if (current.status !== 'active') throw new ConflictError('Bu hedef zaten kapalı.');
    const running = this.#d.plans.list(1000).filter((p) => p.goalId === goalId && (p.status === 'approved' || p.status === 'draft'));
    for (const p of running) this.stopPlan(p.id, { quiet: true });
    const goal = store.update(goalId, { status: 'dropped', closedAt: this.#now(), note: 'Sahibi durdurdu' });
    const c = this.coordinator();
    const plansLine = running.length ? ` Süren planları da durdu: ${running.map((p) => `“${p.title}”`).join(', ')}.` : '';
    if (c) this.#d.notices.add(c.id, 'goal.stopped', `Sahibi “${goal.title}” hedefini durdurdu.${plansLine} Bu hedef için iş açma; gerekiyorsa sahibine sor.`);
    this.#emit(c?.id ?? goal.createdBy, { type: 'goal.changed', change: 'stopped', goal });
    return goal;
  }

  /** The owner pauses the whole company (spec §6.4): nothing is handed out until resume. */
  pause(): void {
    this.#state().setPaused(true);
    this.#emit(this.coordinator()?.id ?? null, { type: 'company.paused', paused: true });
  }

  resume(): void {
    this.#state().setPaused(false);
    this.#emit(this.coordinator()?.id ?? null, { type: 'company.paused', paused: false });
  }

  paused(): boolean {
    return this.#d.state?.paused() ?? false;
  }

  #state(): CompanyStateStore {
    if (!this.#d.state) throw new ConflictError('Bu ofiste şirket durumu açık değil.');
    return this.#d.state;
  }
```

`EventStore.append` takes `string | null`: `pause`/`resume` file the event under the coordinator, or `null` without one — write `this.#emit(this.coordinator()?.id ?? null, …)` and widen `#emit`'s parameter to `string | null`.

In `createTask`'s plan checks add:

```ts
      if (plan.status === 'stopped') throw new ConflictError(`“${plan.title}” planı durduruldu; gerekiyorsa yeni bir plan öner.`);
```

- [ ] **Step 5: Dispatcher**

At the top of `#consider`, after `if (!employee) return;`:

```ts
    // The owner paused the company: nothing is handed out, no one is woken (spec §6.4); the owner's messages go straight to the engine.
    if (this.#d.company.paused()) return;
```

In `start()`'s event subscription, add `'company.paused'` to the event types that schedule a sweep.

- [ ] **Step 6: API**

In `apps/office-server/src/api.ts`: `PLAN_ROUTE` accepts `stop`: `\/(approve|decline|stop)$`, and the handler becomes:

```ts
    if (method === 'POST' && plan) {
      const id = plan[1] ?? '';
      return sendJson(res, 200, plan[2] === 'approve' ? company.approve(id) : plan[2] === 'decline' ? company.decline(id) : company.stopPlan(id));
    }
```

Add `const GOAL_ROUTE = /^\/api\/goals\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/stop$/;` and, in the company block:

```ts
    const goalStop = GOAL_ROUTE.exec(url.pathname);
    if (method === 'POST' && goalStop) return sendJson(res, 200, company.stopGoal(goalStop[1] ?? ''));
    if (method === 'POST' && url.pathname === '/api/company/pause') {
      company.pause();
      return sendJson(res, 200, { paused: true });
    }
    if (method === 'POST' && url.pathname === '/api/company/resume') {
      company.resume();
      return sendJson(res, 200, { paused: false });
    }
```

`snapshot` adds `goals: d.company.service.goals(), paused: d.company.service.paused()` to the company part.

- [ ] **Step 7: Run the whole server suite**

Run: `cd apps/office-server && npx vitest run > /tmp/cc-s2t4.log 2>&1; tail -6 /tmp/cc-s2t4.log; cd ../.. && pnpm -r --if-present typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add apps/office-server/src apps/office-server/test
git commit -m "feat(company): the owner can stop a plan, drop a goal or pause the whole company"
```

---

### Task 5: The pulse, and resting

**Files:**
- Create: `apps/office-server/src/company/pulse.ts`
- Modify: `apps/office-server/src/company/notices.ts` (topics), `apps/office-server/src/company/dispatcher.ts` (run the pulse on the tick), `apps/office-server/src/company/company.ts` (`restUntil`), `apps/office-server/src/mcp/tools.ts` (`restUntil`), `apps/office-server/src/main.ts`
- Test: `apps/office-server/test/pulse.test.ts` (new), `apps/office-server/test/mcp-tools.test.ts`, `apps/office-server/test/economy.scenario.test.ts` (its day has no goals: `pulseHours: 0`)

**Interfaces:**
- Consumes: Tasks 1–4; `Budget.reserveActive()`, `Budget.constitution()`.
- Produces: `class Pulse { constructor(d: PulseDeps); check(): string[] }` (returns the topics it left, for tests); `PulseDeps = { company: Company; goals: GoalStore; state: CompanyStateStore; plans: PlanStore; tasks: TaskStore; notices: NoticeStore; budget?: { reserveActive(): boolean; constitution(): Constitution }; now?: () => number }`; `DispatcherDeps.pulse?: { check(): unknown }`; `Company.restUntil(by, hours: number, reason: string): number`; notice topics `pulse.goal_idle`, `pulse.no_goal` (decision).

- [ ] **Step 1: Write the failing tests**

Create `apps/office-server/test/pulse.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { Pulse } from '../src/company/pulse.ts';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const HOUR = 60 * 60_000;

function make() {
  let clock = new Date(2026, 9, 7, 10, 0).getTime();
  const now = () => clock;
  const s = setup(8, now);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, undefined, now);
  c.budget.setConstitution({ autonomy: 'free' });
  const pulse = () => new Pulse({ company: c.company, goals: c.goals, state: c.state, plans: c.plans, tasks: c.tasks, notices: c.notices, budget: c.budget, now });
  return { ...s, ...c, pulse, advance: (ms: number) => (clock += ms) };
}

describe('the pulse (spec §6.3)', () => {
  it('says nothing without a coordinator, while paused, or during the owner’s reserve', () => {
    const t = make();
    expect(t.pulse().check()).toEqual([]);
    t.company.hireCoordinator('sonnet');
    t.company.pause();
    expect(t.pulse().check()).toEqual([]);
    t.company.resume();
    t.setQuota({ status: 'allowed', fiveHour: { utilization: 0.99, resetsAt: Date.now() + HOUR }, sevenDay: null, updatedAt: Date.now() });
    t.budget.checkReserve();
    expect(t.pulse().check()).toEqual([]);
  });

  it('no goal, no plan, no work: tells the coordinator once per pulseHours, and not while it rests', () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    expect(t.pulse().check()).toEqual(['pulse.no_goal']);
    const notice = t.notices.pending(c.id).find((n) => n.topic === 'pulse.no_goal')!;
    expect(notice.kind).toBe('decision');
    expect(notice.text).toContain('restUntil');
    expect(t.pulse().check()).toEqual([]);
    t.advance(6 * HOUR);
    expect(t.pulse().check()).toEqual(['pulse.no_goal']);
    t.company.restUntil(c.id, 24, 'Bu hafta sahibinin işi bekleniyor');
    t.advance(6 * HOUR);
    expect(t.pulse().check()).toEqual([]);
    t.advance(19 * HOUR);
    expect(t.pulse().check()).toEqual(['pulse.no_goal']);
    t.budget.setConstitution({ pulseHours: 0 });
    t.advance(48 * HOUR);
    expect(t.pulse().check()).toEqual([]);
  });

  it('an active goal without a running plan: once per episode — a plan that ends re-arms it; it survives a restart', () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    const goal = t.company.goalSet(c.id, { title: 'Lansman', why: 'misyon', done: ['site'] });
    expect(t.pulse().check()).toEqual(['pulse.goal_idle']);
    expect(t.notices.pending(c.id).find((n) => n.topic === 'pulse.goal_idle')?.text).toContain('Lansman');
    // A new Pulse is a restarted office: the marker is in the database.
    expect(t.pulse().check()).toEqual([]);
    const plan = t.company.propose(c.id, { title: 'Site', goal: 'g', approach: 'a', method: METHOD, goalId: goal.id });
    expect(t.pulse().check()).toEqual([]);
    const task = t.company.createTask(c.id, { assignee: c.id, title: 'iş', planId: plan.id });
    t.company.finish(c.id, task.id, { summary: 'bitti', outputs: [], learned: '' });
    expect(t.plans.get(plan.id).status).toBe('done');
    expect(t.pulse().check()).toEqual(['pulse.goal_idle']);
    t.company.goalSet(c.id, { goalId: goal.id, status: 'done' });
    expect(t.pulse().check()).toEqual(['pulse.no_goal']);
  });

  it('open work without goals is not idle: no notice while a task is open', () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    t.company.createTask(c.id, { assignee: c.id, title: 'sahibinin işi' });
    expect(t.pulse().check()).toEqual([]);
  });

  it('a new goal ends the rest', () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    t.company.restUntil(c.id, 48, 'dinleniyorum');
    expect(t.state.restUntil()).toBeGreaterThan(0);
    t.company.goalSet(c.id, { title: 'Yeni', why: 'misyon', done: ['x'] });
    expect(t.state.restUntil()).toBe(0);
    expect(() => t.company.restUntil(c.id, 0, 'x')).toThrow(/1 ile 168/);
    expect(() => t.company.restUntil(c.id, 5, ' ')).toThrow(/boş olamaz/);
  });
});
```

(`setQuota` comes from `companyFor`; `QuotaWindow`'s fields are in `packages/shared/src/events.ts` — match them; the default `ownerReservePct` 25 makes 99 % usage the reserve.)

In `apps/office-server/test/dispatcher.test.ts`, in the paused block, add a second test:

```ts
  it('runs the pulse on its tick: a goal with no plan reaches the coordinator as a decision', async () => {
    const s = setup();
    const f = fakeEngine(s);
    const c = companyFor(s, f);
    const coordinator = c.company.hireCoordinator('sonnet');
    c.company.goalSet(coordinator.id, { title: 'Lansman', why: 'misyon', done: ['site'] });
    const pulse = new Pulse({ company: c.company, goals: c.goals, state: c.state, plans: c.plans, tasks: c.tasks, notices: c.notices, budget: c.budget });
    const dispatcher = new Dispatcher({ events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine: f.engine, budget: c.budget, pulse, tickMs: 200 });
    const stop = dispatcher.start();
    cleanups.push(stop, f.cleanup, s.cleanup);
    const msg = await waitFor(s.events, (e) => e.employeeId === coordinator.id && e.event.type === 'message.user' && e.event.text.includes('Lansman'));
    expect((msg.event as { text: string }).text).toContain('goalSet');
  });
```

(import `Pulse` from `../src/company/pulse.ts`).

In `apps/office-server/test/mcp-tools.test.ts`: add `'restUntil'` to the coordinator-only list and append:

```ts
  it('lets the coordinator rest when there is nothing worth doing', async () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    expect(await t.call(c, 'restUntil', { hours: 12, reason: 'Sahibinin cevabı bekleniyor' })).toMatch(/Dinleniyorsun/);
    expect(t.state.restUntil()).toBeGreaterThan(Date.now());
  });
```

In `apps/office-server/test/economy.scenario.test.ts`, where the scenario sets its constitution, add `pulseHours: 0` (its simulated day has no goals; the economy day is measured without the PM loop).

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/office-server && npx vitest run test/pulse.test.ts`
Expected: FAIL — `Cannot find module '../src/company/pulse.ts'`.

- [ ] **Step 3: Notice topics and `restUntil`**

Add to `NOTICE_TOPICS`:

```ts
  /** The pulse: an active goal has no running plan — start the next one or close the goal. */
  'pulse.goal_idle': 'decision',
  /** The pulse: no goal and no work — set a goal from the mission or rest. */
  'pulse.no_goal': 'decision',
```

In `Company` add:

```ts
  /** Nothing worth doing now (spec §6.3): the "no goal" pulse waits until then. Returns the time it ends. */
  restUntil(by: string, hours: number, reason: string): number {
    this.#assertCoordinator(by);
    if (!Number.isFinite(hours) || hours < 1 || hours > 168) throw new ValidationError('Dinlenme süresi 1 ile 168 saat arasında olmalı.');
    const why = clean(reason, 'Gerekçe', 1000, true);
    const until = this.#now() + Math.round(hours * 60 * 60_000);
    this.#state().setRest(until, why);
    return until;
  }
```

- [ ] **Step 4: The pulse**

Create `apps/office-server/src/company/pulse.ts`:

```ts
import { DEFAULT_CONSTITUTION, type Constitution } from '@cc/shared';
import type { Company } from './company.ts';
import type { CompanyStateStore, GoalStore } from './goal-store.ts';
import type { NoticeTopic } from './notices.ts';
import type { NoticeStore, PlanStore, TaskStore } from './store.ts';

const HOUR = 60 * 60_000;
const RUNNING = new Set(['draft', 'approved']);

export interface PulseDeps {
  company: Company;
  goals: GoalStore;
  state: CompanyStateStore;
  plans: PlanStore;
  tasks: TaskStore;
  notices: NoticeStore;
  budget?: { reserveActive(): boolean; constitution(): Constitution };
  now?: () => number;
}

/**
 * The office watches the project so the coordinator does not have to (spec §6.3): code, no model. It leaves the
 * coordinator a decision notice only when one is due — a goal with no running plan, or neither goals nor work — and
 * never twice for the same state (markers in the database survive a restart). The dispatcher delivers the notices by
 * its own rules: never interrupting, waking a sleeping coordinator.
 */
export class Pulse {
  readonly #d: PulseDeps;
  readonly #now: () => number;

  constructor(d: PulseDeps) {
    this.#d = d;
    this.#now = d.now ?? Date.now;
  }

  /** One look at the project; returns the topics of the notices it left. */
  check(): string[] {
    const coordinator = this.#d.company.coordinator();
    if (!coordinator || this.#d.state.paused() || this.#d.budget?.reserveActive()) return [];
    const left: string[] = [];
    const add = (topic: NoticeTopic, text: string) => {
      this.#d.notices.add(coordinator.id, topic, text);
      left.push(topic);
    };
    const plans = this.#d.plans.list(1000);
    const active = this.#d.goals.list({ statuses: ['active'] });
    for (const goal of active) {
      const own = plans.filter((p) => p.goalId === goal.id);
      if (own.some((p) => RUNNING.has(p.status))) continue;
      // plans.list is newest first: the marker is the latest plan's id (or none) — a plan that later ends re-arms it.
      const marker = own[0]?.id ?? 'none';
      const key = `pulse.goal.${goal.id}`;
      if (this.#d.state.get(key) === marker) continue;
      this.#d.state.set(key, marker);
      add('pulse.goal_idle', `“${goal.title}” hedefinin süren planı yok. Sıradaki planı planPropose ile goalId vererek başlat ya da hedefe ulaşıldıysa / vazgeçtiysen goalSet ile kapat (status: done ya da dropped).`);
    }
    if (active.length > 0 || plans.some((p) => RUNNING.has(p.status))) return left;
    if (this.#d.tasks.list({ statuses: ['waiting', 'in_progress', 'review', 'blocked'], limit: 1 }).length > 0) return left;
    const hours = (this.#d.budget?.constitution() ?? DEFAULT_CONSTITUTION).pulseHours;
    if (hours <= 0) return left;
    const now = this.#now();
    if (now < this.#d.state.restUntil()) return left;
    const last = Number(this.#d.state.get('pulse.noGoalAt') ?? '0') || 0;
    if (last > 0 && now - last < hours * HOUR) return left;
    this.#d.state.set('pulse.noGoalAt', String(now));
    add(
      'pulse.no_goal',
      'Aktif hedef yok ve açık iş yok. Şirket özetindeki misyona göre yeni bir hedef koy (goalSet: neden ve ölçülebilir bitti tanımıyla) ve ilk planını başlat; şimdilik değerli iş yoksa iş icat etme — restUntil ile ne zamana kadar ve neden dinlendiğini yaz.',
    );
    return left;
  }
}
```

- [ ] **Step 5: Dispatcher and tools**

`DispatcherDeps` gets `/** The project's pulse (spec §6.3), run on each tick. */ pulse?: { check(): unknown };`; in `start()`'s timer, before `this.#scheduleSweep();`:

```ts
      try {
        this.#d.pulse?.check();
      } catch {
        // A pulse that fails never stops the office; the next tick looks again.
      }
```

and run it once right after the timer is created (before the first `#scheduleSweep()`), in the same try/catch.

Add the tool after `goalsRead`:

```ts
    {
      name: 'restUntil',
      description: 'Say there is nothing worth doing now (coordinator): for how many hours (1–168) and why. The office stops reminding you about having no goal until then; a new goal ends the rest. Never invent work to stay busy.',
      inputSchema: object({ hours: number('Hours to rest (1–168).'), reason: s('Why there is nothing worth doing now.') }, ['hours', 'reason']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const until = company.restUntil(employee.id, num(args, 'hours') ?? 0, str(args, 'reason'));
        return `Dinleniyorsun: ${new Date(until).toLocaleString('tr-TR')} tarihine kadar hedef hatırlatması gelmeyecek. Sahibinin isteği ya da yeni bir hedef bunu bitirir.`;
      },
    },
```

`main.ts`: `const pulse = new Pulse({ company, goals, state, plans, tasks, notices, budget });` and pass `pulse` to `new Dispatcher({...})`.

- [ ] **Step 6: Run the whole server suite**

Run: `cd apps/office-server && npx vitest run > /tmp/cc-s2t5.log 2>&1; tail -6 /tmp/cc-s2t5.log; cd ../.. && pnpm -r --if-present typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add apps/office-server/src apps/office-server/test
git commit -m "feat(company): the pulse — the office watches the project and wakes the coordinator only when a decision is due"
```

---

### Task 6: The web — goals, starting and stopping, pausing, the new constitution fields

**Files:**
- Modify: `apps/office-web/src/store/reducers.ts`, `apps/office-web/src/store/office.ts` (state `goals`, `paused`)
- Modify: `apps/office-web/src/net/api.ts` (`stopPlan`, `stopGoal`, `pauseCompany`, `resumeCompany`)
- Create: `apps/office-web/src/ui/GoalsTab.tsx`
- Modify: `apps/office-web/src/ui/CompanyView.tsx` (Hedefler tab), `apps/office-web/src/ui/PlanCard.tsx`, `apps/office-web/src/ui/TopBar.tsx`, `apps/office-web/src/ui/BudgetTabs.tsx`, `apps/office-web/src/ui/EventItem.tsx`, `apps/office-web/src/ui/labels.ts`, `apps/office-web/src/styles.css`
- Test: `reducers.test.ts`, `GoalsTab.test.tsx` (new), `PlanCard.test.tsx`, `TopBar.test.tsx`, `BudgetTabs.test.tsx`, `EventItem.test.tsx`

**Interfaces:**
- Consumes: `Goal`, `GoalChange`, `company.paused`, snapshot `goals` / `paused`, `Plan.approvedBy`, `PlanStatus 'stopped'`, the routes of Task 4.
- Produces: `OfficeData.goals: Record<string, Goal>`, `OfficeData.paused: boolean`; `api.stopPlan(id)`, `api.stopGoal(id)`, `api.pauseCompany()`, `api.resumeCompany()`; `GoalsTab` component; `GOAL_STATUS_LABELS`.

- [ ] **Step 1: Write the failing tests**

Before writing, read each test file's fixtures (`plan()`, `stored()`, store seeding, how `api` is mocked) and use them. The tests to add:

`reducers.test.ts`:

```ts
  it('keeps goals and the pause from the snapshot and from events', () => {
    const goal = { id: 'g1', title: 'Lansman', why: 'w', done: ['d'], status: 'active' as const, createdBy: 'c', createdAt: 1, closedAt: null, note: null };
    let d = applySnapshot(EMPTY_DATA, { employees: [], quota: null, usage: {}, lastSeq: 1, goals: [goal], paused: true }, 'live');
    expect(d.goals.g1?.title).toBe('Lansman');
    expect(d.paused).toBe(true);
    d = applyEvent(d, stored({ type: 'goal.changed', change: 'stopped', goal: { ...goal, status: 'dropped' } }, 'c', 10));
    expect(d.goals.g1?.status).toBe('dropped');
    d = applyEvent(d, stored({ type: 'company.paused', paused: false }, 'c', 11));
    expect(d.paused).toBe(false);
  });
```

(`applySnapshot`'s real name and signature are in `reducers.ts`; use them.)

`GoalsTab.test.tsx` (new; mock `../net/api.ts` like `PlanCard.test.tsx` does, with `stopGoal`):

```tsx
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Goal, Plan } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { GoalsTab } from './GoalsTab.tsx';

vi.mock('../net/api.ts', () => ({ api: { stopGoal: vi.fn(async () => ({})) } }));
const { api } = await import('../net/api.ts');

const goal = (over: Partial<Goal> = {}): Goal => ({ id: 'g1', title: 'İlk müşteriler', why: 'Misyon', done: ['10 görüşme'], status: 'active', createdBy: 'c', createdAt: 1, closedAt: null, note: null, ...over });
const plan = (over: Partial<Plan> = {}): Plan => ({
  id: 'p1', title: 'Görüşmeler', goal: 'g', approach: 'a', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '', status: 'approved', version: 1,
  proposedBy: 'c', createdAt: 1, updatedAt: 1, approvedAt: 1, goalId: 'g1', approvedBy: 'coordinator', ...over,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('GoalsTab', () => {
  it('shows each goal with why, its definition of done and its plans; the owner can stop an active one', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    useOffice.setState({ goals: { g1: goal(), g2: goal({ id: 'g2', title: 'Eski', status: 'done' }) }, plans: { p1: plan() } });
    render(<GoalsTab />);
    const card = screen.getByRole('region', { name: 'İlk müşteriler' });
    expect(card.textContent).toContain('Misyon');
    expect(card.textContent).toContain('10 görüşme');
    expect(card.textContent).toContain('Görüşmeler');
    expect(within(screen.getByRole('region', { name: 'Eski' })).queryByRole('button', { name: 'Durdur' })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Durdur' }));
    await waitFor(() => expect(api.stopGoal).toHaveBeenCalledWith('g1'));
  });

  it('says when there is no goal yet', () => {
    useOffice.setState({ goals: {}, plans: {} });
    render(<GoalsTab />);
    expect(screen.getByText(/Henüz hedef yok/)).toBeTruthy();
  });
});
```

`PlanCard.test.tsx` (add `stopPlan: vi.fn(async () => ({}))` to its api mock):

```tsx
  it('marks a plan the coordinator started and lets the owner stop a running plan', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    useOffice.setState({ plans: { p1: plan({ status: 'approved', approvedBy: 'coordinator' }) } });
    render(<PlanCard plan={plan({ status: 'approved', approvedBy: 'coordinator' })} />);
    expect(screen.getByText('Koordinatör başlattı')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Durdur' }));
    await waitFor(() => expect(api.stopPlan).toHaveBeenCalledWith('p1'));
  });
```

`TopBar.test.tsx` (mock `pauseCompany` / `resumeCompany`; seed `budget` so the company layer counts as present, as its other tests do):

```tsx
  it('pauses and resumes the company, and says when it is paused', async () => {
    useOffice.setState({ paused: false });
    const { rerender } = render(<TopBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Şirketi duraklat' }));
    await waitFor(() => expect(api.pauseCompany).toHaveBeenCalled());
    useOffice.setState({ paused: true });
    rerender(<TopBar />);
    expect(screen.getByText('Şirket duraklatıldı')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sürdür' }));
    await waitFor(() => expect(api.resumeCompany).toHaveBeenCalled());
  });
```

`BudgetTabs.test.tsx`:

```tsx
  it('edits autonomy, the active-goal limit and the pulse interval', async () => {
    // seed budget with DEFAULT_CONSTITUTION as the file's other constitution tests do, then:
    render(<ConstitutionTab />);
    const free = screen.getByLabelText('Tam serbest') as HTMLInputElement;
    expect(free.checked).toBe(true);
    fireEvent.click(free);
    fireEvent.change(screen.getByLabelText('En fazla aktif hedef'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Nabız aralığı (saat)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(api.setConstitution).toHaveBeenCalledWith(expect.objectContaining({ autonomy: 'plans', activeGoals: 4, pulseHours: 0 })));
  });
```

(`Kaydet` and `api.setConstitution` are whatever the form's save button and API call are named — read the file.)

`EventItem.test.tsx`:

```tsx
  it('notes goals and the pause in the feed', () => {
    const goal = { id: 'g1', title: 'Lansman', why: 'w', done: ['d'], status: 'active' as const, createdBy: 'c', createdAt: 1, closedAt: null, note: null };
    const { rerender } = render(<EventItem stored={{ seq: 1, employeeId: 'c', ts: 0, event: { type: 'goal.changed', change: 'set', goal } }} />);
    expect(screen.getByText('Hedef: Lansman')).toBeTruthy();
    rerender(<EventItem stored={{ seq: 2, employeeId: 'c', ts: 0, event: { type: 'goal.changed', change: 'stopped', goal: { ...goal, status: 'dropped' } } }} />);
    expect(screen.getByText('Hedef durduruldu: Lansman')).toBeTruthy();
    rerender(<EventItem stored={{ seq: 3, employeeId: 'c', ts: 0, event: { type: 'company.paused', paused: true } }} />);
    expect(screen.getByText('Şirket duraklatıldı')).toBeTruthy();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/office-web && npx vitest run`
Expected: FAIL in the new tests (missing `GoalsTab`, no Durdur, no pause button, no new fields, no feed lines).

- [ ] **Step 3: Store and API client**

`OfficeData` gets `goals: Record<string, Goal>` and `paused: boolean` (in `EMPTY_DATA`: `goals: {}, paused: false`); the snapshot reducer sets `goals: Object.fromEntries((s.goals ?? []).map((g) => [g.id, g]))` and `paused: s.paused ?? false`; `applyEvent` adds:

```ts
  if (ev.type === 'goal.changed') next.goals = { ...d.goals, [ev.goal.id]: ev.goal };
  if (ev.type === 'company.paused') next.paused = ev.paused;
```

`net/api.ts` adds (using the file's `request` helper):

```ts
  stopPlan: (id: string) => request<Plan>('POST', `/api/plans/${encodeURIComponent(id)}/stop`),
  stopGoal: (id: string) => request<Goal>('POST', `/api/goals/${encodeURIComponent(id)}/stop`),
  pauseCompany: () => request<{ paused: boolean }>('POST', '/api/company/pause'),
  resumeCompany: () => request<{ paused: boolean }>('POST', '/api/company/resume'),
```

- [ ] **Step 4: Labels**

`labels.ts` adds `export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = { active: 'Aktif', done: 'Ulaşıldı', dropped: 'Bırakıldı' };` (and `stopped: 'Durduruldu'` is already in `PLAN_STATUS_LABELS` from Task 1).

- [ ] **Step 5: The Hedefler tab**

Create `apps/office-web/src/ui/GoalsTab.tsx`:

```tsx
import { useState } from 'react';
import type { Goal } from '@cc/shared';
import { api } from '../net/api.ts';
import { useOffice } from '../store/office.ts';
import { GOAL_STATUS_LABELS, PLAN_STATUS_LABELS } from './labels.ts';

function GoalCard({ goal }: { goal: Goal }) {
  const plans = useOffice((s) => Object.values(s.plans).filter((p) => p.goalId === goal.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = async () => {
    if (!window.confirm(`“${goal.title}” hedefi durdurulsun mu? Süren planları da durur ve açık görevleri iptal edilir.`)) return;
    setError(null);
    setBusy(true);
    try {
      await api.stopGoal(goal.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`goal-card ${goal.status}`} aria-label={goal.title}>
      <header className="row">
        <strong>{goal.title}</strong>
        <span className={`badge goal-${goal.status}`}>{GOAL_STATUS_LABELS[goal.status]}</span>
      </header>
      <p className="muted">{goal.why}</p>
      <ul>
        {goal.done.map((d, i) => (
          <li key={i}>{d}</li>
        ))}
      </ul>
      {plans.length > 0 && (
        <ul className="goal-plans">
          {plans.map((p) => (
            <li key={p.id}>
              {p.title} <span className={`badge plan-${p.status}`}>{PLAN_STATUS_LABELS[p.status]}</span>
            </li>
          ))}
        </ul>
      )}
      {goal.note && <p className="muted">{goal.note}</p>}
      {goal.status === 'active' && (
        <div className="row end">
          <button type="button" disabled={busy} onClick={() => void stop()}>
            Durdur
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** The coordinator's goals (spec §6.4): active first, then the closed ones. */
export function GoalsTab() {
  const goals = useOffice((s) => Object.values(s.goals));
  if (goals.length === 0) return <p className="muted">Henüz hedef yok. Koordinatör şirketin misyonundan hedef koyunca burada görünür.</p>;
  const order = (g: Goal) => (g.status === 'active' ? 0 : 1);
  const sorted = [...goals].sort((a, b) => order(a) - order(b) || a.createdAt - b.createdAt);
  return (
    <div className="goals">
      {sorted.map((g) => (
        <GoalCard key={g.id} goal={g} />
      ))}
    </div>
  );
}
```

In `CompanyView.tsx` add `['goals', 'Hedefler']` to `TABS` right after the org tab, import `GoalsTab`, and render `tab === 'goals' ? <GoalsTab /> : …` in the tab switch.

- [ ] **Step 6: Plan card**

In `PlanCard.tsx`: after the status badge in the header add

```tsx
        {live.approvedBy === 'coordinator' && <span className="badge started-by">Koordinatör başlattı</span>}
```

and after the draft buttons block:

```tsx
      {live.status === 'approved' && (
        <div className="row end">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`“${live.title}” planı durdurulsun mu? Açık görevleri iptal edilir.`)) void act(() => api.stopPlan(live.id));
            }}
          >
            Durdur
          </button>
        </div>
      )}
```

- [ ] **Step 7: Top bar**

In `TopBar.tsx`: read `const paused = useOffice((s) => s.paused);` and `const company = useOffice((s) => s.budget !== null);`; before the Şirket button:

```tsx
      {company && paused && <span className="badge paused">Şirket duraklatıldı</span>}
      {company && (
        <button type="button" onClick={() => void (paused ? api.resumeCompany() : api.pauseCompany()).catch(() => undefined)}>
          {paused ? 'Sürdür' : 'Şirketi duraklat'}
        </button>
      )}
```

(import `api` from `../net/api.ts`).

- [ ] **Step 8: Constitution fields**

In `BudgetTabs.tsx`'s `FIELDS`, add after the economy toggles:

```ts
  { key: 'autonomy', label: 'Tam serbest', hint: 'Açıkken koordinatör hedef koyar ve planlarını sormadan başlatır; kapalıyken her plan senin onayını bekler.', toggle: true, choice: ['free', 'plans'] },
  { key: 'activeGoals', label: 'En fazla aktif hedef', hint: 'Koordinatörün aynı anda yürüttüğü en çok hedef.' },
  { key: 'pulseHours', label: 'Nabız aralığı (saat)', hint: 'Hiç hedef ve iş yokken koordinatöre en çok bu sıklıkla hatırlatılır; 0 = hiç.' },
```

Extend the `FIELDS` entry type with `choice?: readonly [string, string]` (on value, off value). Where the form fills `draft` from the constitution and where it builds the patch on save, a `choice` toggle maps `checked ↔ choice[0]` and `unchecked ↔ choice[1]` (e.g. draft value `'true'` when `constitution.autonomy === 'free'`; on save `autonomy: draft === 'true' ? 'free' : 'plans'`) instead of the boolean the other toggles use.

- [ ] **Step 9: Feed lines and styles**

In `EventItem.tsx` add cases:

```tsx
    case 'goal.changed':
      return (
        <div className="note">
          {e.change === 'set' ? `Hedef: ${e.goal.title}` : e.change === 'stopped' ? `Hedef durduruldu: ${e.goal.title}` : e.change === 'closed' ? `Hedef kapandı: ${e.goal.title}` : `Hedef güncellendi: ${e.goal.title}`}
        </div>
      );
    case 'company.paused':
      return <div className="note">{e.paused ? 'Şirket duraklatıldı' : 'Şirket sürdürüldü'}</div>;
```

Append to `styles.css`:

```css
.goals { display: grid; gap: 10px; }
.goal-card { padding: 10px 12px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--line); }
.goal-card.done, .goal-card.dropped { opacity: 0.7; }
.goal-card ul { margin: 4px 0 6px 18px; padding: 0; }
.badge.goal-active { color: var(--ok); }
.badge.goal-dropped, .badge.plan-stopped { color: var(--bad); }
.badge.started-by { color: var(--info); }
.badge.paused { color: var(--warn); }
```

- [ ] **Step 10: Run the web suite and the type check**

Run: `cd apps/office-web && npx vitest run > /tmp/cc-s2t6.log 2>&1; tail -6 /tmp/cc-s2t6.log; cd ../.. && pnpm -r --if-present typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 11: Commit**

```bash
git add apps/office-web/src
git commit -m "feat(office-web): goals, plans the coordinator started, stopping and pausing, and the PM's constitution fields"
```

---

### Task 7: The real coordinator runs the loop itself, and the docs

**Files:**
- Create: `apps/office-server/test/pm.smoke.real.test.ts` (opt-in)
- Modify: `apps/office-server/package.json` (`smoke`), `README.md`, `docs/superpowers/specs/2026-10-07-coordinator-craft-design.md` (status)

- [ ] **Step 1: The opt-in real test**

Create `apps/office-server/test/pm.smoke.real.test.ts`, wired like `test/craft.smoke.real.test.ts` (same setup block), plus `GoalStore` / `CompanyStateStore` passed to `Company`, a `Pulse`, the dispatcher with `pulse` and `tickMs: 5_000`, and the constitution `autonomy: 'free'`. The scenario:

```ts
      // A company with a mission and no goals: the pulse tells the coordinator, who sets a goal and starts a plan itself.
      company.updateBrief(coordinator.id, '# Şirket\n\nMisyon: küçük işletmelere ofis yazılımımızı tanıtmak. Şu an tek ürün var; tanıtım metni ve kısa bir SSS yok.\n');
      const goalSet = await waitFor(s.events, (e) => e.event.type === 'goal.changed' && e.event.change === 'set', { timeoutMs: 600_000 });
      const goal = (goalSet.event as { goal: Goal }).goal;
      expect(goal.why.length).toBeGreaterThan(0);
      expect(goal.done.length).toBeGreaterThan(0);
      const started = await waitFor(s.events, (e) => e.event.type === 'plan.changed' && e.event.change === 'approved', { timeoutMs: 600_000 });
      const plan = (started.event as { plan: Plan }).plan;
      expect(plan).toMatchObject({ approvedBy: 'coordinator', goalId: goal.id });
      expect(plan.method?.stages.length).toBeGreaterThanOrEqual(2);
      // The owner pauses: the office hands out nothing more.
      company.pause();
      const at = s.events.lastSeq();
      await new Promise((r) => setTimeout(r, 20_000));
      expect(s.events.list({ limit: 100_000 }).filter((e) => e.seq > at && e.event.type === 'task.changed' && e.event.change === 'started')).toHaveLength(0);
```

(`company.updateBrief` needs a coordinator: hire it first with `company.hireCoordinator('sonnet')`; the brief is written before the dispatcher starts so the first pulse sees it.)

- [ ] **Step 2: Run it once against the real claude**

Run: `cd apps/office-server && OFFICE_SMOKE=1 npx vitest run test/pm.smoke.real.test.ts > /tmp/cc-pm-smoke.log 2>&1; tail -20 /tmp/cc-pm-smoke.log; rm -rf ~/.claude/projects/*tmp-cc-*`
Expected: PASS within 20 minutes.

- [ ] **Step 3: Docs**

Add `test/pm.smoke.real.test.ts` to the `smoke` script. In `README.md`, after "Koordinatörlük yetisi", add "Proje yöneticisi ve yaşayan döngü": goals (Hedefler tab), full autonomy by default and the Anayasa switch, the pulse (what wakes the coordinator, `restUntil`), the owner's controls (Durdur on plans and goals, Şirketi duraklat / Sürdür). In the spec header, say stage 2 is implemented too.

- [ ] **Step 4: Full verification and commit**

Run: `pnpm -r --if-present typecheck && pnpm -r --if-present test > /tmp/cc-s2t7.log 2>&1; grep -E "Tests +[0-9]" /tmp/cc-s2t7.log`
Expected: typecheck clean; every package green.

```bash
git add apps/office-server/test/pm.smoke.real.test.ts apps/office-server/package.json README.md docs/superpowers/specs/2026-10-07-coordinator-craft-design.md
git commit -m "test(company): the real coordinator sets a goal and starts a plan on its own; docs"
```
