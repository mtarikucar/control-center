import { afterEach, describe, expect, it } from 'vitest';
import type { Usage } from '@cc/shared';
import { backfillTaskCosts, formatBackfill } from '../src/task-cost-backfill.ts';
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
  return { ...s, ...companyFor(s, f) };
}

const usage = (n: number): Usage => ({ inputTokens: n, outputTokens: n, cacheReadTokens: 10 * n, cacheCreationTokens: 0 });

/** Every task's cost as the database holds it. */
const costs = (t: ReturnType<typeof make>) =>
  Object.fromEntries(
    (t.db.prepare('SELECT id, cost_usd AS usd, tokens FROM tasks').all() as unknown as Array<{ id: string; usd: number; tokens: number }>).map((r) => [r.id, { usd: r.usd, tokens: r.tokens }]),
  );

/** A day of the office as the log keeps it: hand-ins, a decided review, a parked task, queued replies, a turn about no task, a result whose start was not seen. */
function day(t: ReturnType<typeof make>) {
  const start = (id: string) => t.events.append(id, { type: 'turn.started' });
  const finish = (id: string, costUsd: number, u: Usage, queuedTurns = 0) =>
    t.events.append(id, { type: 'turn.finished', ok: true, subtype: 'success', usage: u, costUsd, numTurns: 2, queuedTurns, sessionUsage: null, sessionCostUsd: 0 });
  const c = t.company.hireCoordinator();
  const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
  const can = t.company.hire(c.id, { name: 'Can', role: 'r' });
  const reviewed = t.company.createTask(c.id, { assignee: ada.id, title: 'incelenen', reviewer: can.id });
  t.company.start(reviewed.id);
  start(ada.id);
  finish(ada.id, 0.5, usage(10), 1);
  t.company.finish(ada.id, reviewed.id, { summary: 'bitti', outputs: [], learned: '' });
  finish(ada.id, 0.25, usage(20));
  const review = t.tasks.list({ assignee: can.id }).find((x) => x.kind === 'review')!;
  t.company.start(review.id);
  start(can.id);
  t.company.reviewDecide(can.id, review.id, { decision: 'approve' });
  finish(can.id, 0.125, usage(5));
  const parked = t.company.createTask(c.id, { assignee: ada.id, title: 'bekleyen' });
  t.company.start(parked.id);
  start(ada.id);
  t.company.parkTask(ada.id, parked.id, '+1d', 'pencere dolsun');
  finish(ada.id, 0.75, usage(30));
  start(c.id);
  finish(c.id, 1, usage(40));
  const unseen = t.company.createTask(c.id, { assignee: can.id, title: 'görülmeyen başlangıç' });
  t.company.start(unseen.id);
  finish(can.id, 0.5, usage(8));
  return { reviewed, review, parked, unseen };
}

describe('Task cost backfill', () => {
  it('recomputes from the log exactly what the budget charges live, and writes only with apply', () => {
    const t = make();
    cleanups.push(t.budget.watch());
    const d = day(t);
    const live = costs(t);
    expect(live[d.reviewed.id]).toEqual({ usd: 0.75, tokens: 360 });
    // The database as the old rule left it: nothing on any task.
    t.db.exec('UPDATE tasks SET cost_usd = 0, tokens = 0');
    const dry = backfillTaskCosts(t.db, { apply: false });
    expect(Object.values(costs(t)).every((c) => c.usd === 0 && c.tokens === 0)).toBe(true);
    expect(dry.changes.map((c) => [c.id, c.after])).toEqual(expect.arrayContaining([[d.reviewed.id, live[d.reviewed.id]], [d.unseen.id, live[d.unseen.id]]]));
    expect(dry).toMatchObject({
      turns: { count: 6, usd: 3.125, unassigned: { count: 1, usd: 1 } },
      before: { usd: 0, tokens: 0, tasks: 0 },
      after: { usd: 2.125, tasks: 4 },
      kept: [],
    });
    const applied = backfillTaskCosts(t.db, { apply: true });
    expect(applied.changes).toHaveLength(4);
    expect(costs(t)).toEqual(live);
    // Run again: nothing left to change.
    expect(backfillTaskCosts(t.db, { apply: true }).changes).toEqual([]);
    expect(formatBackfill(dry, false)).toContain('Önce:  görevlerde toplam $0.00');
  });

  it('never lowers a task the database charges more than the log explains', () => {
    const t = make();
    cleanups.push(t.budget.watch());
    const d = day(t);
    t.db.prepare('UPDATE tasks SET cost_usd = 9, tokens = 9 WHERE id = ?').run(d.parked.id);
    const r = backfillTaskCosts(t.db, { apply: true });
    expect(r.kept.map((k) => k.id)).toEqual([d.parked.id]);
    expect(costs(t)[d.parked.id]).toEqual({ usd: 9, tokens: 9 });
    expect(formatBackfill(r, true)).toContain('Olduğu gibi bırakılan');
  });
});
