import { OUTWARD_DECIDERS, OUTWARD_POLICY_KINDS, type OutwardPolicy } from './autonomy.ts';

/** Who decides releases (merge, deploy, migration, server work): the owner, or the office on its own. */
export const RELEASE_POLICIES = ['owner', 'office'] as const;
export type ReleasePolicy = (typeof RELEASE_POLICIES)[number];
export const RELEASE_POLICY_LABELS: Record<ReleasePolicy, string> = { owner: 'sahibine sorulur', office: 'ofis halleder' };
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
  /** Employees at most, the coordinator included (12 by default; never more than the seats, 45). */
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
   * a tool call that publishes, sends, calls, invites, pays, deletes, acts in a browser or touches the office itself
   * is held; who lets it out follows `outwardPolicy` — the system on its rules, or the owner's approval on the
   * office page (pay, delete, the browser and the office itself are always the owner's). The hook is in every session
   * either way; off, it lets every call through and nothing is written, so turning it on needs no restart.
   */
  gateEnabled: boolean;
  /** 'free': the coordinator sets goals and starts its plans without waiting (spec §6.2); 'plans': each plan waits for the owner. */
  autonomy: Autonomy;
  /**
   * Who decides a merge, a deploy, a migration or server work: 'owner' (the default) keeps the role cards' and
   * methods' "ask the owner" rules; 'office' tells every desk to go ahead without asking (pay and delete stay the owner's).
   */
  releasePolicy: ReleasePolicy;
  /** Goals active at once, at most (spec §6.1). */
  activeGoals: number;
  /** With neither goals nor work, the coordinator is told at most this often, hours; 0 = never (spec §6.3). */
  pulseHours: number;
  /**
   * While goals are active, the coordinator hears of anyone who has held no task this many hours (once for each idle
   * stretch); 0 = never.
   */
  idleCapacityHours: number;
  /**
   * The owner's weekly line, %: when the account's 7-day Claude quota reaches it the office pauses itself, once per
   * weekly window (resuming is the owner's); 0 = off. The owner shares the account and keeps the rest for their own work.
   */
  weeklyStopPct: number;
  /** The agenda's estimate for a task with no history, minutes (spec §6.1). */
  defaultTaskMinutes: number;
  /** A routine may not fire more often than this, minutes (spec §4.4). */
  minScheduleMinutes: number;
  /** Routines at once, at most (stopped ones do not count). */
  maxSchedules: number;
  /**
   * Spec capabilities §5: for each outward kind of a connector's call, whether the owner is asked or the system lets it
   * out on the rules below — only while the gate is on. Pay, delete, the browser, the office itself and unclassified
   * tools are always the owner's; so are the sends and publishes of the shell and the built-in tools.
   */
  outwardPolicy: OutwardPolicy;
  /** People whose every call goes to the owner: e-mails, phone numbers, user names (compared folded, a phone by its digits). */
  specialContacts: string[];
  /** System sends + publishes per department (someone without one: per person) in the last hour, at most. */
  sendsPerHour: number;
  /** A call to more recipients than this goes to the owner. */
  bulkRecipients: number;
  /** Local hours [from, to) the system may call in. */
  callHours: [number, number];
  /** System calls per department (someone without one: per person) today, at most. */
  callsPerDay: number;
}

export const DEFAULT_CONSTITUTION: Constitution = {
  maxEmployees: 12,
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
  releasePolicy: 'owner',
  activeGoals: 10,
  pulseHours: 6,
  idleCapacityHours: 2,
  weeklyStopPct: 90,
  defaultTaskMinutes: 45,
  minScheduleMinutes: 60,
  maxSchedules: 20,
  outwardPolicy: { send: 'system', publish: 'system', call: 'system', calendar: 'owner' },
  specialContacts: [],
  sendsPerHour: 30,
  bulkRecipients: 5,
  callHours: [9, 19],
  callsPerDay: 20,
};

const isModel = (v: unknown): v is ModelAlias => (MODEL_ALIASES as readonly unknown[]).includes(v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A model map with every key of `fallback`, in its order: the given model where it is one, else the default. */
function modelMapOf<T extends Record<string, ModelAlias>>(value: unknown, fallback: T): T {
  const given = isRecord(value) ? value : {};
  return Object.fromEntries(Object.entries(fallback).map(([k, d]) => [k, Object.hasOwn(given, k) && isModel(given[k]) ? given[k] : d])) as T;
}

/** The outward policy with every kind, in its order: the given decider where it is one, else the default. */
function policyOf(value: unknown): OutwardPolicy {
  const given = isRecord(value) ? value : {};
  const valid = (v: unknown) => (OUTWARD_DECIDERS as readonly unknown[]).includes(v);
  return Object.fromEntries(OUTWARD_POLICY_KINDS.map((k) => [k, Object.hasOwn(given, k) && valid(given[k]) ? given[k] : DEFAULT_CONSTITUTION.outwardPolicy[k]])) as OutwardPolicy;
}

/**
 * Two whole local hours of the day, the first before the second (24: midnight) — the window a call may be made in; the
 * server's validator and the stored constitution's reader both ask it.
 */
export const isHourWindow = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && v.every((h) => Number.isInteger(h) && h >= 0 && h <= 24) && v[0] < v[1];

/**
 * The rules' counts and their ranges, [min, max] whole numbers: the owner's form takes these (the server's validator
 * is built from them), and a stored one out of range is no limit the owner set — a null, a text or NaN would make
 * `count >= limit` never true, and the system would send without end.
 */
export const RULE_RANGES = { sendsPerHour: [0, 1000], bulkRecipients: [1, 1000], callsPerDay: [0, 1000] } as const;
const inRange = (v: unknown, [min, max]: readonly [number, number]): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Special contacts as the owner's form takes them: at most 200, each trimmed and 1–200 characters. */
export const SPECIAL_CONTACT_LIMITS = { count: 200, chars: 200 } as const;

/**
 * A kept contact list read entry by entry: a bad entry (not a text, empty, too long) is dropped, never the list —
 * one broken entry must not let every special contact's calls go out without the owner.
 */
function contactsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const x of value) {
    const contact = typeof x === 'string' ? x.trim() : '';
    if (contact && contact.length <= SPECIAL_CONTACT_LIMITS.chars) out.push(contact);
    if (out.length === SPECIAL_CONTACT_LIMITS.count) break;
  }
  return out;
}

/**
 * A constitution as it was kept — the database's rows, or a snapshot in the event log (a budget.changed) written by an
 * older office — read as today's: every key the constitution has, in its order, the default where one is missing, and
 * nothing else. A model map keeps the keys it knows with a known model and takes the default for the rest, and so does the
 * outward policy with its deciders; the coordinator's models from before the turn types (owner, decision, digest) meant
 * other turns, so they are dropped; special contacts keep their good entries (contactsOf); call hours that are not a
 * window and a rule's count that is not a whole number in its range are the defaults.
 * Everything that reads a constitution reads it through this.
 */
export function normalizeConstitution(raw: unknown): Constitution {
  const stored = isRecord(raw) ? raw : {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_CONSTITUTION) as Array<keyof Constitution>) {
    const value = Object.hasOwn(stored, key) ? stored[key] : undefined;
    if (key === 'coordinatorModels' || key === 'difficultyModels') out[key] = modelMapOf(value, DEFAULT_CONSTITUTION[key]);
    else if (key === 'outwardPolicy') out[key] = policyOf(value);
    else if (key === 'specialContacts') out[key] = contactsOf(value);
    else if (key === 'callHours') out[key] = isHourWindow(value) ? value : [...DEFAULT_CONSTITUTION.callHours];
    else if (key === 'sendsPerHour' || key === 'bulkRecipients' || key === 'callsPerDay') out[key] = inRange(value, RULE_RANGES[key]) ? value : DEFAULT_CONSTITUTION[key];
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
