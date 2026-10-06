import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type Employee } from '@cc/shared';
import type { McpTool } from '../src/mcp/protocol.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup, until } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make() {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder', 'designer']);
  const tools = officeTools({ company: c.company, roster: s.roster, tasks: c.tasks, characters: () => ['coder', 'designer'], memory: c.memory, budget: c.budget, engine: f.engine });
  const call = async (employee: Employee, name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.find((t: McpTool) => t.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    const current = s.roster.get(employee.id);
    if (!tool.kinds.includes(current.kind)) throw new Error(`closed: ${name}`);
    return tool.run({ employee: current }, args);
  };
  return { ...s, ...c, engine: f.engine, tools, call };
}

describe('office tools', () => {
  it('splits the tools between everyone, leads and the coordinator', () => {
    const t = make();
    const names = (kind: 'member' | 'lead' | 'coordinator') => t.tools.filter((x) => x.kinds.includes(kind)).map((x) => x.name).sort();
    expect(names('member')).toEqual(['briefRead', 'decisionsRead', 'memorySearch', 'myTasks', 'noteWrite', 'officeStatus', 'playbookRead', 'recordSpend', 'taskFinish', 'taskPass', 'taskUpdate']);
    expect(names('lead').filter((n) => !names('member').includes(n))).toEqual(['decisionRecord', 'playbookUpdate']);
    expect(names('coordinator').filter((n) => !names('lead').includes(n))).toEqual([
      'briefUpdate', 'budgetStatus', 'editRoleCard', 'employeeNote', 'hire', 'planPropose', 'planRevise', 'reportToOwner', 'setModel', 'sleep',
      'taskAssign', 'taskCreate', 'taskReprioritize', 'wake',
    ]);
    for (const tool of t.tools) expect(tool.inputSchema).toMatchObject({ type: 'object' });
  });


  it('lets an employee see their queue, pass work to a colleague and hand in their own task', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const can = t.company.hire(OWNER, { name: 'Can', role: 'r' });
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'Rapor yaz', done: ['rapor.md'] });
    expect(await t.call(ada, 'myTasks')).toContain('Rapor yaz');
    const passed = await t.call(ada, 'taskPass', { to: can.id, title: 'Grafikleri çiz', description: 'rapor için', done: ['grafik.png'], priority: 2 });
    expect(passed).toContain('Can');
    expect(t.tasks.list({ assignee: can.id })[0]).toMatchObject({ title: 'Grafikleri çiz', requester: ada.id, priority: 2 });
    t.company.start(task.id);
    const handed = await t.call(ada, 'taskFinish', { taskId: task.id, summary: 'Rapor hazır.', outputs: ['rapor.md'], learned: 'Veriler eksikti.' });
    expect(handed).toContain('teslim');
    expect(t.tasks.get(task.id)).toMatchObject({ status: 'done', result: { summary: 'Rapor hazır.', outputs: ['rapor.md'] } });
  });

  it('also finds a colleague by name when passing work', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    t.company.hire(OWNER, { name: 'Can Yıldız', role: 'r' });
    await t.call(ada, 'taskPass', { to: 'can yıldız', title: 'x' });
    expect(t.tasks.list().some((x) => x.title === 'x')).toBe(true);
    await expect(t.call(ada, 'taskPass', { to: 'kimse', title: 'x' })).rejects.toThrow(/bulunamadı/);
  });

  it('marks a task blocked with a reason', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'x' });
    t.company.start(task.id);
    await t.call(ada, 'taskUpdate', { taskId: task.id, blocked: true, note: 'şifre yok' });
    expect(t.tasks.get(task.id)).toMatchObject({ status: 'blocked', note: 'şifre yok' });
  });

  it('lets the coordinator propose a plan, hire with a model and character, open and hand out tasks', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const plan = await t.call(c, 'planPropose', { title: 'Lansman', goal: 'g', approach: 'a', people: 'bir yazar', steps: ['metin', 'görsel'], quotaPct: 10, usd: 25, days: 3, risks: 'kota' });
    expect(plan).toContain('onay');
    const draft = t.plans.list()[0]!;
    expect(draft).toMatchObject({ title: 'Lansman', steps: ['metin', 'görsel'], usd: 25 });
    await t.call(c, 'planRevise', { planId: draft.id, usd: 30 });
    expect(t.plans.get(draft.id)).toMatchObject({ version: 2, usd: 30 });
    t.company.approve(draft.id);
    const hired = await t.call(c, 'hire', { name: 'Ece', title: 'Yazar', team: 'İçerik', role: 'Metin yazar.', model: 'sonnet', characterId: 'designer' });
    expect(hired).toContain('Ece');
    const ece = t.roster.list().find((e) => e.name === 'Ece')!;
    expect(ece).toMatchObject({ title: 'Yazar', team: 'İçerik', model: 'sonnet', characterId: 'designer', kind: 'member' });
    await t.call(c, 'taskCreate', { assignee: ece.id, title: 'Lansman metni', planId: draft.id, priority: 1 });
    const created = t.tasks.list({ assignee: ece.id })[0]!;
    await t.call(c, 'taskReprioritize', { taskId: created.id, priority: 2 });
    expect(t.tasks.get(created.id).priority).toBe(2);
    await expect(t.call(c, 'hire', { name: 'X', role: 'r', model: 'gpt-9' })).rejects.toThrow(/model/);
  });

  it('lists the company and reads and updates the brief', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r', title: 'Yazar' });
    expect(await t.call(ada, 'officeStatus')).toMatch(/Koordinatör[\s\S]*Ada — Yazar/);
    await t.call(c, 'briefUpdate', { text: '# Özet\n\nMisyon: test.' });
    expect(await t.call(ada, 'briefRead')).toContain('Misyon: test.');
    await t.call(c, 'reportToOwner', { text: 'Bugün iki görev bitti.' });
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'company.report')).toBe(true);
  });

  it('rejects arguments of the wrong type in Turkish', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    await expect(t.call(ada, 'taskFinish', { taskId: 42 })).rejects.toThrow(/taskId/);
    await expect(t.call(ada, 'taskPass', { to: 'x', title: 'y', done: 'tek madde' })).rejects.toThrow(/done/);
  });

  it('everyone writes and searches the memory; leads and the coordinator write the playbook and decisions', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    expect(await t.call(ada, 'noteWrite', { title: 'Seslendirme', text: 'ElevenLabs Türkçe iyi.', tags: ['ses'] })).toMatch(/Not kaydedildi/);
    expect(await t.call(ada, 'memorySearch', { query: 'turkce' })).toContain('[not] Seslendirme');
    expect(await t.call(ada, 'memorySearch', { query: 'hiçbirşey' })).toContain('bir şey yok');
    expect(await t.call(ada, 'playbookRead')).toBe('El kitabı henüz boş.');
    await t.call(c, 'playbookUpdate', { topic: 'Video üretimi', text: 'Önce senaryo, sonra ses.', reason: 'ilk sürüm' });
    expect(await t.call(ada, 'playbookRead')).toContain('Video üretimi (sürüm 1');
    expect(await t.call(ada, 'playbookRead', { topic: 'video ÜRETİMİ' })).toContain('Önce senaryo, sonra ses.');
    await t.call(c, 'decisionRecord', { title: 'Ses aracı', chosen: 'ElevenLabs', reason: 'Türkçe', alternatives: ['Polly'] });
    expect(await t.call(ada, 'decisionsRead')).toMatch(/Ses aracı → ElevenLabs — Türkçe \[alternatifler: Polly\]/);
    await expect(t.call(ada, 'decisionRecord', { title: 'x', chosen: 'y', reason: 'z' })).rejects.toThrow(/closed/);
    t.roster.update(ada.id, { kind: 'lead' });
    expect(await t.call(ada, 'playbookUpdate', { topic: 'Video üretimi', text: 'Senaryo, ses, kurgu.' })).toContain('sürüm 2');
  });

  it('lets the coordinator keep an employee file and read it back', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r', title: 'Yazar' });
    await t.call(c, 'employeeNote', { employee: 'ada', text: 'Kısa metinlerde çok iyi.' });
    const task = t.company.createTask(c.id, { assignee: ada.id, title: 'Slogan' });
    t.company.start(task.id);
    const handed = await t.call(ada, 'taskFinish', { taskId: task.id, summary: 'Üç slogan.', outputs: [] });
    expect(handed).toMatch(/arşiv: company\/archive\//);
    const file = await t.call(c, 'employeeNote', { employee: ada.id });
    expect(file).toContain('Ada — Yazar: 1 görev bitirdi.');
    expect(file).toContain('Kısa metinlerde çok iyi.');
    expect(file).toContain('Slogan: Üç slogan.');
  });

  it('records spending with its warnings and shows the coordinator the budget', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    t.budget.setConstitution({ monthlyUsdCap: 10 });
    expect(await t.call(ada, 'recordSpend', { service: 'ElevenLabs', usd: 5, purpose: 'ses' })).toBe('Harcama kaydedildi: ElevenLabs $5.');
    expect(await t.call(ada, 'recordSpend', { service: 'Canva', usd: 6, purpose: 'görsel' })).toMatch(/aylık sınırı/);
    await expect(t.call(ada, 'recordSpend', { service: 'x', purpose: 'y' })).rejects.toThrow(/usd/);
    expect(await t.call(c, 'budgetStatus')).toContain('Bu ay harcanan: $11 / sınır $10');
  });

  it('lets the coordinator change a model and put someone to sleep and wake them', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r', model: 'haiku' });
    expect(await t.call(c, 'setModel', { employee: 'Ada', model: 'sonnet' })).toContain('sonnet');
    expect(t.roster.get(ada.id).model).toBe('sonnet');
    await until(() => t.engine.ready(ada.id));
    expect(await t.call(c, 'sleep', { employee: 'Ada' })).toBe('Ada uyudu.');
    expect(t.roster.get(ada.id).lifecycle).toBe('sleeping');
    expect(await t.call(c, 'wake', { employee: ada.id })).toBe('Ada uyandı.');
    await expect(t.call(c, 'sleep', { employee: c.id })).rejects.toThrow(/Kendini uyutamazsın/);
  });
});
