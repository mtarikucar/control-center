import type { AgentProvider, OfficeEvent, OfficeEventType, StoredEvent } from '@cc/shared';
import type { Db } from './db.ts';

export type EventListener = (event: StoredEvent) => void;

interface Row {
  seq: number;
  employee_id: string | null;
  ts: number;
  payload: string;
}

function toStored(row: Row): StoredEvent {
  return { seq: row.seq, employeeId: row.employee_id, ts: row.ts, event: JSON.parse(row.payload) as OfficeEvent };
}

export class EventStore {
  readonly #db: Db;
  readonly #now: () => number;
  readonly #listeners = new Set<EventListener>();

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  append(employeeId: string | null, event: OfficeEvent): StoredEvent {
    const ts = this.#now();
    const result = this.#db
      .prepare('INSERT INTO events (employee_id, ts, type, payload) VALUES (?, ?, ?, ?)')
      .run(employeeId, ts, event.type, JSON.stringify(event));
    const stored: StoredEvent = { seq: Number(result.lastInsertRowid), employeeId, ts, event };
    for (const listener of this.#listeners) {
      try {
        listener(stored);
      } catch (err) {
        console.error('olay dinleyicisi hata verdi', err);
      }
    }
    return stored;
  }

  list(opts: { after?: number; employeeId?: string; limit?: number; tail?: boolean } = {}): StoredEvent[] {
    const after = opts.after ?? 0;
    const limit = Math.max(1, Math.min(opts.limit ?? 500, 5000));
    const order = opts.tail ? 'DESC' : 'ASC';
    const rows = (
      opts.employeeId === undefined
        ? this.#db.prepare(`SELECT seq, employee_id, ts, payload FROM events WHERE seq > ? ORDER BY seq ${order} LIMIT ?`).all(after, limit)
        : this.#db
            .prepare(`SELECT seq, employee_id, ts, payload FROM events WHERE seq > ? AND employee_id = ? ORDER BY seq ${order} LIMIT ?`)
            .all(after, opts.employeeId, limit)
    ) as unknown as Row[];
    const events = rows.map(toStored);
    return opts.tail ? events.reverse() : events;
  }

  latest(employeeId: string, type: OfficeEventType, provider?: AgentProvider): StoredEvent | null {
    const row = this.#db
      .prepare(`SELECT seq, employee_id, ts, payload FROM events WHERE employee_id = ? AND type = ?${provider ? " AND COALESCE(json_extract(payload, '$.provider'), 'claude') = ?" : ''} ORDER BY seq DESC LIMIT 1`)
      .get(...(provider ? [employeeId, type, provider] : [employeeId, type])) as unknown as Row | undefined;
    return row ? toStored(row) : null;
  }

  /** Events of these types logged after `ts` (strictly), oldest first; over `limit`, the newest are kept (the type-and-time index). */
  since(ts: number, types: readonly OfficeEventType[], limit = 1000): StoredEvent[] {
    if (types.length === 0) return [];
    const rows = this.#db
      .prepare(`SELECT seq, employee_id, ts, payload FROM events WHERE type IN (${types.map(() => '?').join(', ')}) AND ts > ? ORDER BY seq DESC LIMIT ?`)
      .all(...types, ts, Math.max(1, limit)) as unknown as Row[];
    return rows.map(toStored).reverse();
  }

  /** The last event of this type logged at or before `ts` — with `taskId`, the last about that task; null: none. */
  lastAt(type: OfficeEventType, ts: number, o: { taskId?: string } = {}): StoredEvent | null {
    const about = o.taskId === undefined ? '' : " AND json_extract(payload, '$.task.id') = ?";
    const row = this.#db
      .prepare(`SELECT seq, employee_id, ts, payload FROM events WHERE type = ? AND ts <= ?${about} ORDER BY ts DESC, seq DESC LIMIT 1`)
      .get(...(o.taskId === undefined ? [type, ts] : [type, ts, o.taskId])) as unknown as Row | undefined;
    return row ? toStored(row) : null;
  }

  /** When this employee's last event of these types was logged at or after `ts`; null: none. */
  lastTs(employeeId: string, ts: number, types: readonly OfficeEventType[]): number | null {
    if (types.length === 0) return null;
    const row = this.#db
      .prepare(`SELECT MAX(ts) AS t FROM events WHERE employee_id = ? AND ts >= ? AND type IN (${types.map(() => '?').join(', ')})`)
      .get(employeeId, ts, ...types) as unknown as { t: number | null };
    return row.t ?? null;
  }

  lastSeq(): number {
    const row = this.#db.prepare('SELECT MAX(seq) AS s FROM events').get() as unknown as { s: number | null };
    return row.s ?? 0;
  }

  hasProviderUsage(provider: AgentProvider): boolean {
    return !!this.#db.prepare("SELECT 1 FROM events WHERE type IN ('turn.finished', 'side.answer') AND COALESCE(json_extract(payload, '$.provider'), 'claude') = ? LIMIT 1").get(provider);
  }

  subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
