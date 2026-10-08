import type { Employee, Lifecycle } from '@cc/shared';
import type { CompanyStateStore } from './goal-store.ts';
import type { TaskStore } from './store.ts';

/**
 * Who cannot take work now is not idle capacity: a quota limit, a failed session, stopped by the owner, in the owner's
 * terminal. A sleeper can (a task wakes them).
 */
export const UNAVAILABLE: readonly Lifecycle[] = ['limited', 'error', 'stopped', 'in_terminal'];

export interface Availability {
  canTakeWork: boolean;
  /** Since when they have been without work: the latest of their hire, their last closed task and the last task moved from them. */
  idleSince: number;
}

/** One idle rule for the pulse's idle-capacity notice and the top bar's figures. */
export function availability(e: Employee, d: { tasks: Pick<TaskStore, 'lastFinishedAt'>; state: Pick<CompanyStateStore, 'taskLostAt'> }): Availability {
  return {
    canTakeWork: !UNAVAILABLE.includes(e.lifecycle),
    idleSince: Math.max(e.createdAt, d.tasks.lastFinishedAt(e.id) ?? 0, d.state.taskLostAt(e.id)),
  };
}
