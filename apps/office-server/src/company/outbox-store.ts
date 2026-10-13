import { OUTBOX_MAX_RECIPIENTS, OUTBOX_SUMMARY_CHARS, type OutboxEntry, type OutboxVia, type OutwardPolicyKind } from '@cc/shared';
import type { Db } from '../db.ts';

interface Row {
  id: number;
  employee_id: string;
  department_id: string | null;
  tool: string;
  kind: string;
  target: string;
  recipients: string;
  summary: string;
  via: string;
  approval_id: string | null;
  at: number;
}

const fromRow = (r: Row): OutboxEntry => ({
  id: r.id, employeeId: r.employee_id, departmentId: r.department_id, tool: r.tool, kind: r.kind as OutwardPolicyKind, target: r.target,
  recipients: JSON.parse(r.recipients) as string[], summary: r.summary, via: r.via as OutboxVia, approvalId: r.approval_id, at: r.at,
});

export type NewOutboxEntry = Omit<OutboxEntry, 'id' | 'at'>;

/** What the gate let out (spec capabilities §7, v25): an "allowed", not a "delivered", record; never changed once written. */
export class OutboxStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  add(e: NewOutboxEntry): OutboxEntry {
    const at = this.#now();
    const recipients = e.recipients.slice(0, OUTBOX_MAX_RECIPIENTS);
    // By code point: a cut through an emoji would store half of it (a lone surrogate).
    const summary = Array.from(e.summary).slice(0, OUTBOX_SUMMARY_CHARS).join('');
    const { lastInsertRowid } = this.#db
      .prepare('INSERT INTO outbox (employee_id, department_id, tool, kind, target, recipients, summary, via, approval_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(e.employeeId, e.departmentId, e.tool, e.kind, e.target, JSON.stringify(recipients), summary, e.via, e.approvalId, at);
    return { ...e, recipients, summary, id: Number(lastInsertRowid), at };
  }

  /** Newest first. `departmentId`: one department's (null: the centre's); `kind` and `since` narrow it. */
  list(o: { departmentId?: string | null; kind?: OutwardPolicyKind; since?: number; limit?: number } = {}): OutboxEntry[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (o.departmentId === null) where.push('department_id IS NULL');
    else if (o.departmentId !== undefined) {
      where.push('department_id = ?');
      params.push(o.departmentId);
    }
    if (o.kind !== undefined) {
      where.push('kind = ?');
      params.push(o.kind);
    }
    if (o.since !== undefined) {
      where.push('at >= ?');
      params.push(o.since);
    }
    const rows = this.#db
      .prepare(`SELECT * FROM outbox ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC, id DESC LIMIT ?`)
      .all(...params, o.limit ?? 200) as unknown as Row[];
    return rows.map(fromRow);
  }

  /**
   * Calls of these kinds the system let out (via 'system') since `since`: a department's, or — for someone in none —
   * theirs alone (spec §6). The owner's approvals never count.
   */
  countSystem(o: { departmentId: string | null; employeeId: string; kinds: readonly OutwardPolicyKind[]; since: number }): number {
    const kinds = o.kinds.map(() => '?').join(', ');
    // The scope and the value bound to it from one test: a scope that disagreed with its value would count nothing.
    const department = o.departmentId !== null;
    const scope = department ? 'department_id = ?' : 'department_id IS NULL AND employee_id = ?';
    const row = this.#db
      .prepare(`SELECT COUNT(*) AS n FROM outbox WHERE via = 'system' AND kind IN (${kinds}) AND at >= ? AND ${scope}`)
      .get(...o.kinds, o.since, department ? o.departmentId : o.employeeId) as unknown as { n: number };
    return row.n;
  }
}
