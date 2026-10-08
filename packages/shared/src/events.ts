import type { BudgetSummary, Spend } from './budget.ts';
import type { ClockStatus, Goal, GoalChange, Plan, PlanChange, Schedule, ScheduleChange, Task, TaskChange } from './company.ts';
import type { Employee, EmployeeKind, Lifecycle, ModelAlias } from './employee.ts';
import type { Integration } from './integration.ts';
import type { Decision } from './memory.ts';
import type { Onboarding, OnboardingChange, OnboardingRound } from './onboarding.ts';
import type { ProfileEntry } from './profile.ts';
import type { Proposal, ProposalChange } from './proposal.ts';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface QuotaWindow {
  /** 0..1 */
  utilization: number;
  /** epoch milliseconds */
  resetsAt: number;
}

export type OfficeEvent =
  | { type: 'employee.hired'; name: string }
  | { type: 'employee.fired' }
  /** `tools`: how many of the server's tools the session has (sessions from before carry none). */
  | { type: 'session.started'; model: string; mcp: { name: string; status: string; tools?: number }[] }
  | { type: 'turn.started' }
  | {
      type: 'turn.finished';
      ok: boolean;
      subtype: string;
      usage: Usage;
      costUsd: number;
      numTurns: number;
      /** > 0: claude already holds more user turns and will produce more results without a new message. */
      queuedTurns: number;
      /** claude's running totals for the whole session (all models); `usage`/`costUsd` are this turn's share. */
      sessionUsage: Usage | null;
      sessionCostUsd: number;
    }
  | { type: 'message.user'; text: string; source: 'owner' | 'system' }
  | { type: 'message.assistant'; text: string }
  | { type: 'tool.started'; toolUseId: string; name: string; input: unknown }
  | { type: 'tool.finished'; toolUseId: string; isError: boolean; output: string }
  | { type: 'side.question'; text: string }
  | { type: 'side.answer'; text: string; ok: boolean; usage: Usage; costUsd: number }
  | {
      type: 'quota.updated';
      status: string;
      fiveHour: QuotaWindow | null;
      sevenDay: QuotaWindow | null;
      /** When rejected: the reset of the window that is actually limiting (may be a per-model weekly one). */
      limitResetsAt?: number | null;
    }
  | { type: 'lifecycle.changed'; from: Lifecycle; to: Lifecycle; reason: string }
  | { type: 'task.changed'; change: TaskChange; task: Task }
  | { type: 'plan.changed'; change: PlanChange; plan: Plan }
  | { type: 'goal.changed'; change: GoalChange; goal: Goal }
  | { type: 'company.paused'; paused: boolean }
  | { type: 'schedule.changed'; change: ScheduleChange; schedule: Schedule }
  /** The clock woke more than two minutes after the time it was armed for (sleep, a clock change). */
  | { type: 'clock.jumped'; expectedAt: number; actualAt: number }
  /** One due item failed; the clock went on. */
  | { type: 'clock.error'; job: string; message: string }
  | { type: 'company.report'; text: string }
  /** The coordinator was reminded to report, for the digest hour `slot` (so a restart does not remind again). */
  | { type: 'report.reminded'; slot: number }
  | { type: 'brief.updated' }
  /** A section of the company profile changed; `entry` is the section as it now stands. */
  | { type: 'profile.updated'; entry: ProfileEntry }
  /** The coordinator registered or changed a connector by hand (B3). */
  | { type: 'integration.changed'; integration: Integration }
  /** The onboarding moved; `round` with change 'round': the questions just asked (KÖ1 counts them). */
  | { type: 'onboarding.changed'; change: OnboardingChange; onboarding: Onboarding; round?: OnboardingRound }
  | { type: 'role.changed'; kind: EmployeeKind; title: string; team: string }
  | { type: 'decision.recorded'; decision: Decision }
  | { type: 'playbook.updated'; topic: string; version: number; reason: string }
  | { type: 'note.written'; id: number; title: string; tags: string[] }
  | { type: 'spend.recorded'; spend: Spend }
  | { type: 'budget.changed'; budget: BudgetSummary }
  | { type: 'model.changed'; model: ModelAlias }
  /** A session could not run on the model a hint asked for; it goes on on `from` and the turn's messages are sent again. */
  | { type: 'model.switch.failed'; from: string; to: string; reason: string }
  | { type: 'proposal.changed'; change: ProposalChange; proposal: Proposal }
  | { type: 'error'; message: string }
  /**
   * A request to an owner endpoint that did not come the page's way (no Origin, no valid nonce, no browser fetch
   * metadata): refused, or let through and marked. Detection only: a process of the same user can forge every header.
   */
  | { type: 'owner.request.flagged'; mark: OwnerRequestMark; outcome: 'rejected' | 'accepted'; method: string; path: string; userAgent: string };

export type OwnerRequestMark = 'owner-endpoint, origin-less' | 'owner-endpoint, nonce-less' | 'owner-endpoint, no fetch metadata';

export type OfficeEventType = OfficeEvent['type'];

export interface StoredEvent {
  seq: number;
  employeeId: string | null;
  ts: number;
  event: OfficeEvent;
}

/** Claude use summed over finished turns and side answers; `turns` counts turns, `sideAnswers` answers given aside (askColleague). */
export type UsageTotals = Usage & { costUsd: number; turns: number; sideAnswers: number };

export interface EmployeeUsage {
  today: UsageTotals;
  total: UsageTotals;
}

export interface QuotaState {
  status: string;
  fiveHour: QuotaWindow | null;
  sevenDay: QuotaWindow | null;
  updatedAt: number;
}

export interface OfficeSnapshot {
  employees: Employee[];
  quota: QuotaState | null;
  usage: Record<string, EmployeeUsage>;
  lastSeq: number;
  /** Open tasks and the most recent finished ones (absent from servers without the company layer). */
  tasks?: Task[];
  plans?: Plan[];
  proposals?: Proposal[];
  /** The constitution, the reserve and the money (absent from servers without the company layer). */
  budget?: BudgetSummary;
  /** Active goals and the last closed ones. */
  goals?: Goal[];
  /** The owner paused the company: nothing is handed out. */
  paused?: boolean;
  /** Routines (all but stopped, plus the last 10 stopped). */
  schedules?: Schedule[];
  clock?: ClockStatus;
}

export type ServerMessage =
  | { type: 'snapshot'; snapshot: OfficeSnapshot }
  | { type: 'event'; event: StoredEvent };
