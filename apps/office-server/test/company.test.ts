import { readFileSync } from 'node:fs';
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
  const company = new Company({ roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => f.engine.hire(i), characters: () => characters });
  return { ...s, engine: f.engine, tasks, plans, notices, company };
}

const ofType = (events: StoredEvent[], type: string) => events.filter((e) => e.event.type === type);

describe('Company — people', () => {
  it('hires a coordinator once, on Fable, with the coordinator card', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    expect(c).toMatchObject({ kind: 'coordinator', model: 'fable', name: 'Koordinatör' });
    expect(t.company.coordinator()?.id).toBe(c.id);
    expect(readFileSync(join(deskDir(t.dataDir, c.slug), 'CLAUDE.md'), 'utf8')).toContain('planPropose');
    expect(() => t.company.hireCoordinator()).toThrow(/zaten bir koordinatör/);
  });

  it('makes an employee coordinator and the previous one a member, rewriting both cards', () => {
    const t = make();
    const old = t.company.hireCoordinator();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const next = t.company.appointCoordinator(ada.id);
    expect(next.kind).toBe('coordinator');
    expect(t.roster.get(old.id).kind).toBe('member');
    expect(readFileSync(join(deskDir(t.dataDir, ada.slug), 'CLAUDE.md'), 'utf8')).toContain('planPropose');
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
