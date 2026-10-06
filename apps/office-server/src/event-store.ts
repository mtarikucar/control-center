import type { OfficeEvent, OfficeEventType, StoredEvent } from '@cc/shared';
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

  list(opts: { after?: number; employeeId?: string; limit?: number } = {}): StoredEvent[] {
    const after = opts.after ?? 0;
    const limit = Math.max(1, Math.min(opts.limit ?? 500, 5000));
    const rows = (
      opts.employeeId === undefined
        ? this.#db.prepare('SELECT seq, employee_id, ts, payload FROM events WHERE seq > ? ORDER BY seq LIMIT ?').all(after, limit)
        : this.#db
            .prepare('SELECT seq, employee_id, ts, payload FROM events WHERE seq > ? AND employee_id = ? ORDER BY seq LIMIT ?')
            .all(after, opts.employeeId, limit)
    ) as unknown as Row[];
    return rows.map(toStored);
  }

  latest(employeeId: string, type: OfficeEventType): StoredEvent | null {
    const row = this.#db
      .prepare('SELECT seq, employee_id, ts, payload FROM events WHERE employee_id = ? AND type = ? ORDER BY seq DESC LIMIT 1')
      .get(employeeId, type) as unknown as Row | undefined;
    return row ? toStored(row) : null;
  }

  lastSeq(): number {
    const row = this.#db.prepare('SELECT MAX(seq) AS s FROM events').get() as unknown as { s: number | null };
    return row.s ?? 0;
  }

  subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
