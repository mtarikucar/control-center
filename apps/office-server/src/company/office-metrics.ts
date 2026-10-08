import type { DatabaseSync } from 'node:sqlite';
import { STUCK_REASONS, type Employee, type IdlePerson, type OfficeMetrics, type StuckItem, type StuckReason, type Task, type UnavailablePerson } from '@cc/shared';
import { deliveredSince } from '../performance.ts';
import type { Roster } from '../roster.ts';
import { availability } from './availability.ts';
import type { CompanyStateStore } from './goal-store.ts';
import { OPEN_STATUSES, type TaskStore } from './store.ts';

const WINDOW_HOURS = 24;
const HOUR = 3_600_000;

export interface OfficeMetricsDeps {
  db: DatabaseSync;
  roster: Roster;
  tasks: Pick<TaskStore, 'list' | 'lastFinishedAt'>;
  state: Pick<CompanyStateStore, 'taskLostAt'>;
}

/** Why an open task is stuck, the first that holds in STUCK_REASONS' order; null when it is not. */
function stuckReason(t: Task, holder: Employee | undefined, now: number): StuckReason | null {
  if (t.status === 'blocked') return 'blocked';
  if ((t.dueAt ?? Number.POSITIVE_INFINITY) <= now) return 'overdue';
  // The office had to remind them, and they are not at it now: it stays until they work, finish, park or lose it.
  if (t.status === 'in_progress' && t.nudged && holder?.lifecycle !== 'working') return 'stalled';
  return null;
}

/**
 * The office's three health figures for the top bar, at `now` (reads only): who of the team holds work (the pulse's
 * idle rule, `availability`), what work was delivered in the last day and how much of it passed its first review,
 * which open tasks are stuck.
 */
export function officeMetrics(d: OfficeMetricsDeps, now: number): OfficeMetrics {
  const open = d.tasks.list({ statuses: OPEN_STATUSES, limit: 100_000 });
  const everyone = new Map(d.roster.list({ includeArchived: true }).map((e) => [e.id, e]));

  const holding = new Set(open.map((t) => t.assignee));
  const team = [...everyone.values()].filter((e) => e.lifecycle !== 'archived' && e.kind !== 'coordinator');
  const idle: IdlePerson[] = [];
  const unavailable: UnavailablePerson[] = [];
  let busy = 0;
  for (const e of team) {
    const a = availability(e, d);
    if (!a.canTakeWork) unavailable.push({ id: e.id, name: e.name, title: e.title, state: e.lifecycle });
    else if (holding.has(e.id)) busy += 1;
    else idle.push({ id: e.id, name: e.name, title: e.title, since: a.idleSince });
  }
  idle.sort((a, b) => a.since - b.since);

  const delivered = deliveredSince(d.db, now - WINDOW_HOURS * HOUR);

  const items: StuckItem[] = open
    .flatMap((t) => {
      const holder = everyone.get(t.assignee);
      const reason = stuckReason(t, holder, now);
      return reason ? [{ taskId: t.id, title: t.title, assignee: holder?.name ?? t.assignee, reason }] : [];
    })
    .sort((a, b) => STUCK_REASONS.indexOf(a.reason) - STUCK_REASONS.indexOf(b.reason));

  return {
    generatedAt: now,
    busy: { busy, total: team.length, idle, unavailable },
    delivered: { count: delivered.done, firstPassRate: delivered.firstPassRate, windowHours: WINDOW_HOURS },
    stuck: { count: items.length, items },
  };
}
