import { afterEach, describe, expect, it } from 'vitest';
import type { Employee, Usage } from '@cc/shared';
import { Agenda } from '../src/company/agenda.ts';
import type { McpTool } from '../src/mcp/protocol.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { deliveredSince, formatPerformance, performanceReport } from '../src/performance.ts';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const HOUR = 3_600_000;
const T0 = new Date(2026, 9, 8, 9, 0).getTime();
/** 10 input + 5 output + 100 cache read + 5 cache creation = 120 tokens per unit. */
const usage = (n = 1): Usage => ({ inputTokens: 10 * n, outputTokens: 5 * n, cacheReadTokens: 100 * n, cacheCreationTokens: 5 * n });

function make() {
  let clock = T0;
  const now = () => clock;
  const s = setup(8, now);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder'], now);
  cleanups.push(c.budget.watch());
  const agenda = new Agenda({ roster: s.roster, tasks: c.tasks, schedules: c.schedules, company: c.company, budget: c.budget });
  const performance = { report: (o: { days?: number } = {}) => performanceReport(s.db, { since: o.days ? clock - o.days * 86_400_000 : null, now: clock }) };
  const tools = officeTools({ company: c.company, roster: s.roster, tasks: c.tasks, characters: () => ['coder'], memory: c.memory, budget: c.budget, engine: f.engine, plans: () => c.plans.list(), agenda, performance });
  const call = async (employee: Employee, name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.find((x: McpTool) => x.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    const current = s.roster.get(employee.id);
    if (!tool.kinds.includes(current.kind)) throw new Error(`Bilinmeyen ya da bu çalışana kapalı araç: ${name}`);
    return tool.run({ employee: current }, args);
  };
  const turn = {
    start: (id: string) => s.events.append(id, { type: 'turn.started' }),
    finish: (id: string, costUsd: number, n = 1) =>
      s.events.append(id, { type: 'turn.finished', ok: true, subtype: 'success', usage: usage(n), costUsd, numTurns: 2, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0 }),
  };
  const advance = (ms: number) => void (clock += ms);
  return { ...s, ...c, tools, call, turn, advance, now };
}

/**
 * An office day with a fixed clock (T0 = 09:00):
 * - A (Ada, reviewer Can, plan P): opened 09:00, started 10:00, handed in 11:00, sent back 12:00, handed in 13:00,
 *   approved 14:00 — two rounds, first decision changes.
 * - B (Ada, reviewer Can, plan P): opened and started 14:00, blocked, unblocked and handed in 15:00, approved 16:00.
 * - C (Ada, no reviewer, no plan, due 17:00): opened and started 16:00, parked, back at 17:00 and finished 18:00 — late.
 * - D (Ada, plan P, due 18:30): started 18:00 and still running at 19:00 — late while open.
 * - The coordinator's turn about no task.
 */
function day() {
  const t = make();
  const c = t.company.hireCoordinator();
  const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
  const can = t.company.hire(c.id, { name: 'Can', role: 'r' });
  const plan = t.company.propose(c.id, { method: METHOD, title: 'Açılış', goal: 'g', approach: 'a' });
  t.company.approve(plan.id);
  const review = () => t.tasks.list({ assignee: can.id, statuses: ['waiting'] }).find((x) => x.kind === 'review')!;
  const decide = (decision: 'approve' | 'changes', cost: number) => {
    const r = review();
    t.company.start(r.id);
    t.turn.start(can.id);
    t.company.reviewDecide(can.id, r.id, decision === 'approve' ? { decision } : { decision, findings: [{ severity: 'important', text: 'eksik' }] });
    t.turn.finish(can.id, cost);
  };

  const a = t.company.createTask(c.id, { assignee: ada.id, title: 'A', planId: plan.id, reviewer: can.id });
  t.advance(HOUR);
  t.company.start(a.id);
  t.turn.start(ada.id);
  t.advance(HOUR);
  t.company.finish(ada.id, a.id, { summary: 'a1', outputs: [], learned: '' });
  t.turn.finish(ada.id, 1, 2);
  t.advance(HOUR);
  decide('changes', 0.25);
  t.advance(HOUR);
  t.company.start(a.id);
  t.turn.start(ada.id);
  t.company.finish(ada.id, a.id, { summary: 'a2', outputs: [], learned: '' });
  t.turn.finish(ada.id, 0.5);
  t.advance(HOUR);
  decide('approve', 0.25);

  const b = t.company.createTask(c.id, { assignee: ada.id, title: 'B', planId: plan.id, reviewer: can.id });
  t.company.start(b.id);
  t.company.update(ada.id, b.id, { blocked: true, note: 'cevap bekliyorum' });
  // A note while still blocked is not a second block.
  t.company.update(ada.id, b.id, { note: 'hâlâ bekliyorum' });
  t.advance(HOUR);
  t.turn.start(ada.id);
  t.company.update(ada.id, b.id, { blocked: false });
  t.company.finish(ada.id, b.id, { summary: 'b', outputs: [], learned: '' });
  t.turn.finish(ada.id, 0.75);
  t.advance(HOUR);
  decide('approve', 0.125);

  const cTask = t.company.createTask(c.id, { assignee: ada.id, title: 'C', dueAt: '+1h' });
  t.company.start(cTask.id);
  t.turn.start(ada.id);
  t.company.parkTask(ada.id, cTask.id, '+1h', 'pencere');
  t.turn.finish(ada.id, 0.25);
  t.advance(HOUR);
  t.company.unparkTask(c.id, cTask.id);
  t.company.start(cTask.id);
  t.advance(HOUR);
  t.turn.start(ada.id);
  t.company.finish(ada.id, cTask.id, { summary: 'c', outputs: [], learned: '' });
  t.turn.finish(ada.id, 0.5);

  const d = t.company.createTask(c.id, { assignee: ada.id, title: 'D', planId: plan.id, dueAt: '+30m' });
  t.company.start(d.id);
  t.turn.start(ada.id);
  t.turn.finish(ada.id, 0.125);

  t.turn.start(c.id);
  t.turn.finish(c.id, 2);
  t.advance(HOUR);
  return { t, c, ada, can, plan, a, b, cTask, d };
}

describe('Performance — metrics from the log and the tasks', () => {
  it('per task: cost and turns by the budget’s rule (the same as the live charge), rounds, decisions, first pass, durations, parks, blocks, overdue', () => {
    const { t, a, b, cTask, d } = day();
    const r = performanceReport(t.db, { now: t.now() });
    const of = (id: string) => r.tasks.find((x) => x.id === id)!;
    expect(of(a.id)).toMatchObject({ status: 'done', usd: 1.5, tokens: 360, turns: 2, rounds: 2, approvals: 1, changes: 1, firstPass: false, leadHours: 5, workHours: 4, parks: 0, blocks: 0, overdue: false });
    expect(of(b.id)).toMatchObject({ status: 'done', usd: 0.75, tokens: 120, turns: 1, rounds: 1, approvals: 1, changes: 0, firstPass: true, leadHours: 2, workHours: 2, blocks: 1 });
    expect(of(cTask.id)).toMatchObject({ status: 'done', usd: 0.75, turns: 2, rounds: 0, firstPass: null, leadHours: 2, workHours: 2, parks: 1, blocks: 0, overdue: true });
    expect(of(d.id)).toMatchObject({ status: 'in_progress', usd: 0.125, turns: 1, leadHours: null, workHours: null, overdue: true });
    // The review tasks carry the reviewer's turns.
    expect(r.tasks.filter((x) => x.kind === 'review').map((x) => x.usd).sort()).toEqual([0.125, 0.25, 0.25]);
    // Every task's cost is what the budget charged live (the rule of fix/task-turn-cost).
    const live = t.db.prepare('SELECT id, cost_usd AS usd, tokens FROM tasks').all() as unknown as Array<{ id: string; usd: number; tokens: number }>;
    for (const row of live) expect([row.id, of(row.id).usd, of(row.id).tokens]).toEqual([row.id, row.usd, row.tokens]);
  });

  it('per employee and per plan, with the totals reconciled to every turn.finished', () => {
    const { t, c, ada, can, plan } = day();
    const r = performanceReport(t.db, { now: t.now() });
    const person = (id: string) => r.employees.find((e) => e.id === id)!;
    expect(person(ada.id)).toMatchObject({
      name: 'Ada', done: 3, open: 1, usd: 3.125, turns: 6, unassignedUsd: 0, usdPerDone: 1, reviewed: 2, firstPassRate: 0.5, avgRounds: 1.5,
      avgLeadHours: 3, avgWorkHours: 8 / 3, parks: 1, blocks: 1, overdue: 2, reviewsGiven: 0,
    });
    expect(person(can.id)).toMatchObject({ done: 0, open: 0, usd: 0.625, turns: 3, reviewsGiven: 3, usdPerDone: null, firstPassRate: null, avgRounds: null });
    expect(person(c.id)).toMatchObject({ usd: 2, turns: 1, unassignedUsd: 2, done: 0 });
    // A plan's cost is every task of it, its reviews included (as the budget's costByPlan); the rates are its work tasks'.
    expect(r.plans.find((p) => p.id === plan.id)).toMatchObject({
      title: 'Açılış', done: 2, open: 1, usd: 3, turns: 7, reviewed: 2, firstPassRate: 0.5, avgRounds: 1.5, usdPerDone: 1.125, avgLeadHours: 3.5, avgWorkHours: 3, blocks: 1, parks: 0, overdue: 1,
    });
    const sql = t.db.prepare("SELECT COUNT(*) AS n, SUM(json_extract(payload, '$.costUsd')) AS usd FROM events WHERE type = 'turn.finished'").get() as unknown as { n: number; usd: number };
    expect(r.total).toMatchObject({ turns: sql.n, usd: sql.usd, assignedUsd: 3.75, unassignedUsd: 2 });
    expect(r.total.usd).toBe(5.75);
    expect(r.employees.reduce((n, e) => n + e.usd, 0)).toBe(r.total.usd);
    expect(r.total.tokens).toBe(11 * 120);
  });

  it('a window counts the turns in it and the tasks finished in it; open tasks still count as open', () => {
    const { t, ada } = day();
    // From 15:30: B approved (16:00) and C (16:00–18:00) finish in it; the turns of B's review, C, D and the coordinator.
    const r = performanceReport(t.db, { since: T0 + 6.5 * HOUR, now: t.now() });
    expect(r.since).toBe(T0 + 6.5 * HOUR);
    expect(r.employees.find((e) => e.id === ada.id)).toMatchObject({ done: 2, open: 1, usd: 0.875, turns: 3, reviewed: 1, firstPassRate: 1, usdPerDone: 0.75, parks: 1, overdue: 2 });
    expect(r.total).toMatchObject({ turns: 5, usd: 3 });
  });

  it('deliveredSince reads the same done count and first-pass rate as the report, from the tasks alone', () => {
    const { t, ada } = day();
    for (const since of [0, T0 + 6.5 * HOUR, t.now()]) {
      const group = performanceReport(t.db, { since, now: t.now() }).employees.find((e) => e.id === ada.id)!;
      expect(deliveredSince(t.db, since)).toEqual({ done: group.done, firstPassRate: group.firstPassRate });
    }
    expect(deliveredSince(t.db, T0 + 6.5 * HOUR)).toEqual({ done: 2, firstPassRate: 1 });
  });
});

describe('Performance — reading it', () => {
  it('performanceRead (coordinator and leads): totals, one line per person and per plan; one person or one plan with their tasks', async () => {
    const { t, c, ada, plan } = day();
    expect(t.tools.find((x) => x.name === 'performanceRead')?.kinds).toEqual(['lead', 'coordinator']);
    const all = await t.call(c, 'performanceRead');
    expect(all).toContain('# Performans (tüm zamanlar; kaynak: olay kaydı ve görevler)');
    expect(all).toContain('Claude kullanımı: 10 tur sonucu, $5.75, 1320 token. Görevlere $3.75 + görevsiz $2 = $5.75 (uzlaşıyor).');
    expect(all).toContain('• Ada: 3 iş bitti, 1 açık; ilk geçişte onay 1/2 (%50), onaya kadar ort. 1.5 tur; görev başı ort. $1; ort. süre 3 sa (iş 2.7 sa); takılma 1, park 1, gecikme 2; toplam $3.13');
    expect(all).toContain('• Can: 0 iş bitti, 0 açık; 3 inceleme verdi; toplam $0.63');
    expect(all).toContain('• Koordinatör: 0 iş bitti, 0 açık; toplam $2 (görevsiz $2)');
    expect(all).toContain('• “Açılış”: 2 iş bitti, 1 açık; ilk geçişte onay 1/2 (%50), onaya kadar ort. 1.5 tur; görev başı ort. $1.13; ort. süre 3.5 sa (iş 3 sa); takılma 1, park 0, gecikme 1; toplam $3');
    const one = await t.call(c, 'performanceRead', { employee: 'ada' });
    expect(one).toContain('• Ada: 3 iş bitti');
    expect(one).not.toContain('• Can:');
    expect(one).toContain('• [bitti] “A”: $1.5, 2 tur sonucu; inceleme 2 tur (onay 1, değişiklik 1); süre 5 sa (iş 4 sa)');
    expect(one).toContain('• [bitti] “C”: $0.75, 2 tur sonucu; süre 2 sa (iş 2 sa); park 1; gecikti');
    expect(one).toContain('• [sürüyor] “D”: $0.13, 1 tur sonucu; gecikti');
    const byPlan = await t.call(c, 'performanceRead', { plan: plan.id });
    expect(byPlan).toContain('• “Açılış”: 2 iş bitti');
    expect(byPlan).toContain('• [bitti] “B”: $0.75, 1 tur sonucu; inceleme 1 tur (onay 1); süre 2 sa (iş 2 sa); takılma 1');
    expect(byPlan).not.toContain('“C”');
    const recent = await t.call(c, 'performanceRead', { days: 1 });
    expect(recent).toContain('# Performans (son 1 gün;');
    await expect(t.call(ada, 'performanceRead')).rejects.toThrow(/kapalı araç/);
    await expect(t.call(c, 'performanceRead', { employee: 'Yok' })).rejects.toThrow(/Çalışan bulunamadı/);
    await expect(t.call(c, 'performanceRead', { days: 0 })).rejects.toThrow(/days 1 ile 365/);
  });

  it('says so when the log does not reconcile: a turn result that names no one is in the total but charged to no one', () => {
    const t = make();
    t.events.append(null, { type: 'turn.finished', ok: true, subtype: 'success', usage: usage(), costUsd: 1, numTurns: 1, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0 });
    const r = performanceReport(t.db, { now: t.now() });
    expect(r.total).toEqual({ turns: 1, usd: 1, tokens: 120, assignedUsd: 0, unassignedUsd: 0, reconciled: false });
    expect(formatPerformance(r, {})).toContain('Görevlere $0 + görevsiz $0 = $0 (UZLAŞMIYOR: olay toplamıyla fark var).');
    const { t: office } = day();
    expect(performanceReport(office.db, { now: office.now() }).total.reconciled).toBe(true);
  });

  it('formatPerformance says so when nothing has happened yet', () => {
    const t = make();
    expect(formatPerformance(performanceReport(t.db, { now: t.now() }), {})).toContain('Henüz tur sonucu yok.');
  });
});
