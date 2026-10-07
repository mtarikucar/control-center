import type { TaskDifficulty } from './company.ts';
import type { ModelAlias } from './employee.ts';

/** The owner's fixed limits (spec §4.6, §6). */
export interface Constitution {
  /** Employees at most, the coordinator included (never more than the desks). */
  maxEmployees: number;
  /** Share of the Claude quota kept for the owner: above 100 − this %, the office starts only urgent work. */
  ownerReservePct: number;
  /** Money the company may spend in a calendar month, USD; null = no cap. */
  monthlyUsdCap: number | null;
  chainDepth: number;
  tasksPerDay: number;
  openTasksPerPlan: number;
  /** Someone with nothing to do sleeps after this many idle minutes (0 = never). */
  idleSleepMinutes: number;
  /** Local hours when notices that need no decision come together in one digest turn; the last one brings the daily report. */
  digestHours: number[];
  /** The coordinator's model by what a turn is for: the owner's messages, decisions (notices, tasks, reminders), digests. */
  coordinatorModels: { owner: ModelAlias; decision: ModelAlias; digest: ModelAlias };
  /** Minutes a session's prompt cache stays warm: a session moves to a weaker model only after this long without a turn. */
  cacheTtlMinutes: number;
  /** The model a task starts on, by its difficulty. */
  difficultyModels: Record<TaskDifficulty, ModelAlias>;
}

export const DEFAULT_CONSTITUTION: Constitution = {
  maxEmployees: 8,
  ownerReservePct: 25,
  monthlyUsdCap: null,
  chainDepth: 5,
  tasksPerDay: 30,
  openTasksPerPlan: 60,
  idleSleepMinutes: 30,
  digestHours: [9, 17],
  coordinatorModels: { owner: 'fable', decision: 'sonnet', digest: 'haiku' },
  cacheTtlMinutes: 5,
  difficultyModels: { easy: 'haiku', medium: 'sonnet', hard: 'opus', critical: 'fable' },
};

/** Money an employee spent on an outside service (the office cannot see it; they record it). */
export interface Spend {
  id: string;
  ts: number;
  by: string;
  service: string;
  usd: number;
  purpose: string;
  planId: string | null;
}

export interface ReserveState {
  /** The owner's share is being kept: the office starts only priority-1 work and lets idle people sleep. */
  active: boolean;
  /** Usage at or above which the reserve applies, %. */
  limitPct: number;
  fiveHourPct: number | null;
  sevenDayPct: number | null;
}

export interface BudgetSummary {
  constitution: Constitution;
  reserve: ReserveState;
  /** This calendar month (local time): recorded spending. */
  month: { key: string; usd: number };
  /** Per plan: money recorded with recordSpend, and the Claude usage of its tasks (USD equivalent). */
  plans: Record<string, { spentUsd: number; claudeUsd: number }>;
}
