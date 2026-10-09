import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { MemoryKind } from '@cc/shared';
import { CompanyStateStore } from '../src/company/goal-store.ts';
import { DecisionStore, NoteStore, PlaybookStore } from '../src/company/memory-store.ts';
import { ProfileStore } from '../src/company/profile-store.ts';
import { KIND_WEIGHT, SEARCH_VERSION, SearchIndex, type SearchDoc } from '../src/company/search.ts';
import { PlanStore, TaskStore } from '../src/company/store.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make() {
  const s = setup();
  cleanups.push(s.cleanup);
  return { ...s, index: new SearchIndex(s.db), state: new CompanyStateStore(s.db) };
}

const count = (t: ReturnType<typeof make>) => (t.db.prepare('SELECT COUNT(*) AS n FROM search_index').get() as { n: number }).n;
const doc = (kind: MemoryKind, ref: string, o: Partial<SearchDoc> = {}): SearchDoc => ({ kind, ref, title: 'Ses aracı', body: 'ElevenLabs Türkçe', tags: [], ts: 1000, ...o });

describe('SearchIndex (B11)', () => {
  it('rebuilds from the source tables written before it: every note and decision, each topic’s newest version, finished work with a result, each profile section', () => {
    const t = make();
    // Written by stores with no index, as in an office from before v21.
    const notes = new NoteStore(t.db);
    const decisions = new DecisionStore(t.db);
    const playbook = new PlaybookStore(t.db);
    const tasks = new TaskStore(t.db);
    const profile = new ProfileStore(t.db);
    const plan = new PlanStore(t.db).create({ title: 'Çekirdek 4', goal: 'g', approach: 'a', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '', proposedBy: 'c' });
    notes.create({ by: 'a', title: 'Not bir', text: 'kota', tags: [], source: null });
    notes.create({ by: 'a', title: 'Not iki', text: 'kota', tags: ['x'], source: null });
    decisions.create({ by: 'c', title: 'Karar', chosen: 'kota', reason: 'r', alternatives: [], planId: null, reverts: null });
    playbook.write({ topic: 'Test', text: 'eski kota', by: 'c', reason: '' });
    playbook.write({ topic: 'Test', text: 'yeni kota', by: 'c', reason: '' });
    playbook.write({ topic: 'Yayın', text: 'kota', by: 'c', reason: '' });
    const base = { description: '', done: [], requester: 'c', assignee: 'a', priority: 3, dependsOn: [], chainDepth: 0 };
    const done = tasks.create({ ...base, planId: plan.id, title: 'Biten' });
    tasks.update(done.id, { status: 'done', finishedAt: 5000, result: { summary: 'kota raporu', outputs: [], learned: '' } });
    tasks.create({ ...base, planId: null, title: 'Açık' });
    const empty = tasks.create({ ...base, planId: null, title: 'Sonuçsuz' });
    tasks.update(empty.id, { status: 'done', finishedAt: 5000 });
    const cancelled = tasks.create({ ...base, planId: null, title: 'İptal' });
    tasks.update(cancelled.id, { status: 'cancelled', finishedAt: 5000 });
    profile.write('identity', { name: 'Fırın' }, [], 'c');
    profile.write('identity', { name: 'Fırın', sector: 'kota' }, ['sector'], 'c');
    profile.write('offer', { products: ['ekmek'] }, [], 'c');

    expect(count(t)).toBe(0);
    expect(t.index.rebuildIfStale()).toBe(true);
    // 2 notes + 1 decision + 2 topics + 1 finished task with a result + 2 profile sections.
    expect(count(t)).toBe(8);
    expect(t.state.get('search.version')).toBe(String(SEARCH_VERSION));
    expect(t.index.rebuildIfStale()).toBe(false);
    const { hits } = t.index.search('kota', { limit: 30 });
    expect(new Set(hits.map((h) => `${h.kind}:${h.title}`))).toEqual(
      new Set(['note:Not bir', 'note:Not iki', 'decision:Karar', 'playbook:Test', 'playbook:Yayın', 'task:Biten', 'profile:Kimlik']),
    );
    expect(t.index.search('eski', { limit: 30 }).hits).toEqual([]);
    // The plan's title is a tag of its finished work.
    expect(t.index.search('çekirdek', { limit: 30 }).hits.map((h) => h.title)).toEqual(['Biten']);

    // An older index version, or an emptied index, is rebuilt on the next start.
    t.state.set('search.version', String(SEARCH_VERSION - 1));
    expect(t.index.rebuildIfStale()).toBe(true);
    expect(count(t)).toBe(8);
    t.db.exec('DELETE FROM search_index');
    expect(t.index.rebuildIfStale()).toBe(true);
    expect(count(t)).toBe(8);
    expect(t.index.search('kota', { limit: 30 }).hits).toHaveLength(7);
  });

  it('ranks the same text by kind: the playbook, then decisions, then notes and the profile (newer first), then finished work', () => {
    const t = make();
    t.index.upsert(doc('task', 't'));
    t.index.upsert(doc('note', 'n'));
    t.index.upsert(doc('profile', 'p', { ts: 2000 }));
    t.index.upsert(doc('decision', 'd'));
    t.index.upsert(doc('playbook', 'b'));
    expect(t.index.search('elevenlabs', { limit: 10 }).hits.map((h) => h.kind)).toEqual(['playbook', 'decision', 'profile', 'note', 'task']);
    expect(KIND_WEIGHT).toEqual({ playbook: 0.8, decision: 0.85, note: 1, profile: 1, task: 1.1 });
  });

  it('replaces a record in place, and drops finished work that is cancelled or no longer done', () => {
    const t = make();
    t.index.upsert(doc('note', '1', { body: 'eski metin' }));
    t.index.upsert(doc('note', '1', { body: 'yeni metin' }));
    expect(count(t)).toBe(1);
    expect(t.index.search('eski', { limit: 10 }).hits).toEqual([]);
    expect(t.index.search('yeni', { limit: 10 }).hits).toHaveLength(1);
    t.index.remove('note', '1');
    expect(count(t)).toBe(0);

    const tasks = new TaskStore(t.db, Date.now, t.index);
    const base = { planId: null, description: '', done: [], requester: 'c', assignee: 'a', priority: 3, dependsOn: [], chainDepth: 0 };
    const a = tasks.create({ ...base, title: 'Rapor' });
    expect(t.index.search('rapor', { limit: 10 }).hits).toEqual([]);
    tasks.update(a.id, { status: 'done', finishedAt: 5000, result: { summary: 'bitti', outputs: [], learned: '' } });
    expect(t.index.search('rapor', { limit: 10 }).hits).toMatchObject([{ kind: 'task', id: a.id, ts: 5000 }]);
    tasks.update(a.id, { status: 'cancelled' });
    expect(t.index.search('rapor', { limit: 10 }).hits).toEqual([]);
    tasks.update(a.id, { status: 'done' });
    expect(t.index.search('rapor', { limit: 10 }).hits).toHaveLength(1);
    tasks.update(a.id, { status: 'waiting' });
    expect(count(t)).toBe(0);
  });

  // 10,000 notes and 2,000 finished tasks. Words are drawn from a 2,000-word vocabulary, the first ones far more often
  // (as in real text); `worst` puts the query's words in every record, so the partial round ranks all 12,000.
  const corpus = (worst: boolean) => {
    const t = make();
    let seed = 7;
    const random = () => (seed = (seed * 16_807) % 2_147_483_647) / 2_147_483_647;
    const word = () => (worst && random() < 0.2 ? ['kota', 'inceleme', 'göç'][Math.floor(random() * 3)] : `k${String(Math.floor(random() ** 2 * 2000)).padStart(4, '0')}`);
    const text = (n: number) => Array.from({ length: n }, word).join(' ');
    t.db.exec('BEGIN');
    for (let i = 0; i < 10_000; i++) t.index.upsert({ kind: 'note', ref: String(i), title: text(4), body: text(60), tags: [], ts: i });
    for (let i = 0; i < 2_000; i++) t.index.upsert({ kind: 'task', ref: `t${i}`, title: text(5), body: text(120), tags: ['teslim'], ts: i });
    t.db.exec('COMMIT');
    return t;
  };
  // The CPU time the search takes (ms), median of five: the suite runs files side by side on a machine that may be busy,
  // which stretches wall time without the search doing more work.
  const median = (t: ReturnType<typeof make>, query: string) => {
    const times: number[] = [];
    for (let run = 0; run < 5; run++) {
      const start = process.cpuUsage();
      expect(t.index.search(query, { limit: 10 }).hits).toHaveLength(10);
      const used = process.cpuUsage(start);
      times.push((used.user + used.system) / 1000);
    }
    return times.sort((a, b) => a - b)[2]!;
  };

  // Building a corpus (12,000 upserts) is the slow part, not the search: it goes in each block's beforeAll under its own
  // wide limit, so a busy machine cannot push the test past the suite's 15 s (task 9802762c). The search's budget is
  // still 50 / 200 ms of CPU time, median of five. Each corpus is closed after its own block, not by the afterEach above.
  const CORPUS_TIMEOUT_MS = 60_000;
  const built = (worst: boolean) => {
    const own: Array<() => unknown> = [];
    let t: ReturnType<typeof make> | null = null;
    beforeAll(() => {
      t = corpus(worst);
      own.push(...cleanups.splice(0));
    }, CORPUS_TIMEOUT_MS);
    afterAll(async () => {
      for (const c of own.splice(0)) await c();
    });
    return () => t!;
  };

  describe('over 10,000 notes and 2,000 finished tasks', () => {
    const t = built(false);
    it('answers a five-word query in under 50 ms', () => {
      expect(median(t(), 'k0003 k0040 k0700 yokkelime başkayok')).toBeLessThan(50);
    });
  });

  describe('when every record has the query’s words', () => {
    const t = built(true);
    it('answers it in under 200 ms', () => {
      expect(median(t(), 'kota inceleme göç yokkelime başkayok')).toBeLessThan(200);
    });
  });
});
