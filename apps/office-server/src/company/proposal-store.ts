import { randomUUID } from 'node:crypto';
import type { Proposal, ProposalKind, ProposalStatus } from '@cc/shared';
import type { Db } from '../db.ts';
import { NotFoundError } from '../errors.ts';

interface ProposalRow {
  id: string;
  ts: number;
  by_id: string;
  kind: string;
  title: string;
  text: string;
  usd: number | null;
  plan_id: string | null;
  status: string;
  routed_to: string | null;
  decided_by: string | null;
  note: string | null;
  decided_at: number | null;
}

const fromRow = (r: ProposalRow): Proposal => ({
  id: r.id,
  ts: r.ts,
  by: r.by_id,
  kind: r.kind as ProposalKind,
  title: r.title,
  text: r.text,
  usd: r.usd,
  planId: r.plan_id,
  status: r.status as ProposalStatus,
  routedTo: r.routed_to,
  decidedBy: r.decided_by,
  note: r.note,
  decidedAt: r.decided_at,
});

export type ProposalPatch = Partial<Pick<Proposal, 'status' | 'routedTo' | 'decidedBy' | 'note' | 'decidedAt'>>;

export class ProposalStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  create(p: Omit<Proposal, 'id' | 'ts' | 'decidedBy' | 'note' | 'decidedAt'>): Proposal {
    const proposal: Proposal = { ...p, id: randomUUID(), ts: this.#now(), decidedBy: null, note: null, decidedAt: null };
    this.#db
      .prepare(
        `INSERT INTO proposals (id, ts, by_id, kind, title, text, usd, plan_id, status, routed_to, decided_by, note, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      )
      .run(proposal.id, proposal.ts, proposal.by, proposal.kind, proposal.title, proposal.text, proposal.usd, proposal.planId, proposal.status, proposal.routedTo);
    return proposal;
  }

  get(id: string): Proposal {
    const row = this.#db.prepare('SELECT * FROM proposals WHERE id = ?').get(id) as unknown as ProposalRow | undefined;
    if (!row) throw new NotFoundError(`Öneri bulunamadı: ${id}`);
    return fromRow(row);
  }

  list(o: { statuses?: ProposalStatus[]; routedTo?: string; limit?: number } = {}): Proposal[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (o.statuses && o.statuses.length > 0) {
      where.push(`status IN (${o.statuses.map(() => '?').join(', ')})`);
      params.push(...o.statuses);
    }
    if (o.routedTo !== undefined) {
      where.push('routed_to = ?');
      params.push(o.routedTo);
    }
    const rows = this.#db
      .prepare(`SELECT * FROM proposals ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ts DESC, rowid DESC LIMIT ?`)
      .all(...params, o.limit ?? 200) as unknown as ProposalRow[];
    return rows.map(fromRow);
  }

  update(id: string, patch: ProposalPatch): Proposal {
    const next = { ...this.get(id), ...patch };
    this.#db
      .prepare('UPDATE proposals SET status = ?, routed_to = ?, decided_by = ?, note = ?, decided_at = ? WHERE id = ?')
      .run(next.status, next.routedTo, next.decidedBy, next.note, next.decidedAt, id);
    return next;
  }
}
