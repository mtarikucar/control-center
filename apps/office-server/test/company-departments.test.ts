import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make(deskCount = 8) {
  const s = setup(deskCount);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder', 'designer', 'manager'], undefined, undefined, { departments: true });
  c.budget.setConstitution({ maxEmployees: deskCount });
  const coordinator = c.company.hireCoordinator('sonnet');
  return { ...s, ...c, departments: c.departments!, coordinator };
}

describe('Hiring into departments (spec §5.1, §5.2, §5.5)', () => {
  it('the coordinator hires into a department, as its head when asked; a template’s team joins an open department, never makes one', () => {
    const t = make();
    const sales = t.departments.create(OWNER, { template: 'satis' });
    const head = t.company.hire(t.coordinator.id, { name: 'Sena', template: 'satis-muduru', role: '', departmentId: sales.id, head: true });
    expect(t.roster.get(head.id)).toMatchObject({ kind: 'lead', departmentId: sales.id, team: 'Satış' });
    expect(t.departments.get(sales.id).headId).toBe(head.id);
    const asst = t.company.hire(t.coordinator.id, { name: 'Arda', template: 'satis-asistani', role: '' });
    expect(t.roster.get(asst.id)).toMatchObject({ departmentId: sales.id, team: 'Satış', reportsTo: head.id, kind: 'member' });
    const writer = t.company.hire(t.coordinator.id, { name: 'Ece', template: 'icerik-yazari', role: '' });
    expect(t.roster.get(writer.id)).toMatchObject({ team: '' });
    expect(t.roster.get(writer.id)).not.toHaveProperty('departmentId');
    expect(t.departments.list()).toHaveLength(1);
  });

  it('an explicit free-text team opens a headless custom department', () => {
    const t = make();
    const ada = t.company.hire(t.coordinator.id, { name: 'Ada', role: 'araştırmacı', team: 'Keşif' });
    const dep = t.departments.find('Keşif')!;
    expect(dep).toMatchObject({ headId: null, template: null });
    expect(t.roster.get(ada.id).departmentId).toBe(dep.id);
  });

  it('a head hires into their own department only, never a head; the coordinator hears of it', () => {
    const t = make();
    const mkt = t.departments.create(OWNER, { template: 'pazarlama' });
    const lead = t.company.hire(OWNER, { name: 'Pelin', role: 'r', departmentId: mkt.id, head: true });
    const other = t.departments.create(OWNER, { name: 'Satış', mission: 'm' });
    const ece = t.company.hire(lead.id, { name: 'Ece', template: 'icerik-yazari', role: '' });
    expect(t.roster.get(ece.id)).toMatchObject({ departmentId: mkt.id, kind: 'member', reportsTo: lead.id });
    expect(t.notices.pending(t.coordinator.id).map((n) => n.text).join('\n')).toMatch(/Pelin Pazarlama departmanına Ece adlı çalışanı aldı/);
    expect(() => t.company.hire(lead.id, { name: 'Bora', role: 'r', departmentId: other.id })).toThrow(/Başkan yalnız kendi departmanına işe alır/);
    expect(() => t.company.hire(lead.id, { name: 'Bora', role: 'r', team: 'Satış' })).toThrow(/Başkan yalnız kendi departmanına işe alır/);
    expect(() => t.company.hire(lead.id, { name: 'Bora', role: 'r', head: true })).toThrow(/Başkan atamak koordinatörün işi/);
    expect(() => t.company.hire(ece.id, { name: 'Bora', role: 'r' })).toThrow(/Yalnız koordinatör bunu yapabilir/);
  });

  it('review focus 5: a head hiring into a full office is refused and nothing is written', () => {
    const t = make(3);
    const mkt = t.departments.create(OWNER, { name: 'Pazarlama', mission: 'm' });
    const lead = t.company.hire(OWNER, { name: 'Pelin', role: 'r', departmentId: mkt.id, head: true });
    t.company.hire(lead.id, { name: 'Ece', role: 'r' });
    const before = t.roster.list().length;
    expect(() => t.company.hire(lead.id, { name: 'Bora', role: 'r' })).toThrow(/Anayasa en fazla 3 çalışan diyor/);
    expect(t.roster.list()).toHaveLength(before);
  });

  it('a full office refuses a hire into a new free-text team before the department is opened: nothing is written', () => {
    const t = make(2);
    t.company.hire(t.coordinator.id, { name: 'Ada', role: 'r' });
    expect(() => t.company.hire(t.coordinator.id, { name: 'Bora', role: 'r', team: 'Keşif' })).toThrow(/Anayasa en fazla 2 çalışan diyor/);
    expect(t.departments.list()).toEqual([]);
  });

  it('a head cannot be hired without saying which department', () => {
    const t = make();
    expect(() => t.company.hire(t.coordinator.id, { name: 'Bora', role: 'r', head: true })).toThrow(/Başkan olarak almak için departmanı ver/);
    expect(t.roster.list()).toHaveLength(1);
  });

  it('a hire the roster would refuse opens no department: nothing is written, not even an announcement', () => {
    const t = make();
    const events = () => t.events.list({ limit: 1000 }).filter((e) => e.event.type === 'department.changed').length;
    const other = t.company.hire(t.coordinator.id, { name: 'Ada', role: 'r' });
    const before = { events: events(), last: t.events.lastSeq(), notices: t.notices.pending(other.id).length };
    expect(() => t.company.hire(t.coordinator.id, { name: 'X', role: '', team: 'Yeni' })).toThrow(/Rol tanımı boş olamaz/);
    expect(() => t.company.hire(t.coordinator.id, { name: 'Y'.repeat(61), role: 'r', team: 'Yeni' })).toThrow(/Ad en fazla 60 karakter/);
    expect(() => t.company.hire(t.coordinator.id, { name: 'Z', role: 'r', team: 'Yeni', model: 'gpt' as never })).toThrow(/Bilinmeyen model/);
    expect(() => t.company.hire(t.coordinator.id, { name: 'W', role: 'r', team: 'Yeni', title: 'T'.repeat(81) })).toThrow(/Unvan en fazla 80 karakter/);
    expect(t.departments.list()).toEqual([]);
    expect({ events: events(), last: t.events.lastSeq(), notices: t.notices.pending(other.id).length }).toEqual(before);
    // The hire that is valid still opens it.
    t.company.hire(t.coordinator.id, { name: 'X', role: 'r', team: 'Yeni' });
    expect(t.departments.list().map((d) => d.name)).toEqual(['Yeni']);
  });

  it('no free desk is refused before a department is opened too', () => {
    const t = make(2);
    t.budget.setConstitution({ maxEmployees: 8 });
    t.company.hire(t.coordinator.id, { name: 'Ada', role: 'r' });
    expect(() => t.company.hire(t.coordinator.id, { name: 'Bora', role: 'r', team: 'Yeni' })).toThrow(/Ofis dolu/);
    expect(t.departments.list()).toEqual([]);
  });

  it('spec §3 name rule: no one takes the name of the department their own hire opens', () => {
    const t = make();
    expect(() => t.company.hire(t.coordinator.id, { name: 'Keşif', role: 'r', team: 'Keşif' })).toThrow(/“Keşif” bir departmanın adı olacak; çalışana başka bir ad ver\./);
    expect(() => t.company.hire(t.coordinator.id, { name: ' keşif ', role: 'r', team: 'KEŞİF' })).toThrow(/bir departmanın adı olacak/);
    expect(t.departments.list()).toEqual([]);
    expect(t.roster.list()).toHaveLength(1);
    t.company.hire(t.coordinator.id, { name: 'Ada', role: 'r', team: 'Keşif' });
    expect(t.departments.list().map((d) => d.name)).toEqual(['Keşif']);
  });

  it('review focus 3: nobody is hired under a department’s name', () => {
    const t = make();
    t.departments.create(OWNER, { name: 'Pazarlama', mission: 'm' });
    expect(() => t.company.hire(t.coordinator.id, { name: 'pazarlama', role: 'r' })).toThrow(/“Pazarlama” bir departmanın adı/);
  });
});

describe('A head manages their own department (spec §5.2)', () => {
  it('model, task assignment and the employee file: own department yes, another no; members never', () => {
    const t = make();
    const a = t.departments.create(OWNER, { name: 'A', mission: 'm' });
    const b = t.departments.create(OWNER, { name: 'B', mission: 'm' });
    const head = t.company.hire(OWNER, { name: 'Hale', role: 'r', departmentId: a.id, head: true });
    const mine = t.company.hire(OWNER, { name: 'Mine', role: 'r', departmentId: a.id });
    const out = t.company.hire(OWNER, { name: 'Oya', role: 'r', departmentId: b.id });
    expect(t.company.setModel(head.id, mine.id, 'opus').model).toBe('opus');
    expect(() => t.company.setModel(head.id, out.id, 'opus')).toThrow(/yalnız kendi departmanındaki/);
    expect(() => t.company.setModel(mine.id, head.id, 'opus')).toThrow(/Yalnız koordinatör bunu yapabilir/);
    expect(() => t.company.assertManagesPerson(head.id, mine.id)).not.toThrow();
    expect(() => t.company.assertManagesPerson(head.id, out.id)).toThrow(/yalnız kendi departmanındaki/);
    const task = t.company.createTask(t.coordinator.id, { assignee: mine.id, title: 'İş' });
    expect(t.company.assign(head.id, task.id, head.id).assignee).toBe(head.id);
    expect(() => t.company.assign(head.id, task.id, out.id)).toThrow(/yalnız kendi departmanındaki/);
  });
});

describe('appointLead with departments (spec §5.1)', () => {
  it('makes the employee head of the department named by team (opening a custom one), ends it with lead: false; the old refusals stay', () => {
    const t = make();
    const ada = t.company.hire(t.coordinator.id, { name: 'Ada', role: 'r' });
    t.company.appointLead(t.coordinator.id, ada.id, { team: 'İçerik' });
    const dep = t.departments.find('İçerik')!;
    expect(dep.headId).toBe(ada.id);
    expect(t.roster.get(ada.id)).toMatchObject({ kind: 'lead', team: 'İçerik', departmentId: dep.id });
    t.company.appointLead(t.coordinator.id, ada.id, { lead: false });
    expect(t.departments.get(dep.id).headId).toBeNull();
    expect(t.roster.get(ada.id)).toMatchObject({ kind: 'member', departmentId: dep.id });
    expect(() => t.company.appointLead(t.coordinator.id, t.coordinator.id, { team: 'x' })).toThrow(/Koordinatör ekip lideri yapılamaz/);
    const can = t.company.hire(t.coordinator.id, { name: 'Can', role: 'r' });
    expect(() => t.company.appointLead(t.coordinator.id, can.id, { team: '' })).toThrow(/ekibi olmalı/);
  });
});

describe('Letting a head go (review focus 2)', () => {
  it('the department becomes headless, its members report to no one, nobody is a lead without a department', () => {
    const t = make();
    const dep = t.departments.create(OWNER, { name: 'A', mission: 'm' });
    const head = t.company.hire(OWNER, { name: 'Hale', role: 'r', departmentId: dep.id, head: true });
    const mine = t.company.hire(OWNER, { name: 'Mine', role: 'r', departmentId: dep.id });
    t.roster.update(head.id, { lifecycle: 'archived' });
    t.company.releaseTasksOf(head.id);
    expect(t.departments.get(dep.id).headId).toBeNull();
    expect(t.roster.get(mine.id).reportsTo).toBeNull();
    expect(t.roster.list().filter((e) => e.kind === 'lead')).toEqual([]);
  });
});

describe('liveStreams (what a headless department leaves)', () => {
  it('sees the open streams of an approved plan even when more than a hundred newer plans exist', () => {
    const s = setup(8);
    const f = fakeEngine(s);
    cleanups.push(f.cleanup, s.cleanup);
    let clock = 1_000;
    const c = companyFor(s, f, ['coder', 'designer', 'manager'], () => (clock += 1), undefined, { departments: true });
    const coordinator = c.company.hireCoordinator('sonnet');
    const draft = { goal: 'g', approach: 'a', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '', proposedBy: coordinator.id };
    const old = c.plans.create({ ...draft, title: 'Eski', streams: [{ id: 'web', title: 'Site', owner: coordinator.id, dependsOn: [] }] });
    c.plans.update(old.id, { status: 'approved' });
    for (let i = 0; i < 105; i += 1) c.plans.create({ ...draft, title: `Yeni ${i}` });
    expect(c.plans.list().map((p) => p.title)).not.toContain('Eski');
    expect(c.company.liveStreams().map((x) => `${x.plan.title}/${x.stream.id}`)).toEqual(['Eski/web']);
  });
});

describe('The role card does not rename a department’s team (controller ruling)', () => {
  it('refuses a team that differs from the current one; the same team, or none, is fine', () => {
    const t = make();
    const dep = t.departments.create(OWNER, { name: 'A', mission: 'm' });
    const ada = t.company.hire(t.coordinator.id, { name: 'Ada', role: 'r', departmentId: dep.id });
    const rename = /Ekip artık bir departman: kişiyi departmentMove ile taşı, departmanın adını departmentUpdate ile değiştir\./;
    expect(() => t.company.editRoleCard(t.coordinator.id, ada.id, { team: 'Başka' })).toThrow(rename);
    expect(() => t.company.editRoleCard(t.coordinator.id, ada.id, { team: '' })).toThrow(rename);
    expect(t.roster.get(ada.id)).toMatchObject({ team: 'A', departmentId: dep.id });
    expect(t.company.editRoleCard(t.coordinator.id, ada.id, { team: 'A', title: 'Uzman' })).toMatchObject({ team: 'A', title: 'Uzman', departmentId: dep.id });
    expect(t.company.editRoleCard(t.coordinator.id, ada.id, { title: 'Kıdemli' })).toMatchObject({ team: 'A', title: 'Kıdemli' });
    // A person in the centre has no team, and the same rule holds: a team is not given by the card.
    const free = t.company.hire(t.coordinator.id, { name: 'Can', role: 'r' });
    expect(() => t.company.editRoleCard(t.coordinator.id, free.id, { team: 'Yeni' })).toThrow(rename);
    expect(t.company.editRoleCard(t.coordinator.id, free.id, { team: '' }).team).toBe('');
  });

  it('without departments the card still sets the team, as before', () => {
    const s = setup(8);
    const f = fakeEngine(s);
    cleanups.push(f.cleanup, s.cleanup);
    const c = companyFor(s, f);
    const coordinator = c.company.hireCoordinator('sonnet');
    const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r' });
    expect(c.company.editRoleCard(coordinator.id, ada.id, { team: 'Keşif' }).team).toBe('Keşif');
  });

  it('without departments setModel stays the coordinator’s: a team lead gets no say over their team', () => {
    const s = setup(8);
    const f = fakeEngine(s);
    cleanups.push(f.cleanup, s.cleanup);
    const c = companyFor(s, f);
    const coordinator = c.company.hireCoordinator('sonnet');
    const lead = c.company.hire(coordinator.id, { name: 'Lale', role: 'r' });
    c.company.appointLead(coordinator.id, lead.id, { team: 'Keşif' });
    const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r', team: 'Keşif' });
    expect(s.roster.get(ada.id).reportsTo).toBe(lead.id);
    expect(() => c.company.setModel(lead.id, ada.id, 'opus')).toThrow(/Yalnız koordinatör bunu yapabilir/);
    expect(c.company.setModel(coordinator.id, ada.id, 'opus').model).toBe('opus');
  });
});
