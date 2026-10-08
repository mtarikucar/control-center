import { randomUUID } from 'node:crypto';
import type { Decision, EmployeeNote, Note, PlaybookEntry } from '@cc/shared';
import type { Db } from '../db.ts';
import { NotFoundError } from '../errors.ts';
import type { SearchIndex } from './search.ts';
import { fold, snippetOf, words } from './text.ts';

/**
 * A user's query as an FTS5 expression that cannot be a syntax error: every word folded (Turkish ı/İ, ş, ç… — the
 * index holds folded text too), quoted and prefix-matched, all required. Null when the query has no words.
 */
export function ftsQuery(query: string): string | null {
  const ws = words(query);
  return ws.length ? ws.map((w) => `"${w}"*`).join(' ') : null;
}

interface DecisionRow {
  id: string;
  ts: number;
  by_id: string;
  title: string;
  chosen: string;
  reason: string;
  alternatives: string;
  plan_id: string | null;
  reverts: string | null;
}

const decisionFromRow = (r: DecisionRow): Decision => ({
  id: r.id,
  ts: r.ts,
  by: r.by_id,
  title: r.title,
  chosen: r.chosen,
  reason: r.reason,
  alternatives: JSON.parse(r.alternatives) as string[],
  planId: r.plan_id,
  reverts: r.reverts,
});

export type NewDecision = Omit<Decision, 'id' | 'ts'>;

export class DecisionStore {
  readonly #db: Db;
  readonly #now: () => number;
  readonly #index: SearchIndex | undefined;

  /** `index`: the memory search's index, written with every decision (B11); none in tests that do not search. */
  constructor(db: Db, now: () => number = Date.now, index?: SearchIndex) {
    this.#db = db;
    this.#now = now;
    this.#index = index;
  }

  create(d: NewDecision): Decision {
    const decision: Decision = { ...d, id: randomUUID(), ts: this.#now() };
    this.#db
      .prepare('INSERT INTO decisions (id, ts, by_id, title, chosen, reason, alternatives, plan_id, reverts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(decision.id, decision.ts, decision.by, decision.title, decision.chosen, decision.reason, JSON.stringify(decision.alternatives), decision.planId, decision.reverts);
    this.#index?.decision(decision);
    return decision;
  }

  get(id: string): Decision {
    const row = this.#db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as unknown as DecisionRow | undefined;
    if (!row) throw new NotFoundError(`Karar bulunamadı: ${id}`);
    return decisionFromRow(row);
  }

  list(o: { planId?: string; limit?: number } = {}): Decision[] {
    const limit = o.limit ?? 200;
    const rows = (
      o.planId !== undefined
        ? this.#db.prepare('SELECT * FROM decisions WHERE plan_id = ? ORDER BY ts DESC, rowid DESC LIMIT ?').all(o.planId, limit)
        : this.#db.prepare('SELECT * FROM decisions ORDER BY ts DESC, rowid DESC LIMIT ?').all(limit)
    ) as unknown as DecisionRow[];
    return rows.map(decisionFromRow);
  }

  revertOf(id: string): Decision | null {
    const row = this.#db.prepare('SELECT * FROM decisions WHERE reverts = ? LIMIT 1').get(id) as unknown as DecisionRow | undefined;
    return row ? decisionFromRow(row) : null;
  }
}

interface PlaybookRow {
  topic: string;
  version: number;
  text: string;
  by_id: string;
  reason: string;
  ts: number;
}

const entryFromRow = (r: PlaybookRow): PlaybookEntry => ({ topic: r.topic, version: r.version, text: r.text, by: r.by_id, reason: r.reason, ts: r.ts });

export class PlaybookStore {
  readonly #db: Db;
  readonly #now: () => number;
  readonly #index: SearchIndex | undefined;

  /** `index`: the memory search's index, given each topic's newest version (B11); none in tests that do not search. */
  constructor(db: Db, now: () => number = Date.now, index?: SearchIndex) {
    this.#db = db;
    this.#now = now;
    this.#index = index;
  }

  write(e: { topic: string; text: string; by: string; reason: string }): PlaybookEntry {
    const row = this.#db.prepare('SELECT MAX(version) AS v FROM playbook WHERE topic = ?').get(e.topic) as unknown as { v: number | null };
    const entry: PlaybookEntry = { ...e, version: (row.v ?? 0) + 1, ts: this.#now() };
    this.#db
      .prepare('INSERT INTO playbook (topic, version, text, by_id, reason, ts) VALUES (?, ?, ?, ?, ?, ?)')
      .run(entry.topic, entry.version, entry.text, entry.by, entry.reason, entry.ts);
    this.#index?.playbook(entry);
    return entry;
  }

  latest(topic: string): PlaybookEntry | null {
    const row = this.#db.prepare('SELECT * FROM playbook WHERE topic = ? ORDER BY version DESC LIMIT 1').get(topic) as unknown as PlaybookRow | undefined;
    return row ? entryFromRow(row) : null;
  }

  topics(): PlaybookEntry[] {
    const rows = this.#db
      .prepare(
        `SELECT p.* FROM playbook p
           JOIN (SELECT topic, MAX(version) AS v FROM playbook GROUP BY topic) m ON p.topic = m.topic AND p.version = m.v
         ORDER BY p.topic`,
      )
      .all() as unknown as PlaybookRow[];
    return rows.map(entryFromRow);
  }

  history(topic: string): PlaybookEntry[] {
    const rows = this.#db.prepare('SELECT * FROM playbook WHERE topic = ? ORDER BY version DESC').all(topic) as unknown as PlaybookRow[];
    return rows.map(entryFromRow);
  }
}

interface NoteRow {
  id: number;
  ts: number;
  by_id: string;
  title: string;
  text: string;
  tags: string;
  source: string | null;
}

const noteFromRow = (r: NoteRow): Note => ({ id: r.id, ts: r.ts, by: r.by_id, title: r.title, text: r.text, tags: JSON.parse(r.tags) as string[], source: r.source });

export class NoteStore {
  readonly #db: Db;
  readonly #now: () => number;
  readonly #index: SearchIndex | undefined;

  /** `index`: the memory search's index, written with every note (B11); none in tests that do not search. */
  constructor(db: Db, now: () => number = Date.now, index?: SearchIndex) {
    this.#db = db;
    this.#now = now;
    this.#index = index;
  }

  create(n: Omit<Note, 'id' | 'ts'>): Note {
    const ts = this.#now();
    const r = this.#db
      .prepare('INSERT INTO notes (ts, by_id, title, text, tags, source, ft_title, ft_text, ft_tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ts, n.by, n.title, n.text, JSON.stringify(n.tags), n.source, fold(n.title), fold(n.text), fold(n.tags.join(' ')));
    const note = { ...n, id: Number(r.lastInsertRowid), ts };
    this.#index?.note(note);
    return note;
  }

  list(limit = 100): Note[] {
    const rows = this.#db.prepare('SELECT * FROM notes ORDER BY ts DESC, id DESC LIMIT ?').all(limit) as unknown as NoteRow[];
    return rows.map(noteFromRow);
  }

  /** The notes written from one source (e.g. `plan:<id>`), oldest first. */
  bySource(source: string): Note[] {
    const rows = this.#db.prepare('SELECT * FROM notes WHERE source = ? ORDER BY ts, id').all(source) as unknown as NoteRow[];
    return rows.map(noteFromRow);
  }

  search(query: string, limit = 20): Array<{ note: Note; snippet: string }> {
    const match = ftsQuery(query);
    if (!match) return [];
    const rows = this.#db
      .prepare('SELECT n.* FROM notes_fts JOIN notes n ON n.id = notes_fts.rowid WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?')
      .all(match, limit) as unknown as NoteRow[];
    // The index holds folded text; the snippet comes from the original, so the owner reads what was written.
    const ws = words(query);
    return rows.map((r) => ({ note: noteFromRow(r), snippet: snippetOf(r.text, ws) }));
  }
}

interface EmployeeNoteRow {
  id: number;
  ts: number;
  employee_id: string;
  by_id: string;
  text: string;
}

export class EmployeeNoteStore {
  readonly #db: Db;
  readonly #now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
  }

  add(n: { employeeId: string; by: string; text: string }): EmployeeNote {
    const ts = this.#now();
    const r = this.#db.prepare('INSERT INTO employee_notes (ts, employee_id, by_id, text) VALUES (?, ?, ?, ?)').run(ts, n.employeeId, n.by, n.text);
    return { ...n, id: Number(r.lastInsertRowid), ts };
  }

  list(employeeId: string): EmployeeNote[] {
    const rows = this.#db.prepare('SELECT * FROM employee_notes WHERE employee_id = ? ORDER BY ts, id').all(employeeId) as unknown as EmployeeNoteRow[];
    return rows.map((r) => ({ id: r.id, ts: r.ts, employeeId: r.employee_id, by: r.by_id, text: r.text }));
  }
}
