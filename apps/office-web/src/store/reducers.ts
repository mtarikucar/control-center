import type { Employee, EmployeeUsage, OfficeSnapshot, QuotaState, StoredEvent, Usage, UsageTotals } from '@cc/shared';

export const MAX_EVENTS = 500;

export interface EmployeeView {
  employee: Employee;
  events: StoredEvent[];
  /** toolUseId → when it started; a tool is open until its result arrives or the turn ends. */
  openTools: Record<string, number>;
  lastTurnFinishedAt: number | null;
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
}

export const EMPTY_DATA: OfficeData = { lastSeq: 0, usageSeq: 0, quota: null, usage: {}, views: {} };

const ZERO: UsageTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 };

function addTo(t: UsageTotals, u: Usage, cost: number): UsageTotals {
  return {
    inputTokens: t.inputTokens + u.inputTokens,
    outputTokens: t.outputTokens + u.outputTokens,
    cacheReadTokens: t.cacheReadTokens + u.cacheReadTokens,
    cacheCreationTokens: t.cacheCreationTokens + u.cacheCreationTokens,
    costUsd: t.costUsd + cost,
  };
}

function addUsage(current: EmployeeUsage | undefined, u: Usage, cost: number): EmployeeUsage {
  return { today: addTo(current?.today ?? ZERO, u, cost), total: addTo(current?.total ?? ZERO, u, cost) };
}

/**
 * `live` snapshots open the WebSocket stream, so their lastSeq is where its replay starts; an `http` snapshot may be
 * ahead of events still in flight on the stream and must not move that point. Older snapshots than what is shown
 * are ignored.
 */
export function applySnapshot(d: OfficeData, s: OfficeSnapshot, source: 'live' | 'http' = 'live'): OfficeData {
  if (s.lastSeq < d.usageSeq) return d;
  const views: Record<string, EmployeeView> = {};
  for (const employee of s.employees) {
    const prev = d.views[employee.id];
    views[employee.id] = prev
      ? { ...prev, employee }
      : { employee, events: [], openTools: {}, lastTurnFinishedAt: null, eventsLoaded: false };
  }
  const lastSeq = source === 'live' ? Math.max(d.lastSeq, s.lastSeq) : d.lastSeq;
  return { lastSeq, usageSeq: s.lastSeq, quota: s.quota, usage: s.usage, views };
}

export function applyEvent(d: OfficeData, s: StoredEvent): OfficeData {
  const ev = s.event;
  let quota = d.quota;
  if (ev.type === 'quota.updated') {
    quota = { status: ev.status, fiveHour: ev.fiveHour ?? d.quota?.fiveHour ?? null, sevenDay: ev.sevenDay ?? d.quota?.sevenDay ?? null, updatedAt: s.ts };
  }
  const next: OfficeData = { ...d, lastSeq: Math.max(d.lastSeq, s.seq), quota };
  const id = s.employeeId;
  const view = id ? d.views[id] : undefined;
  if (!id || !view) return next;
  if (view.events.some((x) => x.seq === s.seq)) return next;

  let v: EmployeeView = { ...view, events: [...view.events, s].slice(-MAX_EVENTS) };
  let usage = d.usage;
  switch (ev.type) {
    case 'lifecycle.changed':
      v = { ...v, employee: { ...v.employee, lifecycle: ev.to } };
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
      if (ev.queuedTurns === 0) v = { ...v, openTools: {}, lastTurnFinishedAt: s.ts };
      if (s.seq > d.usageSeq) usage = { ...usage, [id]: addUsage(usage[id], ev.usage, ev.costUsd) };
      break;
    case 'side.answer':
      if (s.seq > d.usageSeq) usage = { ...usage, [id]: addUsage(usage[id], ev.usage, ev.costUsd) };
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
  let lastTurnFinishedAt = view.lastTurnFinishedAt;
  let openTools: Record<string, number> = {};
  for (const e of events) {
    if (e.event.type === 'tool.started') openTools = { ...openTools, [e.event.toolUseId]: e.ts };
    else if (e.event.type === 'tool.finished') {
      openTools = { ...openTools };
      delete openTools[e.event.toolUseId];
    } else if (e.event.type === 'turn.finished' && e.event.queuedTurns === 0) {
      openTools = {};
      lastTurnFinishedAt = Math.max(lastTurnFinishedAt ?? 0, e.ts);
    }
  }
  return { ...view, events, openTools, lastTurnFinishedAt, eventsLoaded: true };
}

export function needsRefresh(s: StoredEvent): boolean {
  return s.event.type === 'employee.hired' || s.event.type === 'employee.fired';
}

export function openToolSince(v: EmployeeView): number | null {
  const starts = Object.values(v.openTools);
  return starts.length > 0 ? Math.min(...starts) : null;
}
