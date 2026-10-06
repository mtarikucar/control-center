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
}

export const DEFAULT_CONSTITUTION: Constitution = {
  maxEmployees: 8,
  ownerReservePct: 25,
  monthlyUsdCap: null,
  chainDepth: 5,
  tasksPerDay: 30,
  openTasksPerPlan: 60,
  idleSleepMinutes: 30,
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
