import { randomUUID } from 'node:crypto';
import type { Plan, PlanMethod, PlanStatus, Task, TaskDifficulty, TaskKind, TaskResult, TaskStatus } from '@cc/shared';
import type { Db } from '../db.ts';
import { NotFoundError } from '../errors.ts';
import { NOTICE_TOPICS, type Notice, type NoticeTopic } from './notices.ts';

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
  kind: string;
  difficulty: string | null;
  reviewer: string | null;
  review_of: string | null;
  round: number | null;
}

function taskFromRow(r: TaskRow): Task {
  return {
    id: r.id,
    planId: r.plan_id,
    kind: r.kind as TaskKind,
    title: r.title,
    description: r.description,
    done: JSON.parse(r.done) as string[],
    requester: r.requester,
    assignee: r.assignee,
    priority: r.priority,
    difficulty: (r.difficulty as TaskDifficulty | null) ?? null,
    reviewer: r.reviewer ?? null,
    reviewOf: r.review_of ?? null,
    round: r.round ?? 0,
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
  /** Default 'work'. */
  kind?: TaskKind;
  title: string;
  description: string;
  done: string[];
  requester: string;
  assignee: string;
  priority: number;
  difficulty?: TaskDifficulty | null;
  /** Who approves the hand-in (an employee id). */
  reviewer?: string | null;
  /** A review task: the task it reviews. */
  reviewOf?: string | null;
  dependsOn: string[];
  chainDepth: number;
}

export type TaskPatch = Partial<Pick<Task, 'assignee' | 'priority' | 'difficulty' | 'reviewer' | 'round' | 'status' | 'note' | 'result' | 'nudged' | 'startedAt' | 'finishedAt'>>;

const OPEN = "('waiting', 'in_progress', 'review', 'blocked')";

export class TaskStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

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
      .prepare('UPDATE tasks SET assignee = ?, priority = ?, difficulty = ?, reviewer = ?, round = ?, status = ?, note = ?, result = ?, nudged = ?, started_at = ?, finished_at = ? WHERE id = ?')
      .run(next.assignee, next.priority, next.difficulty ?? null, next.reviewer ?? null, next.round ?? 0, next.status, next.note, next.result ? JSON.stringify(next.result) : null, next.nudged ? 1 : 0, next.startedAt, next.finishedAt, id);
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

  /** The owner's hand-over for this person is in (one query: a long track record must not hide it). */
  handoverDone(assignee: string): boolean {
    return (
      this.#db.prepare("SELECT 1 FROM tasks WHERE assignee = ? AND kind = 'handover' AND requester = 'owner' AND status = 'done' LIMIT 1").get(assignee) !==
      undefined
    );
  }

  /** When this person last started a task other than `exceptId` (null: never). */
  lastStartedAt(assignee: string, exceptId: string): number | null {
    const row = this.#db.prepare('SELECT MAX(started_at) AS t FROM tasks WHERE assignee = ? AND id != ?').get(assignee, exceptId) as unknown as { t: number | null };
    return row.t;
  }

  /** One finished turn's Claude usage, added to the task the employee was on. */
  charge(id: string, usd: number, tokens: number): void {
    this.#db.prepare('UPDATE tasks SET cost_usd = cost_usd + ?, tokens = tokens + ? WHERE id = ?').run(usd, tokens, id);
  }

  costByPlan(): Record<string, number> {
    const rows = this.#db.prepare('SELECT plan_id, SUM(cost_usd) AS n FROM tasks WHERE plan_id IS NOT NULL GROUP BY plan_id').all() as unknown as Array<{ plan_id: string; n: number }>;
    return Object.fromEntries(rows.map((r) => [r.plan_id, Math.round(r.n * 100) / 100]));
  }

  createdSince(requester: string, since: number): number {
    const row = this.#db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE requester = ? AND created_at >= ?').get(requester, since) as unknown as { n: number };
    return row.n;
  }

  /** A task was opened, started or finished in (after, until]: something to report. */
  changedBetween(after: number, until: number): boolean {
    return (
      this.#db
        .prepare('SELECT 1 FROM tasks WHERE (created_at > ? AND created_at <= ?) OR (started_at > ? AND started_at <= ?) OR (finished_at > ? AND finished_at <= ?) LIMIT 1')
        .get(after, until, after, until, after, until) !== undefined
    );
  }

  openInPlan(planId: string): number {
    const row = this.#db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE plan_id = ? AND status IN ${OPEN}`).get(planId) as unknown as { n: number };
    return row.n;
  }

  /** The last decided review of a task (its findings go with the task when it comes back). */
  latestReview(taskId: string): Task | null {
    const row = this.#db
      .prepare("SELECT * FROM tasks WHERE review_of = ? AND kind = 'review' AND status = 'done' ORDER BY finished_at DESC, rowid DESC LIMIT 1")
      .get(taskId) as unknown as TaskRow | undefined;
    return row ? taskFromRow(row) : null;
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
  method: string | null;
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
    method: r.method ? (JSON.parse(r.method) as PlanMethod) : null,
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
  method?: PlanMethod | null;
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
    const plan: Plan = { ...p, method: p.method ?? null, id: randomUUID(), status: 'draft', version: 1, createdAt: at, updatedAt: at, approvedAt: null };
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

  /** A revision of an approved plan starts: keep the approved version until the owner decides (rule B). */
  saveApproved(id: string): void {
    this.#db.prepare('UPDATE plans SET approved_snapshot = ? WHERE id = ?').run(JSON.stringify(this.get(id)), id);
  }

  approvedSnapshot(id: string): Plan | null {
    const row = this.#db.prepare('SELECT approved_snapshot FROM plans WHERE id = ?').get(id) as unknown as { approved_snapshot: string | null } | undefined;
    return row?.approved_snapshot ? (JSON.parse(row.approved_snapshot) as Plan) : null;
  }

  /** The owner declined the revision: the plan goes on as it was approved. */
  restoreApproved(id: string): Plan {
    const snap = this.approvedSnapshot(id);
    if (!snap) throw new NotFoundError(`Bu planın saklanmış onaylı sürümü yok: ${id}`);
    const { id: _id, createdAt: _c, proposedBy: _p, updatedAt: _u, ...fields } = snap;
    const restored = this.update(id, fields);
    this.clearApproved(id);
    return restored;
  }

  clearApproved(id: string): void {
    this.#db.prepare('UPDATE plans SET approved_snapshot = NULL WHERE id = ?').run(id);
  }

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
}

export class NoticeStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  /** The topic says whether the reader must act now (decision) or it is for the record (info): see NOTICE_TOPICS. */
  add(employeeId: string, topic: NoticeTopic, text: string): void {
    this.#db
      .prepare('INSERT INTO notices (employee_id, kind, topic, text, created_at, delivered_at) VALUES (?, ?, ?, ?, ?, NULL)')
      .run(employeeId, NOTICE_TOPICS[topic], topic, text, this.#now());
  }

  pending(employeeId: string): Notice[] {
    return this.#db
      .prepare('SELECT id, kind, topic, text, created_at AS createdAt FROM notices WHERE employee_id = ? AND delivered_at IS NULL ORDER BY id')
      .all(employeeId) as unknown as Notice[];
  }

  /** The message that carried them was lost: they wait for the reader's next turn again. */
  markUndelivered(ids: number[]): void {
    for (const id of ids) this.#db.prepare('UPDATE notices SET delivered_at = NULL WHERE id = ?').run(id);
  }

  markDelivered(ids: number[]): void {
    const at = this.#now();
    for (const id of ids) this.#db.prepare('UPDATE notices SET delivered_at = ? WHERE id = ?').run(at, id);
  }
}
