import type { DatabaseSync } from 'node:sqlite';
import type { OfficeEvent, Task, TaskChange } from '@cc/shared';
import { TurnLedger, turnTokens } from './company/budget.ts';

/** One turn result and the task the budget charges it to (TurnLedger). */
export interface TurnCharge {
  employeeId: string;
  /** null: the turn was about no task (e.g. a chat with the owner). */
  taskId: string | null;
  usd: number;
  tokens: number;
  ts: number;
}

interface Row {
  employee_id: string | null;
  ts: number;
  payload: string;
}

/**
 * The event log replayed in order with the rule the budget charges by (TurnLedger), for the cost backfill and the
 * performance report. Which task was in progress when a turn started comes from the task.changed events, each
 * carrying the task as it became; `task` hears each of them too.
 */
export function replayTurns(db: DatabaseSync, on: { turn?(c: TurnCharge): void; task?(change: TaskChange, task: Task, ts: number): void }): void {
  const ledger = new TurnLedger();
  const tasks = new Map<string, Task>();
  // TaskStore.inProgressOf as it stood then: the assignee's task in progress, started last.
  const running = (employeeId: string): string | null => {
    let best: Task | null = null;
    for (const t of tasks.values()) {
      if (t.assignee === employeeId && t.status === 'in_progress' && (best === null || (t.startedAt ?? 0) >= (best.startedAt ?? 0))) best = t;
    }
    return best?.id ?? null;
  };
  const rows = db
    .prepare("SELECT employee_id, ts, payload FROM events WHERE type IN ('turn.started', 'task.changed', 'turn.finished') ORDER BY seq")
    .iterate() as Iterable<Row>;
  for (const row of rows) {
    const ev = JSON.parse(row.payload) as OfficeEvent;
    const id = row.employee_id;
    if (ev.type === 'task.changed') {
      tasks.set(ev.task.id, ev.task);
      if (id) ledger.changed(id, ev.change, ev.task);
      on.task?.(ev.change, ev.task, row.ts);
    } else if (ev.type === 'turn.started' && id) ledger.started(id, running(id));
    else if (ev.type === 'turn.finished' && id) {
      on.turn?.({ employeeId: id, taskId: ledger.taskOf(id, () => running(id)), usd: ev.costUsd, tokens: turnTokens(ev.usage), ts: row.ts });
      ledger.finished(id, ev.queuedTurns);
    }
  }
}
