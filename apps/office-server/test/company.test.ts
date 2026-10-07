import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type StoredEvent } from '@cc/shared';
import { Company, LIMITS } from '../src/company/company.ts';
import { NoticeStore, PlanStore, TaskStore } from '../src/company/store.ts';
import { deskDir } from '../src/desk.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make(characters: string[] = ['coder', 'designer']) {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const tasks = new TaskStore(s.db);
  const plans = new PlanStore(s.db);
  const notices = new NoticeStore(s.db);
  const reloaded: string[] = [];
  const company = new Company({ roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => f.engine.hire(i), characters: () => characters, reload: (id) => void reloaded.push(id) });
  return { ...s, engine: f.engine, tasks, plans, notices, company, reloaded };
}

const ofType = (events: StoredEvent[], type: string) => events.filter((e) => e.event.type === type);

describe('Company — people', () => {
  it('hires a coordinator once, on Fable, with the coordinator card', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    expect(c).toMatchObject({ kind: 'coordinator', model: 'fable', name: 'Koordinatör' });
    expect(t.company.coordinator()?.id).toBe(c.id);
    expect(readFileSync(join(deskDir(t.dataDir, c.slug), 'office-guide.md'), 'utf8')).toContain('planPropose');
    expect(() => t.company.hireCoordinator()).toThrow(/zaten bir koordinatör/);
  });

  it('makes an employee coordinator and the previous one a member, rewriting both cards', () => {
    const t = make();
    const old = t.company.hireCoordinator();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const next = t.company.appointCoordinator(ada.id);
    expect(next.kind).toBe('coordinator');
    expect(t.roster.get(old.id).kind).toBe('member');
    expect(readFileSync(join(deskDir(t.dataDir, ada.slug), 'office-guide.md'), 'utf8')).toContain('planPropose');
    // one from hiring the coordinator, two from the appointment (demoted + promoted)
    expect(ofType(t.events.list({ limit: 500 }), 'role.changed')).toHaveLength(3);
  });

  it('hires members only, and picks the least used character when none or an unknown one is given', () => {
    const t = make(['coder', 'designer']);
    const c = t.company.hireCoordinator();
    const a = t.company.hire(c.id, { name: 'Ada', role: 'r', kind: 'coordinator', characterId: 'coder' });
    const b = t.company.hire(c.id, { name: 'Can', role: 'r' });
    const d = t.company.hire(c.id, { name: 'Ece', role: 'r', characterId: 'no-such-model' });
    expect(a.kind).toBe('member');
    expect(b.characterId).toBe('designer');
    expect(['coder', 'designer']).toContain(d.characterId);
    expect(c.characterId).toBe('coder');
  });

  it('lets the coordinator rewrite a role card and announces it', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'eski' });
    const next = t.company.editRoleCard(c.id, ada.id, { title: 'Testçi', team: 'Kalite', role: 'Testleri yazar.' });
    expect(next).toMatchObject({ title: 'Testçi', team: 'Kalite', role: 'Testleri yazar.' });
    expect(readFileSync(join(deskDir(t.dataDir, ada.slug), 'CLAUDE.md'), 'utf8')).toContain('Testleri yazar.');
    expect(() => t.company.editRoleCard(ada.id, c.id, { role: 'x' })).toThrow(/Yalnız koordinatör/);
  });
});

describe('Company — tasks', () => {
  it('creates a task that waits in the assignee queue and is announced', () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'README yaz', done: ['README.md var'] });
    expect(task).toMatchObject({ status: 'waiting', requester: OWNER, priority: 3, chainDepth: 0 });
    const ev = ofType(t.events.list({ limit: 500 }), 'task.changed').at(-1)!;
    expect(ev.employeeId).toBe(ada.id);
    expect(ev.event).toMatchObject({ change: 'created', task: { id: task.id } });
  });

  it('refuses an unknown assignee, an empty title and a priority outside 1–5', () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    expect(() => t.company.createTask(OWNER, { assignee: 'nobody', title: 'x' })).toThrow(/bulunamadı/);
    expect(() => t.company.createTask(OWNER, { assignee: ada.id, title: '  ' })).toThrow(/Başlık/);
    expect(() => t.company.createTask(OWNER, { assignee: ada.id, title: 'x', priority: 9 })).toThrow(/Öncelik/);
  });

  it('review focus: a pass chain deeper than the limit is refused and the coordinator is told', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const [a, b] = [t.company.hire(c.id, { name: 'Ada', role: 'r' }), t.company.hire(c.id, { name: 'Can', role: 'r' })];
    let holder = a;
    let other = b;
    let current = t.company.createTask(OWNER, { assignee: a.id, title: 'kök' });
    t.company.start(current.id);
    for (let depth = 1; depth <= LIMITS.chainDepth; depth += 1) {
      current = t.company.createTask(holder.id, { assignee: other.id, title: `pas ${depth}` });
      expect(current.chainDepth).toBe(depth);
      t.company.start(current.id);
      [holder, other] = [other, holder];
    }
    expect(() => t.company.createTask(holder.id, { assignee: other.id, title: 'bir fazla' })).toThrow(/zincir/);
    expect(t.notices.pending(c.id).some((n) => n.text.includes('zincir'))).toBe(true);
  });

  it('review focus: more than the daily limit from one employee is refused', () => {
    const t = make();
    const [a, b] = [t.company.hire(OWNER, { name: 'Ada', role: 'r' }), t.company.hire(OWNER, { name: 'Can', role: 'r' })];
    for (let i = 0; i < LIMITS.perDay; i += 1) t.company.createTask(a.id, { assignee: b.id, title: `iş ${i}` });
    expect(() => t.company.createTask(a.id, { assignee: b.id, title: 'bir fazla' })).toThrow(/günde/);
  });

  it('starts, blocks and finishes; only the assignee or the coordinator hands it in; requester and coordinator hear', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const [a, b] = [t.company.hire(c.id, { name: 'Ada', role: 'r' }), t.company.hire(c.id, { name: 'Can', role: 'r' })];
    const task = t.company.createTask(a.id, { assignee: b.id, title: 'çevir' });
    expect(t.company.start(task.id)).toMatchObject({ status: 'in_progress' });
    expect(t.company.update(b.id, task.id, { blocked: true, note: 'dosya yok' })).toMatchObject({ status: 'blocked', note: 'dosya yok' });
    expect(t.notices.pending(c.id).at(-1)?.text).toContain('takıldı');
    expect(t.company.update(b.id, task.id, { blocked: false })).toMatchObject({ status: 'in_progress' });
    expect(() => t.company.finish(a.id, task.id, { summary: 's', outputs: [], learned: '' })).toThrow(/Yalnız/);
    const done = t.company.finish(b.id, task.id, { summary: 'çevrildi', outputs: ['tr.md'], learned: '' });
    expect(done).toMatchObject({ status: 'done', result: { summary: 'çevrildi' } });
    expect(t.notices.pending(a.id).at(-1)?.text).toContain('çevrildi');
    expect(t.notices.pending(c.id).at(-1)?.text).toContain('çevrildi');
  });

  it('assigns and reprioritises waiting tasks only, and only for the coordinator', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const [a, b] = [t.company.hire(c.id, { name: 'Ada', role: 'r' }), t.company.hire(c.id, { name: 'Can', role: 'r' })];
    const task = t.company.createTask(c.id, { assignee: a.id, title: 'x' });
    expect(t.company.assign(c.id, task.id, b.id).assignee).toBe(b.id);
    expect(t.company.reprioritize(c.id, task.id, 1).priority).toBe(1);
    expect(() => t.company.assign(a.id, task.id, a.id)).toThrow(/Yalnız koordinatör/);
    t.company.start(task.id);
    expect(() => t.company.assign(c.id, task.id, a.id)).toThrow(/sürüyor/);
  });
});

describe('Company — plans', () => {
  it('proposes a draft, revises it to a new version, and the owner approves it; the coordinator hears', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const plan = t.company.propose(c.id, { title: 'Tanıtım videosu', goal: 'g', approach: 'a', steps: ['senaryo', 'çekim'], usd: 20 });
    expect(plan).toMatchObject({ status: 'draft', version: 1, steps: ['senaryo', 'çekim'], usd: 20, proposedBy: c.id });
    const revised = t.company.revise(c.id, plan.id, { usd: 35, risks: 'kota' });
    expect(revised).toMatchObject({ version: 2, usd: 35, risks: 'kota', status: 'draft' });
    const approved = t.company.approve(plan.id);
    expect(approved.status).toBe('approved');
    expect(t.notices.pending(c.id).at(-1)?.text).toContain('onaylandı');
    const changes = ofType(t.events.list({ limit: 500 }), 'plan.changed').map((e) => (e.event as { change: string }).change);
    expect(changes).toEqual(['proposed', 'revised', 'approved']);
  });

  it('review focus: a second approval, declining an approved plan and tasks for a draft plan fail clearly', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const plan = t.company.propose(c.id, { title: 'P', goal: 'g', approach: 'a' });
    expect(() => t.company.createTask(c.id, { assignee: c.id, title: 'x', planId: plan.id })).toThrow(/onaylanmadı/);
    t.company.approve(plan.id);
    expect(() => t.company.approve(plan.id)).toThrow(/taslak/);
    expect(() => t.company.decline(plan.id)).toThrow(/taslak/);
  });

  it('a revision of an approved plan goes back to draft and needs approval again', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const plan = t.company.propose(c.id, { title: 'P', goal: 'g', approach: 'a' });
    t.company.approve(plan.id);
    expect(t.company.revise(c.id, plan.id, { days: 9 })).toMatchObject({ status: 'draft', version: 2 });
  });

  it('marks a plan done when its last open task is handed in, and tells the coordinator to report', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    const plan = t.company.propose(c.id, { title: 'P', goal: 'g', approach: 'a' });
    t.company.approve(plan.id);
    const task = t.company.createTask(c.id, { assignee: ada.id, title: 'tek iş', planId: plan.id });
    t.company.start(task.id);
    t.company.finish(ada.id, task.id, { summary: 'tamam', outputs: [], learned: '' });
    expect(t.plans.get(plan.id).status).toBe('done');
    expect(t.notices.pending(c.id).at(-1)?.text).toContain('sahibine raporla');
  });

  it('only the coordinator proposes plans and reports to the owner', () => {
    const t = make();
    t.company.hireCoordinator();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    expect(() => t.company.propose(ada.id, { title: 'P', goal: 'g', approach: 'a' })).toThrow(/Yalnız koordinatör/);
    expect(() => t.company.report(ada.id, 'rapor')).toThrow(/Yalnız koordinatör/);
  });
});

describe('Company — brief and status', () => {
  it('updates the brief on every desk and lists who does what', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r', title: 'Yazar' });
    t.company.updateBrief(c.id, '# Özet\n\nMisyon: iyi yazılım.\n');
    expect(readFileSync(join(deskDir(t.dataDir, ada.slug), 'company-brief.md'), 'utf8')).toContain('Misyon');
    const task = t.company.createTask(c.id, { assignee: ada.id, title: 'Blog yazısı' });
    t.company.start(task.id);
    expect(t.company.status().find((l) => l.id === ada.id)).toMatchObject({ name: 'Ada', title: 'Yazar', kind: 'member', task: 'Blog yazısı' });
    expect(() => t.company.updateBrief(ada.id, 'x')).toThrow(/Yalnız koordinatör/);
  });
});

describe('Company — final review', () => {
  it('appointing a coordinator reloads both sessions and tells each what changed', () => {
    const t = make();
    const old = t.company.hireCoordinator();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    t.company.appointCoordinator(ada.id);
    expect([...t.reloaded].sort()).toEqual([old.id, ada.id].sort());
    expect(t.notices.pending(ada.id).at(-1)?.text).toMatch(/koordinatörüsün/);
    expect(t.notices.pending(old.id).at(-1)?.text).toContain('Ada');
  });

  it('the current coordinator hears about a plan its predecessor proposed', () => {
    const t = make();
    const old = t.company.hireCoordinator();
    const plan = t.company.propose(old.id, { title: 'P', goal: 'g', approach: 'a' });
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    t.company.appointCoordinator(ada.id);
    t.company.approve(plan.id);
    expect(t.notices.pending(ada.id).some((n) => n.text.includes('Plan onaylandı'))).toBe(true);
    expect(t.notices.pending(old.id).some((n) => n.text.includes('Plan onaylandı'))).toBe(false);
  });

  it('a fired employee’s open tasks wait again and the coordinator is told to hand them out', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const [ada, can] = [t.company.hire(c.id, { name: 'Ada', role: 'r' }), t.company.hire(c.id, { name: 'Can', role: 'r' })];
    const running = t.company.createTask(c.id, { assignee: ada.id, title: 'yarım kalacak' });
    t.company.start(running.id);
    t.company.createTask(c.id, { assignee: ada.id, title: 'sırada' });
    await t.engine.fire(ada.id);
    t.company.releaseTasksOf(ada.id);
    expect(t.tasks.get(running.id)).toMatchObject({ status: 'waiting', startedAt: null });
    const note = t.notices.pending(c.id).at(-1)!.text;
    expect(note).toContain('yarım kalacak');
    expect(note).toContain('sırada');
    expect(note).toContain('taskAssign');
    expect(t.company.assign(c.id, running.id, can.id).assignee).toBe(can.id);
  });

  it('a task can be taken from someone who stalled after the reminder, and they are told', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const [ada, can] = [t.company.hire(c.id, { name: 'Ada', role: 'r' }), t.company.hire(c.id, { name: 'Can', role: 'r' })];
    const task = t.company.createTask(c.id, { assignee: ada.id, title: 'takılan' });
    t.company.start(task.id);
    t.tasks.update(task.id, { nudged: true });
    expect(t.company.assign(c.id, task.id, can.id)).toMatchObject({ assignee: can.id, status: 'waiting', startedAt: null });
    expect(t.notices.pending(ada.id).at(-1)?.text).toContain('Can');
  });

  it('a task on a plan whose tasks all finished reopens it; draft and declined plans say why not', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    const plan = t.company.propose(c.id, { title: 'Lansman', goal: 'g', approach: 'a', steps: ['metin', 'görsel'] });
    t.company.approve(plan.id);
    const first = t.company.createTask(c.id, { assignee: ada.id, title: 'metin', planId: plan.id });
    t.company.start(first.id);
    t.company.finish(ada.id, first.id, { summary: 'tamam', outputs: [], learned: '' });
    expect(t.plans.get(plan.id).status).toBe('done');
    t.company.createTask(c.id, { assignee: ada.id, title: 'görsel', planId: plan.id });
    expect(t.plans.get(plan.id).status).toBe('approved');
    expect(ofType(t.events.list({ limit: 500 }), 'plan.changed').map((e) => (e.event as { change: string }).change)).toContain('reopened');
    const draft = t.company.propose(c.id, { title: 'Taslak', goal: 'g', approach: 'a' });
    expect(() => t.company.createTask(c.id, { assignee: ada.id, title: 'x', planId: draft.id })).toThrow(/henüz onaylanmadı/);
    const declined = t.company.propose(c.id, { title: 'Red', goal: 'g', approach: 'a' });
    t.company.decline(declined.id);
    expect(() => t.company.createTask(c.id, { assignee: ada.id, title: 'x', planId: declined.id })).toThrow(/vazgeçildi/);
  });
});

describe('Company — hand-ins feed the memory', () => {
  it('archives the outputs, records where, and turns what was learned into a note', async () => {
    const { Memory } = await import('../src/company/memory.ts');
    const { DecisionStore, EmployeeNoteStore, NoteStore, PlaybookStore } = await import('../src/company/memory-store.ts');
    const s = setup();
    const f = fakeEngine(s);
    cleanups.push(f.cleanup, s.cleanup);
    const tasks = new TaskStore(s.db);
    const plans = new PlanStore(s.db);
    const notices = new NoticeStore(s.db);
    const notes = new NoteStore(s.db);
    const memory = new Memory({ roster: s.roster, events: s.events, notices, tasks, plans, dataDir: s.dataDir, decisions: new DecisionStore(s.db), playbook: new PlaybookStore(s.db), notes, employeeNotes: new EmployeeNoteStore(s.db) });
    const company = new Company({ roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => f.engine.hire(i), characters: () => ['coder'], memory });
    const ada = company.hire(OWNER, { name: 'Ada', role: 'r' });
    writeFileSync(join(deskDir(s.dataDir, ada.slug), 'not.md'), 'içerik');
    const task = company.createTask(OWNER, { assignee: ada.id, title: 'Not yaz' });
    company.start(task.id);
    const done = company.finish(ada.id, task.id, { summary: 'Yazıldı.', outputs: ['not.md'], learned: 'Başlık önce gelir.' });
    expect(done.result?.archive).toMatch(/^company\/archive\/plansiz\//);
    expect(readFileSync(join(s.dataDir, done.result!.archive!, 'not.md'), 'utf8')).toBe('içerik');
    expect(notes.list()[0]).toMatchObject({ title: 'Öğrenilen: Not yaz', text: 'Başlık önce gelir.', source: `task:${task.id}` });
  });
});

describe('Company — hand-over', () => {
  it('review focus: one hand-over task however often the owner asks, priority 1, and the coordinator hears', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    const first = t.company.beginHandover(ada.id);
    expect(first).toMatchObject({ kind: 'handover', priority: 1, requester: OWNER, assignee: ada.id, status: 'waiting' });
    expect(t.company.beginHandover(ada.id).id).toBe(first.id);
    expect(t.notices.pending(c.id).at(-1)?.text).toMatch(/Ada işten çıkarılıyor/);
    expect(t.company.handedOver(ada.id)).toBe(false);
    t.company.start(first.id);
    t.company.finish(ada.id, first.id, { summary: 'Devrettim.', outputs: [], learned: '' });
    expect(t.company.handedOver(ada.id)).toBe(true);
    await t.engine.fire(ada.id);
    expect(() => t.company.beginHandover(ada.id)).toThrow(/zaten işten çıkarıldı/);
  });

  it('review focus: firing at once during a hand-over cancels it and returns only the real work', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    const work = t.company.createTask(c.id, { assignee: ada.id, title: 'gerçek iş' });
    const handover = t.company.beginHandover(ada.id);
    await t.engine.fire(ada.id);
    t.company.releaseTasksOf(ada.id);
    expect(t.tasks.get(handover.id).status).toBe('cancelled');
    expect(t.tasks.get(work.id).status).toBe('waiting');
    const note = t.notices.pending(c.id).at(-1)!.text;
    expect(note).toContain('gerçek iş');
    expect(note).not.toContain('Devir');
  });
});

describe('Company — final review (phase 2)', () => {
  it('critical: a hand-over cannot be given to someone else, so only the person the owner chose leaves', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const [ada, bob] = [t.company.hire(c.id, { name: 'Ada', role: 'r' }), t.company.hire(c.id, { name: 'Bob', role: 'r' })];
    const handover = t.company.beginHandover(ada.id);
    t.company.start(handover.id);
    t.tasks.update(handover.id, { nudged: true });
    expect(() => t.company.assign(c.id, handover.id, bob.id)).toThrow(/Devir görevi başkasına verilemez/);
    expect(t.tasks.get(handover.id).assignee).toBe(ada.id);
    expect(t.company.handedOver(bob.id)).toBe(false);
  });

  it('knows a hand-over is in however many tasks the person finished before', () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    for (let i = 0; i < 1001; i += 1) t.tasks.update(t.tasks.create({ planId: null, title: `iş ${i}`, description: '', done: [], requester: OWNER, assignee: ada.id, priority: 3, dependsOn: [], chainDepth: 0 }).id, { status: 'done' });
    const handover = t.company.beginHandover(ada.id);
    t.tasks.update(handover.id, { status: 'done' });
    expect(t.company.handedOver(ada.id)).toBe(true);
  });
});

describe('Company — within the constitution', () => {
  it('refuses a hire past maxEmployees and uses the constitution’s loop limits', async () => {
    const { companyFor } = await import('./company-helpers.ts');
    const s = setup();
    const f = fakeEngine(s);
    cleanups.push(f.cleanup, s.cleanup);
    const t = companyFor(s, f);
    t.budget.setConstitution({ maxEmployees: 2, tasksPerDay: 1 });
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    expect(() => t.company.hire(c.id, { name: 'Can', role: 'r' })).toThrow(/en fazla 2 çalışan/);
    expect(() => t.company.hire(OWNER, { name: 'Can', role: 'r' })).toThrow(/en fazla 2 çalışan/);
    t.company.createTask(ada.id, { assignee: c.id, title: 'bir' });
    expect(() => t.company.createTask(ada.id, { assignee: c.id, title: 'iki' })).toThrow(/günde en fazla 1/);
  });

  it('lets the coordinator change someone’s model and reloads their session', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r', model: 'haiku' });
    expect(t.company.setModel(c.id, ada.id, 'sonnet').model).toBe('sonnet');
    expect(t.reloaded).toContain(ada.id);
    expect(t.events.list({ limit: 500 }).some((e) => e.employeeId === ada.id && e.event.type === 'model.changed')).toBe(true);
    expect(() => t.company.setModel(c.id, ada.id, 'gpt' as never)).toThrow(/Bilinmeyen model/);
    expect(() => t.company.setModel(ada.id, c.id, 'haiku')).toThrow(/Yalnız koordinatör/);
  });
});

describe('Company — notice kinds', () => {
  it('important: what needs the reader now is a decision, what is only for the record is information', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const [ada, can] = [t.company.hire(c.id, { name: 'Ada', role: 'r', team: 'İçerik' }), t.company.hire(c.id, { name: 'Can', role: 'r', team: 'İçerik' })];
    const last = (id: string) => {
      const n = t.notices.pending(id).at(-1);
      return n && `${n.kind} ${n.topic}`;
    };
    const plan = t.company.propose(c.id, { title: 'P', goal: 'g', approach: 'a' });
    t.company.approve(plan.id);
    expect(last(c.id)).toBe('decision plan.approved');

    const passed = t.company.createTask(ada.id, { assignee: can.id, title: 'çevir', planId: plan.id });
    t.company.start(passed.id);
    t.company.update(can.id, passed.id, { blocked: true, note: 'dosya yok' });
    expect(last(c.id)).toBe('decision task.blocked');
    t.company.update(can.id, passed.id, { blocked: false });
    t.company.finish(can.id, passed.id, { summary: 'çevrildi', outputs: [], learned: '' });
    expect(last(ada.id)).toBe('info task.finished');
    expect(t.notices.pending(c.id).slice(-2).map((n) => `${n.kind} ${n.topic}`)).toEqual(['info task.finished', 'info plan.done']);

    const waiting = t.company.createTask(c.id, { assignee: ada.id, title: 'bekleyen' });
    t.company.assign(c.id, waiting.id, can.id);
    expect(last(ada.id)).toBe('info task.moved');
    const stuck = t.company.createTask(c.id, { assignee: ada.id, title: 'takılan' });
    t.company.start(stuck.id);
    t.company.update(ada.id, stuck.id, { blocked: true });
    t.company.assign(c.id, stuck.id, can.id);
    expect(last(ada.id)).toBe('decision task.taken');

    t.company.appointLead(c.id, ada.id);
    expect(last(ada.id)).toBe('info role.changed');
    expect(last(can.id)).toBe('info role.changed');
    t.company.appointCoordinator(can.id);
    expect(last(can.id)).toBe('decision role.coordinator');
    expect(last(c.id)).toBe('info role.changed');
  });
});
