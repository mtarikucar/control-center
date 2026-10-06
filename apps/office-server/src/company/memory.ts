import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Decision, Employee, EmployeeFile, EmployeeNote, MemoryHit, Note, OfficeEvent, PlaybookEntry, Task, TaskResult } from '@cc/shared';
import { OWNER } from '@cc/shared';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.ts';
import type { EventStore } from '../event-store.ts';
import { slugify, type Roster } from '../roster.ts';
import type { DecisionStore, EmployeeNoteStore, NoteStore, PlaybookStore } from './memory-store.ts';
import type { NoticeStore, PlanStore, TaskStore } from './store.ts';
import { clean, fold, lines, snippetOf, words } from './text.ts';

export interface MemoryDeps {
  roster: Roster;
  events: EventStore;
  notices: NoticeStore;
  tasks: TaskStore;
  plans: PlanStore;
  decisions: DecisionStore;
  playbook: PlaybookStore;
  notes: NoteStore;
  employeeNotes: EmployeeNoteStore;
  dataDir: string;
}

function matches(haystack: string, ws: string[]): boolean {
  const h = fold(haystack);
  return ws.every((w) => h.includes(w));
}

/** The company's memory: decisions, the playbook, knowledge notes and employee files (spec §5). */
export class Memory {
  readonly #d: MemoryDeps;

  constructor(d: MemoryDeps) {
    this.#d = d;
  }

  // ── decisions ─────────────────────────────────────────────────────────────

  recordDecision(by: string, d: { title: string; chosen: string; reason: string; alternatives?: string[]; planId?: string | null }): Decision {
    this.#assertLeadOrCoordinator(by);
    const planId = d.planId ?? null;
    if (planId !== null) this.#d.plans.get(planId);
    const decision = this.#d.decisions.create({
      by,
      title: clean(d.title, 'Karar başlığı', 160, true),
      chosen: clean(d.chosen, 'Seçilen', 2000, true),
      reason: clean(d.reason, 'Gerekçe', 4000, true),
      alternatives: lines(d.alternatives, 'Alternatifler', 12, 500),
      planId,
      reverts: null,
    });
    this.#emit(by, { type: 'decision.recorded', decision });
    return decision;
  }

  decisions(o: { query?: string; planId?: string; limit?: number } = {}): Decision[] {
    const all = this.#d.decisions.list({ planId: o.planId, limit: 500 });
    const ws = o.query ? words(o.query) : [];
    const found = ws.length ? all.filter((x) => matches(`${x.title} ${x.chosen} ${x.reason} ${x.alternatives.join(' ')}`, ws)) : all;
    return found.slice(0, o.limit ?? 50);
  }

  /** The owner undoes a decision: a new record says so, and the coordinator is told to act on it (spec §5.2). */
  revertDecision(id: string): Decision {
    const target = this.#d.decisions.get(id);
    if (target.reverts !== null) throw new ConflictError('Bu kayıt zaten bir geri alma; geri alınamaz.');
    if (this.#d.decisions.revertOf(id)) throw new ConflictError('Bu karar zaten geri alındı.');
    const revert = this.#d.decisions.create({
      by: OWNER,
      title: `Geri alındı: ${target.title}`,
      chosen: 'Geri alındı',
      reason: 'Sahibi bu kararı geri aldı.',
      alternatives: [],
      planId: target.planId,
      reverts: target.id,
    });
    const coordinator = this.#coordinator();
    if (coordinator) {
      this.#d.notices.add(
        coordinator.id,
        `Sahibi şu kararı geri aldı: “${target.title}” (seçilen: ${target.chosen}). Gereğini yap; büyük bir değişiklikse planRevise ile sahibine getir.`,
      );
    }
    this.#emit(coordinator?.id ?? null, { type: 'decision.recorded', decision: revert });
    return revert;
  }

  /** The owner's own decisions: approving a purchase, settling what was brought to them. */
  recordOwnerDecision(d: { title: string; chosen: string; reason: string; planId?: string | null }): Decision {
    const decision = this.#d.decisions.create({
      by: OWNER,
      title: clean(d.title, 'Karar başlığı', 160, true),
      chosen: clean(d.chosen, 'Seçilen', 2000, true),
      reason: clean(d.reason, 'Gerekçe', 4000, true),
      alternatives: [],
      planId: d.planId ?? null,
      reverts: null,
    });
    this.#emit(this.#coordinator()?.id ?? null, { type: 'decision.recorded', decision });
    return decision;
  }

  // ── playbook ──────────────────────────────────────────────────────────────

  updatePlaybook(by: string, p: { topic: string; text: string; reason?: string }): PlaybookEntry {
    this.#assertLeadOrCoordinator(by);
    const asked = clean(p.topic, 'Konu', 60, true);
    // The same topic written differently ("test prosedürü" / "Test Prosedürü") is one topic, spelled as first written.
    const topic = this.#findTopic(asked)?.topic ?? asked;
    const entry = this.#d.playbook.write({ topic, text: clean(p.text, 'El kitabı metni', 20000, true), by, reason: clean(p.reason, 'Gerekçe', 500, false) });
    const dir = join(this.#d.dataDir, 'company', 'playbook');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${slugify(topic)}.md`), `# ${topic}\n\n${entry.text}\n`);
    this.#emit(by, { type: 'playbook.updated', topic, version: entry.version, reason: entry.reason });
    return entry;
  }

  playbookTopics(): PlaybookEntry[] {
    return this.#d.playbook.topics();
  }

  playbookTopic(topic: string): PlaybookEntry {
    const found = this.#findTopic(topic);
    if (found) return found;
    const names = this.#d.playbook.topics().map((t) => t.topic);
    throw new NotFoundError(`El kitabında “${topic}” konusu yok.${names.length ? ` Konular: ${names.join(', ')}.` : ' Henüz hiç konu yazılmadı.'}`);
  }

  playbookHistory(topic: string): PlaybookEntry[] {
    return this.#d.playbook.history(this.playbookTopic(topic).topic);
  }

  // ── notes and search ──────────────────────────────────────────────────────

  writeNote(by: string, n: { title: string; text: string; tags?: string[]; source?: string | null }): Note {
    this.#d.roster.get(by);
    const note = this.#d.notes.create({
      by,
      title: clean(n.title, 'Not başlığı', 160, true),
      text: clean(n.text, 'Not metni', 8000, true),
      tags: lines(n.tags, 'Etiketler', 8, 30).map((t) => t.toLocaleLowerCase('tr')),
      source: n.source ?? null,
    });
    this.#emit(by, { type: 'note.written', id: note.id, title: note.title, tags: note.tags });
    return note;
  }

  notes(query?: string, limit = 50): Array<{ note: Note; snippet: string }> {
    return query?.trim() ? this.#d.notes.search(query, limit) : this.#d.notes.list(limit).map((note) => ({ note, snippet: '' }));
  }

  /** Everything the company knows that mentions every word of the query: notes, decisions, playbook topics, finished work. */
  search(query: string, limit = 10): MemoryHit[] {
    const ws = words(query);
    if (ws.length === 0) throw new ValidationError('Arama için en az bir kelime yaz.');
    const hits: MemoryHit[] = this.#d.notes.search(query, limit).map(({ note, snippet }) => ({ kind: 'note', id: String(note.id), title: note.title, snippet, ts: note.ts }));
    for (const x of this.#d.decisions.list({ limit: 500 })) {
      const body = `${x.chosen}. ${x.reason}${x.alternatives.length ? ` (alternatifler: ${x.alternatives.join(', ')})` : ''}`;
      if (matches(`${x.title} ${body}`, ws)) hits.push({ kind: 'decision', id: x.id, title: x.title, snippet: snippetOf(body, ws), ts: x.ts });
    }
    for (const p of this.#d.playbook.topics()) {
      if (matches(`${p.topic} ${p.text}`, ws)) hits.push({ kind: 'playbook', id: p.topic, title: p.topic, snippet: snippetOf(p.text, ws), ts: p.ts });
    }
    for (const t of this.#d.tasks.list({ statuses: ['done'], limit: 100_000 })) {
      if (!t.result) continue;
      const body = `${t.result.summary} ${t.result.learned}`.trim();
      if (matches(`${t.title} ${body}`, ws)) hits.push({ kind: 'task', id: t.id, title: t.title, snippet: snippetOf(body, ws), ts: t.finishedAt ?? t.createdAt });
    }
    return hits.sort((a, b) => b.ts - a.ts).slice(0, limit);
  }

  /** What a hand-in taught goes to the notes, so the next person who searches finds it. */
  learnedFrom(task: Task, result: TaskResult): Note | null {
    if (!result.learned.trim()) return null;
    return this.writeNote(task.assignee, { title: `Öğrenilen: ${task.title}`.slice(0, 160), text: result.learned, tags: ['görev'], source: `task:${task.id}` });
  }

  // ── employee files ────────────────────────────────────────────────────────

  addEmployeeNote(by: string, employeeId: string, text: string): EmployeeNote {
    if (this.#d.roster.get(by).kind !== 'coordinator') throw new ForbiddenError('Yalnız koordinatör bunu yapabilir.');
    const employee = this.#d.roster.get(employeeId);
    return this.#d.employeeNotes.add({ employeeId: employee.id, by, text: clean(text, 'Not', 2000, true) });
  }

  employeeFile(id: string): EmployeeFile {
    const employee = this.#d.roster.get(id);
    const done = this.#d.tasks.list({ assignee: id, statuses: ['done'], limit: 100_000 });
    return {
      employee,
      notes: this.#d.employeeNotes.list(id),
      finished: done.length,
      recent: done
        .slice(-5)
        .reverse()
        .map((t) => ({ id: t.id, title: t.title, summary: t.result?.summary ?? '', finishedAt: t.finishedAt })),
    };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  #findTopic(topic: string): PlaybookEntry | null {
    const wanted = fold(topic.trim());
    return this.#d.playbook.topics().find((t) => fold(t.topic) === wanted) ?? null;
  }

  #coordinator(): Employee | null {
    return this.#d.roster.list().find((e) => e.kind === 'coordinator') ?? null;
  }

  #assertLeadOrCoordinator(by: string): void {
    const kind = this.#d.roster.get(by).kind;
    if (kind !== 'lead' && kind !== 'coordinator') throw new ForbiddenError('Yalnız koordinatör ya da ekip lideri bunu yapabilir.');
  }

  #emit(employeeId: string | null, event: OfficeEvent): void {
    this.#d.events.append(employeeId, event);
  }
}
