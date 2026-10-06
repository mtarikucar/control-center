import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type Employee } from '@cc/shared';
import { Company } from '../src/company/company.ts';
import { NoticeStore, PlanStore, TaskStore } from '../src/company/store.ts';
import type { McpTool } from '../src/mcp/protocol.ts';
import { officeTools } from '../src/mcp/tools.ts';
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
  const characters = () => ['coder', 'designer'];
  const company = new Company({ roster: s.roster, events: s.events, tasks, plans, notices, dataDir: s.dataDir, hire: (i) => f.engine.hire(i), characters });
  const tools = officeTools({ company, roster: s.roster, tasks, characters });
  const call = async (employee: Employee, name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.find((t: McpTool) => t.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    if (!tool.kinds.includes(employee.kind)) throw new Error(`closed: ${name}`);
    return tool.run({ employee: s.roster.get(employee.id) }, args);
  };
  return { ...s, tasks, plans, company, tools, call };
}

describe('office tools', () => {
  it('splits the tools between everyone and the coordinator', () => {
    const t = make();
    const forMember = t.tools.filter((x) => x.kinds.includes('member')).map((x) => x.name).sort();
    expect(forMember).toEqual(['briefRead', 'myTasks', 'officeStatus', 'taskFinish', 'taskPass', 'taskUpdate']);
    const coordinatorOnly = t.tools.filter((x) => !x.kinds.includes('member')).map((x) => x.name).sort();
    expect(coordinatorOnly).toEqual(['briefUpdate', 'editRoleCard', 'hire', 'planPropose', 'planRevise', 'reportToOwner', 'taskAssign', 'taskCreate', 'taskReprioritize']);
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
});
