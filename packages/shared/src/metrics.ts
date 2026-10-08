/** Someone without work in hand, and since when (their last finished task, else their hire). */
export interface IdlePerson {
  id: string;
  name: string;
  title: string;
  since: number;
}

/** Why an open task counts as stuck, in the order they are checked (a task counts once, for the first). */
export const STUCK_REASONS = ['blocked', 'overdue', 'stalled'] as const;
export type StuckReason = (typeof STUCK_REASONS)[number];

export interface StuckItem {
  taskId: string;
  title: string;
  /** The assignee's name. */
  assignee: string;
  reason: StuckReason;
}

/** The office at a glance (GET /api/metrics): is the team used, is work delivered, is anything stuck. */
export interface OfficeMetrics {
  generatedAt: number;
  /** Everyone but the coordinator and the archived; busy: holding a task in progress or blocked. Idle: the longest first. */
  busy: { busy: number; total: number; idle: IdlePerson[] };
  /** Work tasks done in the window; the first-pass rate among those reviewed (null: none was). */
  delivered: { count: number; firstPassRate: number | null; windowHours: 24 };
  stuck: { count: number; items: StuckItem[] };
}
