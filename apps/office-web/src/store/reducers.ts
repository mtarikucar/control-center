import type { BudgetSummary, ClockStatus, Employee, EmployeeUsage, OfficeSnapshot, Plan, Proposal, QuotaState, Schedule, StoredEvent, Task, Usage, UsageTotals, Goal, Approval } from '@cc/shared';

export const MAX_EVENTS = 500;

export interface EmployeeView {
  employee: Employee;
  events: StoredEvent[];
  /** toolUseId → when it started; a tool is open until its result arrives or the turn ends. */
  openTools: Record<string, number>;
  /** When the employee last became idle (a turn ended or the lifecycle went idle); drives wandering. */
  idleSince: number | null;
  eventsLoaded: boolean;
}

export interface OfficeData {
  /** Last seq received over the live feed: the point a reconnect replays from. */
  lastSeq: number;
  /** Events up to this seq are already included in `usage` (it came from a snapshot taken at that seq). */
  usageSeq: number;
  quota: QuotaState | null;
  usage: Record<string, EmployeeUsage>;
  views: Record<string, EmployeeView>;
  /** A snapshot has arrived, so `views` lists everyone: an id missing from it is not an employee. */
  synced: boolean;
  /** The company: every task the snapshot or the feed has shown (open ones and the latest closed). */
  tasks: Record<string, Task>;
  plans: Record<string, Plan>;
  /** Bumped by every memory change, so open memory tabs reload. */
  memoryRev: number;
  /** The constitution, the reserve and the money (null: an office without the company layer). */
  budget: BudgetSummary | null;
  /** The coordinator's goals (stage 2). */
  goals: Record<string, Goal>;
  /** The owner paused the company. */
  paused: boolean;
  proposals: Record<string, Proposal>;
  /** The owner's approvals of calls the gate held (B9a): what waits and the last decided. */
  approvals: Record<string, Approval>;
  /** A colleague passed work: the receiver's tag says so for a few seconds. */
  pings: Record<string, { text: string; at: number }>;
  /** Reports the owner has not read yet, per employee (the coordinator's tag shows them). */
  unseenReports: Record<string, number>;
  /** Routines: active, paused and the last stopped ones. */
  schedules: Record<string, Schedule>;
  /** The office clock as of the last snapshot (null: an office without one). */
  clock: ClockStatus | null;
  /** Bumped by everything that can change an agenda, so an open agenda fetches it again. */
  agendaRev: number;
}

export const EMPTY_DATA: OfficeData = { lastSeq: 0, usageSeq: 0, quota: null, usage: {}, views: {}, synced: false, tasks: {}, plans: {}, memoryRev: 0, budget: null, proposals: {}, approvals: {}, pings: {}, unseenReports: {}, goals: {}, paused: false, schedules: {}, clock: null, agendaRev: 0 };

const ZERO: UsageTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, turns: 0, sideAnswers: 0 };

function addTo(t: UsageTotals, u: Usage, cost: number, side: boolean): UsageTotals {
  return {
    inputTokens: t.inputTokens + u.inputTokens,
    outputTokens: t.outputTokens + u.outputTokens,
    cacheReadTokens: t.cacheReadTokens + u.cacheReadTokens,
    cacheCreationTokens: t.cacheCreationTokens + u.cacheCreationTokens,
    costUsd: t.costUsd + cost,
    turns: t.turns + (side ? 0 : 1),
    sideAnswers: t.sideAnswers + (side ? 1 : 0),
  };
}

function addUsage(current: EmployeeUsage | undefined, u: Usage, cost: number, side = false): EmployeeUsage {
  return { today: addTo(current?.today ?? ZERO, u, cost, side), total: addTo(current?.total ?? ZERO, u, cost, side) };
}

/**
 * `live` snapshots open the WebSocket stream, so their lastSeq is where its replay starts; an `http` snapshot may be
 * ahead of events still in flight on the stream and must not move that point. Older snapshots than what is shown
 * are ignored.
 */
export function applySnapshot(current: OfficeData, s: OfficeSnapshot, source: 'live' | 'http' = 'live'): OfficeData {
  // A live snapshot behind what the page has seen means the office's log started over (its database was reset).
  const d = source === 'live' && s.lastSeq < current.lastSeq ? EMPTY_DATA : current;
  if (s.lastSeq < d.usageSeq) return d;
  const views: Record<string, EmployeeView> = {};
  for (const employee of s.employees) {
    const prev = d.views[employee.id];
    views[employee.id] = prev ? { ...prev, employee } : freshView(employee);
  }
  const lastSeq = source === 'live' ? Math.max(d.lastSeq, s.lastSeq) : d.lastSeq;
  return {
    lastSeq,
    usageSeq: s.lastSeq,
    quota: s.quota,
    usage: s.usage,
    views,
    synced: true,
    memoryRev: d.memoryRev,
    budget: s.budget ?? null,
    proposals: Object.fromEntries((s.proposals ?? []).map((p) => [p.id, p])),
    approvals: Object.fromEntries((s.approvals ?? []).map((a) => [a.id, a])),
    pings: d.pings,
    unseenReports: d.unseenReports,
    tasks: Object.fromEntries((s.tasks ?? []).map((t) => [t.id, t])),
    plans: Object.fromEntries((s.plans ?? []).map((p) => [p.id, p])),
    goals: Object.fromEntries((s.goals ?? []).map((g) => [g.id, g])),
    paused: s.paused ?? false,
    schedules: Object.fromEntries((s.schedules ?? []).map((x) => [x.id, x])),
    clock: s.clock ?? null,
    // From `current`: a log that started over must still move it, or an open agenda would keep the old office.
    agendaRev: current.agendaRev + 1,
  };
}

/** Events after which an agenda may read differently (spec §6.1). */
const AGENDA_EVENTS = new Set(['task.changed', 'plan.changed', 'schedule.changed', 'lifecycle.changed', 'budget.changed', 'company.paused', 'clock.jumped']);

const freshView = (employee: Employee): EmployeeView => ({ employee, events: [], openTools: {}, idleSince: null, eventsLoaded: false });

/** A just-hired employee, shown before the next snapshot lists them. */
export function addEmployee(d: OfficeData, employee: Employee): OfficeData {
  if (d.views[employee.id]) return d;
  return { ...d, views: { ...d.views, [employee.id]: freshView(employee) } };
}

export function applyEvent(d: OfficeData, s: StoredEvent): OfficeData {
  const ev = s.event;
  let quota = d.quota;
  if (ev.type === 'quota.updated') {
    quota = { status: ev.status, fiveHour: ev.fiveHour ?? d.quota?.fiveHour ?? null, sevenDay: ev.sevenDay ?? d.quota?.sevenDay ?? null, updatedAt: s.ts };
  }
  const next: OfficeData = { ...d, lastSeq: Math.max(d.lastSeq, s.seq), quota };
  // Company records are global: keep them whatever the page knows about the employee the event is filed under.
  if (ev.type === 'task.changed') next.tasks = { ...d.tasks, [ev.task.id]: ev.task };
  if (ev.type === 'plan.changed') next.plans = { ...d.plans, [ev.plan.id]: ev.plan };
  if (ev.type === 'decision.recorded' || ev.type === 'playbook.updated' || ev.type === 'note.written') next.memoryRev = d.memoryRev + 1;
  if (ev.type === 'budget.changed') next.budget = ev.budget;
  if (ev.type === 'proposal.changed') next.proposals = { ...d.proposals, [ev.proposal.id]: ev.proposal };
  if (ev.type === 'approval.changed') next.approvals = { ...d.approvals, [ev.approval.id]: ev.approval };
  if (ev.type === 'goal.changed') next.goals = { ...d.goals, [ev.goal.id]: ev.goal };
  if (ev.type === 'company.paused') next.paused = ev.paused;
  if (ev.type === 'schedule.changed') next.schedules = { ...d.schedules, [ev.schedule.id]: ev.schedule };
  if (AGENDA_EVENTS.has(ev.type)) next.agendaRev = d.agendaRev + 1;
  if (ev.type === 'task.changed' && ev.change === 'created' && ev.task.requester !== 'owner' && ev.task.requester !== ev.task.assignee) {
    next.pings = { ...d.pings, [ev.task.assignee]: { text: `Yeni iş: ${ev.task.title}`, at: s.ts } };
  }
  if (ev.type === 'company.report' && s.employeeId) next.unseenReports = { ...d.unseenReports, [s.employeeId]: (d.unseenReports[s.employeeId] ?? 0) + 1 };
  const id = s.employeeId;
  const view = id ? d.views[id] : undefined;
  if (!id || !view) return next;
  if (view.events.some((x) => x.seq === s.seq)) return next;

  let v: EmployeeView = { ...view, events: [...view.events, s].slice(-MAX_EVENTS) };
  let usage = d.usage;
  switch (ev.type) {
    case 'lifecycle.changed':
      v = { ...v, employee: { ...v.employee, lifecycle: ev.to } };
      // Only a working employee runs tools; a crash or stop never reports the open ones finished.
      if (ev.to !== 'working') v = { ...v, openTools: {} };
      if (ev.to === 'idle') v = { ...v, idleSince: s.ts };
      break;
    case 'model.changed':
      v = { ...v, employee: { ...v.employee, model: ev.model } };
      break;
    case 'session.started':
      v = { ...v, employee: { ...v.employee, sessionStarted: true } };
      break;
    case 'tool.started':
      v = { ...v, openTools: { ...v.openTools, [ev.toolUseId]: s.ts } };
      break;
    case 'tool.finished': {
      const openTools = { ...v.openTools };
      delete openTools[ev.toolUseId];
      v = { ...v, openTools };
      break;
    }
    case 'turn.finished':
      if (ev.queuedTurns === 0) v = { ...v, openTools: {}, idleSince: s.ts };
      if (s.seq > d.usageSeq) usage = { ...usage, [id]: addUsage(usage[id], ev.usage, ev.costUsd) };
      break;
    case 'side.answer':
      if (s.seq > d.usageSeq) usage = { ...usage, [id]: addUsage(usage[id], ev.usage, ev.costUsd, true) };
      break;
    default:
      break;
  }
  return { ...next, usage, views: { ...d.views, [id]: v } };
}

/** Folds loaded history into a view (dedupe by seq) and re-derives the turn state from it. */
export function mergeEvents(view: EmployeeView, loaded: StoredEvent[]): EmployeeView {
  const bySeq = new Map<number, StoredEvent>();
  for (const e of [...loaded, ...view.events]) bySeq.set(e.seq, e);
  const events = [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-MAX_EVENTS);
  let idleSince = view.idleSince;
  let openTools: Record<string, number> = {};
  for (const e of events) {
    if (e.event.type === 'tool.started') openTools = { ...openTools, [e.event.toolUseId]: e.ts };
    else if (e.event.type === 'tool.finished') {
      openTools = { ...openTools };
      delete openTools[e.event.toolUseId];
    } else if (e.event.type === 'turn.finished' && e.event.queuedTurns === 0) {
      openTools = {};
      idleSince = Math.max(idleSince ?? 0, e.ts);
    } else if (e.event.type === 'lifecycle.changed') {
      if (e.event.to !== 'working') openTools = {};
      if (e.event.to === 'idle') idleSince = Math.max(idleSince ?? 0, e.ts);
    }
  }
  return { ...view, events, openTools, idleSince, eventsLoaded: true };
}

/** Events that change employee fields only the snapshot carries (who exists, lastError, limitResetsAt). */
export function needsRefresh(s: StoredEvent): boolean {
  const t = s.event.type;
  return t === 'employee.hired' || t === 'employee.fired' || t === 'lifecycle.changed' || t === 'role.changed';
}

export function openToolSince(v: EmployeeView): number | null {
  const starts = Object.values(v.openTools);
  return starts.length > 0 ? Math.min(...starts) : null;
}
