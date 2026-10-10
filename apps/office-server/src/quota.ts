import type { AgentProvider, EmployeeUsage, QuotaState, QuotaWindow, StoredEvent, UsageTotals } from '@cc/shared';
import type { Db } from './db.ts';
import type { EventStore } from './event-store.ts';

const parseWindow = (raw: string | null): QuotaWindow | null => (raw ? (JSON.parse(raw) as QuotaWindow) : null);

export class QuotaTracker {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, events: EventStore, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
    events.subscribe((stored) => this.#onEvent(stored));
  }

  #onEvent(stored: StoredEvent): void {
    const event = stored.event;
    if (event.type !== 'quota.updated') return;
    if (event.provider === 'codex') {
      this.#db.prepare(`INSERT INTO quota_by_provider (provider, status, five_hour, seven_day, updated_at) VALUES ('codex', ?, ?, ?, ?)
        ON CONFLICT(provider) DO UPDATE SET status = excluded.status,
          five_hour = COALESCE(excluded.five_hour, quota_by_provider.five_hour), seven_day = COALESCE(excluded.seven_day, quota_by_provider.seven_day), updated_at = excluded.updated_at`)
        .run(event.status, event.fiveHour ? JSON.stringify(event.fiveHour) : null, event.sevenDay ? JSON.stringify(event.sevenDay) : null, stored.ts);
      return;
    }
    this.#db
      .prepare(
        `INSERT INTO quota (id, status, five_hour, seven_day, updated_at) VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           five_hour = COALESCE(excluded.five_hour, quota.five_hour),
           seven_day = COALESCE(excluded.seven_day, quota.seven_day),
           updated_at = excluded.updated_at`,
      )
      .run(
        event.status,
        event.fiveHour ? JSON.stringify(event.fiveHour) : null,
        event.sevenDay ? JSON.stringify(event.sevenDay) : null,
        stored.ts,
      );
  }

  state(provider: AgentProvider = 'claude'): QuotaState | null {
    const row = this.#db.prepare(provider === 'codex' ? "SELECT status, five_hour, seven_day, updated_at FROM quota_by_provider WHERE provider = 'codex'" : 'SELECT status, five_hour, seven_day, updated_at FROM quota WHERE id = 1').get() as unknown as
      | { status: string; five_hour: string | null; seven_day: string | null; updated_at: number }
      | undefined;
    if (!row) return null;
    return { status: row.status, fiveHour: parseWindow(row.five_hour), sevenDay: parseWindow(row.seven_day), updatedAt: row.updated_at };
  }

  states(): Record<AgentProvider, QuotaState | null> { return { claude: this.state('claude'), codex: this.state('codex') }; }

  usage(employeeId: string): EmployeeUsage {
    const startOfDay = new Date(this.#now());
    startOfDay.setHours(0, 0, 0, 0);
    return { today: this.#sum(employeeId, startOfDay.getTime()), total: this.#sum(employeeId, 0) };
  }

  usageAll(ids: string[]): Record<string, EmployeeUsage> {
    return Object.fromEntries(ids.map((id) => [id, this.usage(id)]));
  }

  /** Everyone's use since `since` (the management board's last day). */
  officeSince(since: number): UsageTotals {
    return this.#sum(null, since);
  }

  /** One employee's use since `since`; null: everyone's. */
  #sum(employeeId: string | null, since: number): UsageTotals {
    const who = employeeId === null ? '' : 'employee_id = ? AND ';
    const row = this.#db
      .prepare(
        `SELECT
           COALESCE(SUM(json_extract(payload, '$.usage.inputTokens')), 0) AS input,
           COALESCE(SUM(json_extract(payload, '$.usage.outputTokens')), 0) AS output,
           COALESCE(SUM(json_extract(payload, '$.usage.cacheReadTokens')), 0) AS cacheRead,
           COALESCE(SUM(json_extract(payload, '$.usage.cacheCreationTokens')), 0) AS cacheCreation,
           COALESCE(SUM(json_extract(payload, '$.costUsd')), 0) AS cost,
           COALESCE(SUM(type = 'turn.finished'), 0) AS turns,
           COALESCE(SUM(type = 'side.answer'), 0) AS side
         FROM events
         WHERE ${who}ts >= ? AND type IN ('turn.finished', 'side.answer')`,
      )
      .get(...(employeeId === null ? [since] : [employeeId, since])) as unknown as { input: number; output: number; cacheRead: number; cacheCreation: number; cost: number; turns: number; side: number };
    return {
      inputTokens: row.input,
      outputTokens: row.output,
      cacheReadTokens: row.cacheRead,
      cacheCreationTokens: row.cacheCreation,
      costUsd: row.cost,
      turns: row.turns,
      sideAnswers: row.side,
    };
  }
}
