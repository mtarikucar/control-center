import type { Autonomy, TaskDifficulty } from './company.ts';
import { MODEL_ALIASES, type ModelAlias } from './employee.ts';

/**
 * What a coordinator turn is for (management cycle §3.5), each with its model in coordinatorModels: `kickoff`, a project
 * start — the owner's message while no plan runs, a management cycle whose board finds no goal with a running plan
 * (or no goal at all); `cycle`, any other management cycle; `routine`, every other turn (notices, a colleague's proposal,
 * review routing, the owner's message while a plan runs).
 */
export const COORDINATOR_TURNS = ['kickoff', 'cycle', 'routine'] as const;
export type CoordinatorTurn = (typeof COORDINATOR_TURNS)[number];

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
  /**
   * The coordinator's model by what a turn is for (COORDINATOR_TURNS): a project start, a management cycle, any other
   * turn. A role model: it applies whatever modelPolicyEnabled says.
   */
  coordinatorModels: Record<CoordinatorTurn, ModelAlias>;
  /**
   * A session moves to a weaker model only after this long without a turn, so a conversation does not flap between
   * models. (Named for the prompt cache; the real CLI keeps it warm longer — over 6½ minutes, measured 2026-10-07.)
   */
  cacheTtlMinutes: number;
  /** The model a task starts on, by its difficulty. */
  difficultyModels: Record<TaskDifficulty, ModelAlias>;
  /**
   * Switches for the economy plan's three features, all OFF by default (and in a database that has no such key): off
   * is the behaviour before the plan — every notice goes at once as before and the daily report reminder comes as
   * before; model hints are ignored (everyone on their own model); a task's difficulty moves no one to another model
   * (it is still kept).
   */
  digestEnabled: boolean;
  modelPolicyEnabled: boolean;
  difficultyModelsEnabled: boolean;
  /**
   * The capability precheck (B8), OFF by default (and in a database that has no such key): on, a task whose required
   * capability its assignee's desk lacks is held before it is handed out and the owner gets one need proposal; a
   * connector tool's error raises the same proposal once. Off is the behaviour before it.
   */
  capabilityPrecheckEnabled: boolean;
  /**
   * The gate for work that cannot be taken back (B9a), OFF by default (and in a database that has no such key): on,
   * a tool call that publishes, sends, pays, deletes, acts in a browser or touches the office itself waits for the
   * owner's approval on the office page. The hook is in every session either way; off, it lets every call through
   * and nothing is written, so turning it on needs no restart.
   */
  gateEnabled: boolean;
  /** 'free': the coordinator sets goals and starts its plans without waiting (spec §6.2); 'plans': each plan waits for the owner. */
  autonomy: Autonomy;
  /** Goals active at once, at most (spec §6.1). */
  activeGoals: number;
  /** With neither goals nor work, the coordinator is told at most this often, hours; 0 = never (spec §6.3). */
  pulseHours: number;
  /**
   * While goals are active, the coordinator hears of anyone who has held no task this many hours (once for each idle
   * stretch); 0 = never.
   */
  idleCapacityHours: number;
  /** The agenda's estimate for a task with no history, minutes (spec §6.1). */
  defaultTaskMinutes: number;
  /** A routine may not fire more often than this, minutes (spec §4.4). */
  minScheduleMinutes: number;
  /** Routines at once, at most (stopped ones do not count). */
  maxSchedules: number;
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
  coordinatorModels: { kickoff: 'fable', cycle: 'opus', routine: 'sonnet' },
  cacheTtlMinutes: 5,
  difficultyModels: { easy: 'haiku', medium: 'sonnet', hard: 'opus', critical: 'fable' },
  digestEnabled: false,
  modelPolicyEnabled: false,
  difficultyModelsEnabled: false,
  capabilityPrecheckEnabled: false,
  gateEnabled: false,
  autonomy: 'free',
  activeGoals: 10,
  pulseHours: 6,
  idleCapacityHours: 2,
  defaultTaskMinutes: 45,
  minScheduleMinutes: 60,
  maxSchedules: 20,
};

const isModel = (v: unknown): v is ModelAlias => (MODEL_ALIASES as readonly unknown[]).includes(v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A model map with every key of `fallback`, in its order: the given model where it is one, else the default. */
function modelMapOf<T extends Record<string, ModelAlias>>(value: unknown, fallback: T): T {
  const given = isRecord(value) ? value : {};
  return Object.fromEntries(Object.entries(fallback).map(([k, d]) => [k, Object.hasOwn(given, k) && isModel(given[k]) ? given[k] : d])) as T;
}

/**
 * A constitution as it was kept — the database's rows, or a snapshot in the event log (a budget.changed) written by an
 * older office — read as today's: every key the constitution has, in its order, the default where one is missing, and
 * nothing else. A model map keeps the keys it knows with a known model and takes the default for the rest; the
 * coordinator's models from before the turn types (owner, decision, digest) meant other turns, so they are dropped.
 * Everything that reads a constitution reads it through this.
 */
export function normalizeConstitution(raw: unknown): Constitution {
  const stored = isRecord(raw) ? raw : {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_CONSTITUTION) as Array<keyof Constitution>) {
    const value = Object.hasOwn(stored, key) ? stored[key] : undefined;
    if (key === 'coordinatorModels' || key === 'difficultyModels') out[key] = modelMapOf(value, DEFAULT_CONSTITUTION[key]);
    else out[key] = value === undefined ? DEFAULT_CONSTITUTION[key] : value;
  }
  return out as unknown as Constitution;
}

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
