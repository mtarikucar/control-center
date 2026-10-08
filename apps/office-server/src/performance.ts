import type { DatabaseSync } from 'node:sqlite';
import type { ReviewDecision, TaskResult, TaskStatus } from '@cc/shared';
import { replayTurns } from './turn-log.ts';

/**
 * How the work went, read from the office's own log and tasks (B4; spec 2026-10-08-performance-metrics-design): per
 * task, per employee and per plan. No new data: cost and turns come from the turn.finished events, charged with the
 * budget's rule (TurnLedger, fix/task-turn-cost) — not from tasks.cost_usd, which stays 0 until that fix is live and
 * backfilled — the rest from the tasks table and the task.changed events.
 */

export interface TaskMetrics {
  id: string;
  title: string;
  kind: string;
  assignee: string;
  planId: string | null;
  status: TaskStatus;
  usd: number;
  tokens: number;
  turns: number;
  rounds: number;
  approvals: number;
  changes: number;
  /** The first review decision approved it; null when never reviewed. */
  firstPass: boolean | null;
  /** Opened → done; null unless done. */
  leadHours: number | null;
  /** First started → done; null unless done. */
  workHours: number | null;
  parks: number;
  blocks: number;
  overdue: boolean;
}

/** Over a group's work tasks: those done in the window and those open now. */
export interface GroupMetrics {
  done: number;
  open: number;
  usd: number;
  tokens: number;
  turns: number;
  usdPerDone: number | null;
  reviewed: number;
  firstPassRate: number | null;
  avgRounds: number | null;
  avgLeadHours: number | null;
  avgWorkHours: number | null;
  parks: number;
  blocks: number;
  overdue: number;
}

export interface EmployeeMetrics extends GroupMetrics {
  id: string;
  name: string;
  unassignedUsd: number;
  reviewsGiven: number;
}

export interface PlanMetrics extends GroupMetrics {
  id: string;
  title: string;
}

export interface PerformanceReport {
  /** Window start (epoch ms); null: all time. */
  since: number | null;
  until: number;
  /** Every turn.finished in the window, summed straight from the events; `reconciled`: equal to what was charged + unassigned. */
  total: { turns: number; usd: number; tokens: number; assignedUsd: number; unassignedUsd: number; reconciled: boolean };
  employees: EmployeeMetrics[];
  plans: PlanMetrics[];
  tasks: TaskMetrics[];
}

interface TaskRow {
  id: string;
  title: string;
  kind: string;
  assignee: string;
  plan_id: string | null;
  status: TaskStatus;
  round: number | null;
  park_count: number | null;
  overdue_notified: number | null;
  created_at: number;
  finished_at: number | null;
  due_at: number | null;
  review_of: string | null;
  result: string | null;
}

const HOUR = 3_600_000;
const OPEN: TaskStatus[] = ['waiting', 'in_progress', 'review', 'blocked', 'parked'];
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

type ReviewRow = Pick<TaskRow, 'kind' | 'review_of' | 'result'>;

/** Review decisions per reviewed task, in the order the reviews were opened (`rows` in created_at, rowid order). */
function reviewDecisions(rows: readonly ReviewRow[]): Map<string, ReviewDecision[]> {
  const decisions = new Map<string, ReviewDecision[]>();
  for (const r of rows) {
    if (r.kind !== 'review' || !r.review_of || !r.result) continue;
    const decision = (JSON.parse(r.result) as TaskResult).review?.decision;
    if (decision) decisions.set(r.review_of, [...(decisions.get(r.review_of) ?? []), decision]);
  }
  return decisions;
}

/** The first review decision approved it; null when never reviewed. */
const firstPassOf = (decided: readonly ReviewDecision[]): boolean | null => (decided.length ? decided[0] === 'approve' : null);

/** The share passed at the first review among the reviewed (null entries: never reviewed); null when none was. */
function firstPassRate(firstPasses: ReadonlyArray<boolean | null>): number | null {
  const reviewed = firstPasses.filter((p) => p !== null);
  return reviewed.length ? reviewed.filter(Boolean).length / reviewed.length : null;
}

/**
 * The office's work tasks done since `since` and their first-pass rate — what the report's groups count as `done` and
 * `firstPassRate`, read from the tasks table alone (no replay of the log), for the top bar's figures.
 */
export function deliveredSince(db: DatabaseSync, since: number): { done: number; firstPassRate: number | null } {
  const DONE = "SELECT id FROM tasks WHERE kind = 'work' AND status = 'done' AND finished_at >= ?";
  const done = db.prepare(DONE).all(since) as unknown as Array<{ id: string }>;
  const reviews = db.prepare(`SELECT kind, review_of, result FROM tasks WHERE kind = 'review' AND review_of IN (${DONE}) ORDER BY created_at, rowid`).all(since) as unknown as ReviewRow[];
  const decisions = reviewDecisions(reviews);
  return { done: done.length, firstPassRate: firstPassRate(done.map((t) => firstPassOf(decisions.get(t.id) ?? []))) };
}

export function performanceReport(db: DatabaseSync, o: { since?: number | null; now?: number } = {}): PerformanceReport {
  const since = o.since ?? null;
  const until = o.now ?? Date.now();
  const from = since ?? Number.NEGATIVE_INFINITY;
  const inWindow = (ts: number) => ts >= from;

  // The log: every turn result with its task; each task's first start and its moves into blocked.
  const perTask = new Map<string, { usd: number; tokens: number; turns: number; windowUsd: number; windowTokens: number; windowTurns: number }>();
  const perEmployee = new Map<string, { usd: number; tokens: number; turns: number; unassignedUsd: number }>();
  const firstStart = new Map<string, number>();
  const blocks = new Map<string, number>();
  const lastStatus = new Map<string, TaskStatus>();
  let assignedUsd = 0;
  let unassignedUsd = 0;
  replayTurns(db, {
    turn: ({ employeeId, taskId, usd, tokens, ts }) => {
      const win = inWindow(ts);
      if (taskId) {
        const t = perTask.get(taskId) ?? { usd: 0, tokens: 0, turns: 0, windowUsd: 0, windowTokens: 0, windowTurns: 0 };
        t.usd += usd;
        t.tokens += tokens;
        t.turns += 1;
        if (win) {
          t.windowUsd += usd;
          t.windowTokens += tokens;
          t.windowTurns += 1;
        }
        perTask.set(taskId, t);
      }
      if (!win) return;
      const e = perEmployee.get(employeeId) ?? { usd: 0, tokens: 0, turns: 0, unassignedUsd: 0 };
      e.usd += usd;
      e.tokens += tokens;
      e.turns += 1;
      if (taskId) assignedUsd += usd;
      else {
        e.unassignedUsd += usd;
        unassignedUsd += usd;
      }
      perEmployee.set(employeeId, e);
    },
    task: (change, task, ts) => {
      if (change === 'started' && !firstStart.has(task.id)) firstStart.set(task.id, ts);
      if (task.status === 'blocked' && lastStatus.get(task.id) !== 'blocked') blocks.set(task.id, (blocks.get(task.id) ?? 0) + 1);
      lastStatus.set(task.id, task.status);
    },
  });

  const rows = db
    .prepare('SELECT id, title, kind, assignee, plan_id, status, round, park_count, overdue_notified, created_at, finished_at, due_at, review_of, result FROM tasks ORDER BY created_at, rowid')
    .all() as unknown as TaskRow[];
  const decisions = reviewDecisions(rows);
  const tasks: TaskMetrics[] = rows.map((r) => {
    const cost = perTask.get(r.id);
    const decided = decisions.get(r.id) ?? [];
    const done = r.status === 'done' && r.finished_at !== null;
    const started = firstStart.get(r.id);
    return {
      id: r.id, title: r.title, kind: r.kind, assignee: r.assignee, planId: r.plan_id, status: r.status,
      usd: cost?.usd ?? 0, tokens: cost?.tokens ?? 0, turns: cost?.turns ?? 0, rounds: r.round ?? 0,
      approvals: decided.filter((d) => d === 'approve').length, changes: decided.filter((d) => d === 'changes').length,
      firstPass: firstPassOf(decided),
      leadHours: done ? (r.finished_at! - r.created_at) / HOUR : null,
      workHours: done && started !== undefined ? (r.finished_at! - started) / HOUR : null,
      parks: r.park_count ?? 0, blocks: blocks.get(r.id) ?? 0,
      // Late: the clock said so, it finished after its due time, or it is open past it (before the clock's next run).
      overdue: r.overdue_notified === 1 || (r.due_at !== null && (r.finished_at !== null ? r.finished_at > r.due_at : OPEN.includes(r.status) && r.due_at < until)),
    };
  });
  const row = new Map(rows.map((r) => [r.id, r]));
  const doneInWindow = (t: TaskMetrics) => t.status === 'done' && inWindow(row.get(t.id)!.finished_at!);
  const open = (t: TaskMetrics) => OPEN.includes(t.status);

  const group = (work: TaskMetrics[], spent: { usd: number; tokens: number; turns: number }): GroupMetrics => {
    const done = work.filter(doneInWindow);
    const live = work.filter(open);
    const reviewed = done.filter((t) => t.firstPass !== null);
    const counted = [...done, ...live];
    return {
      done: done.length, open: live.length, ...spent,
      usdPerDone: mean(done.map((t) => t.usd)),
      reviewed: reviewed.length,
      firstPassRate: firstPassRate(done.map((t) => t.firstPass)),
      avgRounds: mean(reviewed.map((t) => t.rounds)),
      avgLeadHours: mean(done.map((t) => t.leadHours!)),
      avgWorkHours: mean(done.flatMap((t) => (t.workHours === null ? [] : [t.workHours]))),
      parks: sum(counted.map((t) => t.parks)), blocks: sum(counted.map((t) => t.blocks)), overdue: counted.filter((t) => t.overdue).length,
    };
  };
  const work = tasks.filter((t) => t.kind === 'work');

  const people = db.prepare('SELECT id, name FROM employees ORDER BY rowid').all() as unknown as Array<{ id: string; name: string }>;
  const employees: EmployeeMetrics[] = people
    .map((p) => {
      const spent = perEmployee.get(p.id) ?? { usd: 0, tokens: 0, turns: 0, unassignedUsd: 0 };
      const reviewsGiven = tasks.filter((t) => t.kind === 'review' && t.assignee === p.id && doneInWindow(t)).length;
      return { id: p.id, name: p.name, ...group(work.filter((t) => t.assignee === p.id), spent), unassignedUsd: spent.unassignedUsd, reviewsGiven };
    })
    .filter((e) => e.turns > 0 || e.done > 0 || e.open > 0 || e.reviewsGiven > 0)
    .sort((a, b) => b.usd - a.usd);

  const planRows = db.prepare('SELECT id, title FROM plans ORDER BY created_at').all() as unknown as Array<{ id: string; title: string }>;
  const plans: PlanMetrics[] = planRows
    .map((p) => {
      // A plan's cost is every task of it, reviews included (as the budget's costByPlan).
      const own = tasks.filter((t) => t.planId === p.id).map((t) => perTask.get(t.id));
      const spent = { usd: sum(own.map((c) => c?.windowUsd ?? 0)), tokens: sum(own.map((c) => c?.windowTokens ?? 0)), turns: sum(own.map((c) => c?.windowTurns ?? 0)) };
      return { id: p.id, title: p.title, ...group(work.filter((t) => t.planId === p.id), spent) };
    })
    .filter((p) => p.turns > 0 || p.done > 0 || p.open > 0)
    .sort((a, b) => b.usd - a.usd);

  // Straight from the events, apart from the replay: the reconciliation means something.
  const all = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(json_extract(payload, '$.costUsd')), 0) AS usd,
         COALESCE(SUM(json_extract(payload, '$.usage.inputTokens') + json_extract(payload, '$.usage.outputTokens')
           + json_extract(payload, '$.usage.cacheReadTokens') + json_extract(payload, '$.usage.cacheCreationTokens')), 0) AS tokens
       FROM events WHERE type = 'turn.finished' AND ts >= ?`,
    )
    .get(since ?? 0) as unknown as { n: number; usd: number; tokens: number };
  const charged = sum([...perEmployee.values()].map((e) => e.turns));
  return {
    since,
    until,
    total: { turns: all.n, usd: all.usd, tokens: all.tokens, assignedUsd, unassignedUsd, reconciled: charged === all.n && Math.abs(assignedUsd + unassignedUsd - all.usd) < 1e-6 },
    employees,
    plans,
    tasks: tasks.filter((t) => open(t) || (t.status === 'done' && inWindow(row.get(t.id)!.finished_at!)) || (perTask.get(t.id)?.windowTurns ?? 0) > 0),
  };
}

const STATUS_TR: Record<TaskStatus, string> = { waiting: 'bekliyor', in_progress: 'sürüyor', review: 'incelemede', blocked: 'takıldı', parked: 'ertelendi', done: 'bitti', cancelled: 'iptal' };
const money = (n: number) => `$${Math.round(n * 100) / 100}`;
const hours = (n: number) => `${Math.round(n * 10) / 10} sa`;

function groupLine(label: string, g: GroupMetrics, extra: { reviewsGiven?: number; unassignedUsd?: number } = {}): string {
  const parts = [`${g.done} iş bitti, ${g.open} açık`];
  if (g.reviewed > 0) {
    const passed = Math.round((g.firstPassRate ?? 0) * g.reviewed);
    parts.push(`ilk geçişte onay ${passed}/${g.reviewed} (%${Math.round((g.firstPassRate ?? 0) * 100)}), onaya kadar ort. ${Math.round((g.avgRounds ?? 0) * 10) / 10} tur`);
  }
  if (g.done > 0) parts.push(`görev başı ort. ${money(g.usdPerDone ?? 0)}; ort. süre ${hours(g.avgLeadHours ?? 0)}${g.avgWorkHours === null ? '' : ` (iş ${hours(g.avgWorkHours)})`}`);
  if (extra.reviewsGiven) parts.push(`${extra.reviewsGiven} inceleme verdi`);
  if (g.done + g.open > 0) parts.push(`takılma ${g.blocks}, park ${g.parks}, gecikme ${g.overdue}`);
  parts.push(`toplam ${money(g.usd)}${extra.unassignedUsd ? ` (görevsiz ${money(extra.unassignedUsd)})` : ''}`);
  return `• ${label}: ${parts.join('; ')}`;
}

function taskLine(t: TaskMetrics): string {
  const parts = [`${money(t.usd)}, ${t.turns} tur sonucu`];
  if (t.rounds > 0 || t.approvals + t.changes > 0) {
    const decided = [t.approvals ? `onay ${t.approvals}` : '', t.changes ? `değişiklik ${t.changes}` : ''].filter(Boolean).join(', ');
    parts.push(`inceleme ${t.rounds} tur${decided ? ` (${decided})` : ''}`);
  }
  if (t.leadHours !== null) parts.push(`süre ${hours(t.leadHours)}${t.workHours === null ? '' : ` (iş ${hours(t.workHours)})`}`);
  if (t.parks) parts.push(`park ${t.parks}`);
  if (t.blocks) parts.push(`takılma ${t.blocks}`);
  if (t.overdue) parts.push('gecikti');
  return `• [${STATUS_TR[t.status]}] “${t.title}”: ${parts.join('; ')}`;
}

/** What performanceRead shows: the totals reconciled, a line per person and per plan; or one of them with its tasks. */
export function formatPerformance(r: PerformanceReport, o: { employee?: string; plan?: string; days?: number }): string {
  const window = o.days ? `son ${o.days} gün` : r.since === null ? 'tüm zamanlar' : `${new Date(r.since).toLocaleString('tr-TR')} tarihinden beri`;
  const lines = [`# Performans (${window}; kaynak: olay kaydı ve görevler)`];
  const t = r.total;
  if (t.turns === 0) lines.push('Henüz tur sonucu yok.');
  else {
    const check = t.reconciled ? 'uzlaşıyor' : 'UZLAŞMIYOR: olay toplamıyla fark var';
    lines.push(`Claude kullanımı: ${t.turns} tur sonucu, ${money(t.usd)}, ${t.tokens} token. Görevlere ${money(t.assignedUsd)} + görevsiz ${money(t.unassignedUsd)} = ${money(t.assignedUsd + t.unassignedUsd)} (${check}).`);
  }
  const person = (e: EmployeeMetrics) => groupLine(e.name, e, { reviewsGiven: e.reviewsGiven, unassignedUsd: e.unassignedUsd });
  const plan = (p: PlanMetrics) => groupLine(`“${p.title}”`, p);
  const newestFirst = (xs: TaskMetrics[]) => [...xs].reverse().slice(0, 20).map(taskLine);
  if (o.employee !== undefined) {
    const e = r.employees.find((x) => x.id === o.employee);
    lines.push('', '## Çalışan', e ? person(e) : 'Bu dönemde işi ya da turu yok.');
    const own = newestFirst(r.tasks.filter((x) => x.assignee === o.employee));
    if (own.length) lines.push('', '## Görevler', ...own);
    return lines.join('\n');
  }
  if (o.plan !== undefined) {
    const p = r.plans.find((x) => x.id === o.plan);
    lines.push('', '## Plan', p ? plan(p) : 'Bu dönemde işi ya da turu yok.');
    const own = newestFirst(r.tasks.filter((x) => x.planId === o.plan));
    if (own.length) lines.push('', '## Görevler', ...own);
    return lines.join('\n');
  }
  if (r.employees.length) lines.push('', '## Çalışanlar', ...r.employees.map(person));
  if (r.plans.length) lines.push('', '## Planlar', ...r.plans.map(plan));
  return lines.join('\n');
}
