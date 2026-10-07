import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type Employee } from '@cc/shared';
import type { McpTool } from '../src/mcp/protocol.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { companyFor, METHOD } from './company-helpers.ts';
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
  const tools = officeTools({ company: c.company, roster: s.roster, tasks: c.tasks, characters: () => ['coder', 'designer'], memory: c.memory, budget: c.budget, engine: f.engine, plans: () => c.plans.list() });
  const call = async (employee: Employee, name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.find((t: McpTool) => t.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    const current = s.roster.get(employee.id);
    // The protocol's own refusal (mcp/protocol.ts) for a tool outside the caller's kinds.
    if (!tool.kinds.includes(current.kind)) throw new Error(`Bilinmeyen ya da bu çalışana kapalı araç: ${name}`);
    return tool.run({ employee: current }, args);
  };
  return { ...s, ...c, engine: f.engine, tools, call };
}

describe('office tools', () => {
  it('splits the tools between everyone, leads and the coordinator', () => {
    const t = make();
    const names = (kind: 'member' | 'lead' | 'coordinator') => t.tools.filter((x) => x.kinds.includes(kind)).map((x) => x.name).sort();
    expect(names('member')).toEqual([
      'askColleague', 'briefRead', 'decisionsRead', 'memorySearch', 'methodRead', 'myTasks', 'noteWrite', 'officeStatus', 'playbookRead', 'propose', 'recordSpend', 'reviewDecide',
      'taskFinish', 'taskPark', 'taskPass', 'taskUpdate',
    ]);
    expect(names('lead').filter((n) => !names('member').includes(n))).toEqual(['decisionRecord', 'goalsRead', 'playbookUpdate', 'proposalDecide', 'proposalsOpen', 'taskAssign', 'taskCreate', 'taskReprioritize', 'taskUnpark']);
    expect(names('coordinator').filter((n) => !names('lead').includes(n))).toEqual([
      'appointLead', 'briefUpdate', 'budgetStatus', 'editRoleCard', 'employeeNote', 'goalSet', 'hire', 'planPropose', 'planRetro', 'planRevise', 'reportToOwner', 'restUntil', 'setModel', 'sleep', 'wake',
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
    const handed = await t.call(ada, 'taskFinish', { taskId: task.id, summary: 'Rapor hazır.', evidence: ['rapor.md yazıldı'], outputs: ['rapor.md'], learned: 'Veriler eksikti.' });
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
    const plan = await t.call(c, 'planPropose', { method: METHOD, title: 'Lansman', goal: 'g', approach: 'a', people: 'bir yazar', steps: ['metin', 'görsel'], quotaPct: 10, usd: 25, days: 3, risks: 'kota' });
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
    await expect(t.call(ada, 'decisionRecord', { title: 'x', chosen: 'y', reason: 'z' })).rejects.toThrow(/kapalı/);
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

  it('lets anyone propose and the decider see and settle it; a purchase says it went to the owner', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    expect(await t.call(ada, 'propose', { kind: 'purchase', title: 'Telefon hattı', text: 'Müşteriler arıyor.', usd: 12 })).toMatch(/sahibine gitti/);
    expect(await t.call(ada, 'propose', { kind: 'idea', title: 'Blog', text: 'Haftalık yazı.' })).toMatch(/Koordinatör/);
    const open = await t.call(c, 'proposalsOpen');
    expect(open).toContain('Blog');
    expect(open).not.toContain('Telefon');
    const id = t.proposals.list({ statuses: ['open'] })[0]!.id;
    expect(await t.call(c, 'proposalDecide', { proposalId: id, decision: 'accept', note: 'Başla.' })).toMatch(/kabul/);
    await expect(t.call(ada, 'propose', { kind: 'gift', title: 'x', text: 'y' })).rejects.toThrow(/Bilinmeyen öneri türü/);
  });

  it('lets a lead create tasks for their own team only; the coordinator appoints the lead', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r', team: 'İçerik' });
    const can = t.company.hire(c.id, { name: 'Can', role: 'r', team: 'İçerik' });
    const bob = t.company.hire(c.id, { name: 'Bob', role: 'r', team: 'Ürün' });
    expect(await t.call(c, 'appointLead', { employee: 'Ada', team: 'İçerik' })).toMatch(/lider/);
    expect(await t.call(ada, 'taskCreate', { assignee: 'Can', title: 'Slogan' })).toMatch(/Görev açıldı/);
    await expect(t.call(ada, 'taskCreate', { assignee: bob.id, title: 'x' })).rejects.toThrow(/kendi ekibine/);
    expect(t.tasks.list({ assignee: can.id }).map((x) => x.title)).toEqual(['Slogan']);
  });

  it('review focus: asks a colleague without interrupting them, and refuses yourself, strangers and the silent', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const can = t.company.hire(OWNER, { name: 'Can', role: 'r' });
    await expect(t.call(ada, 'askColleague', { to: 'Can', question: 'NOTES.md nerede?' })).rejects.toThrow(/hiç konuşmadı/);
    t.engine.send(can.id, 'merhaba');
    await until(() => t.roster.get(can.id).sessionStarted && t.engine.ready(can.id), 8000);
    await t.engine.sleep(can.id);
    const answer = await t.call(ada, 'askColleague', { to: 'Can', question: 'NOTES.md nerede?' });
    expect(answer).toMatch(/^Can: /);
    expect(t.roster.get(can.id).lifecycle).toBe('sleeping');
    await expect(t.call(ada, 'askColleague', { to: 'Ada', question: 'x' })).rejects.toThrow(/Kendine soramazsın/);
    await expect(t.call(ada, 'askColleague', { to: 'kimse', question: 'x' })).rejects.toThrow(/bulunamadı/);
  });
});

describe('office tools — task difficulty', () => {
  it('taskCreate, taskPass and taskAssign take a difficulty; taskAssign can say it anew; the coordinator reads the mapping', async () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    const can = t.company.hire(c.id, { name: 'Can', role: 'r' });
    await t.call(c, 'taskCreate', { assignee: ada.id, title: 'Mimari', difficulty: 'hard' });
    await t.call(ada, 'taskPass', { to: can.id, title: 'Yazım', difficulty: 'easy' });
    expect(await t.call(ada, 'taskPass', { to: can.id, title: 'Acil', difficulty: 'critical' })).toMatch(/“kritik” yerine “zor”/);
    expect(t.tools.find((x) => x.name === 'taskPass')!.inputSchema).toMatchObject({ properties: { difficulty: { description: expect.stringMatching(/counts as hard/) } } });
    const byTitle = (title: string) => t.tasks.list({ limit: 100 }).find((x) => x.title === title)!;
    expect([byTitle('Mimari').difficulty, byTitle('Yazım').difficulty]).toEqual(['hard', 'easy']);
    await t.call(c, 'taskAssign', { taskId: byTitle('Yazım').id, assignee: ada.id, difficulty: 'medium' });
    expect(byTitle('Yazım')).toMatchObject({ assignee: ada.id, difficulty: 'medium' });
    await expect(t.call(c, 'taskCreate', { assignee: ada.id, title: 'x', difficulty: 'trivial' })).rejects.toThrow(/Zorluk/);
    expect(t.tools.find((x) => x.name === 'taskCreate')!.description).toMatch(/easy → haiku, medium → sonnet, hard → opus, critical → fable/);
  });

  it('lets anyone read the work-type methods', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    expect(await t.call(ada, 'methodRead')).toContain('content');
    expect(await t.call(ada, 'methodRead', { type: 'research' })).toContain('## Kanıt');
    await expect(Promise.resolve().then(() => t.call(ada, 'methodRead', { type: 'x' }))).rejects.toThrow(/Bilinmeyen iş türü/);
  });

  it('planPropose takes the method and refuses a plan without one', async () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    await expect(Promise.resolve().then(() => t.call(c, 'planPropose', { title: 'P', goal: 'g', approach: 'a' }))).rejects.toThrow(/methodRead/);
    expect(await t.call(c, 'planPropose', { title: 'P', goal: 'g', approach: 'a', method: METHOD })).toMatch(/Plan kartı açıldı/);
    expect(t.plans.list()[0]!.method).toEqual(METHOD);
    const schema = t.tools.find((x) => x.name === 'planPropose')!.inputSchema as { required: string[] };
    expect(schema.required).toContain('method');
  });

  it('taskFinish takes evidence and says how many lines a hand-in needs', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const task = t.company.createTask(OWNER, { assignee: ada.id, title: 'Rapor', done: ['rapor.md var', 'sayılar kaynaklı'] });
    await expect(Promise.resolve().then(() => t.call(ada, 'taskFinish', { taskId: task.id, summary: 'bitti' }))).rejects.toThrow(/2 madde var/);
    await t.call(ada, 'taskFinish', { taskId: task.id, summary: 'bitti', evidence: ['rapor.md yazıldı', 'her sayının yanında kaynak'] });
    expect(t.tasks.get(task.id).result?.evidence).toHaveLength(2);
  });

  it('names a reviewer by name, and the reviewer decides with reviewDecide', async () => {
    const t = make();
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const can = t.company.hire(OWNER, { name: 'Can', role: 'r' });
    await t.call(ada, 'taskPass', { to: 'Can', title: 'Çeviri', done: ['tr metin'], reviewer: 'Ada' });
    const task = t.tasks.list({ assignee: can.id })[0]!;
    expect(task.reviewer).toBe(ada.id);
    expect(await t.call(can, 'taskFinish', { taskId: task.id, summary: 'çevirdim', evidence: ['ceviri.md'] })).toMatch(/incelemeye gitti/);
    const review = t.tasks.list({ assignee: ada.id }).find((x) => x.kind === 'review')!;
    expect(await t.call(ada, 'myTasks')).toContain('İnceleme: Çeviri');
    expect(await t.call(ada, 'reviewDecide', { taskId: review.id, decision: 'changes', findings: [{ severity: 'important', text: 'bir paragraf eksik' }] })).toMatch(/Değişiklik istendi/);
    expect(t.tasks.get(task.id).status).toBe('waiting');
  });

  it('lets the coordinator write a plan’s retro', async () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    const plan = t.company.propose(c.id, { title: 'P', goal: 'g', approach: 'a', method: METHOD });
    t.company.approve(plan.id);
    expect(await t.call(c, 'planRetro', { planId: plan.id, wentWell: 'iyi', stuck: 'yok', change: 'erken başla' })).toMatch(/playbookUpdate/);
  });

  it('final review: reviewDecide says when the one who did the work is gone and the task needs someone else', async () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const task = t.company.createTask(c.id, { assignee: ada.id, title: 'Metin', reviewer: c.id });
    t.company.finish(ada.id, task.id, { summary: 'yaptım', outputs: [], learned: '' });
    t.roster.update(ada.id, { lifecycle: 'archived' });
    const review = t.tasks.list({ assignee: c.id }).find((x) => x.reviewOf === task.id)!;
    const reply = await t.call(c, 'reviewDecide', { taskId: review.id, decision: 'changes', findings: [{ severity: 'important', text: 'eksik' }] });
    expect(reply).toMatch(/işten çıkarıldı/);
    expect(reply).toMatch(/taskAssign/);
  });

  it('lets the coordinator set goals and anyone in charge read them with their plans', async () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    expect(await t.call(c, 'goalSet', { title: 'Lansman', why: 'Misyon', done: ['site yayında'] })).toMatch(/Hedef açıldı/);
    const goal = t.goals.list()[0]!;
    await t.call(c, 'planPropose', { title: 'Site', goal: 'g', approach: 'a', method: METHOD, goalId: goal.id });
    const read = await t.call(c, 'goalsRead');
    expect(read).toContain('Lansman');
    expect(read).toContain('Site');
  });

  it('lets the coordinator rest when there is nothing worth doing', async () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    expect(await t.call(c, 'restUntil', { hours: 12, reason: 'Sahibinin cevabı bekleniyor' })).toMatch(/Dinleniyorsun/);
    expect(t.state.restUntil()).toBeGreaterThan(Date.now());
  });

  it('taskPark sets a task aside with a reason and says when it returns; taskUnpark brings it back', async () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const task = t.company.createTask(c.id, { assignee: ada.id, title: 'Pencere' });
    t.company.start(task.id);
    const reply = await t.call(ada, 'taskPark', { taskId: task.id, until: '+6h', reason: 'ölçüm penceresi dolsun' });
    expect(reply).toMatch(/ertelendi/);
    expect(reply).toMatch(/\d\d:\d\d/);
    expect(t.tasks.get(task.id)).toMatchObject({ status: 'parked', parkedReason: 'ölçüm penceresi dolsun' });
    await expect(Promise.resolve().then(() => t.call(ada, 'taskPark', { taskId: task.id, until: 'yarın', reason: 'x' }))).rejects.toThrow(/Dönüş saati/);
    await expect(Promise.resolve().then(() => t.call(ada, 'taskUnpark', { taskId: task.id }))).rejects.toThrow(/kapalı/);
    expect(await t.call(c, 'taskUnpark', { taskId: task.id })).toMatch(/sıraya döndü/);
    expect(t.tasks.get(task.id).status).toBe('waiting');
  });

  it('taskPark by someone other than the assignee names whose task it was, not the caller’s own queue', async () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const own = t.company.createTask(c.id, { assignee: ada.id, title: 'Kendi' });
    const other = t.company.createTask(c.id, { assignee: ada.id, title: 'Başkası' });
    expect(await t.call(ada, 'taskPark', { taskId: own.id, until: '+6h', reason: 'bekliyor' })).toMatch(/Sıran boş/);
    const reply = await t.call(c, 'taskPark', { taskId: other.id, until: '+6h', reason: 'bekliyor' });
    expect(reply).toMatch(/^“Başkası” Ada için .*\d\d:\d\d saatine ertelendi; saatinde onun sırasına geri gelecek\.$/);
    expect(reply).not.toMatch(/Sıran boş/);
  });

  it('taskCreate and taskPass take a start time and a due date', async () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    const ada = t.company.hire(OWNER, { name: 'Ada', role: 'r' });
    const can = t.company.hire(OWNER, { name: 'Can', role: 'r' });
    expect(await t.call(c, 'taskCreate', { assignee: 'Ada', title: 'Sonra', startAfter: '+1d', dueAt: '+3d' })).toMatch(/başlangıç/);
    const created = t.tasks.list({ assignee: ada.id })[0]!;
    expect(created.notBefore).toBeGreaterThan(Date.now());
    expect(created.dueAt).toBeGreaterThan(created.notBefore!);
    await t.call(ada, 'taskPass', { to: 'Can', title: 'Takip', startAfter: '+2h' });
    expect(t.tasks.list({ assignee: can.id })[0]!.notBefore).toBeGreaterThan(Date.now());
    await expect(Promise.resolve().then(() => t.call(c, 'taskCreate', { assignee: 'Ada', title: 'X', dueAt: '+400d' }))).rejects.toThrow(/Son tarih/);
  });
});
