import type { CapabilityKind, CustomCapability, CustomCapabilityStatus } from '@cc/shared';
import type { Db } from '../db.ts';
import { NotFoundError } from '../errors.ts';

interface Row {
  id: string;
  title: string;
  summary: string;
  kind: string;
  tools: string;
  status: string;
  proposed_by: string;
  decided_by: string | null;
  note: string | null;
  created_at: number;
  decided_at: number | null;
}

const fromRow = (r: Row): CustomCapability => ({
  id: r.id, title: r.title, summary: r.summary, kind: r.kind as CapabilityKind, tools: JSON.parse(r.tools) as string[], status: r.status as CustomCapabilityStatus,
  proposedBy: r.proposed_by, decidedBy: r.decided_by, note: r.note, createdAt: r.created_at, decidedAt: r.decided_at,
});

export type CustomCapabilityPatch = Partial<Pick<CustomCapability, 'kind' | 'status' | 'decidedBy' | 'note' | 'decidedAt'>>;

/** The company's own capabilities (spec capabilities §4.1, v25): rows only; the rules are the CustomCapabilities service's. */
export class CustomCapabilityStore {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  find(id: string): CustomCapability | null {
    const row = this.#db.prepare('SELECT * FROM custom_capabilities WHERE id = ?').get(id) as unknown as Row | undefined;
    return row ? fromRow(row) : null;
  }

  get(id: string): CustomCapability {
    const found = this.find(id);
    if (!found) throw new NotFoundError(`Şirket yeteneği bulunamadı: ${id}`);
    return found;
  }

  /** Oldest first. */
  list(o: { statuses?: readonly CustomCapabilityStatus[] } = {}): CustomCapability[] {
    const statuses = o.statuses ?? [];
    const where = statuses.length ? `WHERE status IN (${statuses.map(() => '?').join(', ')})` : '';
    const rows = this.#db.prepare(`SELECT * FROM custom_capabilities ${where} ORDER BY created_at, rowid`).all(...statuses) as unknown as Row[];
    return rows.map(fromRow);
  }

  /** A new row, or one rejected or retired before started over under the same id (the service decides which may). */
  put(c: CustomCapability): CustomCapability {
    this.#db
      .prepare(
        `INSERT INTO custom_capabilities (id, title, summary, kind, tools, status, proposed_by, decided_by, note, created_at, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET title = excluded.title, summary = excluded.summary, kind = excluded.kind, tools = excluded.tools,
           status = excluded.status, proposed_by = excluded.proposed_by, decided_by = excluded.decided_by, note = excluded.note,
           created_at = excluded.created_at, decided_at = excluded.decided_at`,
      )
      .run(c.id, c.title, c.summary, c.kind, JSON.stringify(c.tools), c.status, c.proposedBy, c.decidedBy, c.note, c.createdAt, c.decidedAt);
    return this.get(c.id);
  }

  update(id: string, patch: CustomCapabilityPatch): CustomCapability {
    const next = { ...this.get(id), ...patch };
    this.#db
      .prepare('UPDATE custom_capabilities SET kind = ?, status = ?, decided_by = ?, note = ?, decided_at = ? WHERE id = ?')
      .run(next.kind, next.status, next.decidedBy, next.note, next.decidedAt, id);
    return this.get(id);
  }
}
