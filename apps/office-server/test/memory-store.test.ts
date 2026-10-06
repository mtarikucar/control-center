import { describe, expect, it } from 'vitest';
import { migrateUp, openDb } from '../src/db.ts';
import { DecisionStore, EmployeeNoteStore, NoteStore, PlaybookStore, ftsQuery } from '../src/company/memory-store.ts';

function stores() {
  const db = openDb(':memory:');
  migrateUp(db);
  let t = 1_000;
  const now = () => (t += 1);
  return { decisions: new DecisionStore(db, now), playbook: new PlaybookStore(db, now), notes: new NoteStore(db, now), employeeNotes: new EmployeeNoteStore(db, now) };
}

describe('DecisionStore', () => {
  it('records decisions newest first and finds the record that reverts one', () => {
    const { decisions } = stores();
    const a = decisions.create({ by: 'c', title: 'Ses aracı', chosen: 'ElevenLabs', reason: 'Türkçe iyi', alternatives: ['Polly', 'kendi sesimiz'], planId: 'p1', reverts: null });
    const b = decisions.create({ by: 'c', title: 'Kurgu', chosen: 'CapCut', reason: 'hızlı', alternatives: [], planId: null, reverts: null });
    expect(decisions.get(a.id)).toEqual(a);
    expect(decisions.list().map((d) => d.id)).toEqual([b.id, a.id]);
    expect(decisions.list({ planId: 'p1' }).map((d) => d.id)).toEqual([a.id]);
    expect(decisions.revertOf(a.id)).toBeNull();
    const r = decisions.create({ by: 'owner', title: 'Geri alındı: Ses aracı', chosen: 'Geri alındı', reason: 'x', alternatives: [], planId: 'p1', reverts: a.id });
    expect(decisions.revertOf(a.id)?.id).toBe(r.id);
    expect(() => decisions.get('nope')).toThrow(/Karar bulunamadı/);
  });
});

describe('PlaybookStore', () => {
  it('versions each topic and lists the newest version of every topic', () => {
    const { playbook } = stores();
    expect(playbook.write({ topic: 'Test', text: 'birim', by: 'c', reason: 'ilk' }).version).toBe(1);
    expect(playbook.write({ topic: 'Test', text: 'birim + uçtan uca', by: 'c', reason: 'e2e eklendi' }).version).toBe(2);
    playbook.write({ topic: 'Sürüm', text: 'etiketle', by: 'c', reason: '' });
    expect(playbook.latest('Test')).toMatchObject({ version: 2, text: 'birim + uçtan uca' });
    expect(playbook.latest('Yok')).toBeNull();
    expect(playbook.topics().map((p) => [p.topic, p.version])).toEqual([['Sürüm', 1], ['Test', 2]]);
    expect(playbook.history('Test').map((p) => p.version)).toEqual([2, 1]);
  });
});

describe('NoteStore', () => {
  it('finds notes by any word, prefix and Turkish letters folded, best match first', () => {
    const { notes } = stores();
    const a = notes.create({ by: 'e1', title: 'Seslendirme aracı', text: 'ElevenLabs Türkçe sesleri iyi; ücretli plan gerekiyor.', tags: ['video'], source: null });
    notes.create({ by: 'e2', title: 'Test prosedürü', text: 'Önce birim testleri, sonra uçtan uca.', tags: [], source: 'task:t1' });
    expect(notes.search('turkce').map((h) => h.note.id)).toEqual([a.id]);
    expect(notes.search('seslendir').map((h) => h.note.id)).toEqual([a.id]);
    expect(notes.search('ÜCRETLİ plan')[0]?.snippet).toContain('ücretli');
    expect(notes.search('test uçtan')).toHaveLength(1);
    expect(notes.search('video')).toHaveLength(1);
    expect(notes.list().map((n) => n.title)).toEqual(['Test prosedürü', 'Seslendirme aracı']);
    expect(notes.list()[0]).toMatchObject({ tags: [], source: 'task:t1' });
  });

  it('important: finds Turkish words typed without ı/ş or in capitals, and shows the original text', () => {
    const { notes } = stores();
    notes.create({ by: 'e1', title: 'Yazılım', text: 'kullanıcı satış tasarım ışık', tags: ['Arayüz'], source: null });
    for (const q of ['yazilim', 'YAZILIM', 'kullanici', 'KULLANICI', 'satis', 'SATIŞ', 'tasarim', 'isik', 'ışık', 'arayuz']) expect(notes.search(q), q).toHaveLength(1);
    expect(notes.search('kullanici')[0]?.snippet).toContain('kullanıcı');
  });

  it('review focus: FTS syntax in a query is searched as words, never an SQL error', () => {
    const { notes } = stores();
    notes.create({ by: 'e1', title: 'NEAR plan', text: 'a "quoted" word', tags: [], source: null });
    for (const q of ['"', '*', '-plan', 'NEAR(', 'title:plan', '(plan) OR', 'a"b', '***']) expect(() => notes.search(q)).not.toThrow();
    expect(notes.search('(plan)')).toHaveLength(1);
    expect(notes.search('(plan) OR')).toEqual([]);
    expect(notes.search('*')).toEqual([]);
    expect(ftsQuery('  ')).toBeNull();
    expect(ftsQuery('ses ARACI')).toBe('"ses"* "araci"*');
  });
});

describe('EmployeeNoteStore', () => {
  it('keeps notes per employee, oldest first', () => {
    const { employeeNotes } = stores();
    employeeNotes.add({ employeeId: 'e1', by: 'c', text: 'Testte çok iyi.' });
    employeeNotes.add({ employeeId: 'e2', by: 'c', text: 'başka' });
    employeeNotes.add({ employeeId: 'e1', by: 'c', text: 'Belgeleri aceleye getiriyor.' });
    expect(employeeNotes.list('e1').map((n) => n.text)).toEqual(['Testte çok iyi.', 'Belgeleri aceleye getiriyor.']);
  });
});
