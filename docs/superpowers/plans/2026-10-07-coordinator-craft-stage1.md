# Coordinator Craft — Stage 1 (method and quality) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every coordinator ships knowing how to run any kind of work: a short coordination core in every coordinator's and lead's guide, per-work-type methods read on demand, a required method on every plan card, a review gate (a task with a reviewer closes only on someone else's approval, with rounds), evidence for every definition-of-done item on hand-in, and a retro when a plan ends.

**Architecture:** Knowledge lives in versioned Markdown files that ship with the server (`src/company/craft/`), loaded by `craft.ts` into the office guide and served by the new `methodRead` tool. Migration v8 adds `plans.method` and `tasks.reviewer / review_of / round`; a task with a reviewer moves to the new status `review` on hand-in and the office opens a `review`-kind task for the reviewer, decided with the new `reviewDecide` tool. `taskFinish` requires evidence lines; `planRetro` writes the plan's assessment to the company notes. The web shows the method on the plan card, an "İncelemede" board column, reviewer and round on cards, and review decisions in the chat.

**Tech Stack:** Node 24 (type stripping), node:sqlite, Vitest 3, React 19, zustand — as the company phases.

**Spec:** `docs/superpowers/specs/2026-10-07-coordinator-craft-design.md` (§1 items 1–5, §2, §3, §4, §5, §7–§12; stage 1 of §13).

**Base:** `main` after `office-economy` is merged (migrations v6 notice kinds, v7 task difficulty; notice topics in `src/company/notices.ts`; `TaskDifficulty`). This plan's migration is v8.

## Global Constraints

- Node 24 type stripping: no enums, no parameter properties, `import type` for types, `.ts` extensions in imports.
- Every migration is reversible: `up` + `down`, `down` removes exactly what `up` added and touches no data, round trip tested.
- Tool descriptions in English; tool results, errors, guides, method files and UI text in Turkish.
- Commits: plain conventional commits as the user, no AI trailer or marker of any kind.
- Real claude only opt-in (`OFFICE_SMOKE=1`), temp data dirs, never port 4319; clean `~/.claude/projects/-tmp-cc-*` afterwards.
- The craft is a product feature (spec §3): it lives in the repo, not in any company's playbook or memory.
- The always-loaded core stays short (spec §1.5): `coordination.md` under 6,000 characters, `working.md` under 3,000.

## Spec rulings (decided here)

- **Statuses and kinds.** New task status `review` ("İncelemede"), between `in_progress` and `blocked`; it counts as open (a plan does not finish while a task is in review). New task kind `review`: the task the office opens for the reviewer. A review task is closed only by `reviewDecide`; `taskFinish` on it is refused.
- **Rounds.** `round` counts hand-ins sent to review: the first hand-in makes it 1 and opens "İnceleme: <title> (tur 1)". `changes` sends the task back `waiting` to the same assignee (round unchanged); the next hand-in makes it 2. From the third `changes` on (round ≥ 3) the coordinator gets a decision notice `review.stuck`; before that an info notice `review.changes`.
- **Decisions.** `approve` is allowed only with no critical or important finding (minor ones are recorded and sent to the doer); `changes` needs at least one critical or important finding. Findings are stored sorted most severe first.
- **Who reviews.** The task's `reviewer` (set by `taskCreate`, `taskPass`, `taskAssign`); never the assignee — refused at create, at assign (the task to its reviewer, or a review task to the doer), and at decide. The coordinator may decide any review except of its own task. If the named reviewer was let go when the hand-in comes, the coordinator reviews; if there is no one who may review (no coordinator, or the coordinator is the doer), the task closes as before.
- **Reassigning a review task** to someone else also makes them the task's reviewer for later rounds. A task in status `review` cannot be reassigned.
- **Evidence.** `taskFinish` takes `evidence: string[]`; a `work` task with N definition-of-done items needs at least N lines (same order). Hand-over tasks are exempt (their items are instructions for leaving). Evidence is kept on `TaskResult.evidence`, written as item–evidence pairs to `teslim.md`, and carried into the review task's description.
- **Plan method.** `PlanMethod = { workType, stages: [{ name, role, review }], checks }`; required on `planPropose` (≥ 2 stages, ≥ 1 check), optional on `planRevise` (kept when not given). Plans from before v8 have `method: null`.
- **Plan end.** When a plan's last open task closes, the coordinator gets the decision notice `plan.retro` (instead of the info `plan.done`): assess with `planRetro`, write company-specific lessons to the playbook, report. `planRetro` writes a note tagged `retro` (+ the work type) and, with `methodSuggestion`, a second note tagged `yöntem-önerisi`.
- **Guides.** Everyone's `office-guide.md` gets `working.md` (evidence, reviewer-gated tasks, how to review); coordinators and leads also get `coordination.md`. A craft file that cannot be read leaves its part out; the guide is still written.

## Review Focus

1. A task in review whose doer is let go, or whose review task's holder is let go, must not vanish: the review task goes back to the coordinator like any task, and a `changes` decision on a let-go doer's task tells the coordinator to reassign (Task 5).
2. The doer approving their own work through a side door — `taskAssign` of the task to its reviewer, of the review task to the doer, the coordinator deciding a review of its own task — is always refused (Task 5).
3. Data from before v8 — plans without a method, tasks without reviewer or round — loads, is delivered and displays (method `null`, round 0) (Task 1, Task 7).
4. A model sending malformed input — method as a string, a stage without a role, findings as strings, an unknown severity or decision — gets a clear Turkish error and nothing is stored (Task 3, Task 5).
5. A hand-in whose evidence is fewer lines than done items (e.g. everything in one line) is refused with the count; a hand-over is not (Task 4).

---

## File Structure

```
packages/shared/src/company.ts                     MODIFY  review status/kind, Task.reviewer/reviewOf/round, TaskResult.evidence/review,
                                                           review severities + reviewTally, WORK_TYPES, PlanMethod, Plan.method, TaskChange
apps/office-server/src/migrations.ts               MODIFY  v8
apps/office-server/src/company/store.ts            MODIFY  new columns, 'review' open, latestReview
apps/office-server/src/company/craft.ts            CREATE  loads the craft files: workingText, coordinationText, methodText
apps/office-server/src/company/craft/coordination.md   CREATE  the core (spec §4.1)
apps/office-server/src/company/craft/working.md        CREATE  evidence, reviewer-gated tasks, how to review
apps/office-server/src/company/craft/methods/*.md      CREATE  software, content, research, customer, operations, general
apps/office-server/src/company/roles.ts            MODIFY  guides include the craft; coordinator bullets
apps/office-server/src/company/company.ts          MODIFY  plan method, evidence, review gate, retro
apps/office-server/src/company/review.ts           CREATE  pure helpers: planMethod, reviewFindings, reviewBrief
apps/office-server/src/company/notices.ts          MODIFY  review.approved/changes/stuck, plan.retro; digest group
apps/office-server/src/company/dispatcher.ts       MODIFY  delivery and reminder texts for review tasks, returned task with findings
apps/office-server/src/company/archive.ts          MODIFY  item–evidence pairs in teslim.md
apps/office-server/src/mcp/tools.ts                MODIFY  methodRead, reviewDecide, planRetro; method/reviewer/evidence args
apps/office-web/src/ui/labels.ts                   MODIFY  'review' label
apps/office-web/src/ui/CompanyView.tsx             MODIFY  İncelemede column, reviewer/round/badge on cards
apps/office-web/src/ui/PlanCard.tsx                MODIFY  "Nasıl yapılacak"
apps/office-web/src/ui/EventItem.tsx               MODIFY  in_review / reviewed lines
apps/office-web/src/styles.css                     MODIFY  plan-method, review badge
tests: db.test.ts, company-store.test.ts, craft.test.ts (new), plan-method.test.ts (new), evidence.test.ts (new),
       review.test.ts (new), retro.test.ts (new), dispatcher.test.ts, mcp-tools.test.ts, web tests; craft.smoke.real.test.ts (new, opt-in)
```

---

### Task 1: Shared types, migration v8, stores

**Files:**
- Modify: `packages/shared/src/company.ts`
- Modify: `apps/office-server/src/migrations.ts` (append v8)
- Modify: `apps/office-server/src/company/store.ts`
- Test: `apps/office-server/test/db.test.ts`, `apps/office-server/test/company-store.test.ts`

**Interfaces:**
- Produces: `TASK_STATUSES` incl. `'review'`; `TASK_KINDS` incl. `'review'`; `Task.reviewer?: string | null`, `Task.reviewOf?: string | null`, `Task.round?: number`; `TaskResult.evidence?: string[]`, `TaskResult.review?: ReviewOutcome`; `REVIEW_SEVERITIES`, `ReviewSeverity`, `REVIEW_SEVERITY_LABELS`, `ReviewFinding`, `REVIEW_DECISIONS`, `ReviewDecision`, `ReviewOutcome`, `reviewTally(findings): string`; `WORK_TYPES`, `WorkType`, `WORK_TYPE_LABELS`, `PlanStage`, `PlanMethod`, `Plan.method?: PlanMethod | null`; `TaskChange` incl. `'in_review' | 'reviewed'`.
- Produces (store): `NewTask.reviewer?`, `NewTask.reviewOf?`; `TaskPatch` incl. `reviewer`, `round`; `TaskStore.latestReview(taskId): Task | null`; `NewPlan.method?: PlanMethod | null`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/office-server/test/db.test.ts` (inside `describe('migrations')`), and change the three `toBe(7)` counts at the top of the file to `toBe(8)`:

```ts
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
    expect(migrateUp(db)).toBe(8);
  });
```

Append to `apps/office-server/test/company-store.test.ts` (it already imports `setup`, `TaskStore`, `PlanStore`; add `REVIEW_SEVERITIES` import only if the linter asks):

```ts
describe('TaskStore — review fields (v8)', () => {
  it('keeps a reviewer, the reviewed task and the round; a new task has round 0', () => {
    const s = setup();
    try {
      const tasks = new TaskStore(s.db);
      const work = tasks.create({ planId: null, title: 'Yaz', description: '', done: ['a'], requester: 'owner', assignee: 'e1', priority: 3, dependsOn: [], chainDepth: 0, reviewer: 'e2' });
      expect(work).toMatchObject({ reviewer: 'e2', reviewOf: null, round: 0 });
      expect(tasks.get(work.id)).toMatchObject({ reviewer: 'e2', reviewOf: null, round: 0 });
      const next = tasks.update(work.id, { status: 'review', round: 1, reviewer: 'e3' });
      expect(tasks.get(work.id)).toMatchObject({ status: 'review', round: 1, reviewer: 'e3' });
      expect(next.round).toBe(1);
      const review = tasks.create({ kind: 'review', planId: null, title: 'İnceleme: Yaz (tur 1)', description: '', done: [], requester: 'owner', assignee: 'e3', priority: 3, dependsOn: [], chainDepth: 0, reviewOf: work.id });
      expect(tasks.get(review.id)).toMatchObject({ kind: 'review', reviewOf: work.id, reviewer: null });
    } finally {
      s.cleanup();
    }
  });

  it('counts a task in review as open, and finds the latest finished review of a task', () => {
    const s = setup();
    try {
      let t = 1000;
      const tasks = new TaskStore(s.db, () => t);
      const work = tasks.create({ planId: 'p1', title: 'Yaz', description: '', done: [], requester: 'owner', assignee: 'e1', priority: 3, dependsOn: [], chainDepth: 0, reviewer: 'e2' });
      tasks.update(work.id, { status: 'review' });
      expect(tasks.openInPlan('p1')).toBe(1);
      expect(tasks.latestReview(work.id)).toBeNull();
      const first = tasks.create({ kind: 'review', planId: 'p1', title: 'İnceleme 1', description: '', done: [], requester: 'owner', assignee: 'e2', priority: 3, dependsOn: [], chainDepth: 0, reviewOf: work.id });
      tasks.update(first.id, { status: 'done', finishedAt: (t += 10), result: { summary: 'Değişiklik istendi', outputs: [], learned: '', review: { decision: 'changes', findings: [{ severity: 'important', text: 'eksik' }] } } });
      const second = tasks.create({ kind: 'review', planId: 'p1', title: 'İnceleme 2', description: '', done: [], requester: 'owner', assignee: 'e2', priority: 3, dependsOn: [], chainDepth: 0, reviewOf: work.id });
      expect(tasks.latestReview(work.id)?.id).toBe(first.id);
      tasks.update(second.id, { status: 'done', finishedAt: (t += 10), result: { summary: 'Onaylandı', outputs: [], learned: '', review: { decision: 'approve', findings: [] } } });
      expect(tasks.latestReview(work.id)?.id).toBe(second.id);
      expect(tasks.latestReview(work.id)?.result?.review?.decision).toBe('approve');
    } finally {
      s.cleanup();
    }
  });
});

describe('PlanStore — method (v8)', () => {
  it('stores a plan’s method and reads an old plan’s as null', () => {
    const s = setup();
    try {
      const plans = new PlanStore(s.db);
      const method = { workType: 'content' as const, stages: [{ name: 'Taslak', role: 'yazar', review: false }, { name: 'Editör', role: 'editör', review: true }], checks: ['marka diline uygun'] };
      const p = plans.create({ title: 'Metin', goal: 'g', approach: 'a', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '', proposedBy: 'c', method });
      expect(plans.get(p.id).method).toEqual(method);
      const old = plans.create({ title: 'Eski', goal: 'g', approach: 'a', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '', proposedBy: 'c' });
      expect(plans.get(old.id).method).toBeNull();
      plans.update(old.id, { method });
      expect(plans.get(old.id).method).toEqual(method);
    } finally {
      s.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/office-server && npx vitest run test/db.test.ts test/company-store.test.ts`
Expected: FAIL — `migrateUp` returns 7, `latestReview is not a function`, `method` undefined.

- [ ] **Step 3: Shared types**

In `packages/shared/src/company.ts` replace the first line and the `TaskResult` interface, and the `TASK_KINDS` lines, and add the new exports and fields:

```ts
export const TASK_STATUSES = ['waiting', 'in_progress', 'review', 'blocked', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const REVIEW_SEVERITIES = ['critical', 'important', 'minor'] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];
export const REVIEW_SEVERITY_LABELS: Record<ReviewSeverity, string> = { critical: 'kritik', important: 'önemli', minor: 'küçük' };
export const REVIEW_DECISIONS = ['approve', 'changes'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export interface ReviewFinding {
  severity: ReviewSeverity;
  text: string;
}
export interface ReviewOutcome {
  decision: ReviewDecision;
  /** Most severe first. */
  findings: ReviewFinding[];
}

/** "2 önemli, 1 küçük" — the findings counted by severity, most severe first ('' for none). */
export function reviewTally(findings: readonly ReviewFinding[]): string {
  return REVIEW_SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${REVIEW_SEVERITY_LABELS[s]}`)
    .join(', ');
}

export interface TaskResult {
  summary: string;
  /** Paths of the files the work produced (relative to the employee's desk or absolute). */
  outputs: string[];
  learned: string;
  /** One line of proof per definition-of-done item, in the same order (spec §5.3). */
  evidence?: string[];
  /** A review task's decision (reviewDecide). */
  review?: ReviewOutcome;
  /** Where the office archived the hand-in, relative to the data folder (set by the office). */
  archive?: string;
}
```

```ts
/** `handover`: the task "İşten çıkar" gives — write down what you know before you leave. `review`: the task the office
 * opens for a reviewer when a task with a reviewer is handed in; closed only by reviewDecide. */
export const TASK_KINDS = ['work', 'handover', 'review'] as const;
```

In `interface Task`, after `difficulty?: …`:

```ts
  /** Who approves the hand-in before the task closes (an employee id); absent or null: no review. */
  reviewer?: string | null;
  /** A review task: the id of the task it reviews. */
  reviewOf?: string | null;
  /** How many times the task was handed in for review (0: never). */
  round?: number;
```

Before `PLAN_STATUSES`:

```ts
/** The kinds of work the coordination craft has a method for (spec §4.2); methodRead reads each. */
export const WORK_TYPES = ['software', 'content', 'research', 'customer', 'operations', 'general'] as const;
export type WorkType = (typeof WORK_TYPES)[number];
export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  software: 'Yazılım',
  content: 'İçerik ve pazarlama',
  research: 'Araştırma ve analiz',
  customer: 'Müşteri ve satış',
  operations: 'Operasyon ve satın alma',
  general: 'Genel',
};
export interface PlanStage {
  name: string;
  /** Who does it: a person or a role. */
  role: string;
  /** Someone other than the doer checks it. */
  review: boolean;
}
/** How a plan's work is done (spec §5.1). */
export interface PlanMethod {
  workType: WorkType;
  stages: PlanStage[];
  checks: string[];
}
```

In `interface Plan`, after `risks: string;`:

```ts
  /** How the work is done (spec §5.1); null for plans from before methods. */
  method?: PlanMethod | null;
```

Replace the `TaskChange` line:

```ts
/** `in_review`: handed in, waiting for its reviewer. `reviewed`: a review task was decided. */
export type TaskChange = 'created' | 'assigned' | 'started' | 'updated' | 'finished' | 'reprioritized' | 'in_review' | 'reviewed';
```

- [ ] **Step 4: Migration v8**

Append to the `MIGRATIONS` array in `apps/office-server/src/migrations.ts`:

```ts
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
```

- [ ] **Step 5: Stores**

In `apps/office-server/src/company/store.ts`:

Import line becomes:

```ts
import type { Plan, PlanMethod, PlanStatus, Task, TaskDifficulty, TaskKind, TaskResult, TaskStatus } from '@cc/shared';
```

`TaskRow` gets three fields (after `difficulty`):

```ts
  reviewer: string | null;
  review_of: string | null;
  round: number | null;
```

`taskFromRow` gets (after `difficulty`):

```ts
    reviewer: r.reviewer ?? null,
    reviewOf: r.review_of ?? null,
    round: r.round ?? 0,
```

`NewTask` gets (after `difficulty?`):

```ts
  /** Who approves the hand-in (an employee id). */
  reviewer?: string | null;
  /** A review task: the task it reviews. */
  reviewOf?: string | null;
```

`TaskPatch` becomes:

```ts
export type TaskPatch = Partial<Pick<Task, 'assignee' | 'priority' | 'difficulty' | 'reviewer' | 'round' | 'status' | 'note' | 'result' | 'nudged' | 'startedAt' | 'finishedAt'>>;

const OPEN = "('waiting', 'in_progress', 'review', 'blocked')";
```

`create` becomes:

```ts
  create(t: NewTask): Task {
    const task: Task = {
      ...t, kind: t.kind ?? 'work', difficulty: t.difficulty ?? null, reviewer: t.reviewer ?? null, reviewOf: t.reviewOf ?? null, round: 0,
      id: randomUUID(), status: 'waiting', note: null, result: null, nudged: false, createdAt: this.#now(), startedAt: null, finishedAt: null,
    };
    this.#db
      .prepare(
        `INSERT INTO tasks (id, plan_id, title, description, done, requester, assignee, priority, depends_on, status, chain_depth,
           note, result, nudged, created_at, started_at, finished_at, kind, difficulty, reviewer, review_of, round)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, NULL, NULL, ?, ?, ?, ?, 0)`,
      )
      .run(task.id, task.planId, task.title, task.description, JSON.stringify(task.done), task.requester, task.assignee, task.priority, JSON.stringify(task.dependsOn), task.status, task.chainDepth, task.createdAt, task.kind, task.difficulty ?? null, task.reviewer ?? null, task.reviewOf ?? null);
    return task;
  }
```

`update` becomes:

```ts
  update(id: string, patch: TaskPatch): Task {
    const next = { ...this.get(id), ...patch };
    this.#db
      .prepare('UPDATE tasks SET assignee = ?, priority = ?, difficulty = ?, reviewer = ?, round = ?, status = ?, note = ?, result = ?, nudged = ?, started_at = ?, finished_at = ? WHERE id = ?')
      .run(next.assignee, next.priority, next.difficulty ?? null, next.reviewer ?? null, next.round ?? 0, next.status, next.note, next.result ? JSON.stringify(next.result) : null, next.nudged ? 1 : 0, next.startedAt, next.finishedAt, id);
    return next;
  }
```

After `openInPlan`, add:

```ts
  /** The last decided review of a task (its findings go with the task when it comes back). */
  latestReview(taskId: string): Task | null {
    const row = this.#db
      .prepare("SELECT * FROM tasks WHERE review_of = ? AND kind = 'review' AND status = 'done' ORDER BY finished_at DESC, rowid DESC LIMIT 1")
      .get(taskId) as unknown as TaskRow | undefined;
    return row ? taskFromRow(row) : null;
  }
```

`PlanRow` gets `method: string | null;`; `planFromRow` gets `method: r.method ? (JSON.parse(r.method) as PlanMethod) : null,`; `NewPlan` gets `method?: PlanMethod | null;`; `PlanStore.create` becomes:

```ts
  create(p: NewPlan): Plan {
    const at = this.#now();
    const plan: Plan = { ...p, method: p.method ?? null, id: randomUUID(), status: 'draft', version: 1, createdAt: at, updatedAt: at, approvedAt: null };
    this.#write(plan, true);
    return plan;
  }
```

and `#write` becomes:

```ts
  #write(p: Plan, insert: boolean): void {
    const values = [p.title, p.goal, p.approach, p.people, JSON.stringify(p.steps), p.quotaPct, p.usd, p.days, p.risks, p.status, p.version, p.updatedAt, p.approvedAt, p.method ? JSON.stringify(p.method) : null];
    if (insert) {
      this.#db
        .prepare(
          `INSERT INTO plans (title, goal, approach, people, steps, quota_pct, usd, days, risks, status, version, updated_at, approved_at, method, id, proposed_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(...values, p.id, p.proposedBy, p.createdAt);
    } else {
      this.#db
        .prepare(
          `UPDATE plans SET title = ?, goal = ?, approach = ?, people = ?, steps = ?, quota_pct = ?, usd = ?, days = ?, risks = ?, status = ?,
             version = ?, updated_at = ?, approved_at = ?, method = ? WHERE id = ?`,
        )
        .run(...values, p.id);
    }
  }
```

In `apps/office-server/src/mcp/tools.ts` the `STATUS_TR` record must name every status (TypeScript): add `review: 'incelemede'`. In `apps/office-web/src/ui/labels.ts` add `review: 'İncelemede',` to `TASK_STATUS_LABELS` (after `in_progress`).

- [ ] **Step 6: Run the tests and the type check**

Run: `cd apps/office-server && npx vitest run test/db.test.ts test/company-store.test.ts && cd ../.. && pnpm -r --if-present typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/company.ts apps/office-server/src/migrations.ts apps/office-server/src/company/store.ts apps/office-server/src/mcp/tools.ts apps/office-web/src/ui/labels.ts apps/office-server/test/db.test.ts apps/office-server/test/company-store.test.ts
git commit -m "feat(company): migration v8 — a plan's method, a task's reviewer, the task it reviews and its round"
```

---

### Task 2: The craft — core, working rules, work-type methods, `methodRead`, guides

**Files:**
- Create: `apps/office-server/src/company/craft.ts`
- Create: `apps/office-server/src/company/craft/coordination.md`, `apps/office-server/src/company/craft/working.md`
- Create: `apps/office-server/src/company/craft/methods/{software,content,research,customer,operations,general}.md`
- Modify: `apps/office-server/src/company/roles.ts`
- Modify: `apps/office-server/src/mcp/tools.ts` (add `methodRead`)
- Test: `apps/office-server/test/craft.test.ts` (new), `apps/office-server/test/mcp-tools.test.ts`

**Interfaces:**
- Consumes: `WORK_TYPES`, `WORK_TYPE_LABELS`, `WorkType` (Task 1).
- Produces: `CRAFT_VERSION = '1.0'`, `METHOD_HEADINGS`, `isWorkType(v): v is WorkType`, `workingText(): string`, `coordinationText(): string`, `methodText(type?: string, reader?: (name: string) => string): string` from `src/company/craft.ts`; MCP tool `methodRead` (everyone, arg `type?`).

- [ ] **Step 1: Write the failing tests**

Create `apps/office-server/test/craft.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WORK_TYPES } from '@cc/shared';
import { CRAFT_VERSION, METHOD_HEADINGS, coordinationText, methodText, workingText } from '../src/company/craft.ts';
import { officeGuide } from '../src/company/roles.ts';

describe('the coordination craft (ships with the office)', () => {
  it('has a method for every work type, each with the same headings in the same order', () => {
    for (const type of WORK_TYPES) {
      const text = readFileSync(new URL(`../src/company/craft/methods/${type}.md`, import.meta.url), 'utf8');
      const at = METHOD_HEADINGS.map((h) => text.indexOf(`\n${h}\n`));
      expect(at.every((i) => i > 0), `${type}: ${METHOD_HEADINGS.filter((_, i) => at[i]! < 0).join(', ')}`).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      expect(methodText(type)).toBe(text.trim());
    }
  });

  it('keeps the always-loaded parts short, and the core says its version', () => {
    expect(coordinationText()).toContain(`Koordinatörlük ${CRAFT_VERSION}`);
    expect(coordinationText().length).toBeLessThan(6000);
    expect(workingText().length).toBeLessThan(3000);
    expect(coordinationText()).toContain('methodRead');
    expect(coordinationText()).toContain('planRetro');
    expect(workingText()).toContain('reviewDecide');
    expect(workingText()).toContain('evidence');
  });

  it('without a type lists every type; an unknown type is refused in Turkish', () => {
    const list = methodText();
    for (const type of WORK_TYPES) expect(list).toContain(type);
    expect(() => methodText('poetry')).toThrow(/Bilinmeyen iş türü: poetry/);
  });

  it('falls back to the general method when a method file cannot be read, and to a line when none can', () => {
    const general = methodText('general');
    const missing = (name: string) => {
      if (name === 'methods/content.md') throw new Error('ENOENT');
      return general;
    };
    expect(methodText('content', missing)).toContain('okunamadı');
    expect(methodText('content', missing)).toContain(general);
    expect(methodText('content', () => { throw new Error('ENOENT'); })).toMatch(/Yöntem dosyaları okunamadı/);
  });

  it('gives coordinators and leads the core and everyone the working rules', () => {
    for (const kind of ['coordinator', 'lead'] as const) {
      expect(officeGuide(kind)).toContain(coordinationText());
      expect(officeGuide(kind)).toContain(workingText());
    }
    expect(officeGuide('member')).toContain(workingText());
    expect(officeGuide('member')).not.toContain(`Koordinatörlük ${CRAFT_VERSION}`);
    expect(officeGuide('coordinator')).toContain('methodRead');
  });
});
```

In `apps/office-server/test/mcp-tools.test.ts`, in the first test add `'methodRead'` to the member list (alphabetical: after `'memorySearch'`), and append a test:

```ts
  it('lets anyone read the work-type methods', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    expect(await t.call(ada, 'methodRead')).toContain('content');
    expect(await t.call(ada, 'methodRead', { type: 'research' })).toContain('## Kanıt');
    await expect(Promise.resolve().then(() => t.call(ada, 'methodRead', { type: 'x' }))).rejects.toThrow(/Bilinmeyen iş türü/);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/office-server && npx vitest run test/craft.test.ts test/mcp-tools.test.ts`
Expected: FAIL — `Cannot find module '../src/company/craft.ts'`.

- [ ] **Step 3: The loader**

Create `apps/office-server/src/company/craft.ts`:

```ts
import { readFileSync } from 'node:fs';
import { WORK_TYPES, WORK_TYPE_LABELS, type WorkType } from '@cc/shared';
import { ValidationError } from '../errors.ts';

/**
 * The coordination craft ships with the office (spec §3): the same in every company, versioned with the product, never
 * written into a company's playbook. The core and the working rules go into the office guide (every session start);
 * the work-type methods are read on demand with methodRead, so they cost nothing until needed.
 */
export const CRAFT_VERSION = '1.0';
export const METHOD_HEADINGS = ['## Aşamalar', '## Roller', '## Kalite kontrolleri', '## Kanıt', '## Sık yapılan hatalar', '## Model önerisi'] as const;

const DIR = new URL('./craft/', import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, DIR), 'utf8').trim();

export const isWorkType = (v: unknown): v is WorkType => (WORK_TYPES as readonly unknown[]).includes(v);

/** What everyone needs: evidence on hand-in, what a reviewer-gated task means, how to review (spec §4.1). */
export function workingText(): string {
  return read('working.md');
}

/** The core every coordinator and lead carries (spec §4.1); short, so it stays cheap in every turn. */
export function coordinationText(): string {
  return read('coordination.md');
}

/** methodRead: without a type the list of types, with one its method; an unreadable file falls back to the general method. */
export function methodText(type?: string, reader: (name: string) => string = read): string {
  if (type === undefined || type.trim() === '') {
    return [`Koordinatörlük ${CRAFT_VERSION} — iş türleri (birini methodRead ile oku):`, ...WORK_TYPES.map((t) => `• ${t} — ${WORK_TYPE_LABELS[t]}`)].join('\n');
  }
  const wanted = type.trim();
  if (!isWorkType(wanted)) throw new ValidationError(`Bilinmeyen iş türü: ${wanted}. Türler: ${WORK_TYPES.join(', ')}.`);
  try {
    return reader(`methods/${wanted}.md`);
  } catch {
    try {
      return `(“${wanted}” yöntem dosyası okunamadı; genel yöntem aşağıda.)\n\n${reader('methods/general.md')}`;
    } catch {
      return 'Yöntem dosyaları okunamadı. Genel yol: hedef → ölçülebilir bitti tanımı → yapan ve denetleyen ayrı → her madde için kanıt → teslim → değerlendirme.';
    }
  }
}
```

- [ ] **Step 4: The core and the working rules**

Create `apps/office-server/src/company/craft/coordination.md`:

```md
## Koordinatörlük 1.0 — işi nasıl yönetirsin

Bu bölüm ofisle birlikte gelir ve her şirkette aynıdır. Şirkete özgü kurallar el kitabındadır (`playbookRead`); ikisi
çelişirse şirketin kuralı geçerlidir, bunu `decisionRecord` ile gerekçesiyle yaz.

1. **Önce yöntem.** Bir iş gelince önce `methodRead` ile iş türünün yöntemine, `playbookRead` ile şirketin yerel
   kurallarına bak. Plan kartının yöntemini doldur: iş türü, aşamalar (her biri için kim yapar, incelemesi var mı) ve
   kalite kontrolleri. Tür belli değilse `general`.
2. **Ölçülebilir bitti.** Her görevin bitti tanımı kontrol edilebilir maddelerden oluşsun: "README var" değil, "README
   kurulumu 3 adımda anlatıyor ve adımlar boş bir klasörde çalıştı".
3. **Yapan ≠ denetleyen.** Kalite riski olan her göreve `reviewer` ile bir inceleyici ata; kimse kendi işini onaylamaz.
   Kritik işte inceleyici en az yapan kadar güçlü bir modelde çalışsın (görevin zorluğu inceleme görevine de geçer).
4. **Kanıt.** Teslim, bitti tanımının her maddesi için bir kanıt taşır: çalışan komut ve çıktısı, dosya, kaynak, ekran.
   Sahibine giden raporda yalnız doğrulanmış iddia olur; doğrulanmayanı "doğrulanmadı" diye yaz.
5. **Döngü.** İnceleme bulguları önem sırasıyla gelir: kritik, önemli, küçük. Kritik ve önemli kapanmadan iş geçmez.
   Bir iş üç turda geçemiyorsa yaklaşımı değiştir (başka kişi, başka model, işi böl) ya da sahibine götür.
6. **Ölçek ve maliyet.** En küçük yeterli ekip; işe uygun model ve zorluk; pahalı aşamaları bilerek planla, kota payını
   tahmine yaz.
7. **Geri alınamaz işler sahibinden geçer.** Yayın, dışarıya gönderim, ödeme, canlıya alma, silme: önce sahibinin onayı.
8. **Değerlendirme.** Plan bitince `planRetro`: ne iyi gitti, ne takıldı, bir dahaki sefere ne değişecek. Şirkete özgü
   dersi `playbookUpdate` ile el kitabına yaz; her şirkete yarayacak bir yöntem önerin varsa `methodSuggestion` olarak ekle.
9. **Raporlama.** Kısa, sayılarla, doğrulanmış; belirsizliği ve riski gizleme.

Ekip lideri bunları kendi ekibinin ölçeğinde uygular.
```

Create `apps/office-server/src/company/craft/working.md`:

```md
## İyi iş: kanıt ve inceleme

- **Teslim kanıtla olur.** `taskFinish`'te bitti tanımının her maddesi için `evidence` listesine bir satır yaz (aynı
  sırayla): ne yaptın ve nasıl doğruladın — çalışan komut ve çıktısı, dosya yolu, kaynak. Doğrulayamadığın maddeyi
  "doğrulanmadı: neden" diye yaz; kanıt uydurma.
- **İnceleyicili görev.** Görev mesajında "İnceleyen" yazıyorsa teslimin onun onayıyla kapanır. "Değişiklik istendi"
  diye geri gelirse önce kritik ve önemli bulguları kapat, her biri için ne yaptığını teslim özetine yaz, yeniden teslim et.
- **İnceleme görevi gelirse** (başlığı "İnceleme:" ile başlar) kararını `reviewDecide` ile ver, `taskFinish` ile değil:
  - Her iddiayı kendin doğrula: dosyayı aç, komutu çalıştır, kaynağı kontrol et. Teslim özetine güvenme.
  - Her bulguya önem derecesi ver: `critical` (yanlış ya da zararlı), `important` (bitti tanımını karşılamıyor),
    `minor` (iyileştirme). Her bulguda somut bir senaryo olsun: hangi durumda ne yanlış çıkıyor.
  - Kritik ya da önemli bulgu varsa `changes`, yoksa `approve` (küçükler kayda geçer).
  - Düzeltmeyi kendin yapma, yapana bırak. Kendi işini inceleyemezsin.
```

- [ ] **Step 5: The six methods**

Create `apps/office-server/src/company/craft/methods/software.md`:

```md
# Yöntem: Yazılım (software)

Kod yazmak, düzeltmek, otomasyon, entegrasyon, betik.

## Aşamalar

1. Kabul ölçütleri: ne çalışınca bitmiş sayılır, hangi durumlar kapsam dışı.
2. Gerekirse kısa tasarım: hangi dosyalar, hangi arayüzler, veri değişikliği var mı (geri alınabilir olmalı).
3. Ayrı bir dalda geliştirme, önce test: davranışı söyleyen bir test yaz, başarısız olduğunu gör, sonra kodu yaz.
4. Kod incelemesi: yapan dışında biri (reviewer) değişikliği okur, testleri kendisi çalıştırır.
5. Düzeltme döngüsü: kritik ve önemli bulgular kapanana kadar.
6. Bağımsız doğrulama: gerçek davranış (komut, ekran, istek) bir kez uçtan uca denenir.
7. Kabul ve sahibinin yayın kararı: birleştirme, yayına alma, gönderme sahibine sorulur.

## Roller

- Geliştirici: yapar, test yazar, kanıtı toplar.
- İnceleyici: geliştiriciden başka biri; kritik işte en az onun kadar güçlü bir model.
- Koordinatör: kabul ölçütlerini yazar, yayın kararını sahibine götürür.

## Kalite kontrolleri

- Bütün test takımı yeşil; yeni davranışın kendi testi var ve önce kırmızı görüldü.
- Değişiklik istenen işi yapıyor, fazlasını değil.
- Veri değişikliği geri alınabilir (ileri ve geri adım, gidiş-dönüş denendi).
- Gizli anahtar, parola ya da kişisel veri koda ve kayda girmedi.

## Kanıt

- Test komutu ve çıktısının son satırları (kaç test, kaç başarısız).
- İnceleme raporu: bulgular ve kapanışları.
- Gerçek davranışın çıktısı: çalışan komut, ekran görüntüsü yolu ya da istek-yanıt.

## Sık yapılan hatalar

- "Testler geçiyor" deyip çalıştırmamak; eski bir çalıştırmaya güvenmek.
- Testi koddan sonra yazmak (hiç kırmızı görülmemiş test bir şey kanıtlamaz).
- Kapsamı genişletmek: istenmeyen yeniden düzenleme, ilgisiz düzeltmeler.
- Yayına almayı, birleştirmeyi sahibine sormadan yapmak.

## Model önerisi

Rutin değişiklik: sonnet. Karmaşık geliştirme ya da hata ayıklama: opus. Mimari karar ve kritik inceleme: fable. Basit
betik ve tekrarlı iş: haiku.
```

Create `apps/office-server/src/company/craft/methods/content.md`:

```md
# Yöntem: İçerik ve pazarlama (content)

Metin, görsel, video, sosyal medya gönderisi, kampanya, e-posta, sunum.

## Aşamalar

1. Brief: kitle, tek bir ana mesaj, kanal ve biçim (uzunluk, ölçü, süre), ton, başarı ölçüsü, son tarih.
2. Konsept ya da senaryo: bir iki seçenek, kısa gerekçesiyle.
3. Taslak.
4. Editör ve marka incelemesi: yazandan başka biri; marka dili, ton, açıklık, iddiaların doğruluğu.
5. Üretim: son metin, görsel ya da kurgu.
6. Son kontrol: biçim, yazım, bağlantılar, telif ve izinler.
7. Sahibinin yayın onayı: yayın ve dışarıya gönderim geri alınamaz.
8. Ölçüm: yayından sonra başarı ölçüsüne bakılır, ders el kitabına yazılır.

## Roller

- Yazar ya da üretici: taslağı ve üretimi yapar.
- Editör (reviewer): yazardan başka biri; brief'e ve marka diline göre inceler.
- Koordinatör: brief'i yazar, yayın onayını sahibine götürür.

## Kalite kontrolleri

- Brief'teki kitleye ve tek ana mesaja uyuyor.
- Marka dili ve tonu el kitabıyla tutarlı.
- Her olgusal iddianın bir kaynağı var; sayılar doğru.
- Kanalın biçim kurallarına uyuyor (karakter sınırı, ölçü, süre).
- Telif, görsel ve kişi izinleri tamam.

## Kanıt

- Son dosyalar (yolları) ve kanal için hazır hali.
- Brief'e göre doldurulmuş kontrol listesi.
- İddiaların kaynak listesi.

## Sık yapılan hatalar

- Brief'siz yazmaya başlamak; bir metinde üç mesaj vermek.
- Kaynaksız iddia ve uydurma sayı.
- Yayını ya da gönderimi sahibine sormadan yapmak.
- Ölçmeden "başarılı" demek.

## Model önerisi

Taslak ve üretim: sonnet. Kısa, kalıplı metinler: haiku. Marka ya da konumlandırma kararı: fable.
```

Create `apps/office-server/src/company/craft/methods/research.md`:

```md
# Yöntem: Araştırma ve analiz (research)

Pazar araştırması, rakip analizi, teknik inceleme, veri analizi, karşılaştırma.

## Aşamalar

1. Soruyu netleştir: tam olarak neyi bilmek istiyoruz, cevap hangi kararı besleyecek, ne kadar kesinlik yeter.
2. Kaynak planı: hangi kaynaklar, hangi sırayla, ne zaman durulacak.
3. Toplama: her bilgi kaynağıyla birlikte kaydedilir (bağlantı, tarih, alıntı).
4. Analiz: bulgular soruya göre düzenlenir; çelişen kaynaklar açıkça yazılır.
5. Kaynak kontrolü: araştırandan başka biri önemli iddiaları kaynağından doğrular.
6. Sonuç: cevap, güven düzeyi (yüksek / orta / düşük), belirsizlikler ve bir sonraki adım önerisi.

## Roller

- Araştırmacı: toplar ve analiz eder.
- Kontrol eden (reviewer): araştırmacıdan başka biri; iddiaları kaynağından doğrular.
- Koordinatör: soruyu ve sonucun hangi kararı besleyeceğini yazar.

## Kalite kontrolleri

- Her önemli iddianın bir birincil ya da güvenilir kaynağı var.
- Kaynakların tarihi sorunun gerektirdiği kadar yeni.
- Çelişkiler ve bilinmeyenler gizlenmemiş.
- Sonuç sorulan soruyu cevaplıyor.

## Kanıt

- Kaynak listesi (bağlantı, tarih, hangi iddiayı destekliyor).
- Ham veri ya da notların yolu.
- Kısa yöntem notu: nerelere bakıldı, neler dışarıda kaldı.

## Sık yapılan hatalar

- Soruyu netleştirmeden toplamaya başlamak.
- Tek kaynağa dayanmak; ikincil kaynağı birincil sanmak.
- Eski veriyi güncel diye sunmak.
- Güven düzeyini yazmamak.

## Model önerisi

Toplama ve özetleme: sonnet. Zor analiz ve sentez: opus ya da fable. Basit veri çekme: haiku.
```

Create `apps/office-server/src/company/craft/methods/customer.md`:

```md
# Yöntem: Müşteri ve satış (customer)

Müşteriye yanıt, teklif, destek, takip, satış görüşmesi hazırlığı.

## Aşamalar

1. İhtiyacı anla: müşteri tam olarak ne istiyor, ne zamana, geçmişte ne konuşuldu (müşteri kaydı, notlar).
2. Yanıt ya da teklif taslağı.
3. İkinci göz (reviewer): doğruluk, fiyat ve koşullar, ton, verilen sözler.
4. Dışarıya gönderimden önce sahibinin onayı — ya da sahibinin önceden koyduğu kural (el kitabında yazılı) izin
   veriyorsa o kural.
5. Gönderim ve kayıt: ne gönderildi, ne zaman, kime.
6. Takip: cevap gelmezse ne zaman, nasıl.

## Roller

- Hazırlayan: ihtiyacı anlar, taslağı yazar.
- Kontrol eden (reviewer): hazırlayandan başka biri.
- Sahibi: gönderimi onaylar (kural yoksa).

## Kalite kontrolleri

- Fiyat, tarih ve koşullar doğru ve şirketin kurallarıyla tutarlı.
- Verilemeyecek bir söz verilmemiş.
- Ton müşteriye ve duruma uygun; kişisel veri yalnız gerektiği kadar.
- Sorulan her soru cevaplanmış.

## Kanıt

- Taslağın son hali.
- Kontrol listesi (fiyat, tarih, söz, ton).
- Onay kaydı: kim onayladı, ne zaman (ya da hangi kural).

## Sık yapılan hatalar

- Onaysız göndermek.
- Eski fiyat ya da koşul kullanmak.
- Müşterinin sorusunu değil, kendi anlatmak istediğini yazmak.
- Takibi unutmak.

## Model önerisi

Yanıt taslağı: sonnet. Kalıplı kısa yanıt: haiku. Zor müzakere ya da şikâyet: opus ya da fable.
```

Create `apps/office-server/src/company/craft/methods/operations.md`:

```md
# Yöntem: Operasyon ve satın alma (operations)

Araç ya da servis seçmek, satın almak, kurmak, süreç düzenlemek, hesap ve abonelik işleri.

## Aşamalar

1. İhtiyaç: ne sorun çözülecek, olmazsa ne olur, bütçe sınırı.
2. Seçenekler: en az iki seçenek; maliyet (ilk ve aylık), risk, kurulum emeği, geri dönüş yolu.
3. Öneri: tercih ve gerekçesi; para gerekiyorsa `propose` ile satın alma talebi (sahibine gider).
4. Onay: sahibinin kararı gelmeden para harcanmaz.
5. Kurulum.
6. Doğrulama: kurulanın gerçekten çalıştığı, kurulumu yapandan başka biri tarafından denenir.
7. Kayıt: karar defterine (`decisionRecord`) ve gerekiyorsa el kitabına (nasıl kullanılır).

## Roller

- Araştıran ve kuran: seçenekleri çıkarır, onaydan sonra kurar.
- Doğrulayan (reviewer): kuran dışında biri.
- Sahibi: harcamayı onaylar.

## Kalite kontrolleri

- Seçenekler aynı ölçütlerle karşılaştırılmış.
- Harcama onaylı tutarı aşmıyor; `recordSpend` ile bildirildi.
- Kurulum belgelenmiş; erişim bilgileri güvenli yerde, metne yazılmamış.
- Vazgeçmenin yolu biliniyor (iptal, geri alma).

## Kanıt

- Seçenek karşılaştırması.
- Onay kaydı (öneri no ya da sahibinin kararı).
- Kurulum doğrulaması: çalıştığını gösteren çıktı ya da adım listesi.

## Sık yapılan hatalar

- Tek seçenek sunup "en iyisi bu" demek.
- Onaydan önce satın almak ya da deneme sürümüyle kart bilgisi vermek.
- Erişim bilgilerini notlara yazmak.
- Kurulumu kaydetmemek; bir sonraki kişinin baştan öğrenmesi.

## Model önerisi

Seçenek araştırması: sonnet. Basit kurulum adımları: haiku. Pahalı ya da geri dönüşü zor karar: fable.
```

Create `apps/office-server/src/company/craft/methods/general.md`:

```md
# Yöntem: Genel (general)

Başka bir türe uymayan ya da türü henüz belli olmayan her iş.

## Aşamalar

1. Hedef: bu iş bitince ne değişmiş olacak.
2. Kabul ölçütleri: kontrol edilebilir maddeler.
3. Yapan ve denetleyen ayrımı: kim yapacak, kim kontrol edecek.
4. Yapım.
5. Kanıt: her kabul ölçütü için.
6. Teslim ve inceleme.
7. Değerlendirme: ne öğrenildi, bir dahaki sefere ne değişecek.

## Roller

- Yapan.
- Denetleyen (reviewer): yapandan başka biri.
- Koordinatör: hedefi ve ölçütleri yazar.

## Kalite kontrolleri

- Her kabul ölçütü karşılandı ve kanıtı var.
- Geri alınamaz bir adım varsa sahibinin onayı alındı.

## Kanıt

- Kabul ölçütüne göre madde madde kanıt.

## Sık yapılan hatalar

- Ölçütsüz başlamak; "bitti"nin ne olduğunu sonradan tartışmak.
- Kendi işini kendin onaylamak.

## Model önerisi

İşin zorluğuna göre: kolay → haiku, orta → sonnet, zor → opus, kritik → fable.
```

- [ ] **Step 6: Guides**

In `apps/office-server/src/company/roles.ts`, add the import:

```ts
import { coordinationText, workingText } from './craft.ts';
```

Replace the first bullet of `MEMBER`:

```ts
const MEMBER = `- Sana verilen işler "Görev" başlığıyla bir mesaj olarak gelir. İş bitince \`taskFinish\` aracıyla teslim et:
  kısa özet, bitti tanımının her maddesi için bir kanıt (evidence), ürettiğin dosyalar (outputs; ofis bunları arşive
  kopyalar), öğrendiklerin (learned; şirket notlarına geçer). Takılırsan \`taskUpdate\` ile durumu "blocked" yap ve
  nedenini yaz.
```

(the remaining `MEMBER` bullets stay as they are). In `COORDINATOR`, replace the first two bullets and the last bullet:

```ts
const COORDINATOR = `- Sen şirketin koordinatörüsün; sahibi seninle konuşur. Bir ihtiyaç gelince önce \`methodRead\` ile iş türünün
  yöntemine, \`playbookRead\` ile şirketin yerel kurallarına bak; sonra \`planPropose\` ile bir plan kartı aç: hedef,
  yaklaşım, yöntem (iş türü, aşamalar ve rolleri, kalite kontrolleri), kimler (mevcutlar ve işe alınacaklar), görev
  taslağı, tahmini kota payı, para ve süre, riskler. Sahibiyle tartış, \`planRevise\` ile güncelle. Sahibi kartı
  onaylamadan işe başlama.
- Onay gelince görevleri \`taskCreate\` ile aç ve doğru kişilere ver; kalite riski olan her göreve \`reviewer\` ile bir
  inceleyici ata (yapan kendi işini onaylamaz). Gerekiyorsa \`hire\` ile çalışan al — rol kartını, modeli ve karakteri
  sen seçersin. Masa sayısı sınırlıdır; kimseyi işten çıkaramazsın, bunu yalnız sahibi yapar.
```

```ts
- Bir plan bitince \`planRetro\` ile değerlendir; bir plan bitince ve günde bir kez kısa bir özetle \`reportToOwner\` kullan.`;
```

(the bullets between stay as they are). Replace `officeGuide`:

```ts
/** A craft file that cannot be read leaves its part out; the guide is still written. */
function craft(text: () => string): string {
  try {
    return text();
  } catch {
    return '';
  }
}

/** How someone works with the office: the tools they have, the rules that come with them, and the craft (spec §4.1). */
export function officeGuide(kind: EmployeeKind): string {
  const base =
    kind === 'coordinator' ? `${MEMBER}\n${LEAD.replace('Ekip liderisin', 'Ekip lideri gibi de çalışırsın')}\n${COORDINATOR}` : kind === 'lead' ? `${MEMBER}\n${LEAD}\n${LEAD_ONLY}` : MEMBER;
  const parts = [base, craft(workingText)];
  if (kind !== 'member') parts.push(craft(coordinationText));
  return parts.filter(Boolean).join('\n\n');
}
```

- [ ] **Step 7: `methodRead`**

In `apps/office-server/src/mcp/tools.ts` add the import `import { methodText } from '../company/craft.ts';` and, right after the `playbookRead` tool, add:

```ts
    {
      name: 'methodRead',
      description:
        'Read how a kind of work is done well (the office’s coordination craft, the same in every company): without a type, the list of work types; with one, its stages, roles, quality checks, evidence, common mistakes and model advice. Read it before planning work; the company’s own rules are in playbookRead.',
      inputSchema: object({ type: { type: 'string', enum: [...WORK_TYPES], description: 'Work type; omit for the list.' } }),
      kinds: EVERYONE,
      run: (_ctx, args) => methodText(optStr(args, 'type')),
    },
```

and add `WORK_TYPES` to the `@cc/shared` import at the top of the file.

- [ ] **Step 8: Run the tests**

Run: `cd apps/office-server && npx vitest run test/craft.test.ts test/mcp-tools.test.ts test/desk.test.ts test/company.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/office-server/src/company/craft.ts apps/office-server/src/company/craft apps/office-server/src/company/roles.ts apps/office-server/src/mcp/tools.ts apps/office-server/test/craft.test.ts apps/office-server/test/mcp-tools.test.ts
git commit -m "feat(company): the coordination craft ships with the office — a core in the guide and a method per kind of work"
```

---

### Task 3: A plan says how the work is done

**Files:**
- Create: `apps/office-server/src/company/review.ts` (pure validators, shared by Tasks 3 and 5)
- Modify: `apps/office-server/src/company/company.ts` (`PlanDraft.method`, `propose`, `revise`)
- Modify: `apps/office-server/src/mcp/tools.ts` (`planPropose`, `planRevise`)
- Modify: `apps/office-server/test/company-helpers.ts` (export `METHOD`), and every existing test that proposes a plan
- Test: `apps/office-server/test/plan-method.test.ts` (new), `apps/office-server/test/mcp-tools.test.ts`

**Interfaces:**
- Consumes: `PlanMethod`, `WORK_TYPES` (Task 1); `isWorkType` (Task 2).
- Produces: `planMethod(value: unknown): PlanMethod` and `METHOD_MISSING` from `src/company/review.ts`; `PlanDraft.method?: unknown`; test helper `METHOD` (a valid `PlanMethod`) from `test/company-helpers.ts`.

- [ ] **Step 1: Write the failing tests**

Create `apps/office-server/test/plan-method.test.ts`:

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
  const coordinator = c.company.hireCoordinator('sonnet');
  return { ...s, ...c, coordinator };
}

const DRAFT = { title: 'Tanıtım metni', goal: 'Kısa bir tanıtım', approach: 'Yazar yazar, editör inceler' };

describe('a plan says how the work is done (spec §5.1)', () => {
  it('refuses a plan without a method and says what to add', () => {
    const t = make();
    expect(() => t.company.propose(t.coordinator.id, DRAFT)).toThrow(/methodRead/);
    expect(t.plans.list()).toHaveLength(0);
  });

  it('refuses a malformed method in Turkish and stores nothing', () => {
    const t = make();
    const bad: Array<[unknown, RegExp]> = [
      ['yaz ve kontrol et', /nesne/],
      [{ ...METHOD, workType: 'poetry' }, /İş türü/],
      [{ ...METHOD, stages: [METHOD.stages[0]] }, /en az iki aşama/],
      [{ ...METHOD, stages: ['taslak', 'editör'] }, /aşama bir nesne/],
      [{ ...METHOD, stages: [{ name: 'Taslak', role: '' }, METHOD.stages[1]] }, /rolü boş olamaz/],
      [{ ...METHOD, stages: [{ name: 'Taslak', role: 'yazar', review: 'evet' }, METHOD.stages[1]] }, /review true ya da false/],
      [{ ...METHOD, checks: [] }, /kalite kontrolü/],
      [{ ...METHOD, checks: 'marka' }, /liste/],
    ];
    for (const [method, error] of bad) expect(() => t.company.propose(t.coordinator.id, { ...DRAFT, method }), String(error)).toThrow(error);
    expect(t.plans.list()).toHaveLength(0);
  });

  it('keeps the method on the card; a revision keeps it unless it gives a new one; a declined revision restores it', () => {
    const t = make();
    const plan = t.company.propose(t.coordinator.id, { ...DRAFT, method: METHOD });
    expect(t.plans.get(plan.id).method).toEqual(METHOD);
    t.company.approve(plan.id);
    const kept = t.company.revise(t.coordinator.id, plan.id, { days: 2 });
    expect(kept.method).toEqual(METHOD);
    const other = { workType: 'research' as const, stages: [{ name: 'Topla', role: 'araştırmacı', review: false }, { name: 'Kontrol', role: 'editör', review: true }], checks: ['kaynaklı'] };
    const changed = t.company.revise(t.coordinator.id, plan.id, { method: other });
    expect(changed.method).toEqual(other);
    expect(t.company.decline(plan.id).method).toEqual(METHOD);
  });

  it('trims the method and treats a missing review flag as false', () => {
    const t = make();
    const plan = t.company.propose(t.coordinator.id, {
      ...DRAFT,
      method: { workType: 'content', stages: [{ name: ' Taslak ', role: ' yazar ' }, { name: 'Editör', role: 'editör', review: true }], checks: [' marka dili ', ''] },
    });
    expect(plan.method).toEqual({ workType: 'content', stages: [{ name: 'Taslak', role: 'yazar', review: false }, { name: 'Editör', role: 'editör', review: true }], checks: ['marka dili'] });
  });

  it('a plan from before methods still loads, is approved and revised', () => {
    const t = make();
    const old = t.plans.create({ title: 'Eski', goal: 'g', approach: 'a', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '', proposedBy: t.coordinator.id });
    expect(t.company.approve(old.id).method).toBeNull();
    expect(t.company.revise(t.coordinator.id, old.id, { days: 1 }).method).toBeNull();
    expect(OWNER).toBe('owner');
  });
});
```

In `apps/office-server/test/mcp-tools.test.ts` append:

```ts
  it('planPropose takes the method and refuses a plan without one', async () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    await expect(Promise.resolve().then(() => t.call(c, 'planPropose', { title: 'P', goal: 'g', approach: 'a' }))).rejects.toThrow(/methodRead/);
    expect(await t.call(c, 'planPropose', { title: 'P', goal: 'g', approach: 'a', method: METHOD })).toMatch(/Plan kartı açıldı/);
    expect(t.plans.list()[0]!.method).toEqual(METHOD);
    const schema = t.tools.find((x) => x.name === 'planPropose')!.inputSchema as { required: string[] };
    expect(schema.required).toContain('method');
  });
```

and add `METHOD` to its `./company-helpers.ts` import.

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/office-server && npx vitest run test/plan-method.test.ts`
Expected: FAIL — `METHOD` is not exported by `company-helpers.ts`.

- [ ] **Step 3: The test helper**

Append to `apps/office-server/test/company-helpers.ts`:

```ts
/** A valid plan method for tests that are not about methods (planPropose requires one, spec §5.1). */
export const METHOD = {
  workType: 'general',
  stages: [
    { name: 'Yap', role: 'çalışan', review: false },
    { name: 'Kontrol', role: 'koordinatör', review: true },
  ],
  checks: ['Bitti tanımı karşılandı'],
} as const satisfies import('@cc/shared').PlanMethod;
```

- [ ] **Step 4: The validator**

Create `apps/office-server/src/company/review.ts`:

```ts
import { WORK_TYPES, type PlanMethod } from '@cc/shared';
import { ValidationError } from '../errors.ts';
import { isWorkType } from './craft.ts';
import { clean, lines } from './text.ts';

export const METHOD_MISSING =
  'Önce işin nasıl yapılacağını yaz: methodRead ile iş türünün yöntemine bak, sonra plana yöntemi ekle (method): iş türü (workType), en az iki aşama (her biri için name, role, review) ve en az bir kalite kontrolü (checks).';

const record = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A plan's method as the coordinator gave it (spec §5.1): a work type, two or more stages, one or more checks. */
export function planMethod(value: unknown): PlanMethod {
  if (value === undefined || value === null) throw new ValidationError(METHOD_MISSING);
  const v = record(value);
  if (!v) throw new ValidationError('Yöntem (method) bir nesne olmalı: workType, stages, checks.');
  if (!isWorkType(v.workType)) throw new ValidationError(`İş türü (workType) ${WORK_TYPES.join(', ')} değerlerinden biri olmalı.`);
  if (!Array.isArray(v.stages) || v.stages.length < 2) {
    throw new ValidationError('Yöntemde en az iki aşama (stages) olmalı: her biri için ad (name), kim yapar (role), incelemesi var mı (review).');
  }
  if (v.stages.length > 12) throw new ValidationError('Yöntemde en fazla 12 aşama olabilir.');
  const stages = v.stages.map((raw, i) => {
    const st = record(raw);
    if (!st) throw new ValidationError(`${i + 1}. aşama bir nesne olmalı: name, role, review.`);
    if (st.review !== undefined && typeof st.review !== 'boolean') throw new ValidationError(`${i + 1}. aşamanın review alanı true ya da false olmalı.`);
    return { name: clean(text(st.name), `${i + 1}. aşamanın adı`, 120, true), role: clean(text(st.role), `${i + 1}. aşamanın rolü`, 120, true), review: st.review === true };
  });
  if (v.checks !== undefined && !(Array.isArray(v.checks) && v.checks.every((c) => typeof c === 'string'))) {
    throw new ValidationError('Kalite kontrolleri (checks) metinlerden oluşan bir liste olmalı.');
  }
  const checks = lines(v.checks as string[] | undefined, 'Kalite kontrolleri', 12, 300);
  if (checks.length === 0) throw new ValidationError('Yöntemde en az bir kalite kontrolü (checks) olmalı: işin iyi olduğunu neyle anlayacaksın?');
  return { workType: v.workType, stages, checks };
}
```

- [ ] **Step 5: Company**

In `apps/office-server/src/company/company.ts` add the import `import { planMethod } from './review.ts';`, add `method?: unknown;` to `PlanDraft`, and replace `propose` and the end of `revise`:

```ts
  propose(by: string, draft: PlanDraft): Plan {
    this.#assertCoordinator(by);
    const fields = this.#draft(draft);
    const plan = this.#d.plans.create({ ...fields, method: planMethod(draft.method), proposedBy: by });
    this.#emit(by, { type: 'plan.changed', change: 'proposed', plan });
    return plan;
  }
```

In `revise`, after `const merged = this.#draft({...});` add:

```ts
    const method = draft.method === undefined ? (current.method ?? null) : planMethod(draft.method);
```

and change the update line to:

```ts
    const plan = this.#d.plans.update(planId, { ...merged, method, version: current.version + 1, status: 'draft', approvedAt: null });
```

- [ ] **Step 6: Tools**

In `apps/office-server/src/mcp/tools.ts`, after the `difficulty` const, add:

```ts
const method = {
  type: 'object',
  description: 'How the work is done (read methodRead first): the work type, at least two stages with who does each and whether someone else checks it, and at least one quality check.',
  properties: {
    workType: { type: 'string', enum: [...WORK_TYPES] },
    stages: {
      type: 'array',
      minItems: 2,
      items: { type: 'object', properties: { name: s('Stage name.'), role: s('Who does it: a person or a role.'), review: { type: 'boolean', description: 'Someone other than the doer checks it.' } }, required: ['name', 'role'] },
    },
    checks: strings('Quality checks or acceptance evidence, one each.'),
  },
  required: ['workType', 'stages', 'checks'],
};
```

`planPropose` becomes:

```ts
    {
      name: 'planPropose',
      description:
        'Propose a plan card to the owner before starting any work they asked for: goal, approach, the method (work type, stages with who does and who checks each, quality checks — read methodRead first), who works on it (existing people and roles to hire), draft tasks, estimates (share of weekly quota %, money in USD, days) and risks. The owner approves it on screen.',
      inputSchema: object({ title: s('Plan title.'), goal: s('What the owner wants to achieve.'), approach: s('How you will do it.'), method, people: s('Who works on it.'), steps: strings('Draft tasks, one each.'), quotaPct: number('Estimated share of the weekly Claude quota, %.'), usd: number('Estimated money to spend, USD.'), days: number('Estimated days.'), risks: s('What could go wrong.') }, ['title', 'goal', 'approach', 'method']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const plan = company.propose(employee.id, { title: str(args, 'title'), goal: str(args, 'goal'), approach: str(args, 'approach'), method: args.method, people: optStr(args, 'people'), steps: list(args, 'steps'), quotaPct: num(args, 'quotaPct') ?? null, usd: num(args, 'usd') ?? null, days: num(args, 'days') ?? null, risks: optStr(args, 'risks') });
        return `Plan kartı açıldı (${plan.id}). Sahibinin onayını bekle; onay gelince sana haber verilecek.`;
      },
    },
```

In `planRevise` add `method` to the schema properties (not required) and `method: args.method` to the draft passed to `company.revise`.

- [ ] **Step 7: Existing tests propose with a method**

Every existing test that proposes a plan now passes `METHOD`. Run this once from the repo root (it rewrites `company.propose(X, {` / `.propose(X, {` and `'planPropose', {` call sites and adds the import where missing):

```bash
python3 - <<'EOF'
import re, pathlib
root = pathlib.Path('apps/office-server/test')
for p in sorted(root.glob('*.ts')):
    if p.name in ('plan-method.test.ts', 'company-helpers.ts'):
        continue
    s = p.read_text()
    n = s
    n = re.sub(r"(\.propose\(\s*[^,()]+(?:\.[\w]+|\(\))*\s*,\s*\{)(?!\s*method)", r"\1 method: METHOD,", n)
    n = re.sub(r"('planPropose',\s*\{)(?!\s*method)", r"\1 method: METHOD,", n)
    if n == s:
        continue
    if 'METHOD' not in s:
        m = re.search(r"^import \{([^}]*)\} from '\./company-helpers\.ts';", n, flags=re.M)
        if m:
            n = n.replace(m.group(0), f"import {{{m.group(1).rstrip()}, METHOD }} from './company-helpers.ts';")
        else:
            first = re.search(r"^import .*?;\n", n, flags=re.M | re.S)
            n = n[: first.end()] + "import { METHOD } from './company-helpers.ts';\n" + n[first.end():]
    p.write_text(n)
    print('updated', p)
EOF
```

- [ ] **Step 8: Run the whole server suite**

Run: `cd apps/office-server && npx vitest run > /tmp/cc-t3.log 2>&1; tail -15 /tmp/cc-t3.log`
Expected: all pass (the real-claude files skipped). Any remaining failure is a propose call the script did not match: add `method: METHOD,` there by hand.

- [ ] **Step 9: Commit**

```bash
git add apps/office-server/src/company/review.ts apps/office-server/src/company/company.ts apps/office-server/src/mcp/tools.ts apps/office-server/test
git commit -m "feat(company): a plan card says how the work is done — work type, stages with roles, quality checks"
```

---

### Task 4: A hand-in carries evidence

**Files:**
- Modify: `apps/office-server/src/company/company.ts` (`finish`)
- Modify: `apps/office-server/src/company/archive.ts`
- Modify: `apps/office-server/src/mcp/tools.ts` (`taskFinish`)
- Modify: `apps/office-server/src/company/dispatcher.ts` (delivery's closing line)
- Modify: existing tests that hand in a task with a definition of done
- Test: `apps/office-server/test/evidence.test.ts` (new), `apps/office-server/test/mcp-tools.test.ts`

**Interfaces:**
- Consumes: `TaskResult.evidence` (Task 1).
- Produces: `Company.finish(by, taskId, result)` requires `result.evidence` of length ≥ `task.done.length` for `work` tasks; `archiveTask` writes `## Bitti tanımı ve kanıt`; dispatcher constant `WORK_CLOSING` (used again in Task 5).

- [ ] **Step 1: Write the failing tests**

Create `apps/office-server/test/evidence.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
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
  const c = companyFor(s, f);
  const ada = c.company.hire(OWNER, { name: 'Ada', role: 'r' });
  return { ...s, ...c, ada };
}

describe('a hand-in carries evidence (spec §5.3)', () => {
  it('refuses a hand-in with fewer evidence lines than done items, saying how many', () => {
    const t = make();
    const task = t.company.createTask(OWNER, { assignee: t.ada.id, title: 'README', done: ['kurulum anlatılıyor', 'adımlar çalıştı', 'lisans var'] });
    expect(() => t.company.finish(t.ada.id, task.id, { summary: 'yazdım', outputs: [], learned: '' })).toThrow(/3 madde var/);
    expect(() => t.company.finish(t.ada.id, task.id, { summary: 'yazdım', outputs: [], learned: '', evidence: ['hepsi tamam'] })).toThrow(/3 madde var/);
    expect(t.tasks.get(task.id).status).toBe('waiting');
  });

  it('keeps the evidence with the result and writes item–evidence pairs to the archive', () => {
    const t = make();
    const task = t.company.createTask(OWNER, { assignee: t.ada.id, title: 'README', done: ['kurulum anlatılıyor', 'adımlar çalıştı'] });
    const done = t.company.finish(t.ada.id, task.id, { summary: 'yazdım', outputs: [], learned: '', evidence: ['README.md 1–3. bölüm', 'boş klasörde npm i && npm start çalıştı', 'ek: yazım denetimi'] });
    expect(done.status).toBe('done');
    expect(done.result?.evidence).toEqual(['README.md 1–3. bölüm', 'boş klasörde npm i && npm start çalıştı', 'ek: yazım denetimi']);
    const teslim = readFileSync(join(t.dataDir, done.result!.archive!, 'teslim.md'), 'utf8');
    expect(teslim).toContain('## Bitti tanımı ve kanıt');
    expect(teslim).toContain('- kurulum anlatılıyor\n  Kanıt: README.md 1–3. bölüm');
    expect(teslim).toContain('- adımlar çalıştı\n  Kanıt: boş klasörde npm i && npm start çalıştı');
    expect(teslim).toContain('- Kanıt: ek: yazım denetimi');
  });

  it('needs no evidence when the task has no definition of done, and none for a hand-over', () => {
    const t = make();
    const free = t.company.createTask(OWNER, { assignee: t.ada.id, title: 'Bak' });
    expect(t.company.finish(t.ada.id, free.id, { summary: 'baktım', outputs: [], learned: '' }).status).toBe('done');
    const handover = t.company.beginHandover(t.ada.id);
    expect(handover.done.length).toBeGreaterThan(0);
    expect(t.company.finish(t.ada.id, handover.id, { summary: 'devrettim', outputs: [], learned: '' }).status).toBe('done');
  });

  it('refuses evidence lines that are too long or too many', () => {
    const t = make();
    const task = t.company.createTask(OWNER, { assignee: t.ada.id, title: 'X', done: ['a'] });
    expect(() => t.company.finish(t.ada.id, task.id, { summary: 's', outputs: [], learned: '', evidence: ['x'.repeat(1001)] })).toThrow(/Kanıt/);
    expect(() => t.company.finish(t.ada.id, task.id, { summary: 's', outputs: [], learned: '', evidence: Array.from({ length: 21 }, () => 'k') })).toThrow(/Kanıt/);
  });
});
```

In `apps/office-server/test/mcp-tools.test.ts` append:

```ts
  it('taskFinish takes evidence and says how many lines a hand-in needs', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'Rapor', done: ['rapor.md var', 'sayılar kaynaklı'] });
    await expect(Promise.resolve().then(() => t.call(ada, 'taskFinish', { taskId: task.id, summary: 'bitti' }))).rejects.toThrow(/2 madde var/);
    await t.call(ada, 'taskFinish', { taskId: task.id, summary: 'bitti', evidence: ['rapor.md yazıldı', 'her sayının yanında kaynak'] });
    expect(t.tasks.get(task.id).result?.evidence).toHaveLength(2);
  });
```

In `apps/office-server/test/dispatcher.test.ts`, in the first test add `expect(text).toContain('evidence');`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/office-server && npx vitest run test/evidence.test.ts`
Expected: FAIL — the first hand-in without evidence is accepted.

- [ ] **Step 3: Company**

In `Company.finish`, replace the `handed` block and the summary check with:

```ts
    const evidence = lines(result.evidence, 'Kanıt', 20, 1000);
    const handed: TaskResult = {
      summary: (result.summary ?? '').trim().slice(0, 4000),
      outputs: (result.outputs ?? []).map((o) => String(o).trim()).filter(Boolean).slice(0, 30),
      learned: (result.learned ?? '').trim().slice(0, 4000),
      ...(evidence.length ? { evidence } : {}),
    };
    if (!handed.summary) throw new ValidationError('Teslim özeti boş olamaz.');
    // A hand-over's items are instructions for leaving, not claims to prove.
    if (task.kind === 'work' && evidence.length < task.done.length) {
      throw new ValidationError(`Bitti tanımında ${task.done.length} madde var; her biri için bir kanıt yaz (evidence, aynı sırayla): ne yaptın ve nasıl doğruladın.`);
    }
```

- [ ] **Step 4: Archive**

In `apps/office-server/src/company/archive.ts`, add before `archiveTask`:

```ts
/** Each definition-of-done item with its evidence, then any evidence beyond the items (spec §5.3). */
function evidenceSection(done: string[], evidence: string[]): string[] {
  if (done.length === 0 && evidence.length === 0) return [];
  const rows = done.map((d, i) => `- ${d}\n  Kanıt: ${evidence[i] ?? '—'}`);
  for (const extra of evidence.slice(done.length)) rows.push(`- Kanıt: ${extra}`);
  return ['## Bitti tanımı ve kanıt', '', ...rows, ''];
}
```

and in `body`, after `o.result.summary, '',` insert:

```ts
    ...evidenceSection(o.task.done, o.result.evidence ?? []),
```

- [ ] **Step 5: Tool and delivery**

`taskFinish` in `apps/office-server/src/mcp/tools.ts` becomes:

```ts
    {
      name: 'taskFinish',
      description:
        'Hand in a task you finished: a short summary of the result, one line of evidence per definition-of-done item (same order: what you did and how you checked it), the files you produced, and what you learned. Always call this when a task is done.',
      inputSchema: object({ taskId: s('The task id from the task message.'), summary: s('What was done, in 1–5 sentences.'), evidence: strings('One line of proof per definition-of-done item, in the same order.'), outputs: strings('Files you produced (paths).'), learned: s('Anything worth remembering for later work.') }, ['taskId', 'summary']),
      kinds: EVERYONE,
      run: ({ employee }, args) => {
        const task = company.finish(employee.id, str(args, 'taskId'), { summary: str(args, 'summary'), evidence: list(args, 'evidence'), outputs: list(args, 'outputs') ?? [], learned: optStr(args, 'learned') ?? '' });
        return `“${task.title}” teslim edildi${task.result?.archive ? ` (arşiv: ${task.result.archive})` : ''}. İsteyen ve koordinatör haberdar edildi.`;
      },
    },
```

In `apps/office-server/src/company/dispatcher.ts`, add after `NOTICES_PREFIX`:

```ts
export const WORK_CLOSING =
  'İş bitince `taskFinish` ile teslim et: görev no, kısa özet, bitti tanımının her maddesi için bir kanıt (evidence, aynı sırayla), ürettiğin dosyalar, öğrendiklerin. Takılırsan `taskUpdate` ile "blocked" yap ve nedenini yaz; başka birinin yapması gereken bir parça çıkarsa `taskPass` kullan.';
```

and in `#delivery`, replace the closing paragraph (the line starting `İş bitince \`taskFinish\``) with `${WORK_CLOSING}`.

- [ ] **Step 6: Existing tests hand in with evidence**

Run: `cd apps/office-server && npx vitest run > /tmp/cc-t4.log 2>&1; grep -E "FAIL|madde var" /tmp/cc-t4.log | head -40`
For every failure saying "Bitti tanımında N madde var", add `evidence: [...]` with N short lines to that `finish(...)` / `'taskFinish'` call (the line before it creates the task with its `done` list). The fake claude (`test/fake-claude.mjs`) hands in through MCP only when a test scripts it: if a scripted hand-in has a `done` list, add the evidence to the script's arguments the same way.

- [ ] **Step 7: Run the whole server suite**

Run: `cd apps/office-server && npx vitest run > /tmp/cc-t4.log 2>&1; tail -8 /tmp/cc-t4.log`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/office-server/src apps/office-server/test
git commit -m "feat(company): a hand-in carries one line of evidence per item of the definition of done"
```

---

### Task 5: The review gate

**Files:**
- Modify: `apps/office-server/src/company/review.ts` (add `reviewFindings`, `reviewBrief`, `REVIEW_ROUNDS`)
- Modify: `apps/office-server/src/company/company.ts` (`TaskInput.reviewer`, `createTask`, `assign`, `finish`, `reviewDecide`, helpers)
- Modify: `apps/office-server/src/company/notices.ts` (topics, digest group)
- Modify: `apps/office-server/src/company/dispatcher.ts` (delivery, reminder, escalation texts)
- Modify: `apps/office-server/src/mcp/tools.ts` (`reviewer` on taskCreate/taskPass/taskAssign, `reviewDecide`, `myTasks` line, `taskFinish` reply)
- Test: `apps/office-server/test/review.test.ts` (new), `apps/office-server/test/dispatcher.test.ts`, `apps/office-server/test/mcp-tools.test.ts`

**Interfaces:**
- Consumes: Task 1 types and store; `WORK_CLOSING` (Task 4); evidence (Task 4).
- Produces: `TaskInput.reviewer?: string | null`; `Company.assign(by, taskId, assignee, o: { difficulty?; reviewer?: string | null })`; `Company.reviewDecide(by, reviewTaskId, d: { decision: unknown; findings?: unknown; note?: string }): Task` (returns the reviewed task); notice topics `review.approved` (info), `review.changes` (info), `review.stuck` (decision); `REVIEW_CLOSING` from dispatcher; MCP tool `reviewDecide`.

- [ ] **Step 1: Write the failing tests**

Create `apps/office-server/test/review.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type Task } from '@cc/shared';
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
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'yazar' });
  const can = c.company.hire(coordinator.id, { name: 'Can', role: 'editör' });
  const plan = c.company.propose(coordinator.id, { title: 'Metin', goal: 'g', approach: 'a', method: METHOD });
  c.company.approve(plan.id);
  const task = c.company.createTask(coordinator.id, { assignee: ada.id, title: 'Tanıtım metni', done: ['iki cümle', 'marka dili'], planId: plan.id, reviewer: can.id, difficulty: 'hard' });
  const handIn = (summary = 'yazdım') => c.company.finish(ada.id, task.id, { summary, outputs: [], learned: 'kısa yaz', evidence: ['metin.md iki cümle', 'el kitabına baktım'] });
  const reviewOf = (): Task => c.tasks.list({ assignee: can.id }).filter((t) => t.kind === 'review').at(-1)!;
  return { ...s, ...c, coordinator, ada, can, plan, task, handIn, reviewOf };
}

const topics = (t: ReturnType<typeof make>, id: string) => t.notices.pending(id).map((n) => n.topic);

describe('the review gate (spec §5.2)', () => {
  it('a hand-in with a reviewer goes to review, and the reviewer gets a review task with the items and the evidence', () => {
    const t = make();
    const inReview = t.handIn();
    expect(inReview).toMatchObject({ status: 'review', round: 1, finishedAt: null });
    expect(inReview.result?.evidence).toHaveLength(2);
    const review = t.reviewOf();
    expect(review).toMatchObject({ kind: 'review', reviewOf: t.task.id, assignee: t.can.id, planId: t.plan.id, status: 'waiting', difficulty: 'hard', priority: t.task.priority });
    expect(review.title).toBe('İnceleme: Tanıtım metni (tur 1)');
    expect(review.description).toContain('1. iki cümle\n   Kanıt: metin.md iki cümle');
    expect(review.description).toContain('yazdım');
    expect(t.plans.get(t.plan.id).status).toBe('approved');
    expect(topics(t, t.coordinator.id)).not.toContain('task.finished');
  });

  it('approve closes the task: requester and coordinator hear, the doer hears it passed with the minor notes, the plan can finish', () => {
    const t = make();
    t.handIn();
    const closed = t.company.reviewDecide(t.can.id, t.reviewOf().id, { decision: 'approve', findings: [{ severity: 'minor', text: 'virgül' }] });
    expect(closed).toMatchObject({ id: t.task.id, status: 'done' });
    expect(t.tasks.get(t.reviewOf().id)).toMatchObject({ status: 'done', result: { review: { decision: 'approve', findings: [{ severity: 'minor', text: 'virgül' }] } } });
    expect(t.notices.pending(t.ada.id).find((n) => n.topic === 'review.approved')?.text).toContain('virgül');
    expect(t.plans.get(t.plan.id).status).toBe('done');
  });

  it('changes sends the task back to the doer; the next hand-in opens round 2; from round 3 the coordinator must decide', () => {
    const t = make();
    t.handIn();
    const back = t.company.reviewDecide(t.can.id, t.reviewOf().id, { decision: 'changes', findings: [{ severity: 'minor', text: 'ton' }, { severity: 'important', text: 'üç cümle olmuş' }] });
    expect(back).toMatchObject({ status: 'waiting', round: 1, startedAt: null });
    expect(t.tasks.latestReview(t.task.id)?.result?.review?.findings.map((f) => f.severity)).toEqual(['important', 'minor']);
    expect(topics(t, t.coordinator.id)).toContain('review.changes');
    expect(t.handIn('düzelttim').round).toBe(2);
    expect(t.reviewOf().title).toBe('İnceleme: Tanıtım metni (tur 2)');
    t.company.reviewDecide(t.can.id, t.reviewOf().id, { decision: 'changes', findings: [{ severity: 'critical', text: 'yanlış ürün adı' }] });
    expect(topics(t, t.coordinator.id)).not.toContain('review.stuck');
    t.handIn('yine düzelttim');
    t.company.reviewDecide(t.can.id, t.reviewOf().id, { decision: 'changes', findings: [{ severity: 'important', text: 'hâlâ uzun' }] });
    const stuck = t.notices.pending(t.coordinator.id).find((n) => n.topic === 'review.stuck');
    expect(stuck?.kind).toBe('decision');
    expect(stuck?.text).toMatch(/3 turdur/);
  });

  it('refuses a decision that does not match its findings, and malformed findings', () => {
    const t = make();
    t.handIn();
    const id = t.reviewOf().id;
    expect(() => t.company.reviewDecide(t.can.id, id, { decision: 'approve', findings: [{ severity: 'important', text: 'eksik' }] })).toThrow(/onaylanamaz/);
    expect(() => t.company.reviewDecide(t.can.id, id, { decision: 'changes', findings: [{ severity: 'minor', text: 'ton' }] })).toThrow(/en az bir kritik ya da önemli/);
    expect(() => t.company.reviewDecide(t.can.id, id, { decision: 'changes' })).toThrow(/en az bir kritik ya da önemli/);
    expect(() => t.company.reviewDecide(t.can.id, id, { decision: 'maybe' })).toThrow(/approve ya da changes/);
    expect(() => t.company.reviewDecide(t.can.id, id, { decision: 'changes', findings: ['eksik'] })).toThrow(/önem derecesi/);
    expect(() => t.company.reviewDecide(t.can.id, id, { decision: 'changes', findings: [{ severity: 'blocker', text: 'x' }] })).toThrow(/önem derecesi/);
    expect(() => t.company.reviewDecide(t.can.id, id, { decision: 'changes', findings: 'eksik' })).toThrow(/liste/);
    expect(t.tasks.get(t.task.id).status).toBe('review');
  });

  it('only the reviewer or the coordinator decides; never the doer, never twice; taskFinish cannot close a review', () => {
    const t = make();
    t.handIn();
    const id = t.reviewOf().id;
    expect(() => t.company.reviewDecide(t.ada.id, id, { decision: 'approve' })).toThrow(/sana verilmedi|Kendi işini/);
    expect(() => t.company.finish(t.can.id, id, { summary: 'onay', outputs: [], learned: '' })).toThrow(/reviewDecide/);
    expect(() => t.company.reviewDecide(t.can.id, t.task.id, { decision: 'approve' })).toThrow(/inceleme görevi değil/);
    expect(() => t.company.finish(t.ada.id, t.task.id, { summary: 'yine', outputs: [], learned: '', evidence: ['a', 'b'] })).toThrow(/incelemede/);
    t.company.reviewDecide(t.coordinator.id, id, { decision: 'approve' });
    expect(() => t.company.reviewDecide(t.can.id, id, { decision: 'approve' })).toThrow(/zaten karara/);
  });

  it('the coordinator cannot review its own task, even as coordinator', () => {
    const t = make();
    const own = t.company.createTask(OWNER, { assignee: t.coordinator.id, title: 'Koordinatörün işi', reviewer: t.can.id });
    t.company.finish(t.coordinator.id, own.id, { summary: 'yaptım', outputs: [], learned: '' });
    const review = t.tasks.list({ assignee: t.can.id }).find((x) => x.reviewOf === own.id)!;
    expect(() => t.company.reviewDecide(t.coordinator.id, review.id, { decision: 'approve' })).toThrow(/Kendi işini/);
  });

  it('the doer is never the reviewer: refused at create, at pass, and when assigning either way', () => {
    const t = make();
    expect(() => t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'X', reviewer: t.ada.id })).toThrow(/kendi işinin inceleyicisi/);
    expect(() => t.company.createTask(t.ada.id, { assignee: t.can.id, title: 'Pas', reviewer: t.can.id })).toThrow(/kendi işinin inceleyicisi/);
    const passed = t.company.createTask(t.ada.id, { assignee: t.can.id, title: 'Pas', reviewer: t.ada.id });
    expect(passed.reviewer).toBe(t.ada.id);
    expect(() => t.company.assign(t.coordinator.id, passed.id, t.ada.id)).toThrow(/inceleyicisi ona verilemez/);
    t.handIn();
    const review = t.reviewOf();
    expect(() => t.company.assign(t.coordinator.id, review.id, t.ada.id)).toThrow(/kendi işinin inceleyicisi/);
    expect(() => t.company.assign(t.coordinator.id, t.task.id, t.can.id)).toThrow(/incelemede/);
  });

  it('moving a review task to someone else makes them the reviewer of the later rounds', () => {
    const t = make();
    const ece = t.company.hire(t.coordinator.id, { name: 'Ece', role: 'editör' });
    t.handIn();
    t.company.assign(t.coordinator.id, t.reviewOf().id, ece.id);
    expect(t.tasks.get(t.task.id).reviewer).toBe(ece.id);
    const review = t.tasks.list({ assignee: ece.id }).find((x) => x.kind === 'review')!;
    t.company.reviewDecide(ece.id, review.id, { decision: 'changes', findings: [{ severity: 'important', text: 'eksik' }] });
    t.handIn('düzelttim');
    expect(t.tasks.list({ assignee: ece.id }).filter((x) => x.kind === 'review')).toHaveLength(2);
  });

  it('a let-go reviewer: the coordinator reviews; with no one who may review, the task closes as before', async () => {
    const t = make();
    t.roster.update(t.can.id, { lifecycle: 'archived' });
    t.handIn();
    const review = t.tasks.list({ assignee: t.coordinator.id }).find((x) => x.kind === 'review');
    expect(review?.reviewOf).toBe(t.task.id);
    const lonely = t.company.createTask(OWNER, { assignee: t.coordinator.id, title: 'Tek başına', reviewer: t.can.id });
    expect(t.company.finish(t.coordinator.id, lonely.id, { summary: 'bitti', outputs: [], learned: '' }).status).toBe('done');
  });

  it('changes on a let-go doer’s task tells the coordinator to hand it to someone else', () => {
    const t = make();
    t.handIn();
    t.roster.update(t.ada.id, { lifecycle: 'archived' });
    t.company.reviewDecide(t.can.id, t.reviewOf().id, { decision: 'changes', findings: [{ severity: 'important', text: 'eksik' }] });
    const orphaned = t.notices.pending(t.coordinator.id).find((n) => n.topic === 'task.orphaned');
    expect(orphaned?.text).toMatch(/taskAssign/);
  });

  it('the coordinator handing in for the doer still goes to review; a task without a reviewer closes as before', () => {
    const t = make();
    expect(t.company.finish(t.coordinator.id, t.task.id, { summary: 'onun yerine', outputs: [], learned: '', evidence: ['a', 'b'] }).status).toBe('review');
    const plain = t.company.createTask(OWNER, { assignee: t.ada.id, title: 'Düz iş' });
    expect(t.company.finish(t.ada.id, plain.id, { summary: 'bitti', outputs: [], learned: '' }).status).toBe('done');
  });
});
```

In `apps/office-server/test/dispatcher.test.ts`, append a `describe` block (it uses the file's existing `make`, `systemMessages`, `waitFor`, `until`, `sleep`, `NUDGE_PREFIX`):

```ts
describe('Dispatcher — reviews', () => {
  it('delivers a review task with reviewDecide instructions; a sent-back task comes back with the findings', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const can = t.company.hire(OWNER, { name: 'Can', role: 'r' });
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'Metin', done: ['iki cümle'], reviewer: can.id });
    await waitFor(t.events, (e) => e.employeeId === ada.id && e.event.type === 'message.user' && e.event.text.includes('İnceleyen: Can'));
    t.company.finish(ada.id, task.id, { summary: 'yazdım', outputs: [], learned: '', evidence: ['metin.md'] });
    const reviewMsg = await waitFor(t.events, (e) => e.employeeId === can.id && e.event.type === 'message.user' && e.event.text.includes('İnceleme: Metin'));
    const text = (reviewMsg.event as { text: string }).text;
    expect(text).toContain('reviewDecide');
    expect(text).not.toContain('`taskFinish` ile teslim et');
    const review = t.tasks.list({ assignee: can.id }).find((x) => x.kind === 'review')!;
    t.company.reviewDecide(can.id, review.id, { decision: 'changes', findings: [{ severity: 'important', text: 'üç cümle olmuş' }] });
    const back = await waitFor(t.events, (e) => e.employeeId === ada.id && e.event.type === 'message.user' && e.event.text.includes('değişiklik istendi'));
    expect((back.event as { text: string }).text).toContain('[önemli] üç cümle olmuş');
  });

  it('reminds a reviewer to decide with reviewDecide', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const can = t.company.hire(OWNER, { name: 'Can', role: 'r' });
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'Metin', reviewer: can.id });
    await until(() => t.tasks.get(task.id).status === 'in_progress', 8000);
    t.company.finish(ada.id, task.id, { summary: 'yazdım', outputs: [], learned: '' });
    await until(() => systemMessages(t.events.list({ limit: 5000 }), can.id).some((m) => m.startsWith(NUDGE_PREFIX)), 8000);
    expect(systemMessages(t.events.list({ limit: 5000 }), can.id).find((m) => m.startsWith(NUDGE_PREFIX))).toContain('reviewDecide');
  });
});
```

In `apps/office-server/test/mcp-tools.test.ts`: add `'reviewDecide'` to the member list (after `'recordSpend'`), and append:

```ts
  it('names a reviewer by name, and the reviewer decides with reviewDecide', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const can = t.company.hire(OWNER, { name: 'Can', role: 'r' });
    await t.call(ada, 'taskPass', { to: 'Can', title: 'Çeviri', done: ['tr metin'], reviewer: 'Ada' });
    const task = t.tasks.list({ assignee: can.id })[0]!;
    expect(task.reviewer).toBe(ada.id);
    expect(await t.call(can, 'taskFinish', { taskId: task.id, summary: 'çevirdim', evidence: ['ceviri.md'] })).toMatch(/incelemeye gitti/);
    const review = t.tasks.list({ assignee: ada.id }).find((x) => x.kind === 'review')!;
    expect(await t.call(ada, 'myTasks')).toContain('İnceleme: Çeviri');
    expect(await t.call(ada, 'reviewDecide', { taskId: review.id, decision: 'changes', findings: [{ severity: 'important', text: 'bir paragraf eksik' }] })).toMatch(/Değişiklik istendi/);
    expect(t.tasks.get(task.id).status).toBe('waiting');
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/office-server && npx vitest run test/review.test.ts`
Expected: FAIL — the hand-in closes as `done` (no review), `reviewDecide is not a function`.

- [ ] **Step 3: Review helpers**

Append to `apps/office-server/src/company/review.ts` (and extend its `@cc/shared` import to `REVIEW_SEVERITIES, WORK_TYPES, type PlanMethod, type ReviewFinding, type ReviewSeverity, type Task`):

```ts
/** From this many review rounds sent back on, the coordinator decides how to go on (spec §5.2). */
export const REVIEW_ROUNDS = 3;

/** A reviewer's findings, checked and sorted most severe first. */
export function reviewFindings(value: unknown): ReviewFinding[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError('Bulgular (findings) bir liste olmalı: her biri için severity ve text.');
  if (value.length > 30) throw new ValidationError('En fazla 30 bulgu yazılabilir.');
  return value
    .map((raw, i) => {
      const f = record(raw);
      if (!f || !(REVIEW_SEVERITIES as readonly unknown[]).includes(f.severity)) {
        throw new ValidationError(`${i + 1}. bulgunun önem derecesi (severity) critical, important ya da minor olmalı; metni text alanına yaz.`);
      }
      return { severity: f.severity as ReviewSeverity, text: clean(text(f.text), `${i + 1}. bulgu`, 2000, true) };
    })
    .sort((a, b) => REVIEW_SEVERITIES.indexOf(a.severity) - REVIEW_SEVERITIES.indexOf(b.severity));
}

/** What the reviewer reads: the work, each done item with its evidence, the summary and the outputs. */
export function reviewBrief(task: Task, doer: string, round: number): string {
  const r = task.result;
  const ev = r?.evidence ?? [];
  const items = task.done.length
    ? task.done.map((d, i) => `${i + 1}. ${d}\n   Kanıt: ${ev[i] ?? '—'}`).join('\n')
    : ev.length
      ? ev.map((e) => `- ${e}`).join('\n')
      : '(bitti tanımı yok)';
  return [
    `${doer} “${task.title}” görevini teslim etti (inceleme turu ${round}); görev senin kararınla kapanır.`,
    '',
    '### İş',
    task.description || '(açıklama yok)',
    '',
    '### Bitti tanımı ve kanıt',
    items,
    '',
    '### Teslim özeti',
    r?.summary ?? '',
    ...(r?.outputs.length ? ['', '### Çıktılar', ...r.outputs.map((o) => `- ${o}`)] : []),
    ...(r?.archive ? ['', `Arşiv: ${r.archive}`] : []),
  ]
    .join('\n')
    .slice(0, 12000);
}
```

- [ ] **Step 4: Notice topics**

In `apps/office-server/src/company/notices.ts`, add to `NOTICE_TOPICS` (before `'report.reminder'`):

```ts
  /** Your hand-in passed its review. */
  'review.approved': 'info',
  /** A reviewer sent a task back with findings (the coordinator hears). */
  'review.changes': 'info',
  /** A task was sent back for the third time or more: the coordinator changes the approach or brings it to the owner. */
  'review.stuck': 'decision',
```

and add a digest group after `Teslimler`:

```ts
  { title: 'İncelemeler', topics: ['review.approved', 'review.changes'] },
```

- [ ] **Step 5: Company**

In `apps/office-server/src/company/company.ts`:

Extend imports: `REVIEW_DECISIONS, reviewTally, type ReviewDecision` from `@cc/shared`; `REVIEW_ROUNDS, planMethod, reviewBrief, reviewFindings` from `./review.ts`.

`TaskInput` gets:

```ts
  /** Who approves the hand-in before the task closes (spec §5.2): an employee id; never the assignee. */
  reviewer?: string | null;
```

In `createTask`, after `const assignee = …` validation and before `const title`, nothing changes; just before `const task = this.#d.tasks.create({` add `const reviewer = this.#reviewerOf(input.reviewer, assignee.id);` and add `reviewer,` to the object passed to `tasks.create`.

`assign` becomes:

```ts
  /** Gives a task to someone (and, with `difficulty`, says anew how hard it is; with `reviewer`, who checks it). */
  assign(by: string, taskId: string, assignee: string, o: { difficulty?: TaskDifficulty | null; reviewer?: string | null } = {}): Task {
    this.#assertManages(by, this.#d.tasks.get(taskId).assignee, assignee);
    const task = this.#d.tasks.get(taskId);
    // Finishing a hand-over lets its holder go: moving it would fire someone the owner never chose.
    if (task.kind === 'handover') throw new ConflictError('Devir görevi başkasına verilemez; sahibi beklemek istemezse Hemen çıkar ile devri atlayabilir.');
    const holder = this.#person(task.assignee);
    // A running task stays with its assignee — unless they were fired or left it open after the office's reminder.
    if (task.status === 'in_progress' && !task.nudged && holder !== null && holder.lifecycle !== 'archived') {
      throw new ConflictError('Bu görev şu an sürüyor; bitmeden başkasına verilemez.');
    }
    if (task.status === 'done' || task.status === 'cancelled') throw new ConflictError('Bu görev kapandı.');
    if (task.status === 'review') throw new ConflictError('Bu görev incelemede; inceleme kararı gelmeden başkasına verilemez.');
    const target = this.#d.roster.get(assignee);
    if (target.lifecycle === 'archived') throw new ConflictError(`${target.name} işten çıkarıldı.`);
    let reviewer = task.reviewer ?? null;
    if (task.kind === 'review') {
      if (task.reviewOf && this.#d.tasks.get(task.reviewOf).assignee === target.id) throw new ConflictError(SELF_REVIEW);
    } else {
      if (o.reviewer !== undefined) reviewer = this.#reviewerOf(o.reviewer, target.id);
      if (reviewer === target.id) throw new ConflictError('Bu görevin inceleyicisi ona verilemez: yapan kendi işini onaylayamaz. Önce başka bir inceleyici seç (reviewer).');
    }
    const difficulty = o.difficulty === undefined ? task.difficulty : difficultyOf(o.difficulty);
    const next = this.#d.tasks.update(taskId, { assignee: target.id, status: 'waiting', startedAt: null, nudged: false, difficulty, reviewer });
    // Whoever takes over a review also reviews the later rounds.
    if (task.kind === 'review' && task.reviewOf) this.#d.tasks.update(task.reviewOf, { reviewer: target.id });
    if (holder && holder.id !== target.id && holder.lifecycle !== 'archived') {
      const started = task.status === 'in_progress' || task.status === 'blocked';
      this.#d.notices.add(
        holder.id,
        started ? 'task.taken' : 'task.moved',
        `“${task.title}” görevi (no ${task.id}) ${target.name} adlı çalışana verildi; üzerinde çalışmayı bırak.`,
      );
    }
    this.#taskEvent('assigned', next);
    return next;
  }
```

Add near the other module constants:

```ts
const SELF_REVIEW = 'Bir işi yapan kendi işinin inceleyicisi olamaz; başka birini seç.';
```

Replace `finish` with:

```ts
  finish(by: string, taskId: string, result: TaskResult): Task {
    const task = this.#d.tasks.get(taskId);
    const coordinator = this.coordinator();
    if (task.assignee !== by && coordinator?.id !== by) throw new ForbiddenError('Yalnız görevi üstlenen ya da koordinatör teslim edebilir.');
    if (task.status === 'done' || task.status === 'cancelled') throw new ConflictError('Bu görev zaten kapandı.');
    if (task.kind === 'review') throw new ConflictError('Bu bir inceleme görevi: kararını reviewDecide ile ver (approve ya da changes, bulgular önem dereceleriyle).');
    if (task.status === 'review') throw new ConflictError('Bu görev incelemede; inceleyicinin kararını bekle.');
    const evidence = lines(result.evidence, 'Kanıt', 20, 1000);
    const handed: TaskResult = {
      summary: (result.summary ?? '').trim().slice(0, 4000),
      outputs: (result.outputs ?? []).map((o) => String(o).trim()).filter(Boolean).slice(0, 30),
      learned: (result.learned ?? '').trim().slice(0, 4000),
      ...(evidence.length ? { evidence } : {}),
    };
    if (!handed.summary) throw new ValidationError('Teslim özeti boş olamaz.');
    // A hand-over's items are instructions for leaving, not claims to prove.
    if (task.kind === 'work' && evidence.length < task.done.length) {
      throw new ValidationError(`Bitti tanımında ${task.done.length} madde var; her biri için bir kanıt yaz (evidence, aynı sırayla): ne yaptın ve nasıl doğruladın.`);
    }
    const at = this.#now();
    const archived = this.#archive(task, handed, at);
    const reviewer = task.kind === 'work' && task.reviewer ? this.#reviewerFor(task) : null;
    if (reviewer) {
      const round = (task.round ?? 0) + 1;
      const next = this.#d.tasks.update(taskId, { status: 'review', result: archived, round });
      this.#taskEvent('in_review', next);
      const review = this.#d.tasks.create({
        kind: 'review', planId: task.planId, title: `İnceleme: ${task.title} (tur ${round})`, description: reviewBrief(next, this.nameOf(task.assignee), round),
        done: [], requester: task.requester, assignee: reviewer.id, priority: task.priority, difficulty: task.difficulty ?? null, dependsOn: [], chainDepth: 0, reviewOf: task.id,
      });
      this.#taskEvent('created', review);
      return next;
    }
    return this.#complete(task, archived, by, at);
  }

  /**
   * The reviewer decides (spec §5.2): approve closes the reviewed task; changes sends it back to the one who did it,
   * with the findings. Returns the reviewed task.
   */
  reviewDecide(by: string, reviewTaskId: string, d: { decision: unknown; findings?: unknown; note?: string }): Task {
    const review = this.#d.tasks.get(reviewTaskId);
    if (review.kind !== 'review' || !review.reviewOf) throw new ValidationError('Bu bir inceleme görevi değil; reviewDecide yalnız “İnceleme:” görevleri içindir.');
    if (review.status === 'done' || review.status === 'cancelled') throw new ConflictError('Bu inceleme zaten karara bağlandı.');
    const coordinator = this.coordinator();
    const task = this.#d.tasks.get(review.reviewOf);
    if (task.assignee === by) throw new ForbiddenError('Kendi işini inceleyemezsin; inceleme başka birinde olmalı.');
    if (review.assignee !== by && coordinator?.id !== by) throw new ForbiddenError('Bu inceleme sana verilmedi.');
    if (task.status !== 'review') throw new ConflictError('Bu görev artık incelemede değil.');
    if (!(REVIEW_DECISIONS as readonly unknown[]).includes(d.decision)) throw new ValidationError('Karar (decision) approve ya da changes olmalı.');
    const decision = d.decision as ReviewDecision;
    const findings = reviewFindings(d.findings);
    const serious = findings.some((f) => f.severity !== 'minor');
    if (decision === 'approve' && serious) throw new ValidationError('Kritik ya da önemli bir bulgu varken onaylanamaz: changes ile geri gönder (bulgu küçükse minor yaz).');
    if (decision === 'changes' && !serious) {
      throw new ValidationError('Değişiklik istiyorsan en az bir kritik ya da önemli bulgu yaz (somut bir senaryoyla); yalnız küçük bulgular varsa approve et, küçükler kayda geçer.');
    }
    const note = clean(d.note, 'Not', 2000, false);
    const me = this.#d.roster.get(by);
    const at = this.#now();
    const tally = reviewTally(findings);
    const closed = this.#d.tasks.update(review.id, {
      status: 'done',
      finishedAt: at,
      result: { summary: `${decision === 'approve' ? 'Onaylandı' : 'Değişiklik istendi'}${tally ? ` (${tally})` : ''}${note ? `: ${note}` : ''}`, outputs: [], learned: '', review: { decision, findings } },
    });
    this.#taskEvent('reviewed', closed);
    if (decision === 'approve') {
      const minor = findings.length ? `; küçük notlar: ${findings.map((f) => f.text).join(' · ')}` : '.';
      this.#d.notices.add(task.assignee, 'review.approved', `“${task.title}” incelemeden geçti (${me.name} onayladı)${minor}`);
      return this.#complete(task, task.result ?? { summary: '', outputs: [], learned: '' }, by, at, me.name);
    }
    const back = this.#d.tasks.update(task.id, { status: 'waiting', startedAt: null, nudged: false });
    this.#taskEvent('updated', back);
    const round = task.round ?? 1;
    const line = `İnceleme: “${task.title}” için değişiklik istendi (tur ${round}, ${me.name}): ${tally}.`;
    const doer = this.#person(task.assignee);
    if (!doer || doer.lifecycle === 'archived') this.#tellCoordinator(by, 'task.orphaned', `${line} ${this.nameOf(task.assignee)} işten çıkarıldı; görevi taskAssign ile başkasına ver.`);
    else if (round >= REVIEW_ROUNDS) this.#tellCoordinator(by, 'review.stuck', `${line} Bu iş ${round} turdur geçemiyor: yaklaşımı değiştir (başka kişi, başka model, işi böl) ya da sahibine götür.`);
    else this.#tellCoordinator(by, 'review.changes', line);
    return back;
  }

  /** The hand-in is kept in the archive; the archive never blocks it (the result is in the database either way). */
  #archive(task: Task, handed: TaskResult, at: number): TaskResult {
    try {
      const assignee = this.#d.roster.get(task.assignee);
      const planTitle = task.planId ? this.#d.plans.get(task.planId).title : null;
      const dir = archiveTask({ dataDir: this.#d.dataDir, desk: deskDir(this.#d.dataDir, assignee.slug), task, result: handed, planTitle, by: assignee.name, now: at });
      return { ...handed, archive: relative(this.#d.dataDir, dir) };
    } catch {
      return handed;
    }
  }

  /** The task closes: the requester and the coordinator hear, the lesson becomes a note, the plan may finish. */
  #complete(task: Task, result: TaskResult, by: string, at: number, approvedBy?: string): Task {
    const next = this.#d.tasks.update(task.id, { status: 'done', result, finishedAt: at });
    const coordinator = this.coordinator();
    const line = `Görev bitti: “${task.title}” (${this.nameOf(task.assignee)}${approvedBy ? `; ${approvedBy} onayladı` : ''}): ${result.summary}`;
    if (task.requester !== OWNER && task.requester !== by) {
      // A requester stuck on their own task is likely waiting for this one: they can go on now.
      const waiting = this.#d.tasks.list({ assignee: task.requester, statuses: ['blocked'], limit: 1 }).length > 0;
      this.#d.notices.add(task.requester, waiting ? 'task.awaited' : 'task.finished', line);
    }
    if (coordinator && coordinator.id !== by && coordinator.id !== task.requester) this.#d.notices.add(coordinator.id, 'task.finished', line);
    this.#taskEvent('finished', next);
    this.#d.memory?.learnedFrom(next, result);
    if (task.planId) this.#maybeFinishPlan(task.planId);
    return next;
  }

  /** A reviewer named for a task: someone in the office, not let go, and never the one who does it. */
  #reviewerOf(value: string | null | undefined, assignee: string): string | null {
    if (value === undefined || value === null || value === '') return null;
    const r = this.#d.roster.get(value);
    if (r.lifecycle === 'archived') throw new ConflictError(`${r.name} işten çıkarıldı; inceleyici olamaz.`);
    if (r.id === assignee) throw new ConflictError(SELF_REVIEW);
    return r.id;
  }

  /** Who reviews a hand-in now: its reviewer, or — if they were let go — the coordinator; never the one who did it. */
  #reviewerFor(task: Task): Employee | null {
    const named = task.reviewer ? this.#person(task.reviewer) : null;
    if (named && named.lifecycle !== 'archived' && named.id !== task.assignee) return named;
    const c = this.coordinator();
    return c && c.id !== task.assignee ? c : null;
  }
```

`#taskEvent`'s `change` parameter type becomes `TaskChange` (import `type TaskChange` from `@cc/shared`).

- [ ] **Step 6: Dispatcher texts**

In `apps/office-server/src/company/dispatcher.ts`: extend the `@cc/shared` import with `REVIEW_SEVERITY_LABELS`; add after `WORK_CLOSING`:

```ts
export const REVIEW_CLOSING =
  'Kararını `reviewDecide` ile ver: bu inceleme görevinin no’su, approve ya da changes, bulgular (her biri için severity — critical, important ya da minor — ve somut bir senaryo). Her iddiayı kendin doğrula; düzeltmeyi kendin yapma, yapana bırak. `taskFinish` kullanma.';
```

In `#delivery`, compute and use:

```ts
    const reviewer = task.kind === 'work' && task.reviewer ? `\nİnceleyen: ${this.#d.company.nameOf(task.reviewer)} — teslimin onun onayıyla kapanır.` : '';
    const returned = task.kind === 'work' && (task.round ?? 0) > 0 ? this.#returned(task) : '';
```

and the returned string becomes:

```ts
    return `## Görev: ${task.title}
Görev no: ${task.id}${plan}
İsteyen: ${this.#d.company.nameOf(task.requester)} · Öncelik: ${task.priority}${level}${reviewer}${deps}${brief}

${task.description || '(açıklama yok)'}${done}${returned}

${task.kind === 'review' ? REVIEW_CLOSING : WORK_CLOSING}`;
```

Add the helper:

```ts
  /** A task sent back by its reviewer: the findings of the last review go with it. */
  #returned(task: Task): string {
    const last = this.#d.tasks.latestReview(task.id);
    const outcome = last?.result?.review;
    if (!last || !outcome || outcome.decision !== 'changes') return '';
    const findings = outcome.findings.map((f) => `- [${REVIEW_SEVERITY_LABELS[f.severity]}] ${f.text}`).join('\n');
    return `\n\n### İnceleme: değişiklik istendi (tur ${task.round}, ${this.#d.company.nameOf(last.assignee)})\n${last.result?.summary ?? ''}\n${findings}\nÖnce kritik ve önemli bulguları kapat; her biri için ne yaptığını teslim özetine yaz.`;
  }
```

`#nudge` becomes:

```ts
  #nudge(task: Task): string {
    if (task.kind === 'review') return `${NUDGE_PREFIX} “${task.title}” (no ${task.id}) hâlâ açık. Kararını \`reviewDecide\` ile ver.`;
    return `${NUDGE_PREFIX} “${task.title}” görevi (no ${task.id}) hâlâ açık görünüyor. Bitirdiysen \`taskFinish\` ile teslim et; takıldıysan \`taskUpdate\` ile durumunu yaz.`;
  }
```

In `#escalate`, the non-hand-over text becomes:

```ts
        : `${name} “${task.title}” ${task.kind === 'review' ? 'incelemesini' : 'görevini'} (no ${task.id}) hatırlatmaya rağmen ${task.kind === 'review' ? 'karara bağlamadı' : 'teslim etmedi'}; sırasındaki işler bekliyor. Ona sor ya da taskAssign ile başkasına ver.`,
```

- [ ] **Step 7: Tools**

In `apps/office-server/src/mcp/tools.ts`:

Extend the `@cc/shared` import with `REVIEW_SEVERITIES`. Add after `difficultyArg`:

```ts
const reviewer = s('Who checks the hand-in before it closes (id or name); never the one who does the task. Give one for any task with a quality risk.');
```

`taskLine` becomes:

```ts
function taskLine(t: Task, company: Company): string {
  const done = t.done.length ? ` — bitti tanımı: ${t.done.join('; ')}` : '';
  const review = t.reviewer ? `, inceleyen ${company.nameOf(t.reviewer)}${t.round ? `, tur ${t.round}` : ''}` : '';
  return `• [${STATUS_TR[t.status]}] ${t.id} “${t.title}” (öncelik ${t.priority}, isteyen ${company.nameOf(t.requester)}${review})${done}`;
}
```

In `officeTools`, add a resolver next to `findPerson`:

```ts
  const reviewerArg = (args: Args): string | undefined => {
    const who = optStr(args, 'reviewer');
    return who === undefined || who === '' ? undefined : findPerson(who).id;
  };
```

`taskPass`, `taskCreate`, `taskAssign`: add `reviewer` to each `inputSchema` properties; in `taskPass` and `taskCreate` add `reviewer: reviewerArg(args)` to the input passed to `company.createTask` (resolve it after the other arguments, next to `findPerson(...)` for `to`); in `taskAssign` pass `{ difficulty: difficultyArg(args), reviewer: reviewerArg(args) }`.

`taskFinish`'s `run` returns:

```ts
        if (task.status === 'review') return `“${task.title}” teslim edildi ve incelemeye gitti; karar gelince ya kapanacak ya da bulgularla sana dönecek.`;
        return `“${task.title}” teslim edildi${task.result?.archive ? ` (arşiv: ${task.result.archive})` : ''}. İsteyen ve koordinatör haberdar edildi.`;
```

Add after `taskFinish`:

```ts
    {
      name: 'reviewDecide',
      description:
        'Decide a review task (its title starts with "İnceleme:"): approve closes the reviewed task; changes sends it back to whoever did it with your findings. Check every claim yourself first. Give each finding a severity (critical: wrong or harmful; important: misses the definition of done; minor: an improvement) and a concrete failure scenario. Approve only without critical or important findings. Never review your own work.',
      inputSchema: object(
        {
          taskId: s('The review task id.'),
          decision: { type: 'string', enum: ['approve', 'changes'] },
          findings: { type: 'array', items: object({ severity: { type: 'string', enum: [...REVIEW_SEVERITIES] }, text: s('What is wrong, with a concrete scenario.') }, ['severity', 'text']), description: 'Findings, most severe first.' },
          note: s('A short overall note.'),
        },
        ['taskId', 'decision'],
      ),
      kinds: EVERYONE,
      run: ({ employee }, args) => {
        const task = company.reviewDecide(employee.id, str(args, 'taskId'), { decision: str(args, 'decision'), findings: args.findings, note: optStr(args, 'note') });
        return task.status === 'done'
          ? `Onaylandı: “${task.title}” kapandı; yapan ve isteyen haberdar edildi.`
          : `Değişiklik istendi: “${task.title}” bulgularınla ${company.nameOf(task.assignee)} adlı çalışana döndü (tur ${task.round ?? 1}).`;
      },
    },
```

- [ ] **Step 8: Run the whole server suite**

Run: `cd apps/office-server && npx vitest run > /tmp/cc-t5.log 2>&1; tail -8 /tmp/cc-t5.log`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add apps/office-server/src apps/office-server/test
git commit -m "feat(company): the review gate — a task with a reviewer closes only on someone else's approval, round by round"
```

---

### Task 6: A plan ends with a retro

**Files:**
- Modify: `apps/office-server/src/company/notices.ts` (`plan.retro`)
- Modify: `apps/office-server/src/company/company.ts` (`#maybeFinishPlan`, `retro`)
- Modify: `apps/office-server/src/mcp/tools.ts` (`planRetro`)
- Test: `apps/office-server/test/retro.test.ts` (new), `apps/office-server/test/mcp-tools.test.ts`, any test asserting the old `plan.done` notice

**Interfaces:**
- Consumes: `Memory.writeNote(by, { title, text, tags, source })` (existing), `Plan.method` (Task 1).
- Produces: notice topic `plan.retro` (decision); `Company.retro(by, planId, r: { wentWell: string; stuck: string; change: string; methodSuggestion?: string }): { retro: Note; suggestion: Note | null }`; MCP tool `planRetro` (coordinator).

- [ ] **Step 1: Write the failing tests**

Create `apps/office-server/test/retro.test.ts`:

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
  const coordinator = c.company.hireCoordinator('sonnet');
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r' });
  const plan = c.company.propose(coordinator.id, { title: 'Tanıtım', goal: 'g', approach: 'a', method: { ...METHOD, workType: 'content' } });
  c.company.approve(plan.id);
  return { ...s, ...c, coordinator, ada, plan };
}

const RETRO = { wentWell: 'Editör erken baktı', stuck: 'Brief geç geldi', change: 'Brief’i plan onayında iste' };

describe('a plan ends with a retro (spec §5.4)', () => {
  it('when the last task closes the coordinator gets a decision to assess, report and go on', () => {
    const t = make();
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Metin', planId: t.plan.id });
    t.company.finish(t.ada.id, task.id, { summary: 'yazdım', outputs: [], learned: '' });
    const notice = t.notices.pending(t.coordinator.id).find((n) => n.topic === 'plan.retro');
    expect(notice?.kind).toBe('decision');
    expect(notice?.text).toContain('planRetro');
    expect(notice?.text).toContain('playbookUpdate');
    expect(t.notices.pending(t.coordinator.id).some((n) => n.topic === 'plan.done')).toBe(false);
  });

  it('writes the retro as a note tagged retro and the work type, and a method suggestion as its own note', () => {
    const t = make();
    t.plans.update(t.plan.id, { status: 'done' });
    const { retro, suggestion } = t.company.retro(t.coordinator.id, t.plan.id, { ...RETRO, methodSuggestion: 'İçerikte brief aşaması plan onayından önce gelsin' });
    expect(retro.tags).toEqual(['retro', 'content']);
    expect(retro.source).toBe(`plan:${t.plan.id}`);
    expect(retro.text).toContain('## Ne iyi gitti\n\nEditör erken baktı');
    expect(retro.text).toContain('## Bir dahaki sefere\n\nBrief’i plan onayında iste');
    expect(suggestion?.tags).toEqual(['yöntem-önerisi', 'content']);
    expect(t.memory.notes('brief').length).toBeGreaterThan(0);
    expect(t.company.retro(t.coordinator.id, t.plan.id, RETRO).suggestion).toBeNull();
  });

  it('refuses a retro of a plan that never started, by anyone but the coordinator, or with an empty part', () => {
    const t = make();
    const draft = t.company.propose(t.coordinator.id, { title: 'Taslak', goal: 'g', approach: 'a', method: METHOD });
    expect(() => t.company.retro(t.coordinator.id, draft.id, RETRO)).toThrow(/başlamadı/);
    expect(() => t.company.retro(t.ada.id, t.plan.id, RETRO)).toThrow(/koordinatör/);
    expect(() => t.company.retro(t.coordinator.id, t.plan.id, { ...RETRO, change: ' ' })).toThrow(/boş olamaz/);
    expect(OWNER).toBe('owner');
  });
});
```

In `apps/office-server/test/mcp-tools.test.ts`: add `'planRetro'` to the coordinator-only list (alphabetical, after `'planPropose'`), and append:

```ts
  it('lets the coordinator write a plan’s retro', async () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    const plan = t.company.propose(c.id, { title: 'P', goal: 'g', approach: 'a', method: METHOD });
    t.company.approve(plan.id);
    expect(await t.call(c, 'planRetro', { planId: plan.id, wentWell: 'iyi', stuck: 'yok', change: 'erken başla' })).toMatch(/playbookUpdate/);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/office-server && npx vitest run test/retro.test.ts`
Expected: FAIL — no `plan.retro` notice; `retro is not a function`.

- [ ] **Step 3: Notice topic and company**

In `NOTICE_TOPICS` add (next to `'plan.done'`, which stays for notices already written):

```ts
  /** A plan has no open task left: assess it (planRetro), write the lessons, report, go on (spec §5.4). */
  'plan.retro': 'decision',
```

In `Company.#maybeFinishPlan`, replace the `notices.add(...)` call with:

```ts
    this.#d.notices.add(
      desk,
      'plan.retro',
      `“${plan.title}” planının açık görevi kalmadı. İş bittiyse planRetro ile değerlendir (ne iyi gitti, ne takıldı, ne değişecek; her şirkete yarayacak bir yöntem önerin varsa methodSuggestion), şirkete özgü dersi playbookUpdate ile el kitabına yaz ve reportToOwner ile sahibine kısaca raporla. Sürüyorsa bu plana yeni görev açabilirsin (plan yeniden açılır).`,
    );
```

Add the method to `Company` (in the plans section, after `decline`), with `import type { Note } from '@cc/shared';` added:

```ts
  /** The coordinator assesses a plan (spec §5.4): a note tagged retro; a method suggestion becomes its own note. */
  retro(by: string, planId: string, r: { wentWell: string; stuck: string; change: string; methodSuggestion?: string }): { retro: Note; suggestion: Note | null } {
    this.#assertCoordinator(by);
    const plan = this.#d.plans.get(planId);
    if (plan.status === 'draft' || plan.status === 'declined') throw new ConflictError('Bu plan başlamadı; değerlendirilecek bir iş yok.');
    const memory = this.#d.memory;
    if (!memory) throw new ConflictError('Bu ofiste şirket hafızası açık değil.');
    const wentWell = clean(r.wentWell, 'Ne iyi gitti', 3000, true);
    const stuck = clean(r.stuck, 'Ne takıldı', 3000, true);
    const change = clean(r.change, 'Bir dahaki sefere', 3000, true);
    const suggestionText = clean(r.methodSuggestion, 'Yöntem önerisi', 3000, false);
    const type = plan.method?.workType;
    const tags = (first: string) => (type ? [first, type] : [first]);
    const text = [`Plan: ${plan.title} (sürüm ${plan.version})`, '', '## Ne iyi gitti', '', wentWell, '', '## Ne takıldı', '', stuck, '', '## Bir dahaki sefere', '', change].join('\n');
    const retro = memory.writeNote(by, { title: `Değerlendirme: ${plan.title}`, text, tags: tags('retro'), source: `plan:${plan.id}` });
    const suggestion = suggestionText
      ? memory.writeNote(by, { title: `Yöntem önerisi (${type ?? 'general'}): ${plan.title}`, text: suggestionText, tags: tags('yöntem-önerisi'), source: `plan:${plan.id}` })
      : null;
    return { retro, suggestion };
  }
```

- [ ] **Step 4: Tool**

In `apps/office-server/src/mcp/tools.ts`, after `planRevise`:

```ts
    {
      name: 'planRetro',
      description:
        'Assess a plan when it ends (coordinator): what went well, what got stuck, what to change next time, and — if it would help every company — a method suggestion for the office’s craft. Then write company-specific lessons with playbookUpdate and report to the owner.',
      inputSchema: object({ planId: s('The plan id.'), wentWell: s('What went well.'), stuck: s('What got stuck or went wrong.'), change: s('What to do differently next time.'), methodSuggestion: s('A change to the work-type method that would help any company (optional).') }, ['planId', 'wentWell', 'stuck', 'change']),
      kinds: COORDINATOR,
      run: ({ employee }, args) => {
        const { suggestion } = company.retro(employee.id, str(args, 'planId'), { wentWell: str(args, 'wentWell'), stuck: str(args, 'stuck'), change: str(args, 'change'), methodSuggestion: optStr(args, 'methodSuggestion') });
        return `Değerlendirme şirket notlarına yazıldı${suggestion ? ' (yöntem önerisi ayrıca)' : ''}. Şirkete özgü dersleri playbookUpdate ile el kitabına işle, sonra reportToOwner ile sahibine kısaca raporla.`;
      },
    },
```

- [ ] **Step 5: Run the whole server suite**

Run: `cd apps/office-server && npx vitest run > /tmp/cc-t6.log 2>&1; tail -8 /tmp/cc-t6.log`
Expected: all pass. A test that asserted the old `plan.done` notice (its topic or its "reportToOwner ile sahibine raporla" text) now expects `plan.retro`: update the assertion to the new topic and text; a digest test that used `plan.done` as its sample information notice keeps working (the topic still exists) unless it finishes a plan through `Company` — then it receives a decision instead and must count it as one.

- [ ] **Step 6: Commit**

```bash
git add apps/office-server/src apps/office-server/test
git commit -m "feat(company): a plan ends with a retro — lessons to the notes, method suggestions for the product"
```

---

### Task 7: The web shows the method, the review column and the decisions

**Files:**
- Modify: `apps/office-web/src/ui/CompanyView.tsx`, `apps/office-web/src/ui/PlanCard.tsx`, `apps/office-web/src/ui/EventItem.tsx`, `apps/office-web/src/styles.css`
- Test: `apps/office-web/src/ui/CompanyView.test.tsx`, `apps/office-web/src/ui/PlanCard.test.tsx`, `apps/office-web/src/ui/EventItem.test.tsx`

**Interfaces:**
- Consumes: `TaskStatus 'review'`, `Task.reviewer/round/kind`, `Plan.method`, `WORK_TYPE_LABELS`, `reviewTally`, `TaskChange 'in_review' | 'reviewed'` (Task 1).

- [ ] **Step 1: Write the failing tests**

Read each test file's existing fixtures first (`task(...)`, `plan(...)` builders and how the store is seeded) and add, in the same style:

`PlanCard.test.tsx`:

```tsx
  it('shows how the work will be done', () => {
    render(<PlanCard plan={{ ...samplePlan, method: { workType: 'content', stages: [{ name: 'Taslak', role: 'yazar', review: false }, { name: 'Editör', role: 'editör', review: true }], checks: ['marka dili'] } }} />);
    const section = screen.getByRole('region', { name: 'Nasıl yapılacak' });
    expect(section).toHaveTextContent('İçerik ve pazarlama');
    expect(section).toHaveTextContent('Taslak — yazar');
    expect(section).toHaveTextContent('Editör — editör · incelemeli');
    expect(section).toHaveTextContent('marka dili');
  });

  it('a plan without a method shows no method section', () => {
    render(<PlanCard plan={{ ...samplePlan, method: null }} />);
    expect(screen.queryByRole('region', { name: 'Nasıl yapılacak' })).toBeNull();
  });
```

(`samplePlan` stands for the plan fixture the file already uses; use its real name.)

`CompanyView.test.tsx`:

```tsx
  it('has an İncelemede column with the reviewer and the round on the card', async () => {
    // seed the store as the file's other board tests do, with two employees e1 (Ada) and e2 (Can) and:
    const inReview = task({ id: 't-r', title: 'Tanıtım metni', status: 'review', assignee: 'e1', reviewer: 'e2', round: 2 });
    const review = task({ id: 't-rv', title: 'İnceleme: Tanıtım metni (tur 2)', status: 'waiting', assignee: 'e2', kind: 'review', reviewOf: 't-r' });
    // …open the Görevler tab as the other board tests do, then:
    const column = screen.getByRole('region', { name: 'İncelemede' });
    expect(column).toHaveTextContent('Tanıtım metni');
    expect(column).toHaveTextContent('İnceleyen: Can');
    expect(column).toHaveTextContent('tur 2');
    expect(screen.getByRole('region', { name: 'Bekliyor' })).toHaveTextContent('İnceleme');
  });
```

`EventItem.test.tsx`:

```tsx
  it('says when a task goes to review and how a review was decided', () => {
    const { rerender } = render(<EventItem stored={stored({ type: 'task.changed', change: 'in_review', task: task({ title: 'Metin', status: 'review' }) })} />);
    expect(screen.getByText(/Görev incelemede: Metin/)).toBeInTheDocument();
    rerender(
      <EventItem
        stored={stored({
          type: 'task.changed',
          change: 'reviewed',
          task: task({ title: 'İnceleme: Metin (tur 1)', kind: 'review', status: 'done', result: { summary: 'x', outputs: [], learned: '', review: { decision: 'changes', findings: [{ severity: 'important', text: 'a' }, { severity: 'important', text: 'b' }, { severity: 'minor', text: 'c' }] } } }),
        })}
      />,
    );
    expect(screen.getByText('İnceleme: Metin (tur 1) — değişiklik istendi (2 önemli, 1 küçük)')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/office-web && npx vitest run src/ui/PlanCard.test.tsx src/ui/CompanyView.test.tsx src/ui/EventItem.test.tsx`
Expected: FAIL — no "Nasıl yapılacak" region, no "İncelemede" column, `in_review` renders nothing.

- [ ] **Step 3: Plan card**

In `apps/office-web/src/ui/PlanCard.tsx`, import `WORK_TYPE_LABELS` from `@cc/shared` and insert after the closing `</dl>`:

```tsx
      {live.method && (
        <section className="plan-method" aria-label="Nasıl yapılacak">
          <h4>Nasıl yapılacak · {WORK_TYPE_LABELS[live.method.workType]}</h4>
          <ol>
            {live.method.stages.map((st, i) => (
              <li key={i}>
                {st.name} — {st.role}
                {st.review ? ' · incelemeli' : ''}
              </li>
            ))}
          </ol>
          {live.method.checks.length > 0 && (
            <>
              <strong>Kalite kontrolleri</strong>
              <ul>
                {live.method.checks.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
```

- [ ] **Step 4: Board**

In `apps/office-web/src/ui/CompanyView.tsx`: `const COLUMNS: TaskStatus[] = ['waiting', 'in_progress', 'review', 'blocked', 'done'];` and in the card, after the difficulty badge:

```tsx
                        {t.kind === 'review' && <span className="badge review">İnceleme</span>}
```

and replace the muted line with:

```tsx
                        <span className="muted">
                          {nameOf(t.assignee)} · P{t.priority}
                          {t.planId && plans[t.planId] ? ` · ${plans[t.planId]!.title}` : ''}
                        </span>
                        {t.reviewer && (
                          <span className="muted">
                            İnceleyen: {nameOf(t.reviewer)}
                            {(t.round ?? 0) > 0 ? ` · tur ${t.round}` : ''}
                          </span>
                        )}
```

- [ ] **Step 5: Chat lines**

In `apps/office-web/src/ui/EventItem.tsx`, import `reviewTally` from `@cc/shared`, and the `task.changed` case becomes:

```tsx
    case 'task.changed': {
      if (e.change === 'in_review') return <div className="note">Görev incelemede: {e.task.title}</div>;
      if (e.change === 'reviewed') {
        const r = e.task.result?.review;
        const tally = r ? reviewTally(r.findings) : '';
        return (
          <div className="note">
            {`${e.task.title} — ${r?.decision === 'approve' ? 'onaylandı' : 'değişiklik istendi'}${tally ? ` (${tally})` : ''}`}
          </div>
        );
      }
      if (e.change !== 'created' && e.change !== 'finished' && e.change !== 'started') return null;
      return (
        <div className="note">
          Görev {e.change === 'created' ? 'açıldı' : e.change === 'started' ? 'başladı' : 'bitti'}: {e.task.title}
        </div>
      );
    }
```

- [ ] **Step 6: Styles**

Append to `apps/office-web/src/styles.css` (use the file's existing colour tokens; the names below are those used by `.badge.difficulty` — match them if they differ):

```css
.plan-method { margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: var(--panel-2, rgba(127, 127, 127, 0.08)); }
.plan-method h4 { margin: 0 0 4px; font-size: 13px; }
.plan-method ol, .plan-method ul { margin: 4px 0 6px 18px; padding: 0; }
.board-col .badge.review { background: var(--accent-soft, rgba(90, 120, 255, 0.15)); }
.task-card.review { border-left: 3px solid var(--accent, #5a78ff); }
```

- [ ] **Step 7: Run the web suite and the type check**

Run: `cd apps/office-web && npx vitest run > /tmp/cc-t7.log 2>&1; tail -8 /tmp/cc-t7.log; cd ../.. && pnpm -r --if-present typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add apps/office-web/src
git commit -m "feat(office-web): the plan card says how the work is done; a review column, reviewers and decisions on screen"
```

---

### Task 8: The real coordinator uses it, and the docs say so

**Files:**
- Create: `apps/office-server/test/craft.smoke.real.test.ts` (opt-in)
- Modify: `apps/office-server/package.json` (`smoke` script includes it)
- Modify: `README.md` (the craft, the review gate), `docs/superpowers/specs/2026-10-07-coordinator-craft-design.md` (status line)

- [ ] **Step 1: The opt-in real test**

Create `apps/office-server/test/craft.smoke.real.test.ts`, wired exactly like `test/company.smoke.real.test.ts` (copy its setup block verbatim: Engine with the MCP url and tokens, stores, memory, budget, proposals, Company, createApi, Dispatcher, server on port 0), with this scenario in place of that file's `it(...)` body after the setup:

```ts
    // A need that is not software: the coordinator must plan it as content, with a reviewer.
    const coordinator = company.hireCoordinator('sonnet');
    await until(() => engine.ready(coordinator.id), 60_000);
    engine.send(
      coordinator.id,
      'Ofis yazılımımız için tek paragraflık kısa bir tanıtım metni istiyorum. Bir yazar ve ayrı bir editör işe al (ikisi de haiku); metni yazar yazsın, editör kontrol etsin. Bana sormadan plan kartını öner.',
      'owner',
    );
    const proposed = await waitFor(s.events, (e) => e.event.type === 'plan.changed' && e.event.change === 'proposed', 300_000);
    const plan = (proposed.event as { plan: Plan }).plan;
    expect(plan.method?.workType).toBe('content');
    expect(plan.method?.stages.some((st) => st.review)).toBe(true);
    company.approve(plan.id);
    // The coordinator opens the writing task with the editor as reviewer.
    await until(() => tasks.list({ planId: plan.id }).some((t) => t.kind === 'work' && t.reviewer), 300_000);
    const work = tasks.list({ planId: plan.id }).find((t) => t.kind === 'work' && t.reviewer)!;
    // It closes only after a review task was approved.
    await until(() => tasks.get(work.id).status === 'done', 480_000);
    const reviews = tasks.list({ planId: plan.id }).filter((t) => t.kind === 'review' && t.reviewOf === work.id);
    const approved = reviews.find((r) => r.result?.review?.decision === 'approve');
    expect(approved).toBeTruthy();
    expect(approved!.assignee).not.toBe(work.assignee);
    expect(tasks.get(work.id).finishedAt!).toBeGreaterThanOrEqual(approved!.finishedAt!);
    expect(tasks.get(work.id).result?.evidence?.length ?? 0).toBeGreaterThanOrEqual(work.done.length);
```

with `{ timeout: 900_000 }` on the `it`, and the same cleanup as the company smoke test (stop dispatcher, fire everyone, close the server, `s.cleanup()`).

- [ ] **Step 2: Run it once against the real claude**

Run: `cd apps/office-server && OFFICE_SMOKE=1 npx vitest run test/craft.smoke.real.test.ts > /tmp/cc-craft-smoke.log 2>&1; tail -20 /tmp/cc-craft-smoke.log; rm -rf ~/.claude/projects/*tmp-cc-*`
Expected: PASS in under 15 minutes. If the coordinator's behaviour (not the office) makes it fail — e.g. it opened the task without a reviewer — record what it did; the guide text, not the test, is what to change.

- [ ] **Step 3: Docs**

Add `test/craft.smoke.real.test.ts` to the `smoke` script in `apps/office-server/package.json`. In `README.md`, under the company section, add a short "Koordinatörlük yetisi" paragraph: the craft ships with the office (`src/company/craft/`), `methodRead`, plan methods, the review gate (`reviewer`, "İncelemede", `reviewDecide`, rounds), evidence on hand-in, `planRetro`. In the spec header, set `- Durum:` to say stage 1 is implemented.

- [ ] **Step 4: Full verification**

Run: `pnpm -r --if-present typecheck && pnpm -r --if-present test > /tmp/cc-t8.log 2>&1; grep -E "Tests +[0-9]" /tmp/cc-t8.log`
Expected: typecheck clean; every package green.

- [ ] **Step 5: Commit**

```bash
git add apps/office-server/test/craft.smoke.real.test.ts apps/office-server/package.json README.md docs/superpowers/specs/2026-10-07-coordinator-craft-design.md
git commit -m "test(company): the real coordinator plans non-software work with a method and a reviewer; docs"
```
