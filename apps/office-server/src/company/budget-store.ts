import { randomUUID } from 'node:crypto';
import { normalizeConstitution, type Constitution, type Spend } from '@cc/shared';
import type { Db } from '../db.ts';

export class ConstitutionStore {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** The stored rules read as today's constitution (normalizeConstitution): a key never written is its default. */
  get(): Constitution {
    const rows = this.#db.prepare('SELECT key, value FROM constitution').all() as unknown as Array<{ key: string; value: string }>;
    const stored: Record<string, unknown> = {};
    for (const r of rows) stored[r.key] = JSON.parse(r.value);
    return normalizeConstitution(stored);
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
