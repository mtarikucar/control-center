export const TASK_STATUSES = ['waiting', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskResult {
  summary: string;
  /** Paths of the files the work produced (relative to the employee's desk or absolute). */
  outputs: string[];
  learned: string;
}

/** The id the office uses for the owner wherever a task or plan names who asked. */
export const OWNER = 'owner';

export interface Task {
  id: string;
  planId: string | null;
  title: string;
  description: string;
  /** Definition of done, one item per line. */
  done: string[];
  /** An employee id, or OWNER. */
  requester: string;
  assignee: string;
  /** 1 = most urgent … 5 = whenever. */
  priority: number;
  dependsOn: string[];
  status: TaskStatus;
  /** How many passes deep this task is (a task passed while working on a passed task is one deeper). */
  chainDepth: number;
  note: string | null;
  result: TaskResult | null;
  /** The office reminded the assignee once that this task is still open. */
  nudged: boolean;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export const PLAN_STATUSES = ['draft', 'approved', 'done', 'declined'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export interface Plan {
  id: string;
  title: string;
  goal: string;
  approach: string;
  /** Who works on it: existing employees and roles to hire, in the coordinator's words. */
  people: string;
  /** Draft tasks, one per line. */
  steps: string[];
  /** Estimated share of the weekly subscription quota (%), money (USD) and time (days). */
  quotaPct: number | null;
  usd: number | null;
  days: number | null;
  risks: string;
  status: PlanStatus;
  version: number;
  proposedBy: string;
  createdAt: number;
  updatedAt: number;
  approvedAt: number | null;
}

export type TaskChange = 'created' | 'assigned' | 'started' | 'updated' | 'finished' | 'reprioritized';
export type PlanChange = 'proposed' | 'revised' | 'approved' | 'declined' | 'done';
