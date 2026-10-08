import type { DatabaseSync } from 'node:sqlite';
import { HOLDING_REASONS, STUCK_REASONS, type Employee, type HoldingPerson, type HoldingReason, type IdlePerson, type OfficeMetrics, type StuckItem, type StuckReason, type Task, type TeamMember, type UnavailablePerson } from '@cc/shared';
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

/** Why someone holds these open tasks (none in progress or blocked) without being at them: the nearest reason, then the earliest time. */
function holdingOf(own: readonly Task[], now: number): { why: HoldingReason; at: number | null } {
  const reasons = own.map((t): { why: HoldingReason; at: number | null } =>
    t.status === 'review' ? { why: 'review', at: null } : t.status === 'parked' ? { why: 'parked', at: t.notBefore ?? null } : (t.notBefore ?? 0) > now ? { why: 'scheduled', at: t.notBefore! } : { why: 'queued', at: null },
  );
  return reasons.sort((a, b) => HOLDING_REASONS.indexOf(a.why) - HOLDING_REASONS.indexOf(b.why) || (a.at ?? 0) - (b.at ?? 0))[0]!;
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
 * The office's three health figures for the top bar, at `now` (reads only): who of the team is at work, holds work,
 * is idle (the pulse's rule, `availability`) or cannot take work, what work was delivered in the last day and how much of it passed its first review,
 * which open tasks are stuck.
 */
export function officeMetrics(d: OfficeMetricsDeps, now: number): OfficeMetrics {
  const open = d.tasks.list({ statuses: OPEN_STATUSES, limit: 100_000 });
  const everyone = new Map(d.roster.list({ includeArchived: true }).map((e) => [e.id, e]));

  const openOf = new Map<string, Task[]>();
  for (const t of open) openOf.set(t.assignee, [...(openOf.get(t.assignee) ?? []), t]);
  const team = [...everyone.values()].filter((e) => e.lifecycle !== 'archived' && e.kind !== 'coordinator');
  // Each person in exactly one group.
  const atWork: TeamMember[] = [];
  const holding: HoldingPerson[] = [];
  const idle: IdlePerson[] = [];
  const unavailable: UnavailablePerson[] = [];
  for (const e of team) {
    const member = { id: e.id, name: e.name, title: e.title };
    const a = availability(e, d);
    const own = openOf.get(e.id) ?? [];
    if (!a.canTakeWork) unavailable.push({ ...member, state: e.lifecycle });
    else if (own.some((t) => t.status === 'in_progress' || t.status === 'blocked')) atWork.push(member);
    else if (own.length) holding.push({ ...member, ...holdingOf(own, now) });
    else idle.push({ ...member, since: a.idleSince });
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
    busy: { busy: atWork.length, total: team.length, atWork, holding, idle, unavailable },
    delivered: { count: delivered.done, firstPassRate: delivered.firstPassRate, windowHours: WINDOW_HOURS },
    stuck: { count: items.length, items },
  };
}
