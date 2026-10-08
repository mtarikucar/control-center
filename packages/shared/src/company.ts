import type { ModelAlias } from './employee.ts';

export const TASK_STATUSES = ['waiting', 'in_progress', 'review', 'blocked', 'parked', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const REVIEW_SEVERITIES = ['critical', 'important', 'minor'] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];
export const REVIEW_SEVERITY_LABELS: Record<ReviewSeverity, string> = { critical: 'kritik', important: 'önemli', minor: 'küçük' };
export const REVIEW_DECISIONS = ['approve', 'changes'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export interface ReviewFinding {
  severity: ReviewSeverity;
  text: string;
}
export interface ReviewOutcome {
  decision: ReviewDecision;
  /** Most severe first. */
  findings: ReviewFinding[];
}

/** "2 önemli, 1 küçük" — the findings counted by severity, most severe first ('' for none). */
export function reviewTally(findings: readonly ReviewFinding[]): string {
  return REVIEW_SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${REVIEW_SEVERITY_LABELS[s]}`)
    .join(', ');
}

export interface TaskResult {
  summary: string;
  /** Paths of the files the work produced (relative to the employee's desk or absolute). */
  outputs: string[];
  learned: string;
  /** One line of proof per definition-of-done item, in the same order (spec §5.3). */
  evidence?: string[];
  /** A review task's decision (reviewDecide). */
  review?: ReviewOutcome;
  /** Where the office archived the hand-in, relative to the data folder (set by the office). */
  archive?: string;
}

/** The id the office uses for the owner wherever a task or plan names who asked. */
export const OWNER = 'owner';

/** `handover`: the task "İşten çıkar" gives — write down what you know before you leave. `review`: the task the office
 * opens for a reviewer when a task with a reviewer is handed in; closed only by reviewDecide. */
export const TASK_KINDS = ['work', 'handover', 'review'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** How hard a task is: the constitution maps each to the model the task starts on (difficultyModels). */
export const TASK_DIFFICULTIES = ['easy', 'medium', 'hard', 'critical'] as const;
export type TaskDifficulty = (typeof TASK_DIFFICULTIES)[number];
export const TASK_DIFFICULTY_LABELS: Record<TaskDifficulty, string> = { easy: 'kolay', medium: 'orta', hard: 'zor', critical: 'kritik' };

export interface Task {
  id: string;
  planId: string | null;
  kind: TaskKind;
  title: string;
  description: string;
  /** Definition of done, one item per line. */
  done: string[];
  /** An employee id, or OWNER. */
  requester: string;
  assignee: string;
  /** 1 = most urgent … 5 = whenever. */
  priority: number;
  /** Absent or null: none given; the assignee stays on their current model. */
  difficulty?: TaskDifficulty | null;
  /** Who approves the hand-in before the task closes (an employee id); absent or null: no review. */
  reviewer?: string | null;
  /** A review task: the id of the task it reviews. */
  reviewOf?: string | null;
  /** How many times the task was handed in for review (0: never). */
  round?: number;
  /** Not handed out before this time (epoch ms): a start time, or a parked task's return time. */
  notBefore?: number | null;
  /** Should be done by this time (epoch ms); past it the coordinator is told once. */
  dueAt?: number | null;
  /** Why it was parked (spec §4.2); null when not parked. */
  parkedReason?: string | null;
  /** How many times it was parked (the third tells the coordinator). */
  parkCount?: number;
  /** The routine that opened it, if any. */
  scheduleId?: string | null;
  /** The stream of its plan it belongs to (management cycle §3.4), if any. */
  streamId?: string | null;
  dependsOn: string[];
  status: TaskStatus;
  /** How many passes deep this task is (a task passed while working on a passed task is one deeper). */
  chainDepth: number;
  note: string | null;
  result: TaskResult | null;
  /** The office reminded the assignee that this task is still open (since it last started or moved). */
  nudged: boolean;
  /** When the office last reminded them (epoch ms); null with no reminder, or one from before the time was kept. */
  nudgedAt?: number | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

/** The kinds of work the coordination craft has a method for (spec §4.2); methodRead reads each. */
export const WORK_TYPES = ['software', 'content', 'research', 'customer', 'operations', 'general'] as const;
export type WorkType = (typeof WORK_TYPES)[number];
export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  software: 'Yazılım',
  content: 'İçerik ve pazarlama',
  research: 'Araştırma ve analiz',
  customer: 'Müşteri ve satış',
  operations: 'Operasyon ve satın alma',
  general: 'Genel',
};
export interface PlanStage {
  name: string;
  /** Who does it: a person or a role. */
  role: string;
  /** Someone other than the doer checks it. */
  review: boolean;
}
/** How a plan's work is done (spec §5.1). */
export interface PlanMethod {
  workType: WorkType;
  stages: PlanStage[];
  checks: string[];
}

/** How free the coordinator is (spec §6.2): 'free' starts its plans at once; 'plans' waits for the owner on each. */
export const AUTONOMY_LEVELS = ['free', 'plans'] as const;
export type Autonomy = (typeof AUTONOMY_LEVELS)[number];

export const GOAL_STATUSES = ['active', 'done', 'dropped'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** How a KPI is measured (spec 2026-10-08-goal-kpis-design): read by hand, from a connection, or from the office's own metrics. */
export const KPI_SOURCES = ['manual', 'office', 'capability'] as const;
export type KpiSource = (typeof KPI_SOURCES)[number];
export const KPI_DIRECTIONS = ['atLeast', 'atMost'] as const;
export type KpiDirection = (typeof KPI_DIRECTIONS)[number];
export const KPI_CADENCES = ['daily', 'weekly', 'monthly'] as const;
export type KpiCadence = (typeof KPI_CADENCES)[number];
/** The office's performance metrics a KPI can follow (B4's group metrics), with their label and unit. */
export const KPI_OFFICE_METRICS = {
  firstPassRate: { label: 'ilk geçişte onay oranı', unit: '%' },
  avgRounds: { label: 'onaya kadar ortalama tur', unit: 'tur' },
  usdPerDone: { label: 'görev başı ortalama maliyet', unit: 'USD' },
  avgLeadHours: { label: 'ortalama süre', unit: 'saat' },
  avgWorkHours: { label: 'ortalama iş süresi', unit: 'saat' },
  done: { label: 'biten iş', unit: 'adet' },
  blocks: { label: 'takılma', unit: 'adet' },
  parks: { label: 'park', unit: 'adet' },
  overdue: { label: 'gecikme', unit: 'adet' },
} as const;
export type KpiOfficeMetric = keyof typeof KPI_OFFICE_METRICS;
/** A measurable aim of a goal: reach `target` (at least or at most) in `unit`, read from `source` every `cadence`. */
export interface Kpi {
  name: string;
  target: number;
  direction: KpiDirection;
  unit: string;
  source: KpiSource;
  /** Only for source 'office'. */
  metric: KpiOfficeMetric | null;
  cadence: KpiCadence;
}

const KPI_SOURCE_TR: Record<Exclude<KpiSource, 'office'>, string> = { manual: 'elle', capability: 'bağlantıdan' };
const KPI_CADENCE_TR: Record<KpiCadence, string> = { daily: 'günlük', weekly: 'haftalık', monthly: 'aylık' };

/** One KPI as goalsRead and the Goals tab show it: `Onay oranı ≥ %70 (ofis: ilk geçişte onay oranı, haftalık)`. */
export function kpiText(k: Kpi): string {
  const value = k.unit === '%' ? `%${k.target}` : `${k.target} ${k.unit}`;
  const source = k.source === 'office' && k.metric ? `ofis: ${KPI_OFFICE_METRICS[k.metric].label}` : KPI_SOURCE_TR[k.source as Exclude<KpiSource, 'office'>];
  return `${k.name} ${k.direction === 'atLeast' ? '≥' : '≤'} ${value} (${source}, ${KPI_CADENCE_TR[k.cadence]})`;
}

/** A lasting aim above the plans (spec §6.1): why it matters to the mission and when it counts as reached. */
export interface Goal {
  id: string;
  title: string;
  why: string;
  done: string[];
  /** Its measurable KPIs (B16); none for goals from before them. */
  kpis: Kpi[];
  status: GoalStatus;
  createdBy: string;
  createdAt: number;
  closedAt: number | null;
  note: string | null;
}
/** `set`: opened; `updated`: changed or reopened; `closed`: done or dropped by the coordinator; `stopped`: by the owner. */
export type GoalChange = 'set' | 'updated' | 'closed' | 'stopped';

export const SCHEDULE_STATUSES = ['active', 'paused', 'stopped'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];
/** Recurring work (spec §4.4): each firing opens an ordinary task. */
export interface Schedule {
  id: string;
  title: string;
  description: string;
  done: string[];
  assignee: string;
  reviewer: string | null;
  planId: string | null;
  priority: number;
  difficulty: TaskDifficulty | null;
  /** 5-field cron, local time. */
  cron: string;
  /** Stops after this time (epoch ms), if given. */
  until: number | null;
  status: ScheduleStatus;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastTaskId: string | null;
  /** Firings skipped because the previous instance was still open. */
  skipCount: number;
  /** Consecutive firings that could not open a task. */
  failCount: number;
  createdBy: string;
  createdAt: number;
  note: string | null;
}
export type ScheduleChange = 'created' | 'updated' | 'fired' | 'skipped' | 'paused' | 'resumed' | 'stopped';

/** One line of an employee's agenda (spec §6.1). */
export interface AgendaEntry {
  kind: 'now' | 'queued' | 'review_wait' | 'parked' | 'not_before' | 'scheduled';
  taskId: string | null;
  scheduleId: string | null;
  title: string;
  /** When it starts or returns (epoch ms); null when it depends on another task's end that cannot be estimated. */
  at: number | null;
  /** Estimated end (epoch ms), for now/queued. */
  until: number | null;
  /** Estimate basis: "son 10 iş" / "zorluk: zor, 4 iş" / "ofis geneli" / "varsayılan" / "inceleme". */
  basis: string | null;
  /** "X bitince" (the dependency's title), "inceleyici: Can, tur 2", a park reason, a cron label. */
  note: string | null;
  priority: number | null;
  dueAt: number | null;
  overdue: boolean;
  lowConfidence: boolean;
}
export interface EmployeeAgenda {
  id: string;
  name: string;
  /** Turkish state line: "uyuyor", "kota payı devrede (yalnız öncelik 1)", "şirket duraklatıldı", "limit doldu, açılış 20:10", or null. */
  state: string | null;
  entries: AgendaEntry[];
}
export interface ClockStatus {
  nextDueAt: number | null;
  /** What is due then, in Turkish ("Adım 1 penceresi · Koordinatör"), or null. */
  nextDueLabel: string | null;
  lastRunAt: number | null;
  lastJumpAt: number | null;
}
export interface AgendaReport {
  generatedAt: number;
  horizonMs: number;
  clock: ClockStatus;
  employees: EmployeeAgenda[];
}

export const PLAN_STATUSES = ['draft', 'approved', 'done', 'declined', 'stopped'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** A stream's state (spec 2026-10-08-management-cycle-design §3.4): derived from its tasks, never stored. */
export const STREAM_STATUSES = ['planned', 'active', 'blocked', 'done'] as const;
export type StreamStatus = (typeof STREAM_STATUSES)[number];
/** The owner of a stream no one in the office carries yet starts with this: `alınacak: <rol>` (a role to hire). */
export const STREAM_TO_HIRE = 'alınacak';
/** A parallel line of work in a plan (spec §3.4): who carries it and which of the plan's streams come first. */
export interface PlanStream {
  /** A short lowercase slug, unique in its plan. */
  id: string;
  title: string;
  /** An employee id, or `alınacak: <rol>` for a role still to hire. */
  owner: string;
  /** Ids of streams of the same plan that must be done first. */
  dependsOn: string[];
}
/** A stream with the status its tasks give it. */
export interface PlanStreamView extends PlanStream {
  status: StreamStatus;
}

/**
 * A stream's status from its tasks: blocked (any blocked); done (every task closed, at least one done); active (work
 * started — a task done, in progress or in review — and some still open); planned otherwise (no tasks, none started,
 * or every one cancelled).
 */
export function streamStatus(tasks: ReadonlyArray<Pick<Task, 'status'>>): StreamStatus {
  if (tasks.some((t) => t.status === 'blocked')) return 'blocked';
  const started = tasks.some((t) => t.status === 'done' || t.status === 'in_progress' || t.status === 'review');
  if (tasks.every((t) => t.status === 'done' || t.status === 'cancelled')) return tasks.some((t) => t.status === 'done') ? 'done' : 'planned';
  return started ? 'active' : 'planned';
}

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
  /** How the work is done (spec §5.1); null for plans from before methods. */
  method?: PlanMethod | null;
  /** The goal it serves (spec §6.1), if any. */
  goalId?: string | null;
  /** Its parallel lines of work (management cycle §3.4); none for plans from before them. */
  streams?: PlanStream[];
  /** Who started it: the owner's approval, or the coordinator itself under full autonomy (spec §6.2). */
  approvedBy?: 'owner' | 'coordinator' | null;
  status: PlanStatus;
  version: number;
  proposedBy: string;
  createdAt: number;
  updatedAt: number;
  approvedAt: number | null;
}

/** A plan as the owner's page receives it in the snapshot: each of its streams with the status its tasks give it. */
export type PlanView = Omit<Plan, 'streams'> & { streams?: PlanStreamView[] };

/** `in_review`: handed in, waiting for its reviewer. `reviewed`: a review task was decided. `parked`: set aside until a time. `returned`: its time came. */
export type TaskChange = 'created' | 'assigned' | 'started' | 'updated' | 'finished' | 'reprioritized' | 'in_review' | 'reviewed' | 'parked' | 'returned';
/** `reopened`: a done plan got a new task. `kept`: the owner declined a revision; the plan goes on as approved. `stopped`: by the owner. */
export type PlanChange = 'proposed' | 'revised' | 'approved' | 'declined' | 'done' | 'reopened' | 'kept' | 'stopped';

/**
 * Why the office opened a management cycle (management cycle §3.1): a hand-in, a review decision, someone left with no
 * work, a plan's or a goal's status, a constraint (the constitution, the owner's quota share, the owner resuming the
 * company), a stall (blocked, unanswered after the reminder, past its due date); the heartbeat (while work is open, and
 * every pulseHours with no goal and no work); the office's start with work open; the end of the coordinator's rest.
 */
export const CYCLE_TRIGGER_KINDS = ['delivery', 'review', 'idle', 'plan', 'goal', 'constraint', 'stuck', 'heartbeat', 'start', 'rest'] as const;
export type CycleTriggerKind = (typeof CYCLE_TRIGGER_KINDS)[number];

export interface CycleTrigger {
  kind: CycleTriggerKind;
  /** When it happened (epoch ms). */
  at: number;
  /** What, in a few Turkish words (the task, the plan, who); '' for the heartbeat and the office start. */
  note: string;
  /** The logged event behind it; null when there is none (the heartbeat, the start, a stall the office saw). */
  seq: number | null;
}

/** What cycleClose said (management cycle §3.3): the plan changes made, why, and what to look at next. */
export interface CycleCloseWords {
  changes: string[];
  /** With no change, “değişiklik yok, çünkü …”. */
  reasoning: string;
  next: string | null;
}

/** A recorded management cycle (a `management.cycle` event), as the owner's Yönetim tab reads it (§3.3). */
export interface ManagementCycleRecord extends CycleCloseWords {
  /** The event's seq. */
  seq: number;
  startedAt: number;
  /** When it was recorded: the end of the turn that carried the board. */
  endedAt: number;
  /** Closed with cycleClose; false: the turn ended without it (“kapanmadı”). */
  closed: boolean;
  triggers: CycleTrigger[];
  /** What the cycle's turn cost (null: no result came). */
  costUsd: number | null;
  /** The model it ran on (null: not known). */
  model: ModelAlias | null;
}

/** The cycle the coordinator is in: the board went out, its turn has not ended. */
export interface OpenManagementCycle {
  startedAt: number;
  triggers: CycleTrigger[];
  model: ModelAlias | null;
  /** What its turn's results cost so far (null: none yet). */
  costUsd: number | null;
  /** cycleClose's words when the coordinator already closed it (recorded when the turn ends); null: not yet. */
  close: CycleCloseWords | null;
}

/** The management log (§3.3): the cycle open now, if any, and the last ones recorded, newest first. */
export interface ManagementLog {
  generatedAt: number;
  open: OpenManagementCycle | null;
  cycles: ManagementCycleRecord[];
}
