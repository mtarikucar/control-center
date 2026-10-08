import { MEMORY_KINDS, PROFILE_SPEC, type Decision, type MemoryHit, type MemoryKind, type Note, type PlaybookEntry, type ProfileEntry, type Task } from '@cc/shared';
import type { Db } from '../db.ts';
import { ValidationError } from '../errors.ts';
import { CompanyStateStore } from './goal-store.ts';
import { DecisionStore, NoteStore, PlaybookStore } from './memory-store.ts';
import { ProfileStore } from './profile-store.ts';
import { TaskStore } from './store.ts';
import { fold, snippetOf, words } from './text.ts';

/** Raise it when what goes into the index changes: the office rebuilds the index on its next start. */
export const SEARCH_VERSION = 1;

/**
 * Each kind's weight (spec 2026-10-08-memory-search-design §3.5). bm25 is negative and smaller is better, so the score
 * is bm25 divided by the weight: under 1 brings a kind forward (the playbook and decisions are the company's word), over
 * 1 pushes it back (finished work is long and plentiful).
 */
export const KIND_WEIGHT: Record<MemoryKind, number> = { playbook: 0.8, decision: 0.85, note: 1, profile: 1, task: 1.1 };

/** bm25 column weights, in search_fts's column order: title 3, body 1, tags 2. */
const SCORE = `bm25(search_fts, 3.0, 1.0, 2.0) / (CASE i.kind ${Object.entries(KIND_WEIGHT).map(([k, w]) => `WHEN '${k}' THEN ${w}`).join(' ')} ELSE 1 END)`;

/** One record in the index: the original text (what is shown) — the folded copy is made when it is written. */
export interface SearchDoc {
  kind: MemoryKind;
  /** The note's number, the decision's or task's id, the playbook topic, the profile section. */
  ref: string;
  title: string;
  body: string;
  tags: string[];
  ts: number;
}

export interface SearchOptions {
  limit: number;
  kinds?: MemoryKind[];
  /** Only records from this time on (epoch ms). */
  since?: number;
}

/** The query's words as the index matches them: folded, at most 8, each once. */
export function queryWords(query: string): string[] {
  return [...new Set(words(query))];
}

/** A `kinds` list from a tool or the API: each one of MEMORY_KINDS; none (or an empty list) = every kind. */
export function memoryKinds(value: unknown): MemoryKind[] | undefined {
  if (value === undefined || value === null) return undefined;
  const list = Array.isArray(value) ? value : [value];
  const bad = list.filter((k) => !(MEMORY_KINDS as readonly unknown[]).includes(k));
  if (bad.length) throw new ValidationError(`kinds şunlardan olmalı: ${MEMORY_KINDS.join(', ')} (verilen: ${bad.map(String).join(', ')}).`);
  return list.length ? (list as MemoryKind[]) : undefined;
}

export const noteDoc = (n: Note): SearchDoc => ({ kind: 'note', ref: String(n.id), title: n.title, body: n.text, tags: n.tags, ts: n.ts });

/** The body is what the search showed before B11, so a decision's snippet reads the same. */
export const decisionDoc = (d: Decision): SearchDoc => ({
  kind: 'decision',
  ref: d.id,
  title: d.title,
  body: `${d.chosen}. ${d.reason}${d.alternatives.length ? ` (alternatifler: ${d.alternatives.join(', ')})` : ''}`,
  tags: d.reverts ? ['karar', 'geri-alma'] : ['karar'],
  ts: d.ts,
});

export const playbookDoc = (e: PlaybookEntry): SearchDoc => ({ kind: 'playbook', ref: e.topic, title: e.topic, body: e.text, tags: ['el-kitabı'], ts: e.ts });

/**
 * Finished work with a result — work, reviews and hand-overs alike, as before B11: the summary, each item with its proof
 * and a review's findings. What it taught is not here: Memory.learnedFrom made it a note, which is found instead.
 */
export function taskDoc(t: Task, planTitle: string | null): SearchDoc | null {
  if (t.status !== 'done' || !t.result) return null;
  const proof = (t.result.evidence ?? []).map((e, i) => (t.done[i] ? `${t.done[i]}: ${e}` : e));
  const findings = (t.result.review?.findings ?? []).map((f) => f.text);
  return {
    kind: 'task',
    ref: t.id,
    title: t.title,
    body: [t.result.summary, ...proof, ...findings].join('\n'),
    tags: ['teslim', ...(t.kind === 'review' ? ['inceleme'] : []), ...(planTitle ? [planTitle] : [])],
    ts: t.finishedAt ?? t.createdAt,
  };
}

/** A profile section as "Label: value" lines, in the section's field order. */
export function profileDoc(e: ProfileEntry): SearchDoc {
  const spec = PROFILE_SPEC[e.section];
  const keys = [...Object.keys(spec.fields), ...Object.keys(e.fields).filter((k) => !(k in spec.fields))];
  const lines = keys.flatMap((k) => {
    const value = e.fields[k];
    const text = Array.isArray(value) ? value.join(', ') : (value ?? '');
    return text.trim() ? [`${spec.fields[k]?.label ?? k}: ${text}`] : [];
  });
  return { kind: 'profile', ref: e.section, title: spec.label, body: lines.join('\n'), tags: e.assumed ? ['profil', 'varsayım'] : ['profil'], ts: e.ts };
}

interface Row {
  id: number;
  kind: MemoryKind;
  ref: string;
  title: string;
  body: string;
  ts: number;
  matched?: number;
}

/**
 * The company memory's one full-text index (spec 2026-10-08-memory-search-design): notes, decisions, each playbook
 * topic's newest version, finished work and the profile sections. The stores write it as they write their own tables;
 * the office fills it from those tables on start when it is behind.
 */
export class SearchIndex {
  readonly #db: Db;
  readonly #state: CompanyStateStore;

  constructor(db: Db) {
    this.#db = db;
    this.#state = new CompanyStateStore(db);
  }

  upsert(doc: SearchDoc): void {
    const tags = doc.tags.join(' ');
    this.#db
      .prepare(
        `INSERT INTO search_index (kind, ref, title, body, tags, ft_title, ft_body, ft_tags, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (kind, ref) DO UPDATE SET title = excluded.title, body = excluded.body, tags = excluded.tags,
           ft_title = excluded.ft_title, ft_body = excluded.ft_body, ft_tags = excluded.ft_tags, ts = excluded.ts`,
      )
      .run(doc.kind, doc.ref, doc.title, doc.body, tags, fold(doc.title), fold(doc.body), fold(tags), doc.ts);
  }

  remove(kind: MemoryKind, ref: string): void {
    this.#db.prepare('DELETE FROM search_index WHERE kind = ? AND ref = ?').run(kind, ref);
  }

  note(n: Note): void {
    this.upsert(noteDoc(n));
  }

  decision(d: Decision): void {
    this.upsert(decisionDoc(d));
  }

  /** A topic's new version replaces the old one: only the newest is found. */
  playbook(e: PlaybookEntry): void {
    this.upsert(playbookDoc(e));
  }

  profile(e: ProfileEntry): void {
    this.upsert(profileDoc(e));
  }

  /** A task is in the index while it is done with a result; any other state (cancelled, sent back) takes it out. */
  task(t: Task): void {
    const doc = taskDoc(t, t.planId ? this.#planTitles(t.planId).get(t.planId) ?? null : null);
    if (doc) this.upsert(doc);
    else this.remove('task', t.id);
  }

  /** Writes the index again from the source tables, in one transaction; returns how many records it holds. */
  rebuild(): number {
    const plans = this.#planTitles();
    // LIMIT -1: every row.
    const docs: SearchDoc[] = [
      ...new NoteStore(this.#db).list(-1).map(noteDoc),
      ...new DecisionStore(this.#db).list({ limit: -1 }).map(decisionDoc),
      ...new PlaybookStore(this.#db).topics().map(playbookDoc),
      ...new TaskStore(this.#db).list({ statuses: ['done'], limit: -1 }).flatMap((t) => taskDoc(t, t.planId ? plans.get(t.planId) ?? null : null) ?? []),
      ...Object.values(new ProfileStore(this.#db).current().sections).map(profileDoc),
    ];
    this.#db.exec('BEGIN');
    try {
      this.#db.exec('DELETE FROM search_index');
      for (const doc of docs) this.upsert(doc);
      // The full-text table is rebuilt from search_index itself, whatever state it was in.
      this.#db.exec("INSERT INTO search_fts (search_fts) VALUES ('rebuild')");
      this.#state.set('search.version', String(SEARCH_VERSION));
      this.#db.exec('COMMIT');
    } catch (err) {
      this.#db.exec('ROLLBACK');
      throw err;
    }
    return docs.length;
  }

  /**
   * On start: rebuilds when the index is from an older SEARCH_VERSION, or does not hold what the source tables hold —
   * per kind, how many records and the newest time (an index emptied by a migration, or records written by code from
   * before the index, e.g. after a rollback). Returns whether it rebuilt.
   */
  rebuildIfStale(): boolean {
    const version = Number(this.#state.get('search.version') ?? 0);
    if (version >= SEARCH_VERSION && this.#inStep()) return false;
    this.rebuild();
    return true;
  }

  /**
   * Records with every word first (best score first, the newer on a tie); if they are fewer than `limit`, records with
   * some of the words fill the rest, most words first, marked partial (spec §3.5).
   */
  search(query: string, o: SearchOptions): { hits: MemoryHit[]; mode: 'and' | 'or' | 'none' } {
    const ws = queryWords(query);
    if (ws.length === 0) return { hits: [], mode: 'none' };
    const terms = ws.map((w) => `"${w}"*`);
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (o.kinds?.length) {
      where.push(`i.kind IN (${o.kinds.map(() => '?').join(', ')})`);
      params.push(...o.kinds);
    }
    if (o.since !== undefined) {
      where.push('i.ts >= ?');
      params.push(o.since);
    }
    const filter = where.map((w) => ` AND ${w}`).join('');
    const from = 'FROM search_fts JOIN search_index i ON i.id = search_fts.rowid';
    const all = this.#db
      .prepare(`SELECT i.id, i.kind, i.ref, i.title, i.body, i.ts, ${SCORE} AS score ${from} WHERE search_fts MATCH ?${filter} ORDER BY score, i.ts DESC, i.id DESC LIMIT ?`)
      .all(terms.join(' '), ...params, o.limit) as unknown as Row[];
    let some: Row[] = [];
    if (all.length < o.limit && ws.length > 1) {
      // How many of the words a record has, each counted by the same prefix match as the search itself.
      const matched = terms.map(() => '(search_fts.rowid IN (SELECT rowid FROM search_fts WHERE search_fts MATCH ?))').join(' + ');
      some = this.#db
        .prepare(
          `SELECT i.id, i.kind, i.ref, i.title, i.body, i.ts, ${SCORE} AS score, ${matched} AS matched ${from}
           WHERE search_fts MATCH ? AND i.id NOT IN (SELECT value FROM json_each(?))${filter} ORDER BY matched DESC, score, i.ts DESC, i.id DESC LIMIT ?`,
        )
        .all(...terms, terms.join(' OR '), JSON.stringify(all.map((r) => r.id)), ...params, o.limit - all.length) as unknown as Row[];
    }
    const hit = (r: Row): MemoryHit => ({ kind: r.kind, id: r.ref, title: r.title, snippet: snippetOf(r.body, ws), ts: r.ts });
    return {
      hits: [...all.map(hit), ...some.map((r) => ({ ...hit(r), partial: true as const, matched: r.matched }))],
      mode: some.length ? 'or' : all.length ? 'and' : 'none',
    };
  }

  #planTitles(id?: string): Map<string, string> {
    const rows = (id === undefined ? this.#db.prepare('SELECT id, title FROM plans').all() : this.#db.prepare('SELECT id, title FROM plans WHERE id = ?').all(id)) as unknown as Array<{ id: string; title: string }>;
    return new Map(rows.map((r) => [r.id, r.title]));
  }

  /** Whether the index holds, per kind, as many records as the source tables, with the same newest time. */
  #inStep(): boolean {
    const sources: Record<MemoryKind, string> = {
      note: 'SELECT COUNT(*) AS n, MAX(ts) AS t FROM notes',
      decision: 'SELECT COUNT(*) AS n, MAX(ts) AS t FROM decisions',
      playbook: 'SELECT COUNT(DISTINCT topic) AS n, MAX(ts) AS t FROM playbook',
      task: "SELECT COUNT(*) AS n, MAX(COALESCE(finished_at, created_at)) AS t FROM tasks WHERE status = 'done' AND result IS NOT NULL",
      profile: 'SELECT COUNT(DISTINCT section) AS n, MAX(ts) AS t FROM company_profile',
    };
    const indexed = new Map(
      (this.#db.prepare('SELECT kind, COUNT(*) AS n, MAX(ts) AS t FROM search_index GROUP BY kind').all() as unknown as Array<{ kind: string; n: number; t: number }>).map((r) => [r.kind, r]),
    );
    return MEMORY_KINDS.every((kind) => {
      const source = this.#db.prepare(sources[kind]).get() as unknown as { n: number; t: number | null };
      const index = indexed.get(kind);
      return source.n === (index?.n ?? 0) && (source.t ?? null) === (index?.t ?? null);
    });
  }
}
