import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, MemoryHit, Note, PlaybookEntry, Task } from '@cc/shared';
import { DecisionStore, NoteStore, PlaybookStore } from '../src/company/memory-store.ts';
import { TaskStore } from '../src/company/store.ts';
import { fold, snippetOf, words } from '../src/company/text.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const DAY = 86_400_000;

/** A company wired like main.ts on one clock the test moves: each record gets the time the test says. */
function make() {
  const s = setup();
  const f = fakeEngine(s);
  let at = Date.UTC(2026, 9, 1, 9);
  const now = () => at;
  const c = companyFor(s, f, ['coder'], now);
  cleanups.push(f.cleanup, s.cleanup);
  const coord = c.company.hireCoordinator();
  const ada = c.company.hire(coord.id, { name: 'Ada', role: 'r' });
  const finish = (title: string, summary: string, o: { learned?: string; done?: string[]; evidence?: string[] } = {}) => {
    const task = c.company.createTask(coord.id, { assignee: ada.id, title, done: o.done });
    c.company.start(task.id);
    return c.company.finish(ada.id, task.id, { summary, outputs: [], learned: o.learned ?? '', evidence: o.evidence });
  };
  return { ...s, ...c, coord, ada, finish, now, later: (ms = DAY) => (at += ms) };
}

const keys = (hits: MemoryHit[]) => hits.map((h) => `${h.kind}:${h.title}`);

describe('memory search — matching and order (B11)', () => {
  it('puts an old record that is about the word before a newer one that mentions it in passing: relevance, not recency', () => {
    const t = make();
    t.memory.writeNote(t.ada.id, { title: 'ElevenLabs', text: 'ElevenLabs Türkçe sesleri iyi; ElevenLabs aboneliği aylık.' });
    t.later();
    t.memory.writeNote(t.ada.id, {
      title: 'Haftalık özet',
      text: 'Bu hafta pazar raporu bitti, kota yüzde elli, iki inceleme kapandı, bir ses denemesi elevenlabs ile yapıldı, plan yenilendi.',
    });
    expect(keys(t.memory.search('elevenlabs'))).toEqual(['note:ElevenLabs', 'note:Haftalık özet']);
  });

  it('breaks a tie with the newer record first', () => {
    const t = make();
    t.memory.writeNote(t.ada.id, { title: 'Kota', text: 'Kota sınırı yüzde yüz.' });
    t.later();
    t.memory.writeNote(t.ada.id, { title: 'Kota', text: 'Kota sınırı yüzde yüz.' });
    const hits = t.memory.search('kota');
    expect(hits).toHaveLength(2);
    expect(hits[0]!.ts).toBeGreaterThan(hits[1]!.ts);
  });

  it('ranks a match in the title above one in the body', () => {
    const t = make();
    t.memory.writeNote(t.ada.id, { title: 'Sandbox', text: 'Araçlar kapalı bir ortamda çalışır.' });
    t.later();
    t.memory.writeNote(t.ada.id, { title: 'Araçlar', text: 'Kapalı ortam için sandbox denendi.' });
    expect(keys(t.memory.search('sandbox'))).toEqual(['note:Sandbox', 'note:Araçlar']);
  });

  it('when no record has every word, fills with records that have some, marked partial with how many matched; records with every word come first', () => {
    const t = make();
    t.memory.writeNote(t.ada.id, { title: 'Kapı ve bypassPermissions', text: 'Bash araçları kapıdan geçer.' });
    t.memory.recordDecision(t.coord.id, { title: 'Sandbox kararı', chosen: 'sandbox açık', reason: 'güvenlik' });
    t.memory.writeNote(t.ada.id, { title: 'Alakasız', text: 'Video kurgusu.' });
    const query = 'kapı bypassPermissions Bash sandbox';
    const partial = t.memory.search(query);
    expect(partial.map((h) => [h.title, h.partial, h.matched])).toEqual([
      ['Kapı ve bypassPermissions', true, 3],
      ['Sandbox kararı', true, 1],
    ]);
    t.later();
    t.memory.writeNote(t.ada.id, { title: 'Kapı', text: 'bypassPermissions ile Bash, sandbox içinde bile kapıdan geçer.' });
    const hits = t.memory.search(query);
    expect(hits.map((h) => [h.title, h.partial, h.matched])).toEqual([
      ['Kapı', undefined, undefined],
      ['Kapı ve bypassPermissions', true, 3],
      ['Sandbox kararı', true, 1],
    ]);
    // A record with every word fills the list alone: no partial ones are added once there are enough.
    expect(t.memory.search(query, { limit: 1 }).map((h) => h.title)).toEqual(['Kapı']);
  });

  it('counts a repeated word once, and a one-word query has no partial round', () => {
    const t = make();
    t.memory.writeNote(t.ada.id, { title: 'Ses', text: 'ses ses ses' });
    t.memory.writeNote(t.ada.id, { title: 'Video', text: 'kurgu' });
    expect(t.memory.search('ses ses video kurgu').map((h) => [h.title, h.matched])).toEqual([
      ['Video', 2],
      ['Ses', 1],
    ]);
    expect(t.memory.search('kurgu').map((h) => [h.title, h.partial])).toEqual([['Video', undefined]]);
  });

  it('folds Turkish letters and capitals in every kind: notes, decisions, the playbook, finished work and the profile', () => {
    const t = make();
    const text = 'İSTANBUL ofisi ılık; Türkçe destek.';
    t.memory.writeNote(t.ada.id, { title: 'Not', text });
    t.memory.recordDecision(t.coord.id, { title: 'Karar', chosen: text, reason: 'r' });
    t.memory.updatePlaybook(t.coord.id, { topic: 'El kitabı', text });
    t.finish('Teslim', text);
    t.company.profileUpdate(t.coord.id, { section: 'identity', fields: { summary: text }, assumed: false });
    for (const query of ['istanbul', 'ilik', 'turkce', 'TÜRKÇE', 'Ilık']) {
      expect(new Set(t.memory.search(query).map((h) => h.kind)), query).toEqual(new Set(['note', 'decision', 'playbook', 'task', 'profile']));
    }
  });
});

describe('memory search — what each writer puts in the index (B11)', () => {
  it('a playbook topic is one record, its newest version: an old version’s text is no longer found', () => {
    const t = make();
    t.memory.updatePlaybook(t.coord.id, { topic: 'Test yöntemi', text: 'Önce birim testi.' });
    t.memory.updatePlaybook(t.coord.id, { topic: 'Test yöntemi', text: 'Önce uçtan uca deneme.' });
    expect(keys(t.memory.search('test yöntemi'))).toEqual(['playbook:Test yöntemi']);
    expect(t.memory.search('uçtan uca')[0]).toMatchObject({ kind: 'playbook', id: 'Test yöntemi', snippet: 'Önce uçtan uca deneme.' });
    expect(t.memory.search('birim')).toEqual([]);
  });

  it('a hand-in is found by its summary and its proof, and what it taught only through the note', () => {
    const t = make();
    const task = t.finish('Kurulum', 'Ofis kuruldu.', { learned: 'pnpm dokuz gerekiyor.', done: ['Rapor yazıldı'], evidence: ['rapor.md diskte duruyor'] });
    expect(t.memory.search('kuruldu')).toMatchObject([{ kind: 'task', id: task.id, title: 'Kurulum' }]);
    expect(t.memory.search('diskte')).toMatchObject([{ kind: 'task', id: task.id }]);
    expect(keys(t.memory.search('pnpm dokuz'))).toEqual(['note:Öğrenilen: Kurulum']);
  });

  it('a reviewed hand-in and its review are both found, as finished work, as before', () => {
    const t = make();
    const bob = t.company.hire(t.coord.id, { name: 'Bob', role: 'r' });
    const task = t.company.createTask(t.coord.id, { assignee: t.ada.id, title: 'Logo', reviewer: bob.id });
    t.company.start(task.id);
    t.company.finish(t.ada.id, task.id, { summary: 'Logo çizildi, üç renk.', outputs: [], learned: '' });
    expect(t.memory.search('logo')).toEqual([]);
    const review = t.tasks.list({ assignee: bob.id, statuses: ['waiting'] })[0]!;
    t.company.reviewDecide(bob.id, review.id, { decision: 'approve', note: 'Logo renkleri marka rehberine uyuyor.' });
    expect(new Set(keys(t.memory.search('logo')))).toEqual(new Set(['task:Logo', `task:${review.title}`]));
  });

  it('a profile section is one record, updated in place; an assumed one is tagged', () => {
    const t = make();
    t.company.profileUpdate(t.coord.id, { section: 'identity', fields: { name: 'Tatlı Fırın', sector: 'fırıncılık' }, assumed: true });
    const first = t.memory.search('fırıncılık');
    expect(first).toMatchObject([{ kind: 'profile', id: 'identity', title: 'Kimlik' }]);
    expect(t.memory.search('varsayım', { kinds: ['profile'] })).toHaveLength(1);
    t.company.profileUpdate(t.coord.id, { section: 'identity', fields: { sector: 'pastane' }, assumed: false });
    expect(t.memory.search('fırıncılık')).toEqual([]);
    expect(t.memory.search('pastane tatlı')).toMatchObject([{ kind: 'profile', id: 'identity' }]);
  });
});

describe('memory search — options and the record of searches (B11)', () => {
  it('filters by kind and by time; refuses an empty query and a limit outside 1–30; reads at most 8 words', () => {
    const t = make();
    t.memory.writeNote(t.ada.id, { title: 'Ses notu', text: 'ses' });
    t.memory.recordDecision(t.coord.id, { title: 'Ses kararı', chosen: 'ses', reason: 'r' });
    t.later(10 * DAY);
    const since = t.now();
    t.memory.updatePlaybook(t.coord.id, { topic: 'Ses yöntemi', text: 'ses' });
    expect(keys(t.memory.search('ses', { kinds: ['decision'] }))).toEqual(['decision:Ses kararı']);
    expect(new Set(keys(t.memory.search('ses', { kinds: ['note', 'playbook'] })))).toEqual(new Set(['note:Ses notu', 'playbook:Ses yöntemi']));
    expect(keys(t.memory.search('ses', { since }))).toEqual(['playbook:Ses yöntemi']);
    expect(() => t.memory.search(' "*" ')).toThrow(/en az bir kelime/);
    for (const limit of [0, 31, 2.5]) expect(() => t.memory.search('ses', { limit })).toThrow(/limit/);
    expect(t.memory.search('bir iki üç dört beş altı yedi sekiz ses')).toEqual([]);
  });

  it('records one memory.searched event per search: the query, the hits, the round that found them and the time; nothing else', () => {
    const t = make();
    t.memory.writeNote(t.ada.id, { title: 'Kota', text: 'Kota yüzde elli.' });
    const before = t.events.list({ limit: 5000 }).length;
    t.memory.search('kota', { by: t.ada.id });
    t.memory.search('kota maliyet', { by: t.ada.id });
    t.memory.search('hiçbirşey');
    const added = t.events.list({ limit: 5000 }).slice(before);
    expect(added.map((e) => [e.employeeId, e.event])).toMatchObject([
      [t.ada.id, { type: 'memory.searched', query: 'kota', hits: 1, mode: 'and' }],
      [t.ada.id, { type: 'memory.searched', query: 'kota maliyet', hits: 1, mode: 'or' }],
      [null, { type: 'memory.searched', query: 'hiçbirşey', hits: 0, mode: 'none' }],
    ]);
    for (const e of added) expect((e.event as { ms: number }).ms).toBeGreaterThanOrEqual(0);
  });
});

/**
 * The search as it was before B11 (main 3069341, memory.ts `search`), kept here to compare: every word required,
 * four lists, newest first.
 */
function legacySearch(d: { notes: NoteStore; decisions: DecisionStore; playbook: PlaybookStore; tasks: TaskStore }, query: string, limit: number): MemoryHit[] {
  const ws = words(query);
  const matches = (haystack: string) => ws.every((w) => fold(haystack).includes(w));
  const hits: MemoryHit[] = d.notes.search(query, limit).map(({ note, snippet }) => ({ kind: 'note', id: String(note.id), title: note.title, snippet, ts: note.ts }));
  for (const x of d.decisions.list({ limit: 500 })) {
    const body = `${x.chosen}. ${x.reason}${x.alternatives.length ? ` (alternatifler: ${x.alternatives.join(', ')})` : ''}`;
    if (matches(`${x.title} ${body}`)) hits.push({ kind: 'decision', id: x.id, title: x.title, snippet: snippetOf(body, ws), ts: x.ts });
  }
  for (const p of d.playbook.topics()) if (matches(`${p.topic} ${p.text}`)) hits.push({ kind: 'playbook', id: p.topic, title: p.topic, snippet: snippetOf(p.text, ws), ts: p.ts });
  for (const t of d.tasks.list({ statuses: ['done'], limit: 100_000 })) {
    if (!t.result) continue;
    const body = `${t.result.summary} ${t.result.learned}`.trim();
    if (matches(`${t.title} ${body}`)) hits.push({ kind: 'task', id: t.id, title: t.title, snippet: snippetOf(body, ws), ts: t.finishedAt ?? t.createdAt });
  }
  return hits.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

describe('memory search — today’s calls get the same kind of answer (B11)', () => {
  it('finds every record the old search found, as the same kind, id, title and time, with the same snippet for notes, decisions and the playbook', () => {
    const t = make();
    const made: Array<Note | Decision | PlaybookEntry | Task> = [];
    made.push(t.memory.writeNote(t.ada.id, { title: 'Seslendirme', text: 'ElevenLabs Türkçe sesleri iyi; aylık abonelik.', tags: ['ses', 'video'] }));
    t.later(60_000);
    made.push(t.memory.recordDecision(t.coord.id, { title: 'Ses aracı seçimi', chosen: 'ElevenLabs', reason: 'Türkçe sesler doğal.', alternatives: ['Polly', 'Azure'] }));
    t.later(60_000);
    made.push(t.memory.updatePlaybook(t.coord.id, { topic: 'Video üretimi', text: 'Senaryo, ses (ElevenLabs), kurgu; her adımda inceleme.' }));
    t.later(60_000);
    made.push(t.finish('Ses denemesi', 'ElevenLabs ile üç ses denendi; Türkçe en iyisi.', { learned: 'Ses dosyaları 44.1 kHz olmalı.' }));
    t.later(60_000);
    made.push(t.memory.writeNote(t.ada.id, { title: 'Kota', text: 'Kota yüzde elliye geldi; inceleme turları pahalı.' }));
    t.later(60_000);
    made.push(t.finish('Kota raporu', 'Kota haftalık yüzde elli; en çok inceleme harcıyor.'));
    expect(made).toHaveLength(6);
    const stores = { notes: new NoteStore(t.db), decisions: new DecisionStore(t.db), playbook: new PlaybookStore(t.db), tasks: t.tasks };
    for (const query of ['elevenlabs', 'türkçe', 'ses', 'kota', 'inceleme', 'kota inceleme', 'video', 'Polly', 'abonelik', 'senaryo kurgu', 'ses denemesi']) {
      const before = legacySearch(stores, query, 30);
      const now = t.memory.search(query, { limit: 30 });
      const full = now.filter((h) => !h.partial);
      const key = (h: MemoryHit) => `${h.kind}:${h.id}`;
      expect(new Set(full.map(key)), query).toEqual(new Set(before.map(key)));
      for (const old of before) {
        const hit = full.find((h) => key(h) === key(old))!;
        expect({ title: hit.title, ts: hit.ts }, query).toEqual({ title: old.title, ts: old.ts });
        if (old.kind !== 'task') expect(hit.snippet, query).toBe(old.snippet);
      }
      // The records with every word come first, and nothing is lost to the partial ones.
      expect(now.slice(0, full.length)).toEqual(full);
    }
  });
});
