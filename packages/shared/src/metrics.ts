import type { Lifecycle } from './employee.ts';

/** Someone who could take work and holds no open task, and since when (the latest of their hire, last closed task and last task moved away). */
export interface IdlePerson {
  id: string;
  name: string;
  title: string;
  since: number;
}

/** Someone who cannot take work right now (a quota limit, a failed session, stopped by the owner, in the owner's terminal). */
export interface UnavailablePerson {
  id: string;
  name: string;
  title: string;
  state: Lifecycle;
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
  /**
   * Everyone but the coordinator and the archived (`total`), in three: busy (can take work and holds an open task), idle
   * (can take work and holds none; the longest first) and unavailable (cannot take work right now).
   */
  busy: { busy: number; total: number; idle: IdlePerson[]; unavailable: UnavailablePerson[] };
  /** Work tasks done in the window; the first-pass rate among those reviewed (null: none was). */
  delivered: { count: number; firstPassRate: number | null; windowHours: 24 };
  stuck: { count: number; items: StuckItem[] };
}
