import { streamStatus, type Plan, type PlanStream, type PlanStreamView, type PlanView, type Task } from '@cc/shared';

/** The stream of its plan a task belongs to (management cycle §3.4); null: none, or one the page does not know. */
export function streamOf(plans: Record<string, PlanView>, task: Pick<Task, 'planId' | 'streamId'> | undefined): PlanStream | null {
  if (!task?.planId || !task.streamId) return null;
  return plans[task.planId]?.streams?.find((s) => s.id === task.streamId) ?? null;
}

/**
 * A plan's streams with their status: the server's where the page has it (the snapshot), else what the page's tasks
 * say (a plan only the feed has shown so far; the page has every open task but only the latest closed ones).
 */
export function streamViews(plan: Plan | PlanView, tasks: Record<string, Task>): PlanStreamView[] {
  const streams: ReadonlyArray<PlanStream & { status?: PlanStreamView['status'] }> = plan.streams ?? [];
  if (streams.length === 0) return [];
  const own = Object.values(tasks).filter((t) => t.planId === plan.id);
  return streams.map((s) => ({ ...s, status: s.status ?? streamStatus(own.filter((t) => t.streamId === s.id)) }));
}
