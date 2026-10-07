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
/** A lasting aim above the plans (spec §6.1): why it matters to the mission and when it counts as reached. */
export interface Goal {
  id: string;
  title: string;
  why: string;
  done: string[];
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
  /** Who started it: the owner's approval, or the coordinator itself under full autonomy (spec §6.2). */
  approvedBy?: 'owner' | 'coordinator' | null;
  status: PlanStatus;
  version: number;
  proposedBy: string;
  createdAt: number;
  updatedAt: number;
  approvedAt: number | null;
}

/** `in_review`: handed in, waiting for its reviewer. `reviewed`: a review task was decided. `parked`: set aside until a time. `returned`: its time came. */
export type TaskChange = 'created' | 'assigned' | 'started' | 'updated' | 'finished' | 'reprioritized' | 'in_review' | 'reviewed' | 'parked' | 'returned';
/** `reopened`: a done plan got a new task. `kept`: the owner declined a revision; the plan goes on as approved. `stopped`: by the owner. */
export type PlanChange = 'proposed' | 'revised' | 'approved' | 'declined' | 'done' | 'reopened' | 'kept' | 'stopped';
