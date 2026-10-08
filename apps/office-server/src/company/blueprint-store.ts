import type { Blueprint, BlueprintOutcome, BlueprintStepRecord } from '@cc/shared';
import type { Db } from '../db.ts';

/** The blueprints (one per plan; a revision writes over it) and the install's step records (migration v18). */
export class BlueprintStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  get(planId: string): { blueprint: Blueprint; profileVersion: number } | null {
    const row = this.#db.prepare('SELECT json, profile_version FROM blueprints WHERE plan_id = ?').get(planId) as unknown as { json: string; profile_version: number } | undefined;
    return row ? { blueprint: JSON.parse(row.json) as Blueprint, profileVersion: row.profile_version } : null;
  }

  put(planId: string, blueprint: Blueprint, profileVersion: number, by: string): void {
    const now = this.#now();
    this.#db
      .prepare(
        `INSERT INTO blueprints (plan_id, json, profile_version, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (plan_id) DO UPDATE SET json = excluded.json, profile_version = excluded.profile_version, updated_at = excluded.updated_at`,
      )
      .run(planId, JSON.stringify(blueprint), profileVersion, by, now, now);
  }

  steps(planId: string): BlueprintStepRecord[] {
    return this.#db.prepare('SELECT step, ref, outcome, at FROM blueprint_steps WHERE plan_id = ? ORDER BY at, rowid').all(planId) as unknown as BlueprintStepRecord[];
  }

  record(planId: string, step: string, ref: string | null, outcome: BlueprintOutcome): void {
    this.#db.prepare('INSERT INTO blueprint_steps (plan_id, step, ref, outcome, at) VALUES (?, ?, ?, ?, ?)').run(planId, step, ref, outcome, this.#now());
  }
}
