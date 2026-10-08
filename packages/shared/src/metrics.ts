import type { Lifecycle } from './employee.ts';

/** Someone of the team, as the top bar names them. */
export interface TeamMember {
  id: string;
  name: string;
  title: string;
}

/** Someone who could take work and holds no open task, and since when (the latest of their hire, last closed task and last task moved away). */
export interface IdlePerson extends TeamMember {
  since: number;
}

/**
 * Why someone holds open work they are not at, nearest first (one per person): queued (could be handed out; e.g. behind
 * a dependency or the owner's reserve), scheduled (a start time to come), parked (until a time), review (waits on its
 * reviewer).
 */
export const HOLDING_REASONS = ['queued', 'scheduled', 'parked', 'review'] as const;
export type HoldingReason = (typeof HOLDING_REASONS)[number];

export interface HoldingPerson extends TeamMember {
  why: HoldingReason;
  /** When a scheduled task starts or a parked one returns (the earliest); null for queued and review. */
  at: number | null;
}

/** Someone who cannot take work right now (a quota limit, a failed session, stopped by the owner, in the owner's terminal). */
export interface UnavailablePerson extends TeamMember {
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
   * Everyone but the coordinator and the archived (`total`), each in one group: at work (can take work and holds a task
   * in progress or blocked; `busy` counts them), holding (holds open work but is not at it), idle (holds none; the
   * longest first) and unavailable (cannot take work right now).
   */
  busy: { busy: number; total: number; atWork: TeamMember[]; holding: HoldingPerson[]; idle: IdlePerson[]; unavailable: UnavailablePerson[] };
  /** Work tasks done in the window; the first-pass rate among those reviewed (null: none was). */
  delivered: { count: number; firstPassRate: number | null; windowHours: 24 };
  stuck: { count: number; items: StuckItem[] };
}
