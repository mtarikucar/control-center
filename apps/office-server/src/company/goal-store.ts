import { randomUUID } from 'node:crypto';
import type { Goal, GoalStatus, Kpi } from '@cc/shared';
import type { Db } from '../db.ts';
import { NotFoundError } from '../errors.ts';

interface GoalRow {
  id: string;
  title: string;
  why: string;
  done: string;
  kpis: string;
  status: string;
  created_by: string;
  created_at: number;
  closed_at: number | null;
  note: string | null;
}

const goalFromRow = (r: GoalRow): Goal => ({
  id: r.id, title: r.title, why: r.why, done: JSON.parse(r.done) as string[], kpis: JSON.parse(r.kpis) as Kpi[], status: r.status as GoalStatus, createdBy: r.created_by,
  createdAt: r.created_at, closedAt: r.closed_at, note: r.note,
});

export interface NewGoal {
  title: string;
  why: string;
  done: string[];
  kpis?: Kpi[];
  createdBy: string;
}

export type GoalPatch = Partial<Pick<Goal, 'title' | 'why' | 'done' | 'kpis' | 'status' | 'closedAt' | 'note'>>;

export class GoalStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  create(g: NewGoal): Goal {
    const goal: Goal = { ...g, kpis: g.kpis ?? [], id: randomUUID(), status: 'active', createdAt: this.#now(), closedAt: null, note: null };
    this.#db
      .prepare('INSERT INTO goals (id, title, why, done, kpis, status, created_by, created_at, closed_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)')
      .run(goal.id, goal.title, goal.why, JSON.stringify(goal.done), JSON.stringify(goal.kpis), goal.status, goal.createdBy, goal.createdAt);
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
      .prepare('UPDATE goals SET title = ?, why = ?, done = ?, kpis = ?, status = ?, closed_at = ?, note = ? WHERE id = ?')
      .run(next.title, next.why, JSON.stringify(next.done), JSON.stringify(next.kpis), next.status, next.closedAt, next.note, id);
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
