import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type Department, type Employee } from '@cc/shared';
import { deskDir, guideText, writeRoleCard } from '../src/desk.ts';
import { DepartmentStore } from '../src/company/department-store.ts';
import { departmentBlock, Departments } from '../src/company/departments.ts';
import { NoticeStore } from '../src/company/store.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

/** `now` (optional): one clock for the roster, the log and the departments, to hire and open things in the same millisecond. */
function make(now?: () => number) {
  const s = setup(20, now);
  cleanups.push(s.cleanup);
  const notices = new NoticeStore(s.db);
  const store = new DepartmentStore(s.db, now);
  const reloaded: string[] = [];
  const returned: string[] = [];
  const reseated: string[] = [];
  let reseatAlls = 0;
  const departments = new Departments({
    store, roster: s.roster, events: s.events, notices, dataDir: s.dataDir, reload: (id) => reloaded.push(id), reseat: (id) => void reseated.push(id), reseatAll: () => void (reseatAlls += 1),
  });
  let streams: ReturnType<Parameters<Departments['attach']>[0]['openStreams']> = [];
  departments.attach({ openStreams: () => streams, headEnded: (id) => returned.push(id) });
  const hire = (name: string, extra: Partial<Employee> = {}) => {
    const e = s.roster.create({ name, role: 'r', team: extra.team ?? '', kind: extra.kind ?? 'member' });
    writeRoleCard(s.dataDir, e);
    return e;
  };
  const coordinator = hire('Koordinatör', { kind: 'coordinator' });
  const pending = (id: string) => notices.pending(id).map((n) => `${n.topic}: ${n.text}`);
  const changes = () => s.events.list({ limit: 1000 }).filter((e) => e.event.type === 'department.changed').map((e) => (e.event as { change: string }).change);
  const departmentEvents = () =>
    s.events.list({ limit: 1000 }).flatMap((e) => (e.event.type === 'department.changed' ? [e.event as { change: string; department: Department }] : []));
  return { ...s, notices, store, departments, reloaded, returned, reseated, reseatAlls: () => reseatAlls, hire, coordinator, pending, changes, departmentEvents, setStreams: (x: typeof streams) => (streams = x) };
}

describe('Departments — opening, heads and members (spec §3, §5.1)', () => {
  it('opens a department from a template with a head: the head moves in as lead, the members report to them', () => {
    const t = make();
    const selin = t.hire('Selin');
    const mert = t.hire('Mert');
    const dep = t.departments.create(t.coordinator.id, { template: 'yazilim-otomasyon', headId: selin.id });
    expect(dep).toMatchObject({ name: 'Yazılım ve Otomasyon', template: { id: 'yazilim-otomasyon', version: 1 }, headId: selin.id, status: 'open' });
    expect(dep.mission).toMatch(/yazılımı, entegrasyonları/);
    expect(dep.scope).toMatch(/### Yapmaz/);
    expect(t.roster.get(selin.id)).toMatchObject({ kind: 'lead', team: 'Yazılım ve Otomasyon', departmentId: dep.id, reportsTo: null });
    t.departments.move(t.coordinator.id, mert.id, dep.id);
    expect(t.roster.get(mert.id)).toMatchObject({ kind: 'member', team: 'Yazılım ve Otomasyon', departmentId: dep.id, reportsTo: selin.id });
    expect(t.departments.members(dep.id).map((e) => e.name)).toEqual(['Selin', 'Mert']);
    expect(t.departments.of(mert.id)?.id).toBe(dep.id);
    expect(t.departments.headOf(selin.id)?.id).toBe(dep.id);
    expect(t.departments.responsible(dep.id)?.id).toBe(selin.id);
    expect(t.reloaded).toEqual(expect.arrayContaining([selin.id, mert.id]));
    expect(t.pending(selin.id).join('\n')).toMatch(/role.changed: Artık Yazılım ve Otomasyon departmanının başkanısın/);
    expect(t.changes()).toEqual(['created', 'head', 'moved']);
  });

  it('a custom department needs a name and a mission; at most six are open; names are unique against departments and people', () => {
    const t = make();
    t.hire('Deniz');
    expect(() => t.departments.create(t.coordinator.id, { name: 'Keşif' })).toThrow(/Misyon boş olamaz/);
    t.departments.create(t.coordinator.id, { name: 'Pazarlama', mission: 'm' });
    expect(() => t.departments.create(t.coordinator.id, { name: 'pazarlama ', mission: 'm' })).toThrow(/“Pazarlama” adında bir departman zaten var/);
    expect(() => t.departments.create(t.coordinator.id, { name: 'DENİZ', mission: 'm' })).toThrow(/bir çalışanın adı/);
    for (const name of ['A', 'B', 'C', 'D', 'E']) t.departments.create(OWNER, { name, mission: 'm' });
    expect(() => t.departments.create(t.coordinator.id, { name: 'F', mission: 'm' })).toThrow(/En fazla 6 departman açık olabilir/);
    expect(() => t.departments.assertFreeName('pazarlama')).toThrow(/“Pazarlama” bir departmanın adı/);
    expect(t.departments.list({ status: 'open' })).toHaveLength(6);
  });

  it('only the coordinator and the owner change departments; the coordinator never joins one', () => {
    const t = make();
    const ada = t.hire('Ada');
    expect(() => t.departments.create(ada.id, { name: 'X', mission: 'm' })).toThrow(/yalnız koordinatör ya da sahibi/);
    const dep = t.departments.create(OWNER, { name: 'X', mission: 'm' });
    expect(() => t.departments.move(t.coordinator.id, t.coordinator.id, dep.id)).toThrow(/Koordinatörün departmanı olmaz/);
    expect(() => t.departments.setHead(t.coordinator.id, dep.id, t.coordinator.id)).toThrow(/Koordinatörün departmanı olmaz/);
  });

  it('assertCanHead refuses what setHead would (nobody, someone let go, the coordinator) and changes nothing', () => {
    const t = make();
    const [ada, gone] = [t.hire('Ada'), t.hire('Gül')];
    t.roster.update(gone.id, { lifecycle: 'archived' });
    const dep = t.departments.create(OWNER, { name: 'X', mission: 'm' });
    const events = t.departmentEvents().length;
    expect(() => t.departments.assertCanHead('00000000-0000-4000-8000-000000000000')).toThrow(/Çalışan bulunamadı/);
    expect(() => t.departments.assertCanHead(gone.id)).toThrow(/Gül işten çıkarıldı/);
    expect(() => t.departments.assertCanHead(t.coordinator.id)).toThrow(/Koordinatörün departmanı olmaz/);
    expect(() => t.departments.assertCanHead(ada.id)).not.toThrow();
    expect(t.roster.get(ada.id)).not.toHaveProperty('departmentId');
    expect(t.departments.get(dep.id).headId).toBeNull();
    expect(t.departmentEvents()).toHaveLength(events);
  });

  it('a new head: the former one stays as a member; heading a second department leaves the first headless', () => {
    const t = make();
    const [a, b] = [t.hire('Ada'), t.hire('Bora')];
    const x = t.departments.create(OWNER, { name: 'X', mission: 'm', headId: a.id });
    t.departments.move(OWNER, b.id, x.id);
    t.departments.setHead(OWNER, x.id, b.id);
    expect(t.roster.get(a.id)).toMatchObject({ kind: 'member', departmentId: x.id, reportsTo: b.id });
    expect(t.roster.get(b.id)).toMatchObject({ kind: 'lead', reportsTo: null });
    expect(t.returned).toContain(a.id);
    const y = t.departments.create(OWNER, { name: 'Y', mission: 'm' });
    t.departments.setHead(OWNER, y.id, b.id);
    expect(t.departments.get(x.id).headId).toBeNull();
    expect(t.roster.get(a.id).reportsTo).toBeNull();
    expect(t.roster.get(b.id)).toMatchObject({ kind: 'lead', departmentId: y.id });
  });

  it('a headless department gives its open streams to the coordinator', () => {
    const t = make();
    const a = t.hire('Ada');
    const x = t.departments.create(OWNER, { name: 'X', mission: 'm', headId: a.id });
    t.setStreams([
      { plan: { id: 'p1', title: 'Site' } as never, stream: { id: 'api', title: 'API', owner: `departman:${x.id}`, dependsOn: [], status: 'active' } },
      { plan: { id: 'p1', title: 'Site' } as never, stream: { id: 'ui', title: 'Arayüz', owner: 'someone', dependsOn: [], status: 'active' } },
    ]);
    t.departments.setHead(OWNER, x.id, null);
    expect(t.roster.get(a.id)).toMatchObject({ kind: 'member', departmentId: x.id });
    const said = t.pending(t.coordinator.id).join('\n');
    expect(said).toMatch(/stream.returned: X departmanının başkanı yok; açık akışları sende: “API” \(plan “Site”, api\)/);
    expect(said).not.toMatch(/Arayüz/);
  });

  it('a head named while the department has open streams hears of them in one notice; none open: no notice', () => {
    const t = make();
    const [a, b] = [t.hire('Ada'), t.hire('Bora')];
    const x = t.departments.create(OWNER, { name: 'X', mission: 'm' });
    t.departments.setHead(OWNER, x.id, a.id);
    expect(t.pending(a.id).join('\n')).not.toMatch(/stream.assigned/);
    t.setStreams([
      { plan: { id: 'p1', title: 'Site' } as never, stream: { id: 'api', title: 'API', owner: `departman:${x.id}`, dependsOn: [], status: 'active' } },
      { plan: { id: 'p2', title: 'Blog' } as never, stream: { id: 'yazi', title: 'Yazılar', owner: `departman:${x.id}`, dependsOn: [], status: 'planned' } },
      { plan: { id: 'p1', title: 'Site' } as never, stream: { id: 'ui', title: 'Arayüz', owner: 'someone', dependsOn: [], status: 'active' } },
    ]);
    t.departments.setHead(OWNER, x.id, b.id);
    const said = t.pending(b.id).filter((n) => n.startsWith('stream.assigned'));
    expect(said).toEqual([
      'stream.assigned: Artık başkanı olduğun X departmanının açık akışları: “API” (plan “Site”, planId p1, streamId api), “Yazılar” (plan “Blog”, planId p2, streamId yazi). Her birini streamPlan ile planla (planId, streamId), görevlerini taskCreate ile planId ve streamId vererek aç; bitince streamReport ile raporla.',
    ]);
    expect(t.pending(a.id).join('\n')).not.toMatch(/stream.assigned/);
    t.departments.setHead(OWNER, x.id, b.id);
    expect(t.pending(b.id).filter((n) => n.startsWith('stream.assigned'))).toHaveLength(1);
  });

  it('renames: the members’ team follows; closing sends everyone to the centre and returns the streams', () => {
    const t = make();
    const [a, b] = [t.hire('Ada'), t.hire('Bora')];
    const x = t.departments.create(OWNER, { name: 'X', mission: 'm', headId: a.id });
    t.departments.move(OWNER, b.id, x.id);
    t.departments.update(t.coordinator.id, x.id, { name: 'Büyüme', mission: 'yeni' });
    expect(t.roster.get(b.id).team).toBe('Büyüme');
    expect(() => t.departments.close(OWNER, x.id, '  ')).toThrow(/Gerekçe boş olamaz/);
    t.setStreams([{ plan: { id: 'p1', title: 'Site' } as never, stream: { id: 'api', title: 'API', owner: `departman:${x.id}`, dependsOn: [], status: 'active' } }]);
    t.departments.close(OWNER, x.id, 'iş bitti');
    const said = t.pending(t.coordinator.id).join('\n');
    expect(said).toContain('stream.returned: Büyüme departmanı kapandı; açık akışları sende: “API” (plan “Site”, api). Akışların sahibini planRevise ile değiştir ya da kendin yönet.');
    expect(said).not.toMatch(/departmentUpdate ile başkan ata/);
    expect(t.departments.get(x.id)).toMatchObject({ status: 'closed', headId: null });
    for (const id of [a.id, b.id]) expect(t.roster.get(id)).toMatchObject({ kind: 'member', team: '', reportsTo: null });
    expect(t.roster.get(a.id)).not.toHaveProperty('departmentId');
    expect(() => t.departments.move(OWNER, a.id, x.id)).toThrow(/“Büyüme” departmanı kapandı/);
    expect(t.departments.find('Büyüme')).toBeNull();
  });

  it('closing a headless department also gives its open streams to the coordinator, and says it closed', () => {
    const t = make();
    const x = t.departments.create(OWNER, { name: 'X', mission: 'm' });
    t.setStreams([{ plan: { id: 'p1', title: 'Site' } as never, stream: { id: 'api', title: 'API', owner: `departman:${x.id}`, dependsOn: [], status: 'active' } }]);
    t.departments.close(OWNER, x.id, 'iş bitti');
    expect(t.pending(t.coordinator.id).join('\n')).toContain('stream.returned: X departmanı kapandı; açık akışları sende: “API” (plan “Site”, api).');
  });

  it('a head moved to the centre: the department is headless in the event, its members report to no one, the person is a member with no department', () => {
    const t = make();
    const [a, b] = [t.hire('Ada'), t.hire('Bora')];
    const x = t.departments.create(OWNER, { name: 'X', mission: 'm', headId: a.id });
    t.departments.move(OWNER, b.id, x.id);
    expect(t.roster.get(b.id).reportsTo).toBe(a.id);
    const moved = t.departments.move(OWNER, a.id, null);
    expect(moved).toMatchObject({ kind: 'member', team: '', reportsTo: null });
    expect(moved).not.toHaveProperty('departmentId');
    const events = t.departmentEvents();
    expect(events.slice(-2).map((e) => e.change)).toEqual(['head', 'moved']);
    for (const e of events.slice(-2)) expect(e.department).toMatchObject({ id: x.id, headId: null });
    expect(t.departments.get(x.id).headId).toBeNull();
    expect(t.roster.get(b.id)).toMatchObject({ departmentId: x.id, reportsTo: null });
    expect(t.returned).toContain(a.id);
  });

  it('a head moved into another department: the old one is headless in the event, the person is a member of the new one under its head', () => {
    const t = make();
    const [a, b, c] = [t.hire('Ada'), t.hire('Bora'), t.hire('Cem')];
    const x = t.departments.create(OWNER, { name: 'X', mission: 'm', headId: a.id });
    t.departments.move(OWNER, b.id, x.id);
    const y = t.departments.create(OWNER, { name: 'Y', mission: 'm', headId: c.id });
    const moved = t.departments.move(OWNER, a.id, y.id);
    expect(moved).toMatchObject({ kind: 'member', team: 'Y', departmentId: y.id, reportsTo: c.id });
    const [head, move] = t.departmentEvents().slice(-2);
    expect(head).toMatchObject({ change: 'head', department: { id: x.id, headId: null } });
    expect(move).toMatchObject({ change: 'moved', department: { id: y.id, headId: c.id } });
    expect(t.departments.get(x.id).headId).toBeNull();
    expect(t.roster.get(b.id)).toMatchObject({ departmentId: x.id, reportsTo: null });
    expect(t.departments.members(y.id).map((e) => e.name)).toEqual(['Cem', 'Ada']);
    expect(t.returned).toContain(a.id);
  });

  it('someone let go who headed a department leaves it headless (Company.releaseTasksOf calls left)', () => {
    const t = make();
    const a = t.hire('Ada');
    const x = t.departments.create(OWNER, { name: 'X', mission: 'm', headId: a.id });
    t.roster.update(a.id, { lifecycle: 'archived' });
    t.departments.left(a.id);
    expect(t.departments.get(x.id).headId).toBeNull();
    expect(t.departments.members(x.id)).toEqual([]);
    t.departments.left(a.id);
    expect(t.departments.get(x.id).headId).toBeNull();
  });
});

describe('Departments — the coordinator is never half-applied (final review)', () => {
  /** Everything a call could write, read back: the departments, the roster, the log and every notice. */
  const state = (t: ReturnType<typeof make>) =>
    JSON.stringify({ deps: t.departments.list(), people: t.roster.list(), events: t.events.lastSeq(), notices: t.roster.list().map((e) => t.notices.pending(e.id)) });

  it('setHead with the coordinator writes nothing', () => {
    const t = make();
    const a = t.hire('Ada');
    const x = t.departments.create(OWNER, { name: 'X', mission: 'm', headId: a.id });
    const before = state(t);
    expect(() => t.departments.setHead(OWNER, x.id, t.coordinator.id)).toThrow(/Koordinatörün departmanı olmaz/);
    expect(state(t)).toBe(before);
  });

  it('a coordinator who (illegally) heads a department steps down to the centre when another is named or the head is cleared', () => {
    const t = make();
    const a = t.hire('Ada');
    const x = t.departments.create(OWNER, { name: 'X', mission: 'm' });
    t.store.update(x.id, { headId: t.coordinator.id });
    t.roster.update(t.coordinator.id, { departmentId: x.id, team: 'X' });
    t.departments.setHead(OWNER, x.id, a.id);
    expect(t.departments.get(x.id).headId).toBe(a.id);
    expect(t.roster.get(t.coordinator.id)).toMatchObject({ kind: 'coordinator', team: '', reportsTo: null });
    expect(t.roster.get(t.coordinator.id)).not.toHaveProperty('departmentId');
    expect(t.roster.get(a.id)).toMatchObject({ kind: 'lead', departmentId: x.id });
    // Cleared: the same, with no one named.
    t.departments.setHead(OWNER, x.id, null);
    t.store.update(x.id, { headId: t.coordinator.id });
    t.roster.update(t.coordinator.id, { departmentId: x.id, team: 'X' });
    t.departments.setHead(OWNER, x.id, null);
    expect(t.departments.get(x.id).headId).toBeNull();
    expect(t.roster.get(t.coordinator.id)).toMatchObject({ kind: 'coordinator', team: '' });
    expect(t.roster.get(t.coordinator.id)).not.toHaveProperty('departmentId');
  });

  it('closing a department that (illegally) holds the coordinator completes: everyone, the coordinator too, ends in the centre, the coordinator keeping their kind', () => {
    const t = make();
    const a = t.hire('Ada');
    const b = t.hire('Bora');
    const x = t.departments.create(OWNER, { name: 'X', mission: 'm', headId: a.id });
    t.departments.move(OWNER, b.id, x.id);
    t.roster.update(t.coordinator.id, { departmentId: x.id, team: 'X' });
    t.departments.close(OWNER, x.id, 'iş bitti');
    expect(t.departments.get(x.id)).toMatchObject({ status: 'closed', headId: null });
    for (const id of [a.id, b.id]) expect(t.roster.get(id)).toMatchObject({ kind: 'member', team: '', reportsTo: null });
    expect(t.roster.get(t.coordinator.id)).toMatchObject({ kind: 'coordinator', team: '' });
    for (const id of [a.id, b.id, t.coordinator.id]) expect(t.roster.get(id)).not.toHaveProperty('departmentId');
  });

  it('the coordinator is still never placed in a department', () => {
    const t = make();
    const x = t.departments.create(OWNER, { name: 'X', mission: 'm' });
    const before = state(t);
    expect(() => t.departments.move(OWNER, t.coordinator.id, x.id)).toThrow(/Koordinatörün departmanı olmaz/);
    expect(() => t.departments.create(OWNER, { name: 'Y', mission: 'm', headId: t.coordinator.id })).toThrow(/Koordinatörün departmanı olmaz/);
    expect(state(t)).toBe(before);
  });
});

describe('Departments — teams adopted and free-text teams (spec §5.5, §9.1)', () => {
  it('adopts every team once: names folded into one department, the first lead heads it, a second lead becomes a member', () => {
    const t = make();
    const deniz = t.hire('Deniz', { team: 'Keşif' });
    const selin = t.hire('Selin', { team: 'keşif', kind: 'lead' });
    const kerem = t.hire('Kerem', { team: 'Keşif', kind: 'lead' });
    const mert = t.hire('Mert', { team: 'Geliştirme' });
    const ada = t.hire('Ada');
    t.departments.adoptTeams();
    const open = t.departments.list({ status: 'open' });
    expect(open.map((d) => d.name)).toEqual(['Keşif', 'Geliştirme']);
    const kesif = open[0]!;
    expect(kesif.headId).toBe(selin.id);
    expect(t.roster.get(kerem.id)).toMatchObject({ kind: 'member', departmentId: kesif.id, reportsTo: selin.id });
    expect(t.roster.get(deniz.id)).toMatchObject({ departmentId: kesif.id, team: 'Keşif', reportsTo: selin.id });
    expect(t.roster.get(mert.id).departmentId).toBe(open[1]!.id);
    expect(t.roster.get(ada.id)).not.toHaveProperty('departmentId');
    const before = t.events.lastSeq();
    t.departments.adoptTeams();
    expect(t.departments.list()).toHaveLength(2);
    expect(t.events.lastSeq()).toBe(before);
  });

  it('a team named like someone at work is adopted as “<team> ekibi”; whoever’s kind or team changed gets the card written again', () => {
    const t = make();
    t.hire('Ada');
    const selin = t.hire('Selin', { team: 'Ada', kind: 'lead' });
    const kerem = t.hire('Kerem', { team: 'ada', kind: 'lead' });
    const mert = t.hire('Mert', { team: 'Ada' });
    const file = (e: Employee, name: string) => readFileSync(join(deskDir(t.dataDir, e.slug), name), 'utf8');
    expect(file(kerem, 'office-guide.md')).toBe(guideText('lead'));
    expect(guideText('lead')).not.toBe(guideText('member'));
    expect(file(kerem, 'CLAUDE.md')).toContain('ekibin: ada');
    t.departments.adoptTeams();
    const open = t.departments.list({ status: 'open' });
    expect(open.map((d) => d.name)).toEqual(['Ada ekibi']);
    expect(open[0]!.headId).toBe(selin.id);
    expect(t.roster.get(kerem.id)).toMatchObject({ kind: 'member', team: 'Ada ekibi', departmentId: open[0]!.id, reportsTo: selin.id });
    expect(t.roster.get(mert.id)).toMatchObject({ team: 'Ada ekibi', departmentId: open[0]!.id });
    expect(file(kerem, 'office-guide.md')).toBe(guideText('member'));
    expect(file(kerem, 'CLAUDE.md')).toContain('ekibin: Ada ekibi');
    expect(file(kerem, 'CLAUDE.md')).toContain('@department.md');
    expect(file(selin, 'office-guide.md')).toBe(guideText('lead'));
    expect(file(selin, 'CLAUDE.md')).toContain('ekibin: Ada ekibi');
    const before = t.events.lastSeq();
    t.departments.adoptTeams();
    expect(t.departments.list()).toHaveLength(1);
    expect(t.events.lastSeq()).toBe(before);
    expect(t.reloaded).toEqual([]);
  });

  it('a lead without a team (so without a department) becomes a member: lead iff head of an open department; the card is written, nobody is told', () => {
    const t = make();
    const lale = t.hire('Lale', { kind: 'lead' });
    const file = (e: Employee, name: string) => readFileSync(join(deskDir(t.dataDir, e.slug), name), 'utf8');
    expect(file(lale, 'office-guide.md')).toBe(guideText('lead'));
    const before = t.events.lastSeq();
    t.departments.adoptTeams();
    expect(t.roster.get(lale.id)).toMatchObject({ kind: 'member', team: '', reportsTo: null });
    expect(t.roster.get(lale.id)).not.toHaveProperty('departmentId');
    expect(t.roster.get(t.coordinator.id).kind).toBe('coordinator');
    expect(file(lale, 'office-guide.md')).toBe(guideText('member'));
    expect(t.pending(lale.id)).toEqual([]);
    expect(t.reloaded).toEqual([]);
    expect(t.events.lastSeq()).toBe(before);
    expect(t.departments.list()).toEqual([]);
    t.departments.adoptTeams();
    expect(t.roster.get(lale.id).kind).toBe('member');
  });

  it('a free-text team joins its department, opens one when asked to, refuses past six', () => {
    const t = make();
    const x = t.departments.create(OWNER, { name: 'Satış', mission: 'm' });
    expect(t.departments.forTeam(OWNER, 'satış', { create: false })?.id).toBe(x.id);
    expect(t.departments.forTeam(OWNER, 'İçerik', { create: false })).toBeNull();
    const made = t.departments.forTeam(t.coordinator.id, 'İçerik', { create: true })!;
    expect(made).toMatchObject({ name: 'İçerik', headId: null, template: null });
    for (const name of ['A', 'B', 'C', 'D']) t.departments.create(OWNER, { name, mission: 'm' });
    expect(() => t.departments.forTeam(OWNER, 'Yeni', { create: true })).toThrow(/“Yeni” adında departman yok ve en fazla 6 departman açık olabilir\. Açık departmanlar: Satış, İçerik, A, B, C, D\./);
  });
});

describe('Departments — each desk knows its department (spec §5.4)', () => {
  it('writes department.md for everyone and the card imports it once, also after the card is written again', () => {
    const t = make();
    const [a, b, c] = [t.hire('Ada'), t.hire('Bora'), t.hire('Cem')];
    const x = t.departments.create(OWNER, { template: 'pazarlama', headId: a.id });
    t.departments.move(OWNER, b.id, x.id);
    const file = (e: Employee) => readFileSync(join(deskDir(t.dataDir, e.slug), 'department.md'), 'utf8');
    const card = (e: Employee) => readFileSync(join(deskDir(t.dataDir, e.slug), 'CLAUDE.md'), 'utf8');
    expect(file(b)).toMatch(/\*\*Pazarlama\*\* — Şirketi doğru kitleye/);
    expect(file(b)).toMatch(/Başkan: Ada\./);
    expect(file(b)).toMatch(/Gelen yorum ve mesajlara cevap \(İç-Dış İletişim\)/);
    expect(file(a)).toMatch(/Başkan: sensin\./);
    expect(file(c)).toMatch(/Merkezdesin/);
    expect(file(t.coordinator)).toMatch(/Koordinatörsün/);
    for (const e of [a, b, c]) expect(file(e)).toMatch(/- \*\*Pazarlama\*\*: Şirketi doğru kitleye duyurur ve talep yaratır; strateji, içerik üretimi, yayın ve ölçüm bu departmanda\. — başkan Ada/);
    expect(card(b).match(/@department\.md/g)).toHaveLength(1);
    writeRoleCard(t.dataDir, t.roster.get(b.id));
    expect(card(b).match(/@department\.md/g)).toHaveLength(1);
    expect(existsSync(join(deskDir(t.dataDir, c.slug), 'department.md'))).toBe(true);
  });

  it('departmentBlock: a custom department without a Yapmaz section still says who heads it', () => {
    const e = { id: 'e', name: 'Ada', kind: 'member', departmentId: 'd' } as Employee;
    const text = departmentBlock(e, [{ id: 'd', name: 'Keşif', mission: 'Araştırır.', scope: '', template: null, headId: null, status: 'open', createdAt: 1, closedAt: null, room: null }], [e]);
    expect(text).toMatch(/\*\*Keşif\*\* — Araştırır\.\n\nBaşkan: yok \(koordinatör yönetir\)\./);
    expect(text).not.toMatch(/Yapmadıkların/);
  });
});

describe('Departments — rooms (spec office rooms §4.1)', () => {
  it('review focus 2: a department gets the lowest free room; closing frees it for the next; two open never share one', () => {
    const t = make();
    const [a, b, c] = ['A', 'B', 'C'].map((name) => t.departments.create(OWNER, { name, mission: 'm' })) as [Department, Department, Department];
    expect([a, b, c].map((d) => d.room)).toEqual([0, 1, 2]);
    expect(t.departments.close(OWNER, b.id, 'bitti').room).toBeNull();
    expect(t.departments.create(OWNER, { name: 'D', mission: 'm' }).room).toBe(1);
    expect(t.departments.create(OWNER, { name: 'E', mission: 'm' }).room).toBe(3);
    const rooms = t.departments.list({ status: 'open' }).map((d) => d.room);
    expect(new Set(rooms).size).toBe(rooms.length);
    // The page draws a room from department.changed: the event carries it.
    const last = t.events.list({ limit: 1000 }).filter((e) => e.event.type === 'department.changed').at(-1)!.event as { department: { room: number } };
    expect(last.department.room).toBe(3);
  });

  it('adopted teams get rooms in order; someone’s room is their open department’s, the centre and the coordinator none', () => {
    const t = make();
    const deniz = t.hire('Deniz', { team: 'Keşif' });
    const mert = t.hire('Mert', { team: 'Geliştirme' });
    const ada = t.hire('Ada');
    t.departments.adoptTeams();
    expect(t.departments.list().map((d) => [d.name, d.room])).toEqual([['Keşif', 0], ['Geliştirme', 1]]);
    expect([deniz, mert, ada, t.coordinator].map((e) => t.departments.roomOf(e.id))).toEqual([0, 1, null, null]);
  });

  it('walks everyone whose department changed to their seat (reseat): made head, moved, closed out, adopted', () => {
    const t = make();
    const [a, b] = [t.hire('Ada'), t.hire('Bora')];
    const x = t.departments.create(OWNER, { name: 'X', mission: 'm', headId: a.id });
    expect(t.reseated).toEqual([a.id]);
    t.departments.move(OWNER, b.id, x.id);
    expect(t.reseated).toEqual([a.id, b.id]);
    t.departments.close(OWNER, x.id, 'bitti');
    expect(t.reseated.slice(2).sort()).toEqual([a.id, b.id].sort());
    // Each change then walks everyone (final review I1, M1): a seat it freed is taken, a room it gave is cleared — once each.
    expect(t.reseatAlls()).toBe(3);
    const c = t.hire('Cem', { team: 'Keşif' });
    t.departments.adoptTeams();
    expect(t.reseated.at(-1)).toBe(c.id);
  });

  it('adoption opens the rooms in one fixed order even when everyone was hired in the same millisecond: the hire order (the earlier desk)', () => {
    const t = make(() => 7000);
    const teams = ['Üretim', 'Lojistik', 'Destek', 'Satış'];
    teams.forEach((team, i) => t.hire(`Kişi${i}`, { team }));
    t.departments.adoptTeams();
    const open = t.departments.list({ status: 'open' });
    expect(open.map((d) => [d.name, d.room])).toEqual([['Üretim', 0], ['Lojistik', 1], ['Destek', 2], ['Satış', 3]]);
    // The departments were opened in the same millisecond too: the list (created_at, rowid) agrees with the rooms.
    expect(new Set(open.map((d) => d.createdAt))).toEqual(new Set([7000]));
    expect(open.map((d) => d.room)).toEqual([0, 1, 2, 3]);
    // And again: nothing is re-opened or re-numbered.
    t.departments.adoptTeams();
    expect(t.departments.list().map((d) => [d.name, d.room])).toEqual(open.map((d) => [d.name, d.room]));
  });

  it('adoption goes by when each person was hired, and a tie by desk; a desk moved later reorders only a tie', () => {
    let now = 1000;
    const t = make(() => now);
    const first = t.hire('Birinci', { team: 'Keşif' });
    now = 2000;
    const second = t.hire('İkinci', { team: 'Geliştirme' });
    const third = t.hire('Üçüncü', { team: 'Destek' });
    // The first hire now holds the last desk, and the second the later one of the two hired in the same millisecond.
    t.roster.setDesk(first.id, 10);
    t.roster.setDesk(second.id, 12);
    t.departments.adoptTeams();
    expect(t.departments.list().map((d) => [d.name, d.room])).toEqual([['Keşif', 0], ['Destek', 1], ['Geliştirme', 2]]);
    expect(t.departments.roomOf(third.id)).toBe(1);
  });

  it('a team adopted past the six rooms has none (it sits at the hub); the first six are numbered in order', () => {
    const t = make(() => 9000);
    const teams = ['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7'];
    teams.forEach((team, i) => t.hire(`Kişi${i}`, { team }));
    t.departments.adoptTeams();
    expect(t.departments.list().map((d) => [d.name, d.room])).toEqual([['A1', 0], ['B2', 1], ['C3', 2], ['D4', 3], ['E5', 4], ['F6', 5], ['G7', null]]);
  });

  it('review (task 5): a closed department’s room goes to the earliest-opened open department with none — told (department.changed updated) and its members walk (reseatAll)', () => {
    const t = make(() => 9000);
    const teams = ['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7'];
    const people = teams.map((team, i) => t.hire(`Kişi${i}`, { team }));
    t.departments.adoptTeams();
    const open = (name: string) => t.departments.list({ status: 'open' }).find((d) => d.name === name)!;
    expect(open('G7').room).toBeNull();
    const walked = t.reseated.length;
    const all = t.reseatAlls();
    t.departments.close(OWNER, open('B2').id, 'bitti');
    expect(t.departments.list({ status: 'open' }).map((d) => [d.name, d.room])).toEqual([['A1', 0], ['C3', 2], ['D4', 3], ['E5', 4], ['F6', 5], ['G7', 1]]);
    expect(t.departments.roomOf(people[6]!.id)).toBe(1);
    // B2's person walks to the centre, then everyone to their seat: G7's to the room.
    expect(t.reseated.slice(walked)).toEqual([people[1]!.id]);
    expect(t.reseatAlls()).toBe(all + 1);
    const last = t.departmentEvents().slice(-2);
    expect(last.map((e) => [e.change, e.department.name, e.department.room])).toEqual([['closed', 'B2', null], ['updated', 'G7', 1]]);
  });

  it('only one department takes a freed room, the earliest-opened without one; the next freed room goes to the next', () => {
    const t = make(() => 9000);
    ['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7', 'H8'].forEach((team, i) => t.hire(`Kişi${i}`, { team }));
    t.departments.adoptTeams();
    const open = (name: string) => t.departments.list({ status: 'open' }).find((d) => d.name === name)!;
    t.departments.close(OWNER, open('C3').id, 'bitti');
    expect([open('G7').room, open('H8').room]).toEqual([2, null]);
    t.departments.close(OWNER, open('A1').id, 'bitti');
    expect([open('G7').room, open('H8').room]).toEqual([2, 0]);
  });

  it('adoption heals a department that has no room while one is free (data written before the rule), once; a second adoption changes nothing', () => {
    const t = make(() => 9000);
    const a = t.store.create({ name: 'A', mission: 'm', scope: '', template: null, headId: null, room: 0 });
    const b = t.store.create({ name: 'B', mission: 'm', scope: '', template: null, headId: null });
    const ada = t.hire('Ada');
    t.departments.move(OWNER, ada.id, b.id);
    const events = t.departmentEvents().length;
    const all = t.reseatAlls();
    t.departments.adoptTeams();
    expect([a, b].map((d) => t.departments.get(d.id).room)).toEqual([0, 1]);
    // Everyone walks to their seat: B's Ada to room 1.
    expect(t.reseatAlls()).toBe(all + 1);
    expect(t.departmentEvents().slice(events).map((e) => [e.change, e.department.name, e.department.room])).toEqual([['updated', 'B', 1]]);
    t.departments.adoptTeams();
    expect(t.departmentEvents()).toHaveLength(events + 1);
    expect(t.reseatAlls()).toBe(all + 1);
  });
});
