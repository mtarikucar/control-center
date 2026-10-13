import { randomUUID } from 'node:crypto';
import type { Department, DepartmentStatus, StreamNote, StreamNoteKind } from '@cc/shared';
import type { Db } from '../db.ts';
import { NotFoundError } from '../errors.ts';

export type NewDepartment = Pick<Department, 'name' | 'mission' | 'scope' | 'template' | 'headId'>;
export type DepartmentPatch = Partial<Pick<Department, 'name' | 'mission' | 'scope' | 'template' | 'headId'>>;
export type NewStreamNote = Omit<StreamNote, 'id' | 'at'>;

interface DepartmentRow {
  id: string;
  name: string;
  mission: string;
  scope: string;
  template: string | null;
  template_version: number | null;
  head_id: string | null;
  status: string;
  created_at: number;
  closed_at: number | null;
}

const department = (r: DepartmentRow): Department => ({
  id: r.id, name: r.name, mission: r.mission, scope: r.scope,
  template: r.template ? { id: r.template, version: r.template_version ?? 1 } : null,
  headId: r.head_id, status: r.status as DepartmentStatus, createdAt: r.created_at, closedAt: r.closed_at,
});

/** The departments (spec 2026-10-13-departments §3): rows only; the invariants are the Departments service's. */
export class DepartmentStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  create(d: NewDepartment): Department {
    const id = randomUUID();
    this.#db
      .prepare('INSERT INTO departments (id, name, mission, scope, template, template_version, head_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, d.name, d.mission, d.scope, d.template?.id ?? null, d.template?.version ?? null, d.headId, 'open', this.#now());
    return this.get(id);
  }

  get(id: string): Department {
    const row = this.#db.prepare('SELECT * FROM departments WHERE id = ?').get(id) as unknown as DepartmentRow | undefined;
    if (!row) throw new NotFoundError(`Departman bulunamadı: ${id}`);
    return department(row);
  }

  /** In opening order (the rooms fill in that order). */
  list(o: { status?: DepartmentStatus } = {}): Department[] {
    const rows = (
      o.status
        ? this.#db.prepare('SELECT * FROM departments WHERE status = ? ORDER BY created_at, rowid').all(o.status)
        : this.#db.prepare('SELECT * FROM departments ORDER BY created_at, rowid').all()
    ) as unknown as DepartmentRow[];
    return rows.map(department);
  }

  update(id: string, patch: DepartmentPatch): Department {
    const next = { ...this.get(id), ...patch };
    this.#db
      .prepare('UPDATE departments SET name = ?, mission = ?, scope = ?, template = ?, template_version = ?, head_id = ? WHERE id = ?')
      .run(next.name, next.mission, next.scope, next.template?.id ?? null, next.template?.version ?? null, next.headId, id);
    return this.get(id);
  }

  /** Closed for good: no head, no members (the service moves them first). */
  close(id: string): Department {
    this.#db.prepare("UPDATE departments SET status = 'closed', closed_at = ?, head_id = NULL WHERE id = ?").run(this.#now(), id);
    return this.get(id);
  }
}

interface NoteRow {
  id: number;
  plan_id: string;
  stream_id: string;
  kind: string;
  text: string;
  evidence: string;
  next: string | null;
  by: string;
  at: number;
}

const note = (r: NoteRow): StreamNote => ({
  id: r.id, planId: r.plan_id, streamId: r.stream_id, kind: r.kind as StreamNoteKind, text: r.text,
  evidence: JSON.parse(r.evidence) as string[], next: r.next, by: r.by, at: r.at,
});

/** A head's plans of and reports on plan streams (spec §5.2): every call a new row, the latest shown. */
export class StreamNoteStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  add(n: NewStreamNote): StreamNote {
    const result = this.#db
      .prepare('INSERT INTO stream_notes (plan_id, stream_id, kind, text, evidence, next, by, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(n.planId, n.streamId, n.kind, n.text, JSON.stringify(n.evidence), n.next, n.by, this.#now());
    return note(this.#db.prepare('SELECT * FROM stream_notes WHERE id = ?').get(Number(result.lastInsertRowid)) as unknown as NoteRow);
  }

  latest(planId: string, streamId: string, kind: StreamNoteKind): StreamNote | null {
    const row = this.#db
      .prepare('SELECT * FROM stream_notes WHERE plan_id = ? AND stream_id = ? AND kind = ? ORDER BY at DESC, id DESC LIMIT 1')
      .get(planId, streamId, kind) as unknown as NoteRow | undefined;
    return row ? note(row) : null;
  }

  /** Every note of a plan, newest first. */
  forPlan(planId: string): StreamNote[] {
    return (this.#db.prepare('SELECT * FROM stream_notes WHERE plan_id = ? ORDER BY at DESC, id DESC').all(planId) as unknown as NoteRow[]).map(note);
  }
}
