import type { DatabaseSync } from 'node:sqlite';
import { STUCK_REASONS, type IdlePerson, type OfficeMetrics, type StuckItem, type StuckReason, type Task } from '@cc/shared';
import { deliveredSince } from '../performance.ts';
import type { Roster } from '../roster.ts';
import { RENUDGE_MS } from './dispatcher.ts';
import { OPEN_STATUSES, type TaskStore } from './store.ts';

const WINDOW_HOURS = 24;
const HOUR = 3_600_000;

export interface OfficeMetricsDeps {
  db: DatabaseSync;
  roster: Roster;
  tasks: Pick<TaskStore, 'list'>;
}

/** Why an open task is stuck, the first that holds in STUCK_REASONS' order; null when it is not. */
function stuckReason(t: Task, now: number): StuckReason | null {
  if (t.status === 'blocked') return 'blocked';
  if ((t.dueAt ?? Number.POSITIVE_INFINITY) <= now) return 'overdue';
  // As the dispatcher reads a reminder: one from before its time was kept counts as long ago.
  if (t.status === 'in_progress' && t.nudged && now - (t.nudgedAt ?? 0) >= RENUDGE_MS) return 'stalled';
  return null;
}

/**
 * The office's three health figures for the top bar, at `now` (reads only): who of the team holds work, what work was
 * delivered in the last day and how much of it passed its first review, which open tasks are stuck.
 */
export function officeMetrics(d: OfficeMetricsDeps, now: number): OfficeMetrics {
  const open = d.tasks.list({ statuses: OPEN_STATUSES, limit: 100_000 });
  const everyone = d.roster.list({ includeArchived: true });
  const nameOf = new Map(everyone.map((e) => [e.id, e.name]));

  const team = everyone.filter((e) => e.lifecycle !== 'archived' && e.kind !== 'coordinator');
  const holding = new Set(open.filter((t) => t.status === 'in_progress' || t.status === 'blocked').map((t) => t.assignee));
  const lastFinished = new Map(
    (d.db.prepare('SELECT assignee, MAX(finished_at) AS at FROM tasks WHERE finished_at IS NOT NULL GROUP BY assignee').all() as unknown as Array<{ assignee: string; at: number }>).map((r) => [r.assignee, r.at]),
  );
  const idle: IdlePerson[] = team
    .filter((e) => !holding.has(e.id))
    .map((e) => ({ id: e.id, name: e.name, title: e.title, since: lastFinished.get(e.id) ?? e.createdAt }))
    .sort((a, b) => a.since - b.since);

  const delivered = deliveredSince(d.db, now - WINDOW_HOURS * HOUR);

  const items: StuckItem[] = open
    .flatMap((t) => {
      const reason = stuckReason(t, now);
      return reason ? [{ taskId: t.id, title: t.title, assignee: nameOf.get(t.assignee) ?? t.assignee, reason }] : [];
    })
    .sort((a, b) => STUCK_REASONS.indexOf(a.reason) - STUCK_REASONS.indexOf(b.reason));

  return {
    generatedAt: now,
    busy: { busy: team.length - idle.length, total: team.length, idle },
    delivered: { count: delivered.done, firstPassRate: delivered.firstPassRate, windowHours: WINDOW_HOURS },
    stuck: { count: items.length, items },
  };
}
