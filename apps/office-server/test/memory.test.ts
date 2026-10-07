import { existsSync, readFileSync } from 'node:fs';
import { METHOD, PLANS_ONLY } from './company-helpers.ts';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type StoredEvent } from '@cc/shared';
import { Company } from '../src/company/company.ts';
import { Memory } from '../src/company/memory.ts';
import { DecisionStore, EmployeeNoteStore, NoteStore, PlaybookStore } from '../src/company/memory-store.ts';
import { NoticeStore, PlanStore, TaskStore } from '../src/company/store.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make() {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const tasks = new TaskStore(s.db);
  const plans = new PlanStore(s.db);
  const notices = new NoticeStore(s.db);
  const memory = new Memory({
    roster: s.roster, events: s.events, notices, tasks, plans, dataDir: s.dataDir,
    decisions: new DecisionStore(s.db), playbook: new PlaybookStore(s.db), notes: new NoteStore(s.db), employeeNotes: new EmployeeNoteStore(s.db),
  });
  const company = new Company({ constitution: PLANS_ONLY, roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => f.engine.hire(i), characters: () => ['coder'] });
  const c = company.hireCoordinator();
  const ada = company.hire(c.id, { name: 'Ada', role: 'r' });
  return { ...s, tasks, plans, notices, memory, company, c, ada };
}

const ofType = (events: StoredEvent[], type: string) => events.filter((e) => e.event.type === type);

describe('Memory — decisions', () => {
  it('records the coordinator’s and leads’ decisions, refuses members, and filters by words and plan', () => {
    const t = make();
    const plan = t.company.propose(t.c.id, { method: METHOD, title: 'Video', goal: 'g', approach: 'a' });
    const d = t.memory.recordDecision(t.c.id, { title: 'Ses aracı', chosen: 'ElevenLabs', reason: 'Türkçe sesleri iyi', alternatives: ['Polly'], planId: plan.id });
    expect(d).toMatchObject({ by: t.c.id, alternatives: ['Polly'], planId: plan.id, reverts: null });
    expect(ofType(t.events.list({ limit: 500 }), 'decision.recorded')).toHaveLength(1);
    expect(() => t.memory.recordDecision(t.ada.id, { title: 'x', chosen: 'y', reason: 'z' })).toThrow(/koordinatör ya da ekip lideri/);
    t.roster.update(t.ada.id, { kind: 'lead' });
    t.memory.recordDecision(t.ada.id, { title: 'Kurgu', chosen: 'CapCut', reason: 'hızlı' });
    expect(t.memory.decisions({ query: 'turkce' }).map((x) => x.title)).toEqual(['Ses aracı']);
    expect(t.memory.decisions({ planId: plan.id })).toHaveLength(1);
    expect(t.memory.decisions().map((x) => x.title)).toEqual(['Kurgu', 'Ses aracı']);
    expect(() => t.memory.recordDecision(t.c.id, { title: 'x', chosen: 'y', reason: 'z', planId: 'nope' })).toThrow(/Plan bulunamadı/);
  });

  it('review focus: the owner reverts a decision once; the coordinator is told; a revert cannot be reverted', () => {
    const t = make();
    const d = t.memory.recordDecision(t.c.id, { title: 'Ses aracı', chosen: 'ElevenLabs', reason: 'iyi' });
    const r = t.memory.revertDecision(d.id);
    expect(r).toMatchObject({ by: OWNER, reverts: d.id });
    expect(t.notices.pending(t.c.id).at(-1)?.text).toContain('Ses aracı');
    expect(() => t.memory.revertDecision(d.id)).toThrow(/zaten geri alındı/);
    expect(() => t.memory.revertDecision(r.id)).toThrow(/geri alma; geri alınamaz/);
    expect(t.memory.decisions()).toHaveLength(2);
  });
});

describe('Memory — playbook', () => {
  it('versions a topic, writes its file, matches topic names loosely and lists topics when one is missing', () => {
    const t = make();
    expect(() => t.memory.playbookTopic('Test')).toThrow(/Henüz hiç konu yazılmadı/);
    t.memory.updatePlaybook(t.c.id, { topic: 'Test prosedürü', text: 'Önce birim testleri.', reason: 'ilk' });
    const second = t.memory.updatePlaybook(t.c.id, { topic: 'test PROSEDÜRÜ', text: 'Birim, sonra uçtan uca.', reason: 'e2e eklendi' });
    expect(second).toMatchObject({ topic: 'Test prosedürü', version: 2 });
    expect(t.memory.playbookTopic('TEST prosedürü').text).toBe('Birim, sonra uçtan uca.');
    expect(t.memory.playbookHistory('test prosedürü').map((p) => p.version)).toEqual([2, 1]);
    const file = join(t.dataDir, 'company', 'playbook', 'test-proseduru.md');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('uçtan uca');
    expect(() => t.memory.playbookTopic('Sürüm')).toThrow(/Konular: Test prosedürü/);
    expect(() => t.memory.updatePlaybook(t.ada.id, { topic: 'x', text: 'y' })).toThrow(/koordinatör ya da ekip lideri/);
    expect(ofType(t.events.list({ limit: 500 }), 'playbook.updated')).toHaveLength(2);
  });
});

describe('Memory — notes and search', () => {
  it('anyone writes notes; search finds notes, decisions, playbook topics and finished work, newest first', () => {
    const t = make();
    t.memory.writeNote(t.ada.id, { title: 'Seslendirme', text: 'ElevenLabs Türkçe sesleri iyi.', tags: ['Video', 'ses'] });
    t.memory.recordDecision(t.c.id, { title: 'Ses aracı seçimi', chosen: 'ElevenLabs', reason: 'Türkçe' });
    t.memory.updatePlaybook(t.c.id, { topic: 'Video üretimi', text: 'Ses için ElevenLabs kullan.' });
    const task = t.company.createTask(t.c.id, { assignee: t.ada.id, title: 'Ses denemesi' });
    t.company.start(task.id);
    t.company.finish(t.ada.id, task.id, { summary: 'ElevenLabs ile 3 ses denendi.', outputs: [], learned: '' });
    const hits = t.memory.search('elevenlabs');
    expect(hits.map((h) => h.kind).sort()).toEqual(['decision', 'note', 'playbook', 'task']);
    expect([...hits].sort((a, b) => b.ts - a.ts)).toEqual(hits);
    expect(t.memory.notes('türkçe')[0]?.note.tags).toEqual(['video', 'ses']);
    expect(t.memory.notes()).toHaveLength(1);
    expect(() => t.memory.search(' "*" ')).toThrow(/en az bir kelime/);
    expect(ofType(t.events.list({ limit: 500 }), 'note.written')).toHaveLength(1);
  });

  it('turns what a hand-in taught into a note, and nothing when it taught nothing', () => {
    const t = make();
    const task = t.company.createTask(t.c.id, { assignee: t.ada.id, title: 'Kurulum' });
    const note = t.memory.learnedFrom(task, { summary: 's', outputs: [], learned: 'pnpm 9 gerekiyor.' });
    expect(note).toMatchObject({ by: t.ada.id, title: 'Öğrenilen: Kurulum', text: 'pnpm 9 gerekiyor.', source: `task:${task.id}` });
    expect(t.memory.learnedFrom(task, { summary: 's', outputs: [], learned: '  ' })).toBeNull();
  });
});

describe('Memory — employee files', () => {
  it('keeps the coordinator’s notes and the track record of each employee, also after they leave', async () => {
    const t = make();
    t.memory.addEmployeeNote(t.c.id, t.ada.id, 'Testte çok iyi.');
    expect(() => t.memory.addEmployeeNote(t.ada.id, t.ada.id, 'x')).toThrow(/Yalnız koordinatör/);
    for (const title of ['bir', 'iki']) {
      const task = t.company.createTask(t.c.id, { assignee: t.ada.id, title });
      t.company.start(task.id);
      t.company.finish(t.ada.id, task.id, { summary: `${title} bitti`, outputs: [], learned: '' });
    }
    t.roster.update(t.ada.id, { lifecycle: 'archived' });
    const file = t.memory.employeeFile(t.ada.id);
    expect(file.notes.map((n) => n.text)).toEqual(['Testte çok iyi.']);
    expect(file.finished).toBe(2);
    expect(file.recent.map((r) => r.title)).toEqual(['iki', 'bir']);
    expect(file.employee.lifecycle).toBe('archived');
  });
});
