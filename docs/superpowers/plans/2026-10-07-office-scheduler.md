# Office Scheduler Implementation Plan (part 1 of 2: Tasks 1–4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Part 2 (Tasks 5–9) is `2026-10-07-office-scheduler-part-2.md`.

**Goal:** The office gets its own scheduling: a task can be parked until a time or told not to start before one, has an optional due date, recurring work runs as routines that open ordinary tasks, one Clock service drives every timed job from the database, and an Agenda service shows the owner, per employee, what runs when — so a waiting task never blocks its owner's queue again.

**Architecture:** Migration v10 adds `tasks.not_before / due_at / parked_reason / park_count / schedule_id / overdue_notified`, the task status `parked`, and a `schedules` table. `company/time.ts` parses `until` values and evaluates 5-field cron in local time. `company/scheduling.ts` is the due-processor (parked returns, overdue notices, routine firing with a pile-up brake and single catch-up) and the source of "next due at". `company/clock.ts` is the one timer: it arms itself to the nearest due time (at most 60 s away), runs the due-processor, runs the dispatcher's existing tick jobs, and re-arms on `touch()`. The dispatcher delivers as before but skips tasks whose time has not come. `company/agenda.ts` derives each employee's forward agenda with duration estimates. The web gets an Ajanda tab, an agenda section in the employee panel and owner buttons; employee sessions lose Claude's own scheduling tools via `--disallowedTools`.

**Tech Stack:** Node 24 type stripping, node:sqlite, Vitest 3, React 19 + zustand — as the company phases.

**Spec:** `docs/superpowers/specs/2026-10-07-office-scheduler-design.md` (all sections; §13 sequence).

**Base:** `main` at 33b6b3d (migrations up to v9). Execution: subagent-driven, implementers on Opus, reviewers on Fable (the owner's choice).

## Global Constraints

- Node 24 type stripping: no enums, no parameter properties, `import type` for types, `.ts` extensions in imports.
- Every migration is reversible: `up` + `down`, `down` removes exactly what `up` added and touches no data, round trip (up → down → up) tested with pre-existing rows.
- Tool descriptions in English; tool results, errors, guides, UI text and notices in Turkish.
- Commits: plain conventional commits as the user, no AI trailer or marker of any kind.
- Real claude only opt-in (`OFFICE_SMOKE=1`), temp data dirs, never port 4319; clean `~/.claude/projects/-tmp-cc-*` afterwards.
- Time rules live only in the database; nothing in memory but the clock's next wake-up (spec §5).
- Every transition the clock performs is atomic and harmless when repeated; every due item runs in its own try/catch (spec §5).
- Delivery texts, notices and events that exist today must not change when no time field is set: the economy scenario compares a recorded golden message by message (`test/economy.scenario.test.ts`).
- Anayasa limits: `defaultTaskMinutes` 45 (5–480), `minScheduleMinutes` 60 (1–1440), `maxSchedules` 20 (0–100).

## Spec rulings (decided here)

- **`until` grammar:** `+<n>m`, `+<n>h`, `+<n>d` (relative, whole numbers) or a local wall-clock time `YYYY-MM-DDTHH:MM`, `YYYY-MM-DDTHH:MM:SS` or `YYYY-MM-DD HH:MM` (no zone: the machine's local time). Must be in the future; parking at most 30 days ahead, a due date at most 365 days ahead. Replies and the sheet print times as `bugün 14:55`, `yarın 09:00`, `8 Eki 14:55` (local).
- **Who may park:** the assignee (own task), the coordinator (any), a lead (their team's, via the existing `#assertManages`), the owner (API). Only the coordinator, a lead or the owner may unpark. The owner's API actions carry `by = OWNER` and bypass roster checks.
- **Parking a started task** cancels nothing: status `parked`, `started_at` cleared, `nudged` reset; the assignee hears `task.parked` (decision) only when someone else parked it. The reviewer of a parked task is untouched.
- **Return from park:** `status = waiting`, `not_before = NULL`, priority kept; event `task.changed` with the new change `returned`. The dispatcher's normal rules then deliver (or not: paused, reserve, busy).
- **Unpark / "Şimdi başlasın":** `parked` or `waiting` with a future `not_before` → `waiting`, `not_before = NULL`; the owner's release also sets priority 1. Refused for `in_progress`, `review`, `blocked`, closed, and `handover`.
- **Due ordering:** `ORDER BY priority, (due_at IS NULL), due_at, created_at` in `nextFor` and the agenda.
- **Overdue:** once per task (`overdue_notified`), info notice `task.overdue` to the coordinator; the owner sees it red in the sheet. Checked by the clock on every run for open tasks (`waiting, in_progress, review, blocked, parked`).
- **Routine instance title:** `<schedule title> — <bugün 09:00 style local time of the firing>`; description = schedule description; `done`, `reviewer`, `priority`, `difficulty`, `planId` copied; `requester` = the schedule's creator; `schedule_id` set. Pile-up brake: an open instance (any open status) of the same schedule blocks a new one.
- **Routine next time** is computed with the local-time cron evaluator strictly after `now` at firing time (single catch-up). A schedule whose `until` has passed at check time becomes `stopped` without firing.
- **Minimum interval** is checked on create/update by computing the first five occurrences from now and taking the smallest gap; it must be ≥ `minScheduleMinutes`.
- **Clock jobs:** the dispatcher's tick (reserve check, report reminder when the digest is off, pulse, sweep) stays one function, `Dispatcher.tick()`, registered with the clock as a 60 s job; tests that pass `tickMs` without a clock keep the old `setInterval` path, so existing dispatcher tests do not change.
- **Clock jump:** when a run happens more than 2 minutes later than the time it was armed for, write `clock.jumped` (event, employee null) and `company_state.clock.lastJumpAt`.
- **Agenda estimates:** median of `finished_at − started_at` over the employee's last 10 finished `work` tasks; with the task's difficulty and ≥ 3 samples of that difficulty, the median of those; else the office-wide median of the last 50; else `defaultTaskMinutes`. Review tasks: median of the last 10 decided reviews, else 15 min. Each estimate carries its basis label.
- **Board:** parked tasks stay in the "Bekliyor" column with an "ertelendi · <time>" badge (no sixth column); the Ajanda tab is where time is shown.
- **Snapshot** gains `schedules` (all but `stopped`, plus the last 10 stopped) and `clock: { nextDueAt, nextDueLabel, lastRunAt, lastJumpAt }`.

## Review Focus

1. A parked task returns while its assignee sleeps, the company is paused, or the reserve is on: the status flips to `waiting`, nothing is delivered until the dispatcher's own rules allow it, and a sleeper is woken only when it may start (Task 4: `test/clock.test.ts`, Task 5: dispatcher test).
2. `until` from a model: `+0h`, a past time, `2026-13-40T99:99`, `yarın`, 31 days ahead for a park, a zone suffix — each refused in Turkish with the accepted forms; `+90m` and `2026-10-08 14:55` accepted (Task 2: `test/time.test.ts`).
3. A routine whose assignee is let go or whose plan is stopped never fires again: paused with a coordinator notice / stopped; a routine already due at that moment does not fire during the same run (Task 6).
4. The owner's "Şimdi başlasın" on a running, reviewing or hand-over task is refused with a Turkish 409, and on a parked task makes it priority 1 and deliverable now; the coordinator hears once (Task 5: `test/company-api.test.ts`).
5. Agenda with no history (fresh office), a task depending on another employee's unfinished task, and a parked task past its return time (clock not yet run) all render without throwing and with the right labels (Task 7: `test/agenda.test.ts`).

---

## File Structure

```
packages/shared/src/company.ts                 MODIFY  TaskStatus +parked; Task.notBefore/dueAt/parkedReason/parkCount/scheduleId;
                                                       TaskChange +parked/returned; Schedule, ScheduleStatus, ScheduleChange; AgendaEntry/EmployeeAgenda/AgendaReport/ClockStatus
packages/shared/src/budget.ts                  MODIFY  defaultTaskMinutes, minScheduleMinutes, maxSchedules
packages/shared/src/events.ts                  MODIFY  schedule.changed, clock.jumped, clock.error; snapshot schedules, clock
apps/office-server/src/migrations.ts           MODIFY  v10
apps/office-server/src/company/store.ts        MODIFY  TaskStore new columns, OPEN +parked, nextFor time-aware, due/overdue/durations queries; ScheduleStore (new class)
apps/office-server/src/company/budget.ts       MODIFY  three number rules
apps/office-server/src/company/time.ts         CREATE  parseUntil, formatWhen, cron parse/next/label/minInterval
apps/office-server/src/company/scheduling.ts   CREATE  Scheduling: nextDueAt, runDue (parked returns, overdue, routines)
apps/office-server/src/company/clock.ts        CREATE  Clock: one timer, jobs, touch, jump detection, status
apps/office-server/src/company/agenda.ts       CREATE  Agenda: per-employee forward view, estimates, Turkish text
apps/office-server/src/company/company.ts      MODIFY  parkTask/unparkTask/ownerPrioritize/returnFromPark, startAfter/dueAt, schedules CRUD, open lists +parked
apps/office-server/src/company/dispatcher.ts   MODIFY  tick() + clock registration, delivery lines for due/start, open lists
apps/office-server/src/company/notices.ts      MODIFY  topics, digest group "Ajanda"
apps/office-server/src/company/craft/*.md      MODIFY  park/routine guidance, Claude scheduler closed
apps/office-server/src/claude/args.ts          MODIFY  --disallowedTools
apps/office-server/src/mcp/tools.ts            MODIFY  taskPark, taskUnpark, scheduleCreate/List/Update, agendaRead; startAfter/dueAt
apps/office-server/src/api.ts                  MODIFY  task park/release/prioritize, schedules pause/resume/stop, GET /api/agenda, snapshot
apps/office-server/src/main.ts                 MODIFY  wiring
apps/office-web/src/...                        MODIFY  labels, store (schedules, clock, agendaRev), api, AgendaTab (new), AgendaSection in Panel, EventItem, BudgetTabs fields, styles
tests: db, company-store, budget, time (+ time-dst), scheduling, clock, park (new), schedules (new), agenda (new), dispatcher, company-api, mcp-tools, args, web; scheduler.smoke.real.test.ts + lockdown.real.test.ts (opt-in)
```

---

### Task 1: Types, constitution keys, migration v10, stores

**Files:**
- Modify: `packages/shared/src/company.ts`, `packages/shared/src/budget.ts`, `packages/shared/src/events.ts`
- Modify: `apps/office-server/src/migrations.ts`, `apps/office-server/src/company/store.ts`, `apps/office-server/src/company/budget.ts`
- Modify: `apps/office-web/src/ui/labels.ts` (status label), web fixtures that spell out a whole `Constitution`
- Test: `apps/office-server/test/db.test.ts`, `apps/office-server/test/company-store.test.ts`, `apps/office-server/test/budget.test.ts`

**Interfaces:**
- Produces (shared): `TASK_STATUSES` incl. `'parked'`; `Task.notBefore?: number | null`, `Task.dueAt?: number | null`, `Task.parkedReason?: string | null`, `Task.parkCount?: number`, `Task.scheduleId?: string | null`; `TaskChange` incl. `'parked' | 'returned'`; `SCHEDULE_STATUSES = ['active','paused','stopped']`, `ScheduleStatus`, `Schedule`, `ScheduleChange = 'created' | 'updated' | 'fired' | 'skipped' | 'paused' | 'resumed' | 'stopped'`; `ClockStatus`; events `schedule.changed { change, schedule }`, `clock.jumped { expectedAt, actualAt }`, `clock.error { job, message }`; `OfficeSnapshot.schedules?`, `OfficeSnapshot.clock?`; `Constitution.defaultTaskMinutes / minScheduleMinutes / maxSchedules`.
- Produces (store): `NewTask.notBefore?/dueAt?/scheduleId?`; `TaskPatch` incl. `notBefore | dueAt | parkedReason | parkCount`; `TaskStore.nextFor(assignee, now?)` time-aware; `TaskStore.dueParked(now): Task[]`; `TaskStore.returnParked(id, now): boolean` (atomic); `TaskStore.overdueUnnotified(now): Task[]`; `TaskStore.markOverdueNotified(id)`; `TaskStore.nextDueAt(now): number | null`; `TaskStore.openInstance(scheduleId): Task | null`; `TaskStore.durations(o: { assignee?: string; kind: TaskKind; difficulty?: TaskDifficulty | null; limit: number }): number[]`; `ScheduleStore` (`create`, `get`, `list(o?: { statuses?: ScheduleStatus[]; assignee?: string; planId?: string; limit? })`, `update(id, patch)`, `due(now): Schedule[]`, `nextRunAt(): number | null`, `activeCount(): number`).

- [ ] **Step 1: Write the failing tests**

In `apps/office-server/test/db.test.ts`: add `const V10_TABLES = [...V9_TABLES, 'schedules'].sort();`, change the three top-level `toBe(9)` to `toBe(10)` and their `V9_TABLES` to `V10_TABLES`; make the v9 test's last line `expect(migrateUp(db, upTo(9))).toBe(9);`; append inside `describe('migrations')`:

```ts
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
    expect(migrateUp(db)).toBe(10);
  });
```

Append to `apps/office-server/test/company-store.test.ts` (it has `stores()` and `task(over)`; add `ScheduleStore` to its import from `../src/company/store.ts`):

```ts
describe('TaskStore — time (v10)', () => {
  it('keeps not_before, due_at, the park reason and count; old rows read as nulls and 0', () => {
    const { tasks } = stores();
    const t = tasks.create(task({ notBefore: 5000, dueAt: 9000 }));
    expect(t).toMatchObject({ notBefore: 5000, dueAt: 9000, parkedReason: null, parkCount: 0, scheduleId: null });
    const parked = tasks.update(t.id, { status: 'parked', parkedReason: 'pencere dolsun', parkCount: 1, notBefore: 7000 });
    expect(tasks.get(t.id)).toMatchObject({ status: 'parked', parkedReason: 'pencere dolsun', parkCount: 1, notBefore: 7000 });
    expect(parked.parkCount).toBe(1);
    const plain = tasks.create(task({ title: 'eski gibi' }));
    expect(tasks.get(plain.id)).toMatchObject({ notBefore: null, dueAt: null, parkCount: 0 });
  });

  it('nextFor skips a task whose time has not come, and puts the nearer due date first within a priority', () => {
    const { tasks } = stores();
    const later = tasks.create(task({ title: 'sonra', notBefore: 10_000 }));
    const dueLate = tasks.create(task({ title: 'geç', dueAt: 50_000 }));
    const dueSoon = tasks.create(task({ title: 'yakın', dueAt: 20_000 }));
    const noDue = tasks.create(task({ title: 'tarihsiz' }));
    expect(tasks.nextFor('e1', 1000)?.id).toBe(dueSoon.id);
    tasks.update(dueSoon.id, { status: 'done' });
    expect(tasks.nextFor('e1', 1000)?.id).toBe(dueLate.id);
    tasks.update(dueLate.id, { status: 'done' });
    expect(tasks.nextFor('e1', 1000)?.id).toBe(noDue.id);
    tasks.update(noDue.id, { status: 'done' });
    expect(tasks.nextFor('e1', 1000)).toBeNull();
    expect(tasks.nextFor('e1', 10_000)?.id).toBe(later.id);
  });

  it('parked counts as open; returnParked flips exactly once and only when due; nextDueAt is the nearest of park returns, start times and due dates', () => {
    const { tasks } = stores();
    const p = tasks.create(task({ planId: 'p1' }));
    tasks.update(p.id, { status: 'parked', notBefore: 5000 });
    expect(tasks.openInPlan('p1')).toBe(1);
    expect(tasks.dueParked(4999)).toEqual([]);
    expect(tasks.returnParked(p.id, 4999)).toBe(false);
    expect(tasks.dueParked(5000).map((t) => t.id)).toEqual([p.id]);
    expect(tasks.returnParked(p.id, 5000)).toBe(true);
    expect(tasks.get(p.id)).toMatchObject({ status: 'waiting', notBefore: null });
    expect(tasks.returnParked(p.id, 5000)).toBe(false);
    const w = tasks.create(task({ notBefore: 8000 }));
    const d = tasks.create(task({ dueAt: 7000 }));
    expect(tasks.nextDueAt(1000)).toBe(7000);
    tasks.markOverdueNotified(d.id);
    expect(tasks.nextDueAt(1000)).toBe(8000);
    tasks.update(w.id, { status: 'done' });
    expect(tasks.nextDueAt(1000)).toBeNull();
  });

  it('lists overdue open tasks once, and an open instance of a schedule', () => {
    const { tasks } = stores();
    const a = tasks.create(task({ dueAt: 1000 }));
    tasks.create(task({ dueAt: 1000 }));
    const done = tasks.create(task({ dueAt: 1000 }));
    tasks.update(done.id, { status: 'done' });
    expect(tasks.overdueUnnotified(2000)).toHaveLength(2);
    tasks.markOverdueNotified(a.id);
    expect(tasks.overdueUnnotified(2000)).toHaveLength(1);
    const inst = tasks.create(task({ scheduleId: 's1' }));
    expect(tasks.openInstance('s1')?.id).toBe(inst.id);
    tasks.update(inst.id, { status: 'cancelled' });
    expect(tasks.openInstance('s1')).toBeNull();
  });

  it('gives durations of finished work, newest first, optionally by assignee and difficulty', () => {
    const { tasks } = stores();
    for (const [i, diff] of (['easy', 'hard', 'easy'] as const).entries()) {
      const t = tasks.create(task({ difficulty: diff }));
      tasks.update(t.id, { status: 'in_progress', startedAt: 1000 * (i + 1) });
      tasks.update(t.id, { status: 'done', finishedAt: 1000 * (i + 1) + 600 * (i + 1) });
    }
    const other = tasks.create(task({ assignee: 'e2' }));
    tasks.update(other.id, { status: 'in_progress', startedAt: 10 });
    tasks.update(other.id, { status: 'done', finishedAt: 10_010 });
    expect(tasks.durations({ assignee: 'e1', kind: 'work', limit: 10 })).toEqual([1800, 1200, 600]);
    expect(tasks.durations({ assignee: 'e1', kind: 'work', difficulty: 'easy', limit: 10 })).toEqual([1800, 600]);
    expect(tasks.durations({ kind: 'work', limit: 2 })).toEqual([1800, 1200]);
  });
});

describe('ScheduleStore', () => {
  it('creates, lists by status, updates, finds due ones and the nearest next run', () => {
    const { schedules } = stores();
    const a = schedules.create({ title: 'Günlük ölçüm', description: 'd', done: ['rapor'], assignee: 'e1', reviewer: null, planId: null, priority: 3, difficulty: null, cron: '0 9 * * *', until: null, createdBy: 'c', nextRunAt: 9000 });
    expect(a).toMatchObject({ status: 'active', skipCount: 0, failCount: 0, lastRunAt: null, lastTaskId: null, note: null });
    const b = schedules.create({ title: 'Haftalık', description: '', done: [], assignee: 'e2', reviewer: 'e1', planId: 'p1', priority: 2, difficulty: 'easy', cron: '0 10 * * 1', until: 99_000, createdBy: 'c', nextRunAt: 5000 });
    expect(schedules.due(4999).map((s) => s.id)).toEqual([]);
    expect(schedules.due(9000).map((s) => s.id)).toEqual([b.id, a.id]);
    expect(schedules.nextRunAt()).toBe(5000);
    schedules.update(b.id, { status: 'paused' });
    expect(schedules.due(9000).map((s) => s.id)).toEqual([a.id]);
    expect(schedules.nextRunAt()).toBe(9000);
    expect(schedules.activeCount()).toBe(1);
    expect(schedules.list({ statuses: ['paused'] }).map((s) => s.id)).toEqual([b.id]);
    expect(schedules.list({ assignee: 'e1' }).map((s) => s.id)).toEqual([a.id]);
    expect(() => schedules.get('yok')).toThrow(/Rutin bulunamadı/);
  });
});
```

(The `stores()` helper must also return `schedules: new ScheduleStore(db, now)`.)

Append to `apps/office-server/test/budget.test.ts` inside `describe('Budget — constitution')`:

```ts
  it('the scheduler keys: default task minutes, the routine minimum interval and the routine cap, validated in Turkish', () => {
    const t = make();
    expect(DEFAULT_CONSTITUTION).toMatchObject({ defaultTaskMinutes: 45, minScheduleMinutes: 60, maxSchedules: 20 });
    expect(t.budget.setConstitution({ defaultTaskMinutes: 30, minScheduleMinutes: 15, maxSchedules: 5 })).toMatchObject({ defaultTaskMinutes: 30, minScheduleMinutes: 15, maxSchedules: 5 });
    expect(() => t.budget.setConstitution({ defaultTaskMinutes: 1 })).toThrow(/Varsayılan görev süresi/);
    expect(() => t.budget.setConstitution({ minScheduleMinutes: 0 })).toThrow(/Rutin aralığı/);
    expect(() => t.budget.setConstitution({ maxSchedules: 101 })).toThrow(/En fazla rutin/);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/office-server && npx vitest run test/db.test.ts test/company-store.test.ts test/budget.test.ts`
Expected: FAIL — `migrateUp` returns 9, `ScheduleStore` not exported, unknown constitution key.

- [ ] **Step 3: Shared types**

`packages/shared/src/company.ts`:

```ts
export const TASK_STATUSES = ['waiting', 'in_progress', 'review', 'blocked', 'parked', 'done', 'cancelled'] as const;
```

In `interface Task`, after `round?: number;`:

```ts
  /** Not handed out before this time (epoch ms): a start time, or a parked task's return time. */
  notBefore?: number | null;
  /** Should be done by this time (epoch ms); past it the coordinator is told once. */
  dueAt?: number | null;
  /** Why it was parked (spec §4.2); null when not parked. */
  parkedReason?: string | null;
  /** How many times it was parked (the third tells the coordinator). */
  parkCount?: number;
  /** The routine that opened it, if any. */
  scheduleId?: string | null;
```

Replace the `TaskChange` line:

```ts
/** `in_review`: handed in, waiting for its reviewer. `reviewed`: a review task was decided. `parked`: set aside until a time. `returned`: its time came. */
export type TaskChange = 'created' | 'assigned' | 'started' | 'updated' | 'finished' | 'reprioritized' | 'in_review' | 'reviewed' | 'parked' | 'returned';
```

Append after the `GoalChange` line:

```ts
export const SCHEDULE_STATUSES = ['active', 'paused', 'stopped'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];
/** Recurring work (spec §4.4): each firing opens an ordinary task. */
export interface Schedule {
  id: string;
  title: string;
  description: string;
  done: string[];
  assignee: string;
  reviewer: string | null;
  planId: string | null;
  priority: number;
  difficulty: TaskDifficulty | null;
  /** 5-field cron, local time. */
  cron: string;
  /** Stops after this time (epoch ms), if given. */
  until: number | null;
  status: ScheduleStatus;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastTaskId: string | null;
  /** Firings skipped because the previous instance was still open. */
  skipCount: number;
  /** Consecutive firings that could not open a task. */
  failCount: number;
  createdBy: string;
  createdAt: number;
  note: string | null;
}
export type ScheduleChange = 'created' | 'updated' | 'fired' | 'skipped' | 'paused' | 'resumed' | 'stopped';

/** One line of an employee's agenda (spec §6.1). */
export interface AgendaEntry {
  kind: 'now' | 'queued' | 'review_wait' | 'parked' | 'not_before' | 'scheduled';
  taskId: string | null;
  scheduleId: string | null;
  title: string;
  /** When it starts or returns (epoch ms); null when it depends on another task's end that cannot be estimated. */
  at: number | null;
  /** Estimated end (epoch ms), for now/queued. */
  until: number | null;
  /** Estimate basis: "son 10 iş" / "zorluk: zor, 4 iş" / "ofis geneli" / "varsayılan" / "inceleme". */
  basis: string | null;
  /** "X bitince" (the dependency's title), "Can'da, tur 2", a park reason, a cron label. */
  note: string | null;
  priority: number | null;
  dueAt: number | null;
  overdue: boolean;
  lowConfidence: boolean;
}
export interface EmployeeAgenda {
  id: string;
  name: string;
  /** Turkish state line: "uyuyor", "kota payı devrede (yalnız öncelik 1)", "şirket duraklatıldı", "limit doldu, açılış 20:10", or null. */
  state: string | null;
  entries: AgendaEntry[];
}
export interface ClockStatus {
  nextDueAt: number | null;
  /** What is due then, in Turkish ("Adım 1 penceresi · Koordinatör"), or null. */
  nextDueLabel: string | null;
  lastRunAt: number | null;
  lastJumpAt: number | null;
}
export interface AgendaReport {
  generatedAt: number;
  horizonMs: number;
  clock: ClockStatus;
  employees: EmployeeAgenda[];
}
```

`packages/shared/src/budget.ts`: in `Constitution` after `pulseHours: number;`:

```ts
  /** The agenda's estimate for a task with no history, minutes (spec §6.1). */
  defaultTaskMinutes: number;
  /** A routine may not fire more often than this, minutes (spec §4.4). */
  minScheduleMinutes: number;
  /** Routines at once, at most (stopped ones do not count). */
  maxSchedules: number;
```

and in `DEFAULT_CONSTITUTION`: `defaultTaskMinutes: 45, minScheduleMinutes: 60, maxSchedules: 20,`.

`packages/shared/src/events.ts`: extend the import from `./company.ts` with `Schedule, ScheduleChange, ClockStatus`; add to the `OfficeEvent` union after `company.paused`:

```ts
  | { type: 'schedule.changed'; change: ScheduleChange; schedule: Schedule }
  /** The clock woke more than two minutes after the time it was armed for (sleep, a clock change). */
  | { type: 'clock.jumped'; expectedAt: number; actualAt: number }
  /** One due item failed; the clock went on. */
  | { type: 'clock.error'; job: string; message: string }
```

and to `OfficeSnapshot`:

```ts
  /** Routines (all but stopped, plus the last 10 stopped). */
  schedules?: Schedule[];
  clock?: ClockStatus;
```

- [ ] **Step 4: Migration v10**

Append to `MIGRATIONS` in `apps/office-server/src/migrations.ts`:

```ts
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
```

(`until` is a keyword-ish name in some tools; the column is `until_at`, the field stays `until`.)

- [ ] **Step 5: TaskStore**

In `apps/office-server/src/company/store.ts`:

Import line gains `Schedule, ScheduleStatus`:

```ts
import type { Plan, PlanMethod, PlanStatus, Schedule, ScheduleStatus, Task, TaskDifficulty, TaskKind, TaskResult, TaskStatus } from '@cc/shared';
```

`TaskRow` gets (after `round`):

```ts
  not_before: number | null;
  due_at: number | null;
  parked_reason: string | null;
  park_count: number | null;
  schedule_id: string | null;
```

`taskFromRow` gets (after `round: r.round ?? 0,`):

```ts
    notBefore: r.not_before ?? null,
    dueAt: r.due_at ?? null,
    parkedReason: r.parked_reason ?? null,
    parkCount: r.park_count ?? 0,
    scheduleId: r.schedule_id ?? null,
```

`NewTask` gets (after `reviewOf?`):

```ts
  /** Not handed out before this time. */
  notBefore?: number | null;
  dueAt?: number | null;
  /** The routine that opens it. */
  scheduleId?: string | null;
```

`TaskPatch` and `OPEN` become:

```ts
export type TaskPatch = Partial<Pick<Task, 'assignee' | 'priority' | 'difficulty' | 'reviewer' | 'round' | 'status' | 'note' | 'result' | 'nudged' | 'startedAt' | 'finishedAt' | 'notBefore' | 'dueAt' | 'parkedReason' | 'parkCount'>>;

const OPEN = "('waiting', 'in_progress', 'review', 'blocked', 'parked')";
/** Statuses the clock watches for a due date. */
export const OPEN_STATUSES: TaskStatus[] = ['waiting', 'in_progress', 'review', 'blocked', 'parked'];
```

`create` becomes:

```ts
  create(t: NewTask): Task {
    const task: Task = {
      ...t, kind: t.kind ?? 'work', difficulty: t.difficulty ?? null, reviewer: t.reviewer ?? null, reviewOf: t.reviewOf ?? null, round: 0,
      notBefore: t.notBefore ?? null, dueAt: t.dueAt ?? null, parkedReason: null, parkCount: 0, scheduleId: t.scheduleId ?? null,
      id: randomUUID(), status: 'waiting', note: null, result: null, nudged: false, createdAt: this.#now(), startedAt: null, finishedAt: null,
    };
    this.#db
      .prepare(
        `INSERT INTO tasks (id, plan_id, title, description, done, requester, assignee, priority, depends_on, status, chain_depth,
           note, result, nudged, created_at, started_at, finished_at, kind, difficulty, reviewer, review_of, round, not_before, due_at, schedule_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, NULL, NULL, ?, ?, ?, ?, 0, ?, ?, ?)`,
      )
      .run(task.id, task.planId, task.title, task.description, JSON.stringify(task.done), task.requester, task.assignee, task.priority, JSON.stringify(task.dependsOn), task.status, task.chainDepth, task.createdAt, task.kind, task.difficulty ?? null, task.reviewer ?? null, task.reviewOf ?? null, task.notBefore ?? null, task.dueAt ?? null, task.scheduleId ?? null);
    return task;
  }
```

`update` becomes:

```ts
  update(id: string, patch: TaskPatch): Task {
    const next = { ...this.get(id), ...patch };
    this.#db
      .prepare(
        `UPDATE tasks SET assignee = ?, priority = ?, difficulty = ?, reviewer = ?, round = ?, status = ?, note = ?, result = ?, nudged = ?, started_at = ?, finished_at = ?,
           not_before = ?, due_at = ?, parked_reason = ?, park_count = ? WHERE id = ?`,
      )
      .run(
        next.assignee, next.priority, next.difficulty ?? null, next.reviewer ?? null, next.round ?? 0, next.status, next.note, next.result ? JSON.stringify(next.result) : null, next.nudged ? 1 : 0, next.startedAt, next.finishedAt,
        next.notBefore ?? null, next.dueAt ?? null, next.parkedReason ?? null, next.parkCount ?? 0, id,
      );
    return next;
  }
```

`nextFor` becomes (the `now` parameter defaults to the store's clock):

```ts
  /**
   * The assignee's next task: waiting, its start time come, every dependency done; most urgent first (1 = most urgent),
   * then the nearer due date, then oldest.
   */
  nextFor(assignee: string, now: number = this.#now()): Task | null {
    const rows = this.#db
      .prepare(
        `SELECT * FROM tasks WHERE assignee = ? AND status = 'waiting' AND (not_before IS NULL OR not_before <= ?)
         ORDER BY priority, (due_at IS NULL), due_at, created_at`,
      )
      .all(assignee, now) as unknown as TaskRow[];
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
```

After `latestReview`, add:

```ts
  /** Parked tasks whose return time has come. */
  dueParked(now: number): Task[] {
    const rows = this.#db.prepare("SELECT * FROM tasks WHERE status = 'parked' AND not_before IS NOT NULL AND not_before <= ? ORDER BY not_before").all(now) as unknown as TaskRow[];
    return rows.map(taskFromRow);
  }

  /** A parked task comes back to the queue — once, and only when its time has come (atomic; a second call changes nothing). */
  returnParked(id: string, now: number): boolean {
    const r = this.#db
      .prepare("UPDATE tasks SET status = 'waiting', not_before = NULL, started_at = NULL, nudged = 0 WHERE id = ? AND status = 'parked' AND not_before IS NOT NULL AND not_before <= ?")
      .run(id, now);
    return Number(r.changes) > 0;
  }

  /** Open tasks past their due date that the coordinator has not been told about. */
  overdueUnnotified(now: number): Task[] {
    const rows = this.#db
      .prepare(`SELECT * FROM tasks WHERE status IN ${OPEN} AND due_at IS NOT NULL AND due_at <= ? AND overdue_notified = 0 ORDER BY due_at`)
      .all(now) as unknown as TaskRow[];
    return rows.map(taskFromRow);
  }

  markOverdueNotified(id: string): void {
    this.#db.prepare('UPDATE tasks SET overdue_notified = 1 WHERE id = ?').run(id);
  }

  /** The nearest future time a task needs the clock: a park return, a start time, or an unannounced due date. */
  nextDueAt(now: number): number | null {
    const row = this.#db
      .prepare(
        `SELECT MIN(t) AS t FROM (
           SELECT not_before AS t FROM tasks WHERE status IN ('parked', 'waiting') AND not_before IS NOT NULL AND not_before > ?
           UNION ALL
           SELECT due_at AS t FROM tasks WHERE status IN ${OPEN} AND due_at IS NOT NULL AND due_at > ? AND overdue_notified = 0
         )`,
      )
      .get(now, now) as unknown as { t: number | null };
    return row.t ?? null;
  }

  /** The still-open task a routine opened last, if any (the pile-up brake, spec §4.4). */
  openInstance(scheduleId: string): Task | null {
    const row = this.#db.prepare(`SELECT * FROM tasks WHERE schedule_id = ? AND status IN ${OPEN} ORDER BY created_at DESC LIMIT 1`).get(scheduleId) as unknown as TaskRow | undefined;
    return row ? taskFromRow(row) : null;
  }

  /** How long finished tasks took (ms), newest first — the agenda's estimates (spec §6.1). */
  durations(o: { assignee?: string; kind: TaskKind; difficulty?: TaskDifficulty | null; limit: number }): number[] {
    const where = ["status = 'done'", 'started_at IS NOT NULL', 'finished_at IS NOT NULL', 'kind = ?'];
    const params: Array<string | number> = [o.kind];
    if (o.assignee !== undefined) {
      where.push('assignee = ?');
      params.push(o.assignee);
    }
    if (o.difficulty) {
      where.push('difficulty = ?');
      params.push(o.difficulty);
    }
    const rows = this.#db
      .prepare(`SELECT finished_at - started_at AS d FROM tasks WHERE ${where.join(' AND ')} ORDER BY finished_at DESC LIMIT ?`)
      .all(...params, o.limit) as unknown as Array<{ d: number }>;
    return rows.map((r) => r.d);
  }
```

- [ ] **Step 6: ScheduleStore**

Append to `apps/office-server/src/company/store.ts` (before `NoticeStore`):

```ts
interface ScheduleRow {
  id: string;
  title: string;
  description: string;
  done: string;
  assignee: string;
  reviewer: string | null;
  plan_id: string | null;
  priority: number;
  difficulty: string | null;
  cron: string;
  until_at: number | null;
  status: string;
  next_run_at: number | null;
  last_run_at: number | null;
  last_task_id: string | null;
  skip_count: number;
  fail_count: number;
  created_by: string;
  created_at: number;
  note: string | null;
}

const scheduleFromRow = (r: ScheduleRow): Schedule => ({
  id: r.id, title: r.title, description: r.description, done: JSON.parse(r.done) as string[], assignee: r.assignee, reviewer: r.reviewer, planId: r.plan_id,
  priority: r.priority, difficulty: (r.difficulty as TaskDifficulty | null) ?? null, cron: r.cron, until: r.until_at, status: r.status as ScheduleStatus,
  nextRunAt: r.next_run_at, lastRunAt: r.last_run_at, lastTaskId: r.last_task_id, skipCount: r.skip_count, failCount: r.fail_count, createdBy: r.created_by,
  createdAt: r.created_at, note: r.note,
});

export interface NewSchedule {
  title: string;
  description: string;
  done: string[];
  assignee: string;
  reviewer: string | null;
  planId: string | null;
  priority: number;
  difficulty: TaskDifficulty | null;
  cron: string;
  until: number | null;
  createdBy: string;
  nextRunAt: number | null;
}

export type SchedulePatch = Partial<Pick<Schedule, 'title' | 'description' | 'done' | 'assignee' | 'reviewer' | 'priority' | 'difficulty' | 'cron' | 'until' | 'status' | 'nextRunAt' | 'lastRunAt' | 'lastTaskId' | 'skipCount' | 'failCount' | 'note'>>;

/** Routines (spec §4.4): templates the clock turns into ordinary tasks. */
export class ScheduleStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  create(s: NewSchedule): Schedule {
    const schedule: Schedule = { ...s, id: randomUUID(), status: 'active', lastRunAt: null, lastTaskId: null, skipCount: 0, failCount: 0, createdAt: this.#now(), note: null };
    this.#db
      .prepare(
        `INSERT INTO schedules (id, title, description, done, assignee, reviewer, plan_id, priority, difficulty, cron, until_at, status, next_run_at, last_run_at, last_task_id, skip_count, fail_count, created_by, created_at, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL, NULL, 0, 0, ?, ?, NULL)`,
      )
      .run(schedule.id, schedule.title, schedule.description, JSON.stringify(schedule.done), schedule.assignee, schedule.reviewer, schedule.planId, schedule.priority, schedule.difficulty, schedule.cron, schedule.until, schedule.nextRunAt, schedule.createdBy, schedule.createdAt);
    return schedule;
  }

  get(id: string): Schedule {
    const row = this.#db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as unknown as ScheduleRow | undefined;
    if (!row) throw new NotFoundError(`Rutin bulunamadı: ${id}`);
    return scheduleFromRow(row);
  }

  list(o: { statuses?: ScheduleStatus[]; assignee?: string; planId?: string; limit?: number } = {}): Schedule[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (o.statuses?.length) {
      where.push(`status IN (${o.statuses.map(() => '?').join(', ')})`);
      params.push(...o.statuses);
    }
    if (o.assignee !== undefined) {
      where.push('assignee = ?');
      params.push(o.assignee);
    }
    if (o.planId !== undefined) {
      where.push('plan_id = ?');
      params.push(o.planId);
    }
    const rows = this.#db.prepare(`SELECT * FROM schedules ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at LIMIT ?`).all(...params, o.limit ?? 1000) as unknown as ScheduleRow[];
    return rows.map(scheduleFromRow);
  }

  update(id: string, patch: SchedulePatch): Schedule {
    const next: Schedule = { ...this.get(id), ...patch };
    this.#db
      .prepare(
        `UPDATE schedules SET title = ?, description = ?, done = ?, assignee = ?, reviewer = ?, priority = ?, difficulty = ?, cron = ?, until_at = ?, status = ?,
           next_run_at = ?, last_run_at = ?, last_task_id = ?, skip_count = ?, fail_count = ?, note = ? WHERE id = ?`,
      )
      .run(next.title, next.description, JSON.stringify(next.done), next.assignee, next.reviewer, next.priority, next.difficulty, next.cron, next.until, next.status, next.nextRunAt, next.lastRunAt, next.lastTaskId, next.skipCount, next.failCount, next.note, id);
    return next;
  }

  /** Active routines whose next run has come, soonest first. */
  due(now: number): Schedule[] {
    const rows = this.#db.prepare("SELECT * FROM schedules WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at, created_at").all(now) as unknown as ScheduleRow[];
    return rows.map(scheduleFromRow);
  }

  nextRunAt(): number | null {
    const row = this.#db.prepare("SELECT MIN(next_run_at) AS t FROM schedules WHERE status = 'active' AND next_run_at IS NOT NULL").get() as unknown as { t: number | null };
    return row.t ?? null;
  }

  /** Routines that count against the constitution's cap (stopped ones do not). */
  activeCount(): number {
    return (this.#db.prepare("SELECT COUNT(*) AS n FROM schedules WHERE status IN ('active', 'paused')").get() as unknown as { n: number }).n;
  }
}
```

- [ ] **Step 7: Constitution rules and labels**

`apps/office-server/src/company/budget.ts`, `RULES` gains:

```ts
  defaultTaskMinutes: { label: 'Varsayılan görev süresi (dk)', min: 5, max: () => 480, integer: true },
  minScheduleMinutes: { label: 'Rutin aralığı en az (dk)', min: 1, max: () => 1440, integer: true },
  maxSchedules: { label: 'En fazla rutin', min: 0, max: () => 100, integer: true },
```

`apps/office-web/src/ui/labels.ts`: `TASK_STATUS_LABELS` gains `parked: 'Ertelendi',` (after `blocked`). `apps/office-server/src/mcp/tools.ts` `STATUS_TR` gains `parked: 'ertelendi'`.

Web fixtures that spell out a whole `Constitution` get the three keys: run from the repo root

```bash
python3 - <<'EOF'
import re, pathlib
for p in pathlib.Path('apps/office-web/src').rglob('*.test.ts*'):
    s = p.read_text()
    n = re.sub(r"pulseHours: 6(?!, defaultTaskMinutes)", "pulseHours: 6, defaultTaskMinutes: 45, minScheduleMinutes: 60, maxSchedules: 20", s)
    if n != s:
        p.write_text(n); print('updated', p)
EOF
```

(The BudgetTabs save-expectation that lists only the saved fields is unchanged: it does not spell out `pulseHours`.)

- [ ] **Step 8: Run the tests and the type check**

Run: `cd apps/office-server && npx vitest run test/db.test.ts test/company-store.test.ts test/budget.test.ts && cd ../.. && pnpm -r --if-present typecheck`
Expected: PASS; typecheck clean (the web's `TASK_STATUS_LABELS` and the server's `STATUS_TR` are `Record<TaskStatus, …>` and now name `parked`).

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src apps/office-server/src apps/office-server/test apps/office-web/src
git commit -m "feat(company): migration v10 — a task's start time, due date and park, and routines"
```

---

### Task 2: Time utilities — `until` parsing, local cron, Turkish labels

**Files:**
- Create: `apps/office-server/src/company/time.ts`
- Test: `apps/office-server/test/time.test.ts` (new), `apps/office-server/test/time-dst.test.ts` (new)

**Interfaces:**
- Produces: `parseUntil(value: string, now: number, o: { maxDays: number; label: string }): number` (throws `ValidationError`); `formatWhen(ms: number, now: number): string` ("bugün 14:55" / "yarın 09:00" / "8 Eki 14:55" / "8 Eki 2027 14:55"); `parseCron(expr: string): CronSpec` (throws `ValidationError`); `nextCron(spec: CronSpec, afterMs: number): number` (strictly after; local time; throws if none within 366 days); `cronLabel(spec: CronSpec): string`; `minIntervalMinutes(spec: CronSpec, fromMs: number): number` (smallest gap among the first five occurrences; `Infinity` with fewer than two).

- [ ] **Step 1: Write the failing tests**

Create `apps/office-server/test/time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cronLabel, formatWhen, minIntervalMinutes, nextCron, parseCron, parseUntil } from '../src/company/time.ts';

const T0 = new Date(2026, 9, 7, 14, 10).getTime(); // 7 Eki 2026 14:10 local
const PARK = { maxDays: 30, label: 'Dönüş saati' };

describe('parseUntil', () => {
  it('reads relative minutes, hours and days from now', () => {
    expect(parseUntil('+90m', T0, PARK)).toBe(T0 + 90 * 60_000);
    expect(parseUntil('+6h', T0, PARK)).toBe(T0 + 6 * 3_600_000);
    expect(parseUntil('+1d', T0, PARK)).toBe(T0 + 24 * 3_600_000);
    expect(parseUntil(' +2H ', T0, PARK)).toBe(T0 + 2 * 3_600_000);
  });

  it('reads a local wall-clock time in three spellings', () => {
    const want = new Date(2026, 9, 8, 14, 55).getTime();
    expect(parseUntil('2026-10-08T14:55', T0, PARK)).toBe(want);
    expect(parseUntil('2026-10-08 14:55', T0, PARK)).toBe(want);
    expect(parseUntil('2026-10-08T14:55:30', T0, PARK)).toBe(want + 30_000);
  });

  it('review focus: refuses the past, zero, nonsense, words, a zone suffix and too far ahead — in Turkish, naming the forms', () => {
    for (const bad of ['+0h', '+0m', '2026-10-07T14:10', '2026-10-07T09:00', '2026-13-40T99:99', 'yarın', '2026-10-08T14:55Z', '2026-10-08T14:55+03:00', '+31d', '+745h', '', 'h+2']) {
      expect(() => parseUntil(bad, T0, PARK), bad).toThrow(/Dönüş saati.*(\+6h|2026-10-08T14:55|gelecekte|en fazla 30 gün)/);
    }
    expect(parseUntil('+30d', T0, PARK)).toBe(T0 + 30 * 24 * 3_600_000);
    expect(() => parseUntil('+400d', T0, { maxDays: 365, label: 'Son tarih' })).toThrow(/Son tarih en fazla 365 gün/);
  });
});

describe('formatWhen', () => {
  it('says today, tomorrow, or the day and month; the year only when it differs', () => {
    expect(formatWhen(new Date(2026, 9, 7, 16, 5).getTime(), T0)).toBe('bugün 16:05');
    expect(formatWhen(new Date(2026, 9, 8, 9, 0).getTime(), T0)).toBe('yarın 09:00');
    expect(formatWhen(new Date(2026, 9, 12, 14, 55).getTime(), T0)).toBe('12 Eki 14:55');
    expect(formatWhen(new Date(2027, 0, 3, 8, 30).getTime(), T0)).toBe('3 Oca 2027 08:30');
    expect(formatWhen(new Date(2026, 9, 6, 18, 0).getTime(), T0)).toBe('6 Eki 18:00');
  });
});

describe('cron', () => {
  it('parses the five fields with *, lists, ranges and steps; refuses anything else in Turkish', () => {
    expect(parseCron('0 9 * * 1-5').fields.dow).toEqual([1, 2, 3, 4, 5]);
    expect(parseCron('*/15 * * * *').fields.minute).toEqual([0, 15, 30, 45]);
    expect(parseCron('30 8,18 1,15 * *').fields.hour).toEqual([8, 18]);
    expect(parseCron('0 0 * * 7').fields.dow).toEqual([0]);
    for (const bad of ['0 9 * *', '60 9 * * *', '0 24 * * *', '0 9 32 * *', '0 9 * 13 *', '0 9 * * 8', 'a b c d e', '0 9 * * 1-', '']) {
      expect(() => parseCron(bad), bad).toThrow(/Zamanlama.*5 alan/);
    }
  });

  it('finds the next occurrence strictly after a time, in local time', () => {
    const daily9 = parseCron('0 9 * * *');
    expect(nextCron(daily9, T0)).toBe(new Date(2026, 9, 8, 9, 0).getTime());
    expect(nextCron(daily9, new Date(2026, 9, 8, 9, 0).getTime())).toBe(new Date(2026, 9, 9, 9, 0).getTime());
    expect(nextCron(daily9, new Date(2026, 9, 8, 8, 59, 59).getTime())).toBe(new Date(2026, 9, 8, 9, 0).getTime());
    const weekdays18 = parseCron('0 18 * * 1-5');
    // 7 Eki 2026 is a Wednesday → the same day 18:00; Friday 9 Eki 18:01 → Monday 12 Eki 18:00.
    expect(nextCron(weekdays18, T0)).toBe(new Date(2026, 9, 7, 18, 0).getTime());
    expect(nextCron(weekdays18, new Date(2026, 9, 9, 18, 1).getTime())).toBe(new Date(2026, 9, 12, 18, 0).getTime());
    const monthly = parseCron('0 10 31 * *');
    expect(nextCron(monthly, new Date(2026, 10, 1).getTime())).toBe(new Date(2026, 11, 31, 10, 0).getTime());
    expect(() => nextCron(parseCron('0 0 30 2 *'), T0)).toThrow(/366 gün/);
  });

  it('labels common patterns in Turkish and leaves the rest as cron', () => {
    expect(cronLabel(parseCron('0 9 * * *'))).toBe('her gün 09:00');
    expect(cronLabel(parseCron('30 18 * * 1-5'))).toBe('hafta içi 18:30');
    expect(cronLabel(parseCron('0 10 * * 1'))).toBe('her Pazartesi 10:00');
    expect(cronLabel(parseCron('0 * * * *'))).toBe('her saat');
    expect(cronLabel(parseCron('*/15 * * * *'))).toBe('her 15 dakikada');
    expect(cronLabel(parseCron('0 9 1 * *'))).toBe('her ayın 1’i 09:00');
    expect(cronLabel(parseCron('0 9,17 * * *'))).toBe('0 9,17 * * *');
  });

  it('measures the smallest gap between the first five occurrences', () => {
    expect(minIntervalMinutes(parseCron('*/15 * * * *'), T0)).toBe(15);
    expect(minIntervalMinutes(parseCron('0 9 * * *'), T0)).toBe(24 * 60);
    expect(minIntervalMinutes(parseCron('0 9,10 * * *'), T0)).toBe(60);
    expect(minIntervalMinutes(parseCron('0 0 30 2 *'), T0)).toBe(Number.POSITIVE_INFINITY);
  });
});
```

Create `apps/office-server/test/time-dst.test.ts` (a zone with daylight saving; `TZ` must be set before the first `Date` call in the worker):

```ts
process.env.TZ = 'Europe/Berlin';
import { describe, expect, it } from 'vitest';
import { nextCron, parseCron } from '../src/company/time.ts';

describe('cron across daylight saving (Europe/Berlin)', () => {
  it('skips a wall-clock time that does not exist on the spring-forward day', () => {
    // 29 Mar 2026: 02:00 → 03:00. "30 2 * * *" has no 02:30 that day; the next is 30 Mar 02:30.
    const spec = parseCron('30 2 * * *');
    const after = new Date(2026, 2, 28, 12, 0).getTime();
    const next = new Date(nextCron(spec, after));
    expect([next.getDate(), next.getMonth(), next.getHours(), next.getMinutes()]).toEqual([30, 2, 2, 30]);
  });

  it('fires once, not twice, on the fall-back day', () => {
    // 25 Oct 2026: 03:00 → 02:00; 02:30 happens twice. The first is chosen; the next is the day after.
    const spec = parseCron('30 2 * * *');
    const first = nextCron(spec, new Date(2026, 9, 24, 12, 0).getTime());
    const d = new Date(first);
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([25, 2, 30]);
    const second = new Date(nextCron(spec, first));
    expect([second.getDate(), second.getHours(), second.getMinutes()]).toEqual([26, 2, 30]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/office-server && npx vitest run test/time.test.ts test/time-dst.test.ts`
Expected: FAIL — `Cannot find module '../src/company/time.ts'`.

- [ ] **Step 3: Implement**

Create `apps/office-server/src/company/time.ts`:

```ts
import { ValidationError } from '../errors.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A time an employee or the owner gives (spec §4.2): relative (`+30m`, `+6h`, `+1d`) or a local wall-clock time
 * (`2026-10-08T14:55`, `2026-10-08 14:55`, with optional seconds). No zone: the machine's local time. Must lie in the
 * future and within `maxDays`.
 */
export function parseUntil(value: string, now: number, o: { maxDays: number; label: string }): number {
  const text = (value ?? '').trim();
  const forms = `${o.label} gelecekte bir zaman olmalı: göreli (+30m, +6h, +1d) ya da yerel saat (2026-10-08T14:55 ya da 2026-10-08 14:55)`;
  let at: number;
  const rel = /^\+(\d{1,4})\s*([mhdMHD])$/.exec(text);
  const abs = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2]!.toLowerCase();
    at = now + n * (unit === 'm' ? MINUTE : unit === 'h' ? HOUR : DAY);
  } else if (abs) {
    const [y, mo, d, h, mi, s] = abs.slice(1).map((x) => Number(x ?? 0)) as [number, number, number, number, number, number];
    const date = new Date(y, mo - 1, d, h, mi, s);
    // A rolled-over date (month 13, hour 99) is not the date that was written.
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || date.getHours() !== h || date.getMinutes() !== mi) throw new ValidationError(`${forms}.`);
    at = date.getTime();
  } else {
    throw new ValidationError(`${forms}.`);
  }
  if (at <= now) throw new ValidationError(`${forms}; verilen zaman geçmişte ya da şimdi.`);
  if (at - now > o.maxDays * DAY) throw new ValidationError(`${o.label} en fazla ${o.maxDays} gün ileri olabilir.`);
  return at;
}

/** "bugün 14:55", "yarın 09:00", "12 Eki 14:55", "3 Oca 2027 08:30" — local time, relative to `now`. */
export function formatWhen(ms: number, now: number): string {
  const d = new Date(ms);
  const n = new Date(now);
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay(d, n)) return `bugün ${time}`;
  const tomorrow = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
  if (sameDay(d, tomorrow)) return `yarın ${time}`;
  const year = d.getFullYear() === n.getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year} ${time}`;
}

export interface CronSpec {
  expr: string;
  fields: { minute: number[]; hour: number[]; dom: number[]; month: number[]; dow: number[] };
  /** `*` was given (the field restricts nothing). */
  any: { dom: boolean; dow: boolean };
}

const RANGES = { minute: [0, 59], hour: [0, 23], dom: [1, 31], month: [1, 12], dow: [0, 7] } as const;

function field(name: keyof typeof RANGES, text: string): { values: number[]; any: boolean } {
  const [lo, hi] = RANGES[name];
  const out = new Set<number>();
  let any = false;
  for (const part of text.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(part);
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) throw new Error(part);
    let from = lo;
    let to = hi;
    if (m[1] !== '*') {
      const [a, b] = m[1]!.split('-').map(Number) as [number, number | undefined];
      from = a;
      to = b ?? (m[2] === undefined ? a : hi);
      if (from < lo || to > hi || from > to) throw new Error(part);
    } else if (m[2] === undefined) any = true;
    for (let v = from; v <= to; v += step) out.add(name === 'dow' && v === 7 ? 0 : v);
  }
  return { values: [...out].sort((a, b) => a - b), any };
}

/** Five fields — minute hour day-of-month month day-of-week — with `*`, lists, ranges and steps; 7 = Sunday too. */
export function parseCron(expr: string): CronSpec {
  const parts = (expr ?? '').trim().split(/\s+/);
  const why = 'Zamanlama (cron) 5 alan olmalı: dakika saat ay-günü ay hafta-günü; ör. "0 9 * * 1-5" (hafta içi 09:00).';
  if (parts.length !== 5 || parts.some((p) => p === '')) throw new ValidationError(why);
  try {
    const minute = field('minute', parts[0]!);
    const hour = field('hour', parts[1]!);
    const dom = field('dom', parts[2]!);
    const month = field('month', parts[3]!);
    const dow = field('dow', parts[4]!);
    return { expr: parts.join(' '), fields: { minute: minute.values, hour: hour.values, dom: dom.values, month: month.values, dow: dow.values }, any: { dom: dom.any, dow: dow.any } };
  } catch {
    throw new ValidationError(why);
  }
}

/** Standard cron: when both day fields are restricted, a day matches if either does. */
function dayMatches(spec: CronSpec, d: Date): boolean {
  if (!spec.fields.month.includes(d.getMonth() + 1)) return false;
  const domOk = spec.fields.dom.includes(d.getDate());
  const dowOk = spec.fields.dow.includes(d.getDay());
  if (spec.any.dom && spec.any.dow) return true;
  if (spec.any.dom) return dowOk;
  if (spec.any.dow) return domOk;
  return domOk || dowOk;
}

/**
 * The first occurrence strictly after `afterMs`, in local time. A wall-clock time that does not exist (spring forward)
 * is skipped; one that happens twice (fall back) yields its first instant, so a routine fires at most once for it.
 */
export function nextCron(spec: CronSpec, afterMs: number): number {
  const after = new Date(afterMs);
  // The same wall-clock minute as `after` is never "next": on the fall-back day the repeated hour would fire twice.
  const sameMinute = (d: Date) =>
    d.getFullYear() === after.getFullYear() && d.getMonth() === after.getMonth() && d.getDate() === after.getDate() && d.getHours() === after.getHours() && d.getMinutes() === after.getMinutes();
  for (let dayOffset = 0; dayOffset <= 366; dayOffset += 1) {
    const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + dayOffset);
    if (!dayMatches(spec, day)) continue;
    for (const h of spec.fields.hour) {
      for (const m of spec.fields.minute) {
        const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
        if (candidate.getHours() !== h || candidate.getMinutes() !== m) continue; // does not exist on this day
        if (candidate.getTime() > afterMs && !sameMinute(candidate)) return candidate.getTime();
      }
    }
  }
  throw new ValidationError('Bu zamanlama önümüzdeki 366 gün içinde hiç tetiklenmiyor.');
}

/** The smallest gap between the first five occurrences from `fromMs`, in minutes (Infinity with fewer than two). */
export function minIntervalMinutes(spec: CronSpec, fromMs: number): number {
  const times: number[] = [];
  let t = fromMs;
  for (let i = 0; i < 5; i += 1) {
    try {
      t = nextCron(spec, t);
    } catch {
      break;
    }
    times.push(t);
  }
  let min = Number.POSITIVE_INFINITY;
  for (let i = 1; i < times.length; i += 1) min = Math.min(min, (times[i]! - times[i - 1]!) / MINUTE);
  return min;
}

/** A Turkish label for the common shapes; anything else stays as the cron text. */
export function cronLabel(spec: CronSpec): string {
  const { minute, hour, dom, month, dow } = spec.fields;
  const allDays = spec.any.dom && spec.any.dow && month.length === 12;
  const oneTime = minute.length === 1 && hour.length === 1;
  const time = oneTime ? `${pad(hour[0]!)}:${pad(minute[0]!)}` : '';
  if (oneTime && allDays) return `her gün ${time}`;
  if (oneTime && spec.any.dom && month.length === 12 && dow.join(',') === '1,2,3,4,5') return `hafta içi ${time}`;
  if (oneTime && spec.any.dom && month.length === 12 && dow.length === 1) return `her ${DAYS[dow[0]!]} ${time}`;
  if (oneTime && spec.any.dow && month.length === 12 && dom.length === 1) return `her ayın ${dom[0]}’i ${time}`;
  if (minute.length === 1 && minute[0] === 0 && hour.length === 24 && allDays) return 'her saat';
  if (hour.length === 24 && allDays && minute.length > 1 && minute[0] === 0 && minute.every((m, i) => m === i * minute[1]!) && 60 % minute[1]! === 0) return `her ${minute[1]} dakikada`;
  return spec.expr;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/office-server && npx vitest run test/time.test.ts test/time-dst.test.ts`
Expected: PASS. If the DST file fails because the worker's zone was already fixed, run it alone with `TZ=Europe/Berlin npx vitest run test/time-dst.test.ts`; if that passes, make the test file skip itself when `Intl.DateTimeFormat().resolvedOptions().timeZone !== 'Europe/Berlin'` and add `"test:dst": "TZ=Europe/Berlin vitest run test/time-dst.test.ts"` to `apps/office-server/package.json`, called from the `test` script (`vitest run && pnpm test:dst`).

- [ ] **Step 5: Commit**

```bash
git add apps/office-server/src/company/time.ts apps/office-server/test/time.test.ts apps/office-server/test/time-dst.test.ts apps/office-server/package.json
git commit -m "feat(company): time utilities — until parsing, local-time cron, Turkish labels"
```

---

### Task 3: Park, start time, due date — the company rules and the due-processor for tasks

**Files:**
- Create: `apps/office-server/src/company/scheduling.ts`
- Modify: `apps/office-server/src/company/company.ts`, `apps/office-server/src/company/notices.ts`, `apps/office-server/src/company/dispatcher.ts`
- Modify: `apps/office-server/test/company-helpers.ts` (`schedules`, `scheduling` in `companyFor`)
- Test: `apps/office-server/test/park.test.ts` (new), `apps/office-server/test/scheduling.test.ts` (new), `apps/office-server/test/dispatcher.test.ts`

**Interfaces:**
- Consumes: Task 1 stores and types; Task 2 `parseUntil`, `formatWhen`.
- Produces: `TaskInput.startAfter?: string | null`, `TaskInput.dueAt?: string | null`; `Company.attachClock(clock: { touch(): void }): void` (every `this.#d.clock?.touch()` below reads `this.#clock ?? this.#d.clock`; add a private `#clock: { touch(): void } | null = null` field); `Company.parkTask(by: string, taskId: string, until: string, reason: string): Task`; `Company.unparkTask(by: string, taskId: string, o?: { priority?: number }): Task`; `Company.ownerPrioritize(taskId: string): Task`; `Company.returnFromPark(taskId: string, now: number): Task | null` (used by Scheduling); `CompanyDeps.clock?: { touch(): void }`; `CompanyDeps.schedules?: ScheduleStore`; `Scheduling` class (`constructor(d: SchedulingDeps)`, `nextDueAt(now?): number | null`, `runDue(now?): DueReport`) — routines are wired in Task 6, this task handles parked returns and overdue; notice topics `task.parked`, `task.reparked` (decision), `task.overdue`, `agenda.owner_changed` (info); `PARK_MAX_DAYS = 30`, `DUE_MAX_DAYS = 365`, `REPARK_LIMIT = 3` exported from `scheduling.ts`.

- [ ] **Step 1: Write the failing tests**

Create `apps/office-server/test/park.test.ts`:

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

const T0 = new Date(2026, 9, 7, 14, 10).getTime();

function make() {
  let clock = T0;
  const now = () => clock;
  const s = setup(8, now);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, undefined, now);
  const coordinator = c.company.hireCoordinator('sonnet');
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r', team: 'İçerik' });
  const can = c.company.hire(coordinator.id, { name: 'Can', role: 'r', team: 'İçerik' });
  const plan = c.company.propose(coordinator.id, { title: 'P', goal: 'g', approach: 'a', method: METHOD });
  c.company.approve(plan.id);
  const topics = (id: string) => c.notices.pending(id).map((n) => `${n.kind} ${n.topic}`);
  return { ...s, ...c, coordinator, ada, can, plan, topics, advance: (ms: number) => (clock += ms) };
}

describe('park (spec §4.2)', () => {
  it('the assignee parks their running task until a time with a reason: status parked, the slot free, the clock touched', () => {
    const t = make();
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Adım 1 penceresi', planId: t.plan.id });
    t.company.start(task.id);
    const parked = t.company.parkTask(t.ada.id, task.id, '2026-10-08T14:55', 'ölçüm penceresi dolsun');
    expect(parked).toMatchObject({ status: 'parked', notBefore: new Date(2026, 9, 8, 14, 55).getTime(), parkedReason: 'ölçüm penceresi dolsun', parkCount: 1, startedAt: null, nudged: false });
    expect(t.tasks.inProgressOf(t.ada.id)).toBeNull();
    expect(t.tasks.openInPlan(t.plan.id)).toBe(1);
    expect(t.touched).toBeGreaterThan(0);
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'task.changed' && e.event.change === 'parked')).toBe(true);
    expect(t.topics(t.ada.id)).not.toContain('decision task.parked');
  });

  it('someone else parking a started task tells the doer to stop; a waiting task parked tells no one', () => {
    const t = make();
    const running = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'süren' });
    t.company.start(running.id);
    t.company.parkTask(t.coordinator.id, running.id, '+6h', 'yarına');
    expect(t.notices.pending(t.ada.id).find((n) => n.topic === 'task.parked')?.text).toMatch(/bırak/);
    const waiting = t.company.createTask(t.coordinator.id, { assignee: t.can.id, title: 'bekleyen' });
    t.company.parkTask(t.coordinator.id, waiting.id, '+1d', 'önce diğeri');
    expect(t.topics(t.can.id)).toEqual([]);
  });

  it('refuses parking a review, a hand-over, a closed task, or by someone with no say; and a bad until', () => {
    const t = make();
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'incelemeli', reviewer: t.can.id });
    t.company.finish(t.ada.id, task.id, { summary: 'bitti', outputs: [], learned: '' });
    expect(() => t.company.parkTask(t.ada.id, task.id, '+1h', 'x')).toThrow(/incelemede/);
    const handover = t.company.beginHandover(t.can.id);
    expect(() => t.company.parkTask(t.can.id, handover.id, '+1h', 'x')).toThrow(/Devir/);
    const other = t.company.createTask(t.coordinator.id, { assignee: t.can.id, title: 'başkasının' });
    expect(() => t.company.parkTask(t.ada.id, other.id, '+1h', 'x')).toThrow(/Yalnız/);
    expect(() => t.company.parkTask(t.can.id, other.id, 'yarın', 'x')).toThrow(/Dönüş saati/);
    expect(() => t.company.parkTask(t.can.id, other.id, '+1h', ' ')).toThrow(/Gerekçe/);
    t.company.finish(t.can.id, other.id, { summary: 'bitti', outputs: [], learned: '' });
    expect(() => t.company.parkTask(t.can.id, other.id, '+1h', 'x')).toThrow(/kapandı/);
  });

  it('the third park tells the coordinator the task keeps being deferred', () => {
    const t = make();
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'ertelenen' });
    for (let i = 1; i <= 3; i += 1) {
      t.company.parkTask(t.ada.id, task.id, '+1h', `erteleme ${i}`);
      t.advance(2 * 3_600_000);
      expect(t.company.returnFromPark(task.id, T0 + i * 2 * 3_600_000)?.status).toBe('waiting');
    }
    expect(t.tasks.get(task.id).parkCount).toBe(3);
    const stuck = t.notices.pending(t.coordinator.id).find((n) => n.topic === 'task.reparked');
    expect(stuck?.kind).toBe('decision');
    expect(stuck?.text).toContain('ertelenen');
  });

  it('unpark brings a parked or start-timed task back now; the owner’s release also makes it priority 1; running and review tasks are refused', () => {
    const t = make();
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'parklı' });
    t.company.parkTask(t.ada.id, task.id, '+1d', 'bekle');
    expect(() => t.company.unparkTask(t.ada.id, task.id)).toThrow(/Yalnız koordinatör/);
    expect(t.company.unparkTask(t.coordinator.id, task.id)).toMatchObject({ status: 'waiting', notBefore: null, priority: 3 });
    const timed = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'saatli', startAfter: '+2h' });
    expect(timed.notBefore).toBe(T0 + 2 * 3_600_000);
    expect(t.tasks.nextFor(t.ada.id)?.id).toBe(task.id);
    expect(t.company.unparkTask(OWNER, timed.id, { priority: 1 })).toMatchObject({ status: 'waiting', notBefore: null, priority: 1 });
    expect(t.tasks.nextFor(t.ada.id)?.id).toBe(timed.id);
    expect(t.notices.pending(t.coordinator.id).find((n) => n.topic === 'agenda.owner_changed')?.kind).toBe('info');
    t.company.start(timed.id);
    expect(() => t.company.unparkTask(OWNER, timed.id)).toThrow(/sürüyor|park edilmiş/);
  });

  it('a due date orders the queue and, once past, tells the coordinator exactly once', () => {
    const t = make();
    const late = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'geç', dueAt: '+5d' });
    const soon = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'yakın', dueAt: '+1h' });
    expect(t.tasks.nextFor(t.ada.id)?.id).toBe(soon.id);
    expect(() => t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'x', dueAt: '+400d' })).toThrow(/Son tarih en fazla 365 gün/);
    t.advance(2 * 3_600_000);
    expect(t.scheduling.runDue().overdue).toEqual([soon.id]);
    expect(t.notices.pending(t.coordinator.id).filter((n) => n.topic === 'task.overdue')).toHaveLength(1);
    expect(t.scheduling.runDue().overdue).toEqual([]);
    expect(late.dueAt).toBe(T0 + 5 * 24 * 3_600_000);
  });

  it('the owner’s prioritize makes a waiting task priority 1 and tells the coordinator', () => {
    const t = make();
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'öne' });
    expect(t.company.ownerPrioritize(task.id).priority).toBe(1);
    expect(t.notices.pending(t.coordinator.id).some((n) => n.topic === 'agenda.owner_changed' && n.text.includes('öne'))).toBe(true);
  });

  it('a parked task is released to the coordinator when its holder is let go, and cancelled when its plan is stopped', () => {
    const t = make();
    const a = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'A', planId: t.plan.id });
    t.company.parkTask(t.ada.id, a.id, '+1d', 'bekle');
    t.company.releaseTasksOf(t.ada.id);
    expect(t.tasks.get(a.id)).toMatchObject({ status: 'waiting', notBefore: T0 + 24 * 3_600_000 });
    expect(t.notices.pending(t.coordinator.id).find((n) => n.topic === 'task.orphaned')?.text).toContain('A');
    const b = t.company.createTask(t.coordinator.id, { assignee: t.can.id, title: 'B', planId: t.plan.id });
    t.company.parkTask(t.can.id, b.id, '+1d', 'bekle');
    t.company.stopPlan(t.plan.id);
    expect(t.tasks.get(b.id).status).toBe('cancelled');
  });
});
```

Create `apps/office-server/test/scheduling.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const T0 = new Date(2026, 9, 7, 14, 10).getTime();
const HOUR = 3_600_000;

function make() {
  let clock = T0;
  const now = () => clock;
  const s = setup(8, now);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, undefined, now);
  const coordinator = c.company.hireCoordinator('sonnet');
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r' });
  return { ...s, ...c, coordinator, ada, advance: (ms: number) => (clock += ms) };
}

describe('Scheduling.runDue — tasks (spec §5)', () => {
  it('returns parked tasks whose time came, each exactly once, and reports them', () => {
    const t = make();
    const a = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'A' });
    const b = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'B' });
    t.company.parkTask(t.ada.id, a.id, '+1h', 'a');
    t.company.parkTask(t.ada.id, b.id, '+3h', 'b');
    expect(t.scheduling.nextDueAt()).toBe(T0 + HOUR);
    expect(t.scheduling.runDue().returned).toEqual([]);
    t.advance(HOUR);
    expect(t.scheduling.runDue().returned).toEqual([a.id]);
    expect(t.tasks.get(a.id)).toMatchObject({ status: 'waiting', notBefore: null, parkedReason: null });
    expect(t.scheduling.runDue().returned).toEqual([]);
    expect(t.scheduling.nextDueAt()).toBe(T0 + 3 * HOUR);
    expect(t.events.list({ limit: 500 }).filter((e) => e.event.type === 'task.changed' && e.event.change === 'returned')).toHaveLength(1);
  });

  it('a new Scheduling on the same database catches up once after a long gap', () => {
    const t = make();
    const a = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'A' });
    t.company.parkTask(t.ada.id, a.id, '+1h', 'a');
    t.advance(50 * HOUR);
    const report = t.freshScheduling().runDue();
    expect(report.returned).toEqual([a.id]);
    expect(t.freshScheduling().runDue().returned).toEqual([]);
  });

  it('review focus: while the company is paused a parked task still returns to waiting (delivery is the dispatcher’s, and it hands out nothing)', () => {
    const t = make();
    const a = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'A' });
    t.company.parkTask(t.ada.id, a.id, '+1h', 'a');
    t.company.pause();
    t.advance(HOUR);
    expect(t.scheduling.runDue().returned).toEqual([a.id]);
    expect(t.tasks.get(a.id).status).toBe('waiting');
  });

  it('one failing item does not stop the others; the failure is in the log', () => {
    const t = make();
    const a = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'A' });
    const b = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'B' });
    t.company.parkTask(t.ada.id, a.id, '+1h', 'a');
    t.company.parkTask(t.ada.id, b.id, '+1h', 'b');
    t.advance(HOUR);
    t.breakReturnOf(a.id);
    const report = t.scheduling.runDue();
    expect(report.returned).toEqual([b.id]);
    expect(report.errors).toHaveLength(1);
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'clock.error' && e.event.job.includes(a.id))).toBe(true);
  });
});
```

`companyFor` must return `scheduling`, `freshScheduling()`, `touched` (a counter the fake clock increments) and `breakReturnOf(taskId)` (makes `company.returnFromPark` throw for that id — see Step 3).

In `apps/office-server/test/dispatcher.test.ts` append:

```ts
describe('Dispatcher — time', () => {
  it('does not hand out a task before its start time; a parked task frees the slot and the next task is delivered', async () => {
    const s = setup();
    const f = fakeEngine(s);
    const c = companyFor(s, f);
    const dispatcher = new Dispatcher({ events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine: f.engine, budget: c.budget });
    const stop = dispatcher.start();
    cleanups.push(stop, f.cleanup, s.cleanup);
    const ada = c.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const timed = c.company.createTask(OWNER, { assignee: ada.id, title: 'Saatli iş', startAfter: '+1d' });
    const first = c.company.createTask(OWNER, { assignee: ada.id, title: 'İlk iş' });
    await waitFor(s.events, (e) => e.employeeId === ada.id && e.event.type === 'message.user' && e.event.text.includes('İlk iş'));
    expect(c.tasks.get(timed.id).status).toBe('waiting');
    const second = c.company.createTask(OWNER, { assignee: ada.id, title: 'İkinci iş' });
    c.company.parkTask(ada.id, first.id, '+2h', 'pencere');
    await waitFor(s.events, (e) => e.employeeId === ada.id && e.event.type === 'message.user' && e.event.text.includes('İkinci iş'));
    expect(c.tasks.get(second.id).status).toBe('in_progress');
    expect(c.tasks.get(first.id).status).toBe('parked');
    const text = (s.events.list({ limit: 5000 }).findLast((e) => e.employeeId === ada.id && e.event.type === 'message.user')!.event as { text: string }).text;
    expect(text).not.toContain('Son tarih');
  });

  it('names the due date and the start time in the delivery when they are set', async () => {
    const s = setup();
    const f = fakeEngine(s);
    const c = companyFor(s, f);
    const stop = new Dispatcher({ events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine: f.engine, budget: c.budget }).start();
    cleanups.push(stop, f.cleanup, s.cleanup);
    const ada = c.company.hire(OWNER, { name: 'Ada', role: 'r' });
    c.company.createTask(OWNER, { assignee: ada.id, title: 'Tarihli', dueAt: '+2d' });
    const msg = await waitFor(s.events, (e) => e.employeeId === ada.id && e.event.type === 'message.user' && e.event.text.includes('Tarihli'));
    expect((msg.event as { text: string }).text).toMatch(/Son tarih: .*\d\d:\d\d/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/office-server && npx vitest run test/park.test.ts test/scheduling.test.ts`
Expected: FAIL — `parkTask is not a function`, `t.scheduling` undefined.

- [ ] **Step 3: Test helper**

In `apps/office-server/test/company-helpers.ts`: import `ScheduleStore` with the other stores and `Scheduling` from `../src/company/scheduling.ts`; in `companyFor` create `const schedules = new ScheduleStore(s.db, now);`, a fake clock `let touched = 0; const clock = { touch: () => void (touched += 1) };`, pass `schedules, clock` to `new Company({...})`, then:

```ts
  const scheduling = new Scheduling({ db: s.db, tasks, schedules, notices, company, state, events: s.events, constitution: () => budget.constitution(), now });
  const freshScheduling = () => new Scheduling({ db: s.db, tasks, schedules, notices, company, state, events: s.events, constitution: () => budget.constitution(), now });
  /** Makes the return of one task throw (a failing due item for the clock tests). */
  const breakReturnOf = (taskId: string) => {
    const real = company.returnFromPark.bind(company);
    company.returnFromPark = (id: string, at: number) => {
      if (id === taskId) throw new Error('bozuk dönüş');
      return real(id, at);
    };
  };
```

and return `schedules, scheduling, freshScheduling, breakReturnOf, get touched() { return touched; }` alongside the rest (the `touched` getter must read the live counter: return an object literal with a getter, or expose `touches: () => touched` — the tests use `t.touched`, so use a getter).

- [ ] **Step 4: Notice topics**

In `apps/office-server/src/company/notices.ts` add to `NOTICE_TOPICS` (before `'report.reminder'`):

```ts
  /** Someone else parked the task you were working on: stop until it comes back. */
  'task.parked': 'decision',
  /** The same task was parked a third time: is it real work? */
  'task.reparked': 'decision',
  /** A task passed its due date (the coordinator hears once). */
  'task.overdue': 'info',
  /** The owner changed the agenda from the sheet (released, parked, prioritized, a routine paused…). */
  'agenda.owner_changed': 'info',
```

and a digest group after `İncelemeler`: `{ title: 'Ajanda', topics: ['task.overdue', 'agenda.owner_changed'] },`.

- [ ] **Step 5: Company**

In `apps/office-server/src/company/company.ts`:

Imports: add `import { formatWhen, parseUntil } from './time.ts';`, `import { DUE_MAX_DAYS, PARK_MAX_DAYS, REPARK_LIMIT } from './scheduling.ts';`, and `ScheduleStore` to the type import from `./store.ts`. `CompanyDeps` gains:

```ts
  /** Routines (stage: scheduler; absent in tests that do not care). */
  schedules?: ScheduleStore;
  /** The office clock: told when a time changed, so it re-arms (absent in tests that do not care). */
  clock?: { touch(): void };
```

`TaskInput` gains:

```ts
  /** Not handed out before this time (spec §4.1): `+6h`, `+1d` or a local `2026-10-08T14:55`. */
  startAfter?: string | null;
  /** Should be done by this time (spec §4.3); same forms. */
  dueAt?: string | null;
```

In `createTask`, before `const reviewer = …`:

```ts
    const now = this.#now();
    const notBefore = input.startAfter ? parseUntil(input.startAfter, now, { maxDays: DUE_MAX_DAYS, label: 'Başlangıç saati' }) : null;
    const dueAt = input.dueAt ? parseUntil(input.dueAt, now, { maxDays: DUE_MAX_DAYS, label: 'Son tarih' }) : null;
    if (notBefore !== null && dueAt !== null && dueAt < notBefore) throw new ValidationError('Son tarih başlangıç saatinden önce olamaz.');
```

and pass `notBefore, dueAt` to `tasks.create`; after `this.#taskEvent('created', task);` add `if (notBefore !== null || dueAt !== null) this.#d.clock?.touch();`.

Every open-status list in `company.ts` that reads `['waiting', 'in_progress', 'blocked']` or `['waiting', 'in_progress', 'review', 'blocked']` gains `'parked'` — `releaseTasksOf` (both the work loop and, in Task 5-era code, the hand-over lookup in `beginHandover` stays as is: a hand-over is never parked), `stopPlan`. In `releaseTasksOf`'s loop, a parked task becomes `waiting` and **keeps** `notBefore`:

```ts
      if (task.status !== 'waiting') this.#taskEvent('updated', this.#d.tasks.update(task.id, { status: 'waiting', startedAt: null, nudged: false, parkedReason: null }));
```

(the `notBefore` is untouched by this patch, so a parked task's return time stays as its start time).

Add a time section after `reprioritize`:

```ts
  // ── time (spec §4) ────────────────────────────────────────────────────────

  /**
   * Sets a task aside until a time (spec §4.2): by the one doing it, the coordinator, a lead for their team, or the
   * owner. The task stays open but holds no one's slot; the clock brings it back.
   */
  parkTask(by: string, taskId: string, until: string, reason: string): Task {
    const task = this.#d.tasks.get(taskId);
    if (by !== OWNER && task.assignee !== by) this.#assertManages(by, task.assignee);
    if (task.kind === 'handover') throw new ConflictError('Devir görevi park edilemez.');
    if (task.status === 'done' || task.status === 'cancelled') throw new ConflictError('Bu görev kapandı; park edilemez.');
    if (task.status === 'review') throw new ConflictError('Bu görev incelemede; kararı inceleyici verir, park edilemez.');
    const now = this.#now();
    const notBefore = parseUntil(until, now, { maxDays: PARK_MAX_DAYS, label: 'Dönüş saati' });
    const why = clean(reason, 'Gerekçe', 500, true);
    const wasStarted = task.status === 'in_progress' || task.status === 'blocked';
    const parkCount = (task.parkCount ?? 0) + 1;
    const next = this.#d.tasks.update(taskId, { status: 'parked', notBefore, parkedReason: why, parkCount, startedAt: null, nudged: false });
    this.#taskEvent('parked', next);
    const when = formatWhen(notBefore, now);
    if (wasStarted && by !== task.assignee) {
      this.#d.notices.add(task.assignee, 'task.parked', `“${task.title}” görevi (no ${task.id}) ${by === OWNER ? 'sahibi' : this.nameOf(by)} tarafından ${when}'e ertelendi (${why}). Üzerinde çalışmayı bırak; saatinde geri gelecek.`);
    }
    if (by === OWNER) this.#tellOwnerChanged(`Sahibi “${task.title}” görevini ${when}'e erteledi: ${why}.`);
    if (parkCount >= REPARK_LIMIT) {
      this.#tellCoordinator('', 'task.reparked', `“${task.title}” görevi (no ${task.id}) ${parkCount}. kez ertelendi (son gerekçe: ${why}). Gerçek bir iş mi, bölünmeli mi, iptal mi — karar ver.`);
    }
    this.#d.clock?.touch();
    return next;
  }

  /** The time came (the clock): the parked task waits in its queue again — once, and only if still parked and due. */
  returnFromPark(taskId: string, now: number): Task | null {
    if (!this.#d.tasks.returnParked(taskId, now)) return null;
    const next = this.#d.tasks.update(taskId, { parkedReason: null });
    this.#taskEvent('returned', next);
    return next;
  }

  /** Brings a parked or start-timed task back now (coordinator, lead, owner); the owner's release also puts it first. */
  unparkTask(by: string, taskId: string, o: { priority?: number } = {}): Task {
    const task = this.#d.tasks.get(taskId);
    if (by !== OWNER) this.#assertManages(by, task.assignee);
    if (task.status === 'in_progress' || task.status === 'blocked') throw new ConflictError('Bu görev zaten sürüyor; park edilmiş değil.');
    if (task.status !== 'parked' && !(task.status === 'waiting' && task.notBefore !== null && task.notBefore !== undefined)) {
      throw new ConflictError('Bu görev park edilmiş ya da başlangıç saatli değil.');
    }
    if (o.priority !== undefined && (!Number.isInteger(o.priority) || o.priority < 1 || o.priority > 5)) throw new ValidationError('Öncelik 1 ile 5 arasında bir tam sayı olmalı.');
    const next = this.#d.tasks.update(taskId, { status: 'waiting', notBefore: null, parkedReason: null, startedAt: null, nudged: false, ...(o.priority !== undefined ? { priority: o.priority } : {}) });
    this.#taskEvent('returned', next);
    if (by === OWNER) this.#tellOwnerChanged(`Sahibi “${task.title}” görevini şimdi başlattı${o.priority === 1 ? ' (öncelik 1)' : ''}.`);
    this.#d.clock?.touch();
    return next;
  }

  /** The owner's "Öne al": priority 1, the time untouched. */
  ownerPrioritize(taskId: string): Task {
    const task = this.#d.tasks.get(taskId);
    if (task.status === 'done' || task.status === 'cancelled') throw new ConflictError('Bu görev kapandı.');
    const next = this.#d.tasks.update(taskId, { priority: 1 });
    this.#taskEvent('reprioritized', next);
    this.#tellOwnerChanged(`Sahibi “${task.title}” görevini öne aldı (öncelik 1).`);
    return next;
  }

  /** The clock is built after the company (it needs the scheduling service, which needs the company): attached here. */
  attachClock(clock: { touch(): void }): void {
    this.#clock = clock;
  }

  /** What the owner changed from the sheet: the coordinator hears, for the record. */
  #tellOwnerChanged(text: string): void {
    const c = this.coordinator();
    if (c) this.#d.notices.add(c.id, 'agenda.owner_changed', text);
  }
```

(`#tellCoordinator('', …)` with an empty `about` reaches the coordinator even when the coordinator is the one parking — the brake must always be heard.)

- [ ] **Step 6: The due-processor (tasks)**

Create `apps/office-server/src/company/scheduling.ts`:

```ts
import type { Constitution } from '@cc/shared';
import { DEFAULT_CONSTITUTION } from '@cc/shared';
import type { Db } from '../db.ts';
import type { EventStore } from '../event-store.ts';
import type { Company } from './company.ts';
import type { CompanyStateStore } from './goal-store.ts';
import type { NoticeStore, ScheduleStore, TaskStore } from './store.ts';
import { formatWhen } from './time.ts';

/** A park may reach this far ahead (spec §4.2). */
export const PARK_MAX_DAYS = 30;
/** A due date or start time may reach this far ahead. */
export const DUE_MAX_DAYS = 365;
/** From this many parks on, the coordinator decides whether the task is real work (spec §4.2). */
export const REPARK_LIMIT = 3;

export interface SchedulingDeps {
  db: Db;
  tasks: TaskStore;
  schedules: ScheduleStore;
  notices: NoticeStore;
  company: Company;
  state: CompanyStateStore;
  events: EventStore;
  constitution?: () => Constitution;
  now?: () => number;
}

/** What one run of the due-processor did. */
export interface DueReport {
  /** Tasks that came back from park. */
  returned: string[];
  /** Routines that opened a task. */
  fired: string[];
  /** Routines skipped because their previous instance was still open. */
  skipped: string[];
  /** Tasks whose due date passed (the coordinator was told). */
  overdue: string[];
  /** "<job>: <message>" for each item that failed; the run went on. */
  errors: string[];
}

/**
 * The scheduling service (spec §4, §5): the rules of time over the task store, and the processor the clock runs.
 * It never delivers anything itself; it changes states, and the dispatcher's own rules do the rest.
 */
export class Scheduling {
  readonly #d: SchedulingDeps;
  readonly #now: () => number;

  constructor(d: SchedulingDeps) {
    this.#d = d;
    this.#now = d.now ?? Date.now;
  }

  /** The nearest future time anything needs the clock, or null. */
  nextDueAt(now: number = this.#now()): number | null {
    const candidates = [this.#d.tasks.nextDueAt(now), this.#d.schedules.nextRunAt()].filter((t): t is number => t !== null && t > now);
    return candidates.length ? Math.min(...candidates) : null;
  }

  /** Everything due at `now`, each item on its own: a failure is logged and skipped. */
  runDue(now: number = this.#now()): DueReport {
    const report: DueReport = { returned: [], fired: [], skipped: [], overdue: [], errors: [] };
    const guard = (job: string, fn: () => void) => {
      try {
        fn();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        report.errors.push(`${job}: ${message}`);
        this.#d.events.append(null, { type: 'clock.error', job, message: message.slice(0, 500) });
      }
    };
    for (const task of this.#d.tasks.dueParked(now)) {
      guard(`park-return ${task.id}`, () => {
        if (this.#d.company.returnFromPark(task.id, now)) report.returned.push(task.id);
      });
    }
    for (const task of this.#d.tasks.overdueUnnotified(now)) {
      guard(`overdue ${task.id}`, () => {
        this.#d.tasks.markOverdueNotified(task.id);
        const c = this.#d.company.coordinator();
        if (c) this.#d.notices.add(c.id, 'task.overdue', `“${task.title}” görevinin (no ${task.id}, ${this.#d.company.nameOf(task.assignee)}) son tarihi geçti: ${formatWhen(task.dueAt ?? now, now)}.`);
        report.overdue.push(task.id);
      });
    }
    this.runSchedules(now, report, guard);
    this.#d.state.set('clock.lastRunAt', String(now));
    return report;
  }

  /** Routines come in Task 6; until then nothing here is due. */
  protected runSchedules(_now: number, _report: DueReport, _guard: (job: string, fn: () => void) => void): void {}

  protected rules(): Constitution {
    return this.#d.constitution?.() ?? DEFAULT_CONSTITUTION;
  }

  protected get deps(): SchedulingDeps {
    return this.#d;
  }
}
```

(`protected` is a TypeScript-only modifier and is stripped; keep it, it documents intent and compiles under type stripping.)

- [ ] **Step 7: Dispatcher**

In `apps/office-server/src/company/dispatcher.ts`: import `formatWhen` from `./time.ts`. In `#consider`, the hand-over lookup keeps its list (a hand-over is never parked). In `#remindReport`, `open` reads `statuses: ['waiting', 'in_progress', 'review', 'blocked', 'parked']`. In `#delivery`, after `const level = …` add:

```ts
    const due = task.dueAt ? `\nSon tarih: ${formatWhen(task.dueAt, this.#now())}` : '';
```

and put `${due}` right after `${level}` in the header line (`… · Öncelik: ${task.priority}${level}${due}${reviewer}${deps}${brief}`). No other text changes.

- [ ] **Step 8: Run the whole server suite**

Run: `cd apps/office-server && npx vitest run > /tmp/cc-sched-t3.log 2>&1; tail -8 /tmp/cc-sched-t3.log; cd ../.. && pnpm -r --if-present typecheck`
Expected: all pass (the economy golden is untouched: no time field is set in that scenario); typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add apps/office-server/src apps/office-server/test
git commit -m "feat(company): park a task until a time, start it after one, give it a due date — without holding anyone's slot"
```

---

### Task 4: The Clock service

**Files:**
- Create: `apps/office-server/src/company/clock.ts`
- Modify: `apps/office-server/src/company/dispatcher.ts` (`tick()`, clock registration), `apps/office-server/src/main.ts`
- Test: `apps/office-server/test/clock.test.ts` (new), `apps/office-server/test/dispatcher.test.ts`

**Interfaces:**
- Consumes: `Scheduling.nextDueAt / runDue` (Task 3), `CompanyStateStore`, `EventStore`.
- Produces: `class Clock` — `constructor(d: ClockDeps)`, `start(): () => void` (runs due items at once, arms), `touch(): void` (re-arm now), `every(name: string, ms: number, fn: () => void): void` (a periodic job; first run on `start()`), `onRan(fn: (report: DueReport) => void): void`, `status(now?): ClockStatus`, `runNow(): DueReport` (for tests and the API); `ClockDeps = { scheduling: Scheduling; state: CompanyStateStore; events: EventStore; label?: (now: number) => string | null; now?: () => number; timers?: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }; safetyMs?: number /* default 60_000 */; jumpMs?: number /* default 120_000 */ }`; `DispatcherDeps.clock?: { every(name: string, ms: number, fn: () => void): void; onRan(fn: () => void): void }`; `Dispatcher.tick(): void` (public).

- [ ] **Step 1: Write the failing tests**

Create `apps/office-server/test/clock.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { Clock } from '../src/company/clock.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const T0 = new Date(2026, 9, 7, 14, 10).getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;

/** Fake timers: one pending callback at most (the clock keeps one), fired by advancing the clock. */
function make() {
  let clock = T0;
  const now = () => clock;
  const s = setup(8, now);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, undefined, now);
  let pending: { fn: () => void; at: number } | null = null;
  const timers = {
    set: (fn: () => void, ms: number) => {
      pending = { fn, at: clock + ms };
      return pending;
    },
    clear: () => {
      pending = null;
    },
  };
  const coordinator = c.company.hireCoordinator('sonnet');
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r' });
  // A long safety interval, so the tests see the due times and the jobs, not the safety tick.
  const newClock = (o: { safetyMs?: number } = {}) => new Clock({ scheduling: c.scheduling, state: c.state, events: s.events, now, timers, safetyMs: o.safetyMs ?? 60 * MIN, label: (at) => (c.scheduling.nextDueAt(at) ? 'bir şey' : null) });
  /** Moves time forward and fires the pending timer if its time came (like a real timer would). */
  const advance = (ms: number) => {
    clock += ms;
    if (pending && pending.at <= clock) {
      const p = pending;
      pending = null;
      p.fn();
    }
  };
  return { ...s, ...c, coordinator, ada, newClock, advance, armedAt: () => pending?.at ?? null, jump: (ms: number) => void (clock += ms) };
}

describe('Clock (spec §5)', () => {
  it('arms to the nearest due time, at most the safety interval away, and re-arms on touch', () => {
    const t = make();
    const clock = t.newClock();
    cleanups.push(clock.start());
    expect(t.armedAt()).toBe(T0 + 60 * MIN);
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'A' });
    t.company.parkTask(t.ada.id, task.id, '+5m', 'kısa'); // parkTask touches the test helper's fake clock, not this one
    clock.touch();
    expect(t.armedAt()).toBe(T0 + 5 * MIN);
    t.advance(5 * MIN);
    expect(t.tasks.get(task.id).status).toBe('waiting');
    expect(t.armedAt()).toBe(T0 + 5 * MIN + 60 * MIN);
    expect(clock.status().lastRunAt).toBe(T0 + 5 * MIN);
  });

  it('runs due items at start (catch-up after a restart) and reports what it did to listeners', () => {
    const t = make();
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'A' });
    t.company.parkTask(t.ada.id, task.id, '+1h', 'uzun');
    t.jump(5 * HOUR);
    const ran: string[][] = [];
    const clock = t.newClock();
    clock.onRan((r) => ran.push(r.returned));
    cleanups.push(clock.start());
    expect(ran).toEqual([[task.id]]);
    expect(t.tasks.get(task.id).status).toBe('waiting');
  });

  it('runs periodic jobs on their interval and never lets one failing job stop the others or the clock', () => {
    const t = make();
    const clock = t.newClock({ safetyMs: 60 * MIN });
    const log: string[] = [];
    let a = 0;
    clock.every('a', 10 * MIN, () => void log.push(`a${(a += 1)}`));
    clock.every('boom', 10 * MIN, () => {
      throw new Error('kötü iş');
    });
    clock.every('b', 30 * MIN, () => void log.push('b'));
    cleanups.push(clock.start());
    expect(log).toEqual(['a1', 'b']);
    t.advance(10 * MIN);
    expect(log).toEqual(['a1', 'b', 'a2']);
    t.advance(10 * MIN);
    t.advance(10 * MIN);
    expect(log.filter((x) => x === 'b')).toHaveLength(2);
    expect(t.events.list({ limit: 500 }).filter((e) => e.event.type === 'clock.error' && e.event.job === 'boom').length).toBeGreaterThanOrEqual(2);
  });

  it('notes a jump when it wakes more than two minutes late, and still processes what became due', () => {
    const t = make();
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'A' });
    t.company.parkTask(t.ada.id, task.id, '+30m', 'x');
    const clock = t.newClock();
    cleanups.push(clock.start());
    clock.touch();
    // The machine slept: the timer fires 3 hours after the moment it was armed for.
    t.jump(3 * HOUR);
    t.advance(0);
    expect(t.tasks.get(task.id).status).toBe('waiting');
    expect(clock.status().lastJumpAt).toBe(T0 + 3 * HOUR);
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'clock.jumped')).toBe(true);
    expect(t.state.get('clock.lastJumpAt')).toBe(String(T0 + 3 * HOUR));
  });

  it('status names the next due time and label', () => {
    const t = make();
    const clock = t.newClock();
    cleanups.push(clock.start());
    expect(clock.status()).toMatchObject({ nextDueAt: null, nextDueLabel: null });
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'A' });
    t.company.parkTask(t.ada.id, task.id, '+2h', 'x');
    expect(clock.status()).toMatchObject({ nextDueAt: T0 + 2 * HOUR, nextDueLabel: 'bir şey' });
  });
});
```

In `apps/office-server/test/dispatcher.test.ts` append to the `Dispatcher — time` block:

```ts
  it('with a clock, the dispatcher’s tick is a clock job and a park return sweeps: a sleeping employee is woken when their task comes back', async () => {
    let now = Date.now();
    const s = setup(8, () => now);
    const f = fakeEngine(s, { engine: { now: () => now } });
    const c = companyFor(s, f, undefined, () => now);
    let pending: (() => void) | null = null;
    const timers = { set: (fn: () => void) => ((pending = fn), 1), clear: () => void (pending = null) };
    const clock = new Clock({ scheduling: c.scheduling, state: c.state, events: s.events, now: () => now, timers });
    const dispatcher = new Dispatcher({ events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine: f.engine, budget: c.budget, clock, now: () => now });
    cleanups.push(dispatcher.start(), clock.start(), f.cleanup, s.cleanup);
    const ada = c.company.hire(OWNER, { name: 'Ada', role: 'r' });
    await until(() => f.engine.ready(ada.id), 8000);
    const task = c.company.createTask(OWNER, { assignee: ada.id, title: 'Parklı' });
    await until(() => c.tasks.get(task.id).status === 'in_progress', 8000);
    c.company.parkTask(ada.id, task.id, '+1h', 'bekle');
    await f.engine.sleep(ada.id);
    expect(s.roster.get(ada.id).lifecycle).toBe('sleeping');
    now += 61 * 60_000;
    pending?.(); // the clock's timer fires
    await until(() => s.roster.get(ada.id).lifecycle !== 'sleeping', 8000);
    await until(() => c.tasks.get(task.id).status === 'in_progress', 8000);
  });
```

(add `import { Clock } from '../src/company/clock.ts';` to the file's imports).

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/office-server && npx vitest run test/clock.test.ts`
Expected: FAIL — `Cannot find module '../src/company/clock.ts'`.

- [ ] **Step 3: The Clock**

Create `apps/office-server/src/company/clock.ts`:

```ts
import type { ClockStatus } from '@cc/shared';
import type { EventStore } from '../event-store.ts';
import type { CompanyStateStore } from './goal-store.ts';
import type { DueReport, Scheduling } from './scheduling.ts';

export interface ClockTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface ClockDeps {
  scheduling: Scheduling;
  state: CompanyStateStore;
  events: EventStore;
  /** What is due at a time, in Turkish, for the status line (null: nothing). */
  label?: (now: number) => string | null;
  now?: () => number;
  timers?: ClockTimers;
  /** The clock never sleeps longer than this (the safety tick). */
  safetyMs?: number;
  /** Waking later than this past the armed time counts as a jump. */
  jumpMs?: number;
}

interface Job {
  name: string;
  ms: number;
  fn: () => void;
  nextAt: number;
}

const REAL_TIMERS: ClockTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/**
 * The office's one timer (spec §5). It holds no due times of its own: on every arm it asks the scheduling service
 * for the nearest one, sleeps until then (at most `safetyMs`), runs what is due and re-arms. Any change to a time
 * calls `touch()`. A restart catches up at start; a long sleep or a clock change is noted, never a problem.
 */
export class Clock {
  readonly #d: ClockDeps;
  readonly #now: () => number;
  readonly #timers: ClockTimers;
  readonly #safetyMs: number;
  readonly #jumpMs: number;
  readonly #jobs: Job[] = [];
  readonly #listeners: Array<(report: DueReport) => void> = [];
  #handle: unknown = null;
  #armedFor: number | null = null;
  #started = false;

  constructor(d: ClockDeps) {
    this.#d = d;
    this.#now = d.now ?? Date.now;
    this.#timers = d.timers ?? REAL_TIMERS;
    this.#safetyMs = d.safetyMs ?? 60_000;
    this.#jumpMs = d.jumpMs ?? 120_000;
  }

  /** A periodic office job (the dispatcher's tick, the pulse…); runs at start and every `ms` after. */
  every(name: string, ms: number, fn: () => void): void {
    this.#jobs.push({ name, ms, fn, nextAt: 0 });
    if (this.#started) this.#arm();
  }

  onRan(fn: (report: DueReport) => void): void {
    this.#listeners.push(fn);
  }

  start(): () => void {
    this.#started = true;
    this.#run();
    return () => {
      this.#started = false;
      if (this.#handle !== null) this.#timers.clear(this.#handle);
      this.#handle = null;
    };
  }

  /** A time changed: look again now and re-arm. */
  touch(): void {
    if (!this.#started) return;
    this.#arm();
  }

  /** Runs what is due right now (the API's and the tests' hand on the clock). */
  runNow(): DueReport {
    return this.#run();
  }

  status(now: number = this.#now()): ClockStatus {
    const nextDue = this.#d.scheduling.nextDueAt(now);
    return {
      nextDueAt: nextDue,
      nextDueLabel: nextDue === null ? null : (this.#d.label?.(now) ?? null),
      lastRunAt: Number(this.#d.state.get('clock.lastRunAt') ?? '0') || null,
      lastJumpAt: Number(this.#d.state.get('clock.lastJumpAt') ?? '0') || null,
    };
  }

  #run(): DueReport {
    const now = this.#now();
    if (this.#armedFor !== null && now - this.#armedFor > this.#jumpMs) {
      this.#d.state.set('clock.lastJumpAt', String(now));
      this.#d.events.append(null, { type: 'clock.jumped', expectedAt: this.#armedFor, actualAt: now });
    }
    this.#armedFor = null;
    let report: DueReport;
    try {
      report = this.#d.scheduling.runDue(now);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.#d.events.append(null, { type: 'clock.error', job: 'runDue', message: message.slice(0, 500) });
      report = { returned: [], fired: [], skipped: [], overdue: [], errors: [message] };
    }
    for (const job of this.#jobs) {
      if (job.nextAt > now) continue;
      job.nextAt = now + job.ms;
      try {
        job.fn();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.#d.events.append(null, { type: 'clock.error', job: job.name, message: message.slice(0, 500) });
      }
    }
    for (const fn of this.#listeners) {
      try {
        fn(report);
      } catch {
        // A listener's failure is its own.
      }
    }
    this.#arm();
    return report;
  }

  #arm(): void {
    if (!this.#started) return;
    if (this.#handle !== null) this.#timers.clear(this.#handle);
    const now = this.#now();
    const due = this.#d.scheduling.nextDueAt(now);
    const jobAt = this.#jobs.length ? Math.min(...this.#jobs.map((j) => j.nextAt)) : Number.POSITIVE_INFINITY;
    const at = Math.min(due ?? Number.POSITIVE_INFINITY, jobAt, now + this.#safetyMs);
    this.#armedFor = at;
    this.#handle = this.#timers.set(() => this.#run(), Math.max(0, at - now));
  }
}
```

- [ ] **Step 4: Dispatcher integration**

In `apps/office-server/src/company/dispatcher.ts`: `DispatcherDeps` gains

```ts
  /** The office clock (spec §5): the tick becomes one of its jobs and every due run sweeps. Absent: the old interval. */
  clock?: { every(name: string, ms: number, fn: () => void): void; onRan(fn: () => void): void };
```

`start()` becomes:

```ts
  start(): () => void {
    const off = this.#d.events.subscribe((stored) => {
      const ev = stored.event;
      if (ev.type === 'lifecycle.changed' && stored.employeeId) {
        if (ev.to === 'idle') this.#idleSince.set(stored.employeeId, this.#now());
        else this.#idleSince.delete(stored.employeeId);
        if (ev.to === 'idle') this.#schedule(stored.employeeId);
      } else if (['task.changed', 'plan.changed', 'decision.recorded', 'quota.updated', 'budget.changed', 'company.paused', 'schedule.changed'].includes(ev.type)) this.#scheduleSweep();
    });
    if (this.#d.clock) {
      // The clock runs the tick at start and on its interval, and sweeps after every due run (a park came back).
      this.#d.clock.every('dispatcher.tick', this.#d.tickMs ?? 60_000, () => this.tick());
      this.#d.clock.onRan(() => this.#scheduleSweep());
      return off;
    }
    const timer = setInterval(() => this.tick(), this.#d.tickMs ?? 60_000);
    timer.unref();
    this.tick();
    return () => {
      off();
      clearInterval(timer);
    };
  }

  /** One office tick: the reserve, the report reminder (digest off), the pulse, a sweep. */
  tick(): void {
    this.#d.budget?.checkReserve();
    if (!this.#rules().digestEnabled) this.#remindReport();
    this.#pulse();
    this.#scheduleSweep();
  }
```

`main.ts`: after `const dispatcher = …`, build the scheduling service and the clock and start it after `dispatcher.start()`:

```ts
const schedules = new ScheduleStore(db);
const scheduling = new Scheduling({ db, tasks, schedules, notices, company, state, events, constitution: () => budget.constitution() });
const clock = new Clock({ scheduling, state, events, label: (now) => dueLabel(tasks, schedules, company, now) });
```

where `company` receives `schedules` in its deps and `company.attachClock(clock)` is called right after the clock is built, the dispatcher receives `clock`, and in the `listen` callback `clock.start()` runs after `dispatcher.start()`. `dueLabel` is a small helper in `scheduling.ts`:

```ts
/** "Adım 1 penceresi · Koordinatör" — what the nearest due time is about (for the status line and the sheet). */
export function dueLabel(tasks: TaskStore, schedules: ScheduleStore, company: Company, now: number): string | null {
  const at = [tasks.nextDueAt(now), schedules.nextRunAt()].filter((t): t is number => t !== null && t > now);
  if (at.length === 0) return null;
  const when = Math.min(...at);
  const task = tasks.list({ statuses: ['parked', 'waiting'], limit: 10_000 }).find((t) => t.notBefore === when) ?? tasks.list({ statuses: ['waiting', 'in_progress', 'review', 'blocked', 'parked'], limit: 10_000 }).find((t) => t.dueAt === when);
  if (task) return `${task.title} · ${company.nameOf(task.assignee)}`;
  const schedule = schedules.list({ statuses: ['active'] }).find((s) => s.nextRunAt === when);
  return schedule ? `${schedule.title} · ${company.nameOf(schedule.assignee)} (rutin)` : null;
}
```

Also the `/api/office` snapshot and `/api/agenda` need the clock status: `ApiDeps.company` gains `clock?: Clock` (`clock: { status(): ClockStatus }`), and `snapshot` adds `clock: d.company.clock?.status()`; pass `clock` in `main.ts`. (Schedules in the snapshot come in Task 6.)

- [ ] **Step 5: Run the whole server suite and typecheck**

Run: `cd apps/office-server && npx vitest run > /tmp/cc-sched-t4.log 2>&1; tail -8 /tmp/cc-sched-t4.log; cd ../.. && pnpm -r --if-present typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src apps/office-server/test
git commit -m "feat(company): the office clock — one timer armed from the database, catching up after a restart, noting jumps"
```

Continue with part 2: `docs/superpowers/plans/2026-10-07-office-scheduler-part-2.md` (Tasks 5–9).
