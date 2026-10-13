import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type Employee } from '@cc/shared';
import { officeTools } from '../src/mcp/tools.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make() {
  const s = setup(12);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder', 'designer', 'manager'], undefined, undefined, { departments: true });
  c.budget.setConstitution({ maxEmployees: 8 });
  const coordinator = c.company.hireCoordinator('sonnet');
  const tools = officeTools({
    company: c.company, roster: s.roster, tasks: c.tasks, characters: () => ['coder'], memory: c.memory, budget: c.budget,
    engine: { sleep: async () => undefined, wake: () => undefined, sideQuestion: async () => ({ ok: true, answer: '' }) },
    plans: () => c.plans.list(), agenda: { text: () => '' }, departments: c.departments!,
  });
  const call = async (who: Employee, name: string, args: Record<string, unknown>) => {
    const tool = tools.find((x) => x.name === name)!;
    if (!tool.kinds.includes(s.roster.get(who.id).kind)) throw new Error(`${name} not offered to ${who.kind}`);
    return String(await tool.run({ employee: s.roster.get(who.id) } as never, args));
  };
  return { ...s, ...c, departments: c.departments!, coordinator, tools, call };
}

describe('Department tools (spec §5)', () => {
  it('offers the department tools only where departments are wired, each to its kinds', () => {
    const t = make();
    const names = (kind: 'member' | 'lead' | 'coordinator') => t.tools.filter((x) => x.kinds.includes(kind)).map((x) => x.name);
    expect(names('member')).toContain('departmentsRead');
    for (const n of ['departmentTemplates', 'streamPlan', 'streamReport', 'hire', 'setModel', 'sleep', 'wake', 'employeeNote']) expect(names('lead'), n).toContain(n);
    for (const n of ['departmentCreate', 'departmentUpdate', 'departmentMove', 'departmentClose']) {
      expect(names('coordinator'), n).toContain(n);
      expect(names('lead'), n).not.toContain(n);
    }
    for (const n of ['departmentTemplates', 'streamPlan', 'streamReport']) expect(names('member'), n).not.toContain(n);
    // Without departments the office has none of them.
    const s = setup();
    const f = fakeEngine(s);
    cleanups.push(f.cleanup, s.cleanup);
    const c = companyFor(s, f);
    const plain = officeTools({ company: c.company, roster: s.roster, tasks: c.tasks, characters: () => ['coder'], memory: c.memory, budget: c.budget, engine: f.engine, plans: () => c.plans.list(), agenda: { text: () => '' } });
    expect(plain.map((x) => x.name).filter((n) => /^department|^stream(Plan|Report)$/.test(n))).toEqual([]);
  });

  it('the coordinator opens from a template with a head, lists, updates, moves and closes', async () => {
    const t = make();
    const selin = t.company.hire(t.coordinator.id, { name: 'Selin', role: 'r' });
    const mert = t.company.hire(t.coordinator.id, { name: 'Mert', role: 'r' });
    expect(await t.call(t.coordinator, 'departmentTemplates', {})).toMatch(/yazilim-otomasyon — Yazılım ve Otomasyon: Şirketin ihtiyaç duyduğu yazılımı/);
    expect(await t.call(t.coordinator, 'departmentCreate', { template: 'yazilim-otomasyon', head: 'Selin' })).toMatch(/Yazılım ve Otomasyon departmanı açıldı; başkanı Selin/);
    expect(await t.call(t.coordinator, 'departmentMove', { employee: 'Mert', department: 'yazılım ve otomasyon' })).toMatch(/Mert artık Yazılım ve Otomasyon departmanında/);
    const list = await t.call(mert, 'departmentsRead', {});
    expect(list).toMatch(/Departmanlar \(1\/6\)/);
    expect(list).toMatch(/• Yazılım ve Otomasyon — başkan Selin · 2 kişi · şablon yazilim-otomasyon \(sürüm 1\)/);
    expect(await t.call(mert, 'departmentsRead', { department: 'Yazılım ve Otomasyon' })).toMatch(/### Yapmaz/);
    expect(await t.call(t.coordinator, 'departmentUpdate', { department: 'Yazılım ve Otomasyon', head: 'Mert' })).toMatch(/başkanı artık Mert/);
    expect(await t.call(t.coordinator, 'departmentMove', { employee: 'Selin' })).toMatch(/Selin artık merkezde/);
    expect(await t.call(t.coordinator, 'departmentClose', { department: 'Yazılım ve Otomasyon', reason: 'deneme' })).toMatch(/kapandı/);
    expect(t.roster.get(selin.id)).not.toHaveProperty('departmentId');
  });

  it('a head: hire, setModel, sleep, wake, employeeNote in their own department; refused elsewhere', async () => {
    const t = make();
    const a = t.departments.create(OWNER, { template: 'pazarlama' });
    const b = t.departments.create(OWNER, { name: 'Satış', mission: 'm' });
    const head = t.company.hire(OWNER, { name: 'Pelin', role: 'r', departmentId: a.id, head: true });
    const out = t.company.hire(OWNER, { name: 'Oya', role: 'r', departmentId: b.id });
    expect(await t.call(head, 'hire', { name: 'Ece', template: 'icerik-yazari' })).toMatch(/İşe alındı: Ece .* Pazarlama departmanı/);
    expect(await t.call(head, 'setModel', { employee: 'Ece', model: 'opus' })).toMatch(/Ece artık opus/);
    expect(await t.call(head, 'employeeNote', { employee: 'Ece', text: 'Görselde iyi.' })).toMatch(/dosyasına not eklendi/);
    await expect(t.call(head, 'setModel', { employee: 'Oya', model: 'opus' })).rejects.toThrow(/yalnız kendi departmanındaki/);
    await expect(t.call(head, 'sleep', { employee: 'Oya' })).rejects.toThrow(/yalnız kendi departmanındaki/);
    await expect(t.call(head, 'wake', { employee: 'Oya' })).rejects.toThrow(/yalnız kendi departmanındaki/);
    await expect(t.call(head, 'hire', { name: 'Bora', role: 'r', model: 'sonnet', department: 'Satış' })).rejects.toThrow(/Başkan yalnız kendi departmanına işe alır/);
    await expect(t.call(head, 'departmentCreate', { name: 'X', mission: 'm' })).rejects.toThrow(/not offered/);
    expect(out.id).toBeTruthy();
  });

  it('review focus 4: taskPass to a department goes to its head, a headless one to the coordinator, a closed one is refused', async () => {
    const t = make();
    const a = t.departments.create(OWNER, { name: 'Pazarlama', mission: 'm' });
    const head = t.company.hire(OWNER, { name: 'Pelin', role: 'r', departmentId: a.id, head: true });
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    expect(await t.call(ada, 'taskPass', { to: 'pazarlama', title: 'Duyuru metni' })).toMatch(/“Duyuru metni” Pazarlama departmanına gitti: başkanı Pelin/);
    expect(t.tasks.list({ assignee: head.id })[0]!.description).toMatch(/^Pazarlama departmanına/);
    t.departments.setHead(OWNER, a.id, null);
    expect(await t.call(ada, 'taskPass', { to: 'departman: Pazarlama', title: 'İkinci' })).toMatch(/başkanı yok; koordinatöre gitti/);
    t.departments.close(OWNER, a.id, 'son');
    await expect(t.call(ada, 'taskPass', { to: 'Pazarlama', title: 'Üçüncü' })).rejects.toThrow(/Çalışan ya da departman bulunamadı: Pazarlama\. Açık departmanlar: yok/);
  });

  it('streamPlan and streamReport for the head of the stream’s department', async () => {
    const t = make();
    t.budget.setConstitution({ autonomy: 'free' });
    const a = t.departments.create(OWNER, { name: 'Pazarlama', mission: 'm' });
    const head = t.company.hire(OWNER, { name: 'Pelin', role: 'r', departmentId: a.id, head: true });
    const plan = t.company.propose(t.coordinator.id, { title: 'Lansman', goal: 'g', approach: 'a', method: { workType: 'general', stages: [{ name: 'a', role: 'b' }, { name: 'c', role: 'd' }], checks: ['x'] }, streams: [{ id: 'duyuru', title: 'Duyuru', owner: 'Pazarlama' }] } as never);
    expect(await t.call(head, 'streamPlan', { planId: plan.id, streamId: 'duyuru', text: 'Önce metin.' })).toMatch(/“Duyuru” akışının planı yazıldı/);
    expect(await t.call(head, 'streamReport', { planId: plan.id, streamId: 'duyuru', summary: 'Hazır.', evidence: ['dosya'] })).toMatch(/“Duyuru” akışının raporu koordinatöre gitti/);
  });

  it('taskCreate: a head opens tasks for their own department only; the coordinator hires a head into a department by name', async () => {
    const t = make();
    t.departments.create(OWNER, { name: 'Pazarlama', mission: 'm' });
    t.departments.create(OWNER, { name: 'Satış', mission: 'm' });
    // The coordinator names the department and the headship; the reply says where the hire went.
    expect(await t.call(t.coordinator, 'hire', { name: 'Pelin', role: 'r', model: 'sonnet', department: 'pazarlama', head: true })).toMatch(/İşe alındı: Pelin .* → Pazarlama departmanı \(başkan\)\./);
    expect(await t.call(t.coordinator, 'hire', { name: 'Oya', role: 'r', model: 'sonnet', department: 'departman: Satış' })).toMatch(/→ Satış departmanı\./);
    await expect(t.call(t.coordinator, 'hire', { name: 'Bora', role: 'r', model: 'sonnet', department: 'Yok' })).rejects.toThrow(/Departman bulunamadı: Yok\. Açık departmanlar: Pazarlama, Satış\./);
    const pelin = t.roster.byIdOrName('Pelin')!;
    const ece = t.company.hire(pelin.id, { name: 'Ece', role: 'r' });
    expect(await t.call(pelin, 'taskCreate', { assignee: 'Ece', title: 'Metin' })).toMatch(/Görev açıldı: .* “Metin” → Ece/);
    await expect(t.call(pelin, 'taskCreate', { assignee: 'Oya', title: 'Satış işi' })).rejects.toThrow(/yalnız kendi departmanına görev açar; başka departmana taskPass ile pasla/);
    expect(await t.call(pelin, 'taskCreate', { assignee: 'Pelin', title: 'Kendime' })).toMatch(/→ Pelin/);
    expect(ece.departmentId).toBeTruthy();
  });

  it('departmentsRead names a department’s people and open streams; a plan’s streams name the department that carries them', async () => {
    const t = make();
    t.budget.setConstitution({ autonomy: 'free' });
    const a = t.departments.create(OWNER, { name: 'Pazarlama', mission: 'Duyurular.' });
    const pelin = t.company.hire(OWNER, { name: 'Pelin', role: 'r', departmentId: a.id, head: true });
    const proposed = await t.call(t.coordinator, 'planPropose', { title: 'Lansman', goal: 'g', approach: 'a', method: { workType: 'general', stages: [{ name: 'a', role: 'b' }, { name: 'c', role: 'd' }], checks: ['x'] }, streams: [{ id: 'duyuru', title: 'Duyuru', owner: 'departman: Pazarlama' }] });
    expect(proposed).toMatch(/Akışlar: Duyuru → Pazarlama departmanı/);
    const one = await t.call(t.coordinator, 'departmentsRead', { department: 'Pazarlama' });
    expect(one).toMatch(/Kişiler:\n• Pelin ★ başkan/);
    expect(one).toMatch(/Açık akışlar:\n• “Lansman” › Duyuru \(duyuru, planlı\)/);
    // The head's plan and report show under the stream, the latest of each.
    const planId = t.plans.list()[0]!.id;
    await t.call(pelin, 'streamPlan', { planId, streamId: 'duyuru', text: 'İlk taslak.' });
    await t.call(pelin, 'streamPlan', { planId, streamId: 'duyuru', text: 'Önce metin, sonra görsel.' });
    await t.call(pelin, 'streamReport', { planId, streamId: 'duyuru', summary: 'Metin hazır.', evidence: ['duyuru.md', 'onay'], next: 'Görsel' });
    const noted = await t.call(t.coordinator, 'departmentsRead', { department: 'Pazarlama' });
    expect(noted).toMatch(/  Son plan: Önce metin, sonra görsel\.\n  Son rapor: Metin hazır\. — kanıt: duyuru\.md; onay — sırada: Görsel/);
    expect(noted).not.toContain('İlk taslak');
    await expect(t.call(t.coordinator, 'departmentsRead', { department: 'Yok' })).rejects.toThrow(/Departman bulunamadı: Yok\. Açık departmanlar: Pazarlama\./);
  });

  it('without departments taskPass names people only, as before', async () => {
    const s = setup();
    const f = fakeEngine(s);
    cleanups.push(f.cleanup, s.cleanup);
    const c = companyFor(s, f);
    const [pass] = officeTools({ company: c.company, roster: s.roster, tasks: c.tasks, characters: () => ['coder'], memory: c.memory, budget: c.budget, engine: f.engine, plans: () => c.plans.list(), agenda: { text: () => '' } }).filter((x) => x.name === 'taskPass');
    const ada = c.company.hire(OWNER, { name: 'Ada', role: 'r' });
    c.company.hire(OWNER, { name: 'Can', role: 'r' });
    await expect(Promise.resolve().then(() => pass!.run({ employee: ada } as never, { to: 'Pazarlama', title: 'x' }))).rejects.toThrow(/^Çalışan bulunamadı: Pazarlama\. officeStatus ile ofistekileri görebilirsin\.$/);
    expect(String(await pass!.run({ employee: ada } as never, { to: 'can', title: 'y' }))).toMatch(/“y” Can adlı çalışanın sırasına eklendi/);
  });
});
