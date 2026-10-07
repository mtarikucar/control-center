import type { Constitution } from '@cc/shared';
import { DEFAULT_CONSTITUTION } from '@cc/shared';
import type { Db } from '../db.ts';
import type { EventStore } from '../event-store.ts';
import type { Company } from './company.ts';
import type { CompanyStateStore } from './goal-store.ts';
import type { NoticeStore, ScheduleStore, TaskStore } from './store.ts';
import { formatWhen, nextCron, parseCron } from './time.ts';

/** A park may reach this far ahead (spec §4.2). */
export const PARK_MAX_DAYS = 30;
/** A due date or start time may reach this far ahead. */
export const DUE_MAX_DAYS = 365;
/** From this many parks on, the coordinator decides whether the task is real work (spec §4.2). */
export const REPARK_LIMIT = 3;

export interface SchedulingDeps {
  db: Db;
  tasks: TaskStore;
  schedules: ScheduleStore;
  notices: NoticeStore;
  company: Company;
  state: CompanyStateStore;
  events: EventStore;
  constitution?: () => Constitution;
  now?: () => number;
}

/** "Adım 1 penceresi · Koordinatör" — what the nearest due time is about (for the status line and the sheet). */
export function dueLabel(tasks: TaskStore, schedules: ScheduleStore, company: Company, now: number): string | null {
  const at = [tasks.nextDueAt(now), schedules.nextRunAt()].filter((t): t is number => t !== null && t > now);
  if (at.length === 0) return null;
  const when = Math.min(...at);
  const task =
    tasks.list({ statuses: ['parked', 'waiting'], limit: 10_000 }).find((t) => t.notBefore === when) ??
    tasks.list({ statuses: ['waiting', 'in_progress', 'review', 'blocked', 'parked'], limit: 10_000 }).find((t) => t.dueAt === when);
  if (task) return `${task.title} · ${company.nameOf(task.assignee)}`;
  const schedule = schedules.list({ statuses: ['active'] }).find((s) => s.nextRunAt === when);
  return schedule ? `${schedule.title} · ${company.nameOf(schedule.assignee)} (rutin)` : null;
}

/** What one run of the due-processor did. */
export interface DueReport {
  /** Tasks that came back from park. */
  returned: string[];
  /** Routines that opened a task. */
  fired: string[];
  /** Routines skipped because their previous instance was still open. */
  skipped: string[];
  /** Tasks whose due date passed (the coordinator was told). */
  overdue: string[];
  /** "<job>: <message>" for each item that failed; the run went on. */
  errors: string[];
}

/**
 * The scheduling service (spec §4, §5): the rules of time over the task store, and the processor the clock runs.
 * It never delivers anything itself; it changes states, and the dispatcher's own rules do the rest.
 */
export class Scheduling {
  readonly #d: SchedulingDeps;
  readonly #now: () => number;

  constructor(d: SchedulingDeps) {
    this.#d = d;
    this.#now = d.now ?? Date.now;
  }

  /** The nearest future time anything needs the clock, or null. */
  nextDueAt(now: number = this.#now()): number | null {
    const candidates = [this.#d.tasks.nextDueAt(now), this.#d.schedules.nextRunAt()].filter((t): t is number => t !== null && t > now);
    return candidates.length ? Math.min(...candidates) : null;
  }

  /** Everything due at `now`, each item on its own: a failure is logged and skipped. */
  runDue(now: number = this.#now()): DueReport {
    const report: DueReport = { returned: [], fired: [], skipped: [], overdue: [], errors: [] };
    const guard = (job: string, fn: () => void) => {
      try {
        fn();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        report.errors.push(`${job}: ${message}`);
        this.#d.events.append(null, { type: 'clock.error', job, message: message.slice(0, 500) });
      }
    };
    for (const task of this.#d.tasks.dueParked(now)) {
      guard(`park-return ${task.id}`, () => {
        if (this.#d.company.returnFromPark(task.id, now)) report.returned.push(task.id);
      });
    }
    for (const task of this.#d.tasks.overdueUnnotified(now)) {
      guard(`overdue ${task.id}`, () => {
        this.#d.tasks.markOverdueNotified(task.id);
        const c = this.#d.company.coordinator();
        if (c) this.#d.notices.add(c.id, 'task.overdue', `“${task.title}” görevinin (no ${task.id}, ${this.#d.company.nameOf(task.assignee)}) son tarihi geçti: ${formatWhen(task.dueAt ?? now, now)}.`);
        report.overdue.push(task.id);
      });
    }
    this.runSchedules(now, report, guard);
    this.#d.state.set('clock.lastRunAt', String(now));
    return report;
  }

  /**
   * Routines whose time came (spec §4.4): one task each, unless the previous instance is still open; none while the
   * company is paused. The next run is always after `now`: missed runs become one catch-up at most.
   */
  protected runSchedules(now: number, report: DueReport, guard: (job: string, fn: () => void) => void): void {
    const d = this.deps;
    if (d.company.paused()) return;
    for (const schedule of d.schedules.due(now)) {
      guard(`schedule ${schedule.id}`, () => {
        if (schedule.until !== null && schedule.until <= now) {
          const stopped = d.schedules.update(schedule.id, { status: 'stopped', note: 'Bitiş tarihi geçti' });
          d.events.append(null, { type: 'schedule.changed', change: 'stopped', schedule: stopped });
          return;
        }
        const nextRunAt = nextCron(parseCron(schedule.cron), now);
        const open = d.tasks.openInstance(schedule.id);
        if (open) {
          // The pile-up brake: no second instance while the first is open.
          const skipCount = schedule.skipCount + 1;
          const skipped = d.schedules.update(schedule.id, { nextRunAt, skipCount, note: `${formatWhen(now, now)}: önceki örnek (“${open.title}”) hâlâ açık, atlandı` });
          d.events.append(null, { type: 'schedule.changed', change: 'skipped', schedule: skipped });
          report.skipped.push(schedule.id);
          if (skipCount % REPARK_LIMIT === 0) {
            const c = d.company.coordinator();
            if (c) d.notices.add(c.id, 'schedule.skipped', `“${schedule.title}” rutini ${skipCount} kez atlandı: önceki örneği (“${open.title}”, no ${open.id}) hâlâ açık. Örneği kapat ya da rutini seyrelt/durdur (scheduleUpdate).`);
          }
          return;
        }
        // Opening the task and moving the next run is one transaction: never half done, never twice.
        d.db.exec('BEGIN IMMEDIATE');
        try {
          const task = d.company.createTask(schedule.createdBy, {
            assignee: schedule.assignee, title: `${schedule.title} — ${formatWhen(now, now)}`, description: schedule.description, done: schedule.done,
            priority: schedule.priority, planId: schedule.planId, difficulty: schedule.difficulty, reviewer: schedule.reviewer, scheduleId: schedule.id,
          });
          const fired = d.schedules.update(schedule.id, { nextRunAt, lastRunAt: now, lastTaskId: task.id, failCount: 0, note: null });
          d.db.exec('COMMIT');
          d.events.append(null, { type: 'schedule.changed', change: 'fired', schedule: fired });
          report.fired.push(schedule.id);
        } catch (err) {
          if (d.db.isTransaction) d.db.exec('ROLLBACK');
          const failCount = schedule.failCount + 1;
          const message = err instanceof Error ? err.message : String(err);
          const paused = failCount >= REPARK_LIMIT;
          const failed = d.schedules.update(schedule.id, { nextRunAt, failCount, status: paused ? 'paused' : schedule.status, note: `${formatWhen(now, now)}: görev açılamadı — ${message}` });
          if (paused) {
            // The sheet follows routines by their events.
            d.events.append(null, { type: 'schedule.changed', change: 'paused', schedule: failed });
            const c = d.company.coordinator();
            if (c) d.notices.add(c.id, 'schedule.failed', `“${schedule.title}” rutini üst üste ${failCount} kez görev açamadı (${message}); duraklatıldı. Nedenini gider ve scheduleUpdate ile sürdür.`);
          }
          // Counted on the routine and logged by the guard (clock.error).
          throw err;
        }
      });
    }
  }

  protected rules(): Constitution {
    return this.#d.constitution?.() ?? DEFAULT_CONSTITUTION;
  }

  protected get deps(): SchedulingDeps {
    return this.#d;
  }
}
