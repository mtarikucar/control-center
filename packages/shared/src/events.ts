import type { Plan, PlanChange, Task, TaskChange } from './company.ts';
import type { Employee, EmployeeKind, Lifecycle } from './employee.ts';

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
  | { type: 'session.started'; model: string; mcp: { name: string; status: string }[] }
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
  | { type: 'company.report'; text: string }
  | { type: 'brief.updated' }
  | { type: 'role.changed'; kind: EmployeeKind; title: string; team: string }
  | { type: 'error'; message: string };

export type OfficeEventType = OfficeEvent['type'];

export interface StoredEvent {
  seq: number;
  employeeId: string | null;
  ts: number;
  event: OfficeEvent;
}

export type UsageTotals = Usage & { costUsd: number };

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
}

export type ServerMessage =
  | { type: 'snapshot'; snapshot: OfficeSnapshot }
  | { type: 'event'; event: StoredEvent };
