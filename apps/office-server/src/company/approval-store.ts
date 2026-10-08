import { randomUUID } from 'node:crypto';
import type { Approval, ApprovalKind, ApprovalScope, ApprovalStatus } from '@cc/shared';
import type { Db } from '../db.ts';
import { NotFoundError } from '../errors.ts';

interface ApprovalRow {
  id: string;
  employee_id: string;
  task_id: string | null;
  kind: string;
  tool: string;
  target: string;
  fingerprint: string;
  summary: string;
  scope: string;
  status: string;
  requested_at: number;
  decided_at: number | null;
  decided_by: string | null;
  decided_via: string | null;
  expires_at: number | null;
  used_at: number | null;
  note: string | null;
}

const fromRow = (r: ApprovalRow): Approval => ({
  id: r.id,
  employeeId: r.employee_id,
  taskId: r.task_id,
  kind: r.kind as ApprovalKind,
  tool: r.tool,
  target: r.target,
  fingerprint: r.fingerprint,
  summary: r.summary,
  scope: r.scope as ApprovalScope,
  status: r.status as ApprovalStatus,
  requestedAt: r.requested_at,
  decidedAt: r.decided_at,
  decidedBy: r.decided_by,
  decidedVia: r.decided_via,
  expiresAt: r.expires_at,
  usedAt: r.used_at,
  note: r.note,
});

export type NewApproval = Pick<Approval, 'employeeId' | 'taskId' | 'kind' | 'tool' | 'target' | 'fingerprint' | 'summary' | 'scope'>;

/** The owner's approvals of calls the gate holds (B9a, v21). Every change of state is one guarded UPDATE. */
export class ApprovalStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  create(a: NewApproval): Approval {
    const approval: Approval = { ...a, id: randomUUID(), status: 'pending', requestedAt: this.#now(), decidedAt: null, decidedBy: null, decidedVia: null, expiresAt: null, usedAt: null, note: null };
    this.#db
      .prepare('INSERT INTO approvals (id, employee_id, task_id, kind, tool, target, fingerprint, summary, scope, status, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(approval.id, a.employeeId, a.taskId, a.kind, a.tool, a.target, a.fingerprint, a.summary, a.scope, 'pending', approval.requestedAt);
    return approval;
  }

  get(id: string): Approval {
    const row = this.#db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as unknown as ApprovalRow | undefined;
    if (!row) throw new NotFoundError(`Onay bulunamadı: ${id}`);
    return fromRow(row);
  }

  /** Newest first. */
  list(o: { statuses?: ApprovalStatus[]; employeeId?: string; limit?: number } = {}): Approval[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (o.statuses?.length) {
      where.push(`status IN (${o.statuses.map(() => '?').join(', ')})`);
      params.push(...o.statuses);
    }
    if (o.employeeId !== undefined) {
      where.push('employee_id = ?');
      params.push(o.employeeId);
    }
    const rows = this.#db
      .prepare(`SELECT * FROM approvals ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY requested_at DESC, rowid DESC LIMIT ?`)
      .all(...params, o.limit ?? 200) as unknown as ApprovalRow[];
    return rows.map(fromRow);
  }

  /** A request already waiting for the same call (the same asker, print and scope). */
  pending(employeeId: string, fingerprint: string, scope: ApprovalScope): Approval | null {
    const row = this.#db
      .prepare("SELECT * FROM approvals WHERE employee_id = ? AND fingerprint = ? AND scope = ? AND status = 'pending' ORDER BY requested_at LIMIT 1")
      .get(employeeId, fingerprint, scope) as unknown as ApprovalRow | undefined;
    return row ? fromRow(row) : null;
  }

  /** The owner decides a waiting request, once; null when it no longer waits. */
  decide(id: string, d: { approve: boolean; decidedBy: string; decidedVia: string; note: string | null; at: number; expiresAt: number | null }): Approval | null {
    const changed = this.#db
      .prepare("UPDATE approvals SET status = ?, decided_at = ?, decided_by = ?, decided_via = ?, note = ?, expires_at = ? WHERE id = ? AND status = 'pending'")
      .run(d.approve ? 'approved' : 'denied', d.at, d.decidedBy, d.decidedVia, d.note, d.approve ? d.expiresAt : null, id).changes;
    return changed === 1 ? this.get(id) : null;
  }

  /** An approved one-call approval for this print, still in time: used now (atomic: a second consume finds nothing). */
  consume(employeeId: string, fingerprint: string, now: number): Approval | null {
    const row = this.#db
      .prepare("SELECT id FROM approvals WHERE employee_id = ? AND fingerprint = ? AND scope = 'call' AND status = 'approved' AND (expires_at IS NULL OR expires_at > ?) ORDER BY decided_at, rowid LIMIT 1")
      .get(employeeId, fingerprint, now) as { id: string } | undefined;
    return row ? this.use(row.id, now) : null;
  }

  /** Marks an approved one as used; null when it was not approved any more. */
  use(id: string, now: number): Approval | null {
    const changed = this.#db.prepare("UPDATE approvals SET status = 'used', used_at = ? WHERE id = ? AND status = 'approved'").run(now, id).changes;
    return changed === 1 ? this.get(id) : null;
  }

  /** An approved call approval for this print, in time, without using it. */
  findCall(employeeId: string, fingerprint: string, now: number): Approval | null {
    const row = this.#db
      .prepare("SELECT * FROM approvals WHERE employee_id = ? AND fingerprint = ? AND scope = 'call' AND status = 'approved' AND (expires_at IS NULL OR expires_at > ?) ORDER BY decided_at, rowid LIMIT 1")
      .get(employeeId, fingerprint, now) as unknown as ApprovalRow | undefined;
    return row ? fromRow(row) : null;
  }

  /** Approved approvals of a task's scope for this asker and kind, still in time (the caller matches the tool family). */
  taskScoped(employeeId: string, kind: ApprovalKind, now: number): Approval[] {
    const rows = this.#db
      .prepare("SELECT * FROM approvals WHERE employee_id = ? AND kind = ? AND scope = 'task' AND status = 'approved' AND (expires_at IS NULL OR expires_at > ?) ORDER BY decided_at")
      .all(employeeId, kind, now) as unknown as ApprovalRow[];
    return rows.map(fromRow);
  }

  /** Approved ones whose time has come: expired. Returns them. */
  expireDue(now: number): Approval[] {
    const due = this.#db.prepare("SELECT id FROM approvals WHERE status = 'approved' AND expires_at IS NOT NULL AND expires_at <= ?").all(now) as Array<{ id: string }>;
    return this.#expire(due.map((r) => r.id), ['approved']);
  }

  /** A task closed: its approvals of the task's scope, waiting or approved, end with it. */
  expireTask(taskId: string): Approval[] {
    const rows = this.#db.prepare("SELECT id FROM approvals WHERE task_id = ? AND scope = 'task' AND status IN ('pending', 'approved')").all(taskId) as Array<{ id: string }>;
    return this.#expire(rows.map((r) => r.id), ['pending', 'approved']);
  }

  #expire(ids: string[], from: ApprovalStatus[]): Approval[] {
    const out: Approval[] = [];
    const update = this.#db.prepare(`UPDATE approvals SET status = 'expired' WHERE id = ? AND status IN (${from.map(() => '?').join(', ')})`);
    for (const id of ids) if (update.run(id, ...from).changes === 1) out.push(this.get(id));
    return out;
  }
}
