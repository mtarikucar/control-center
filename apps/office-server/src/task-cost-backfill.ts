import type { DatabaseSync } from 'node:sqlite';
import { replayTurns } from './turn-log.ts';

/**
 * Per-task Claude cost (tasks.cost_usd, tasks.tokens) recomputed from the event log with the rule the budget charges
 * by (TurnLedger, replayed by turn-log.ts). Before that rule, a turn whose task was handed in before the turn ended
 * was charged to nothing.
 */

export interface Cost {
  usd: number;
  tokens: number;
}

export interface TaskCostChange {
  id: string;
  title: string;
  before: Cost;
  after: Cost;
}

export interface TaskCostBackfill {
  /** Every turn result in the log and the part charged to no task (turns about no task, e.g. a chat with the owner). */
  turns: { count: number; usd: number; tokens: number; unassigned: { count: number; usd: number; tokens: number } };
  before: Cost & { tasks: number };
  after: Cost & { tasks: number };
  /** The tasks whose cost the log raises. */
  changes: TaskCostChange[];
  /** Tasks the database already charges more than the log explains: left as they are. */
  kept: TaskCostChange[];
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** What the log says each task cost. */
export function costsFromLog(db: DatabaseSync): { costs: Map<string, Cost>; turns: TaskCostBackfill['turns'] } {
  const costs = new Map<string, Cost>();
  const turns: TaskCostBackfill['turns'] = { count: 0, usd: 0, tokens: 0, unassigned: { count: 0, usd: 0, tokens: 0 } };
  replayTurns(db, {
    turn: ({ taskId, usd, tokens }) => {
      turns.count += 1;
      turns.usd += usd;
      turns.tokens += tokens;
      if (taskId && (usd > 0 || tokens > 0)) {
        const c = costs.get(taskId) ?? { usd: 0, tokens: 0 };
        costs.set(taskId, { usd: c.usd + usd, tokens: c.tokens + tokens });
      } else if (!taskId) {
        turns.unassigned.count += 1;
        turns.unassigned.usd += usd;
        turns.unassigned.tokens += tokens;
      }
    },
  });
  return { costs, turns };
}

/**
 * Compares the log's costs with the database's and, with `apply`, writes them in one transaction. A task is only ever
 * raised: one the database charges more than the log explains is kept and listed. Without `apply` nothing is written.
 */
export function backfillTaskCosts(db: DatabaseSync, o: { apply: boolean }): TaskCostBackfill {
  const { costs, turns } = costsFromLog(db);
  const rows = db.prepare('SELECT id, title, cost_usd, tokens FROM tasks').all() as unknown as Array<{ id: string; title: string; cost_usd: number; tokens: number }>;
  const changes: TaskCostChange[] = [];
  const kept: TaskCostChange[] = [];
  const before = { usd: 0, tokens: 0, tasks: 0 };
  const after = { usd: 0, tokens: 0, tasks: 0 };
  for (const r of rows) {
    const was = { usd: r.cost_usd, tokens: r.tokens };
    const log = costs.get(r.id) ?? { usd: 0, tokens: 0 };
    // Float sums of the same turns in another order differ in the last bits: within a millionth they are the same.
    const same = Math.abs(log.usd - was.usd) < 1e-6 && log.tokens === was.tokens;
    const raise = !same && log.usd >= was.usd - 1e-6 && log.tokens >= was.tokens;
    const now = raise ? log : was;
    if (raise) changes.push({ id: r.id, title: r.title, before: was, after: log });
    else if (!same) kept.push({ id: r.id, title: r.title, before: was, after: log });
    before.usd += was.usd;
    before.tokens += was.tokens;
    if (was.usd > 0 || was.tokens > 0) before.tasks += 1;
    after.usd += now.usd;
    after.tokens += now.tokens;
    if (now.usd > 0 || now.tokens > 0) after.tasks += 1;
  }
  if (o.apply && changes.length) {
    const update = db.prepare('UPDATE tasks SET cost_usd = ?, tokens = ? WHERE id = ?');
    db.exec('BEGIN');
    try {
      for (const c of changes) update.run(c.after.usd, c.after.tokens, c.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return { turns, before, after, changes, kept };
}

export function formatBackfill(r: TaskCostBackfill, applied: boolean): string {
  const usd = (n: number) => `$${cents(n).toFixed(2)}`;
  const line = (c: TaskCostChange) => `- ${c.id.slice(0, 8)} “${c.title}”: ${usd(c.before.usd)} / ${c.before.tokens} token → ${usd(c.after.usd)} / ${c.after.tokens} token`;
  return [
    `Tur sonuçları (turn.finished): ${r.turns.count}, toplam ${usd(r.turns.usd)}, ${r.turns.tokens} token; hiçbir göreve ait olmayan: ${r.turns.unassigned.count} sonuç, ${usd(r.turns.unassigned.usd)}.`,
    `Önce:  görevlerde toplam ${usd(r.before.usd)}, ${r.before.tokens} token (${r.before.tasks} görevde maliyet var).`,
    `Sonra: görevlerde toplam ${usd(r.after.usd)}, ${r.after.tokens} token (${r.after.tasks} görevde maliyet var).`,
    `${applied ? 'Yazıldı' : 'Yazılacak (deneme, hiçbir şey yazılmadı)'}: ${r.changes.length} görev.`,
    ...r.changes.map(line),
    ...(r.kept.length ? [`Olduğu gibi bırakılan (veritabanı olay kaydından fazlasını gösteriyor): ${r.kept.length} görev.`, ...r.kept.map(line)] : []),
  ].join('\n');
}
