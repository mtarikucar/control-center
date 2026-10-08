import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { kpiText, type Employee } from '@cc/shared';
import { Agenda } from '../src/company/agenda.ts';
import { BlueprintStore } from '../src/company/blueprint-store.ts';
import { blueprintText, Blueprints } from '../src/company/blueprint.ts';
import { IntegrationRegistry } from '../src/company/integrations.ts';
import { deskDir, writeDeskDeny } from '../src/desk.ts';
import type { McpTool } from '../src/mcp/protocol.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine, readArgv } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make() {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder']);
  const integrations = new IntegrationRegistry({ db: s.db, roster: s.roster, events: s.events });
  const blueprints = new Blueprints({ company: c.company, roster: s.roster, tasks: c.tasks, plans: c.plans, schedules: c.schedules, memory: c.memory, store: new BlueprintStore(s.db), integrations, constitution: () => c.budget.constitution() });
  const agenda = new Agenda({ roster: s.roster, tasks: c.tasks, schedules: c.schedules, company: c.company, budget: c.budget });
  const tools = officeTools({ company: c.company, roster: s.roster, tasks: c.tasks, characters: () => ['coder'], memory: c.memory, budget: c.budget, engine: f.engine, plans: () => c.plans.list(), agenda, integrations, blueprints });
  const call = async (employee: Employee, name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.find((x: McpTool) => x.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    const current = s.roster.get(employee.id);
    if (!tool.kinds.includes(current.kind)) throw new Error(`Bilinmeyen ya da bu çalışana kapalı araç: ${name}`);
    return tool.run({ employee: current }, args) as Promise<string>;
  };
  const coordinator = c.company.hireCoordinator();
  /** The onboarding's required questions, answered: the profile a blueprint stands on. */
  const profile = () => {
    const write = (section: string, fields: Record<string, unknown>) => c.company.profileUpdate(coordinator.id, { section, fields, assumed: false });
    write('identity', { name: 'Kıvılcım İçerik', sector: 'dijital içerik ajansı' });
    write('offer', { products: ['Instagram, TikTok, LinkedIn içeriği'] });
    write('customers', { segments: ['altı KOBİ'], channels: ['tavsiye'] });
    write('goals', { goals: ['Haftalık takvim zamanında'] });
    write('success', { done: ['Raporlar zamanında'] });
    write('tools', { email: ['Gmail'] });
    write('constraints', { budget: 'aylık 100 USD', other: ['yayın kararı kurucuda'] });
  };
  const snapshot = () => ({
    employees: s.roster.list({ includeArchived: true }).map((e) => `${e.id}|${e.name}|${e.lifecycle}`),
    goals: c.company.goals().map((g) => `${g.id}|${g.title}|${g.status}`),
    playbook: c.memory.playbookTopics().map((p) => `${p.topic}|${p.version}`),
    schedules: c.schedules.list({ statuses: ['active', 'paused', 'stopped'] }).map((x) => `${x.id}|${x.title}`),
    tasks: c.tasks.list({ limit: 1000 }).map((t) => `${t.id}|${t.title}|${t.assignee}`),
    events: s.events.lastSeq(),
  });
  return { ...s, ...c, f, integrations, blueprints, tools, call, coordinator, profile, snapshot };
}

const KPI = { name: 'Zamanında hazır oranı', target: 90, direction: 'atLeast', unit: '%', source: 'manual', cadence: 'weekly' };
/** The pilot's agency (pilot-senaryosu §4), cut to what a test needs. */
const BP = () => ({
  title: 'Kurulum: Kıvılcım İçerik',
  summary: 'Üç kişilik içerik ajansı; altı KOBİ için Instagram, TikTok ve LinkedIn içeriği; yayın kararı kurucuda.',
  brief: '# Kıvılcım İçerik\n\nAltı KOBİ için içerik üreten bir ajans. Yayın kararı kurucuda.',
  roles: [
    { key: 'yazar', name: 'Ece', template: 'icerik-yazari', role: 'Marka dili: samimi.', capabilities: ['docs.write', 'social.draft', 'web.fetch'] },
    { key: 'editor', name: 'Efe', template: 'editor' },
    { key: 'hesap', name: 'Nil', role: 'Gelen kutusu özeti ve aylık rapor; gönderim kurucuda.', model: 'sonnet', title: 'Hesap Asistanı', capabilities: ['email.read', 'email.send', 'calendar.read'] },
  ],
  playbook: [
    { topic: 'Yayın onay kuralı', text: 'Yayın yalnız kurucunun onayıyla.' },
    { topic: 'Müşteri yanıt kuralları', text: 'Fiyat ve tarih sözü verilmez.' },
  ],
  goals: [{ key: 'h1', title: 'Haftalık takvim zamanında', why: 'Müşteriler takvimi Cuma bekliyor.', done: ['Altı müşterinin takvimi Cuma 17:00’de hazır'], kpis: [KPI] }],
  routines: [{ key: 'rapor', title: 'Haftalık müşteri raporu', role: 'hesap', reviewer: 'editor', cron: '0 9 * * 1', done: ['Rapor şablona uygun'] }],
  tasks: [
    { key: 'arastirma', title: 'Pastane müşterisi araştırması', role: 'yazar', reviewer: 'editor', done: ['Kaynaklı bir sayfa'], requires: ['web.fetch'] },
    { key: 'takvim', title: 'İçerik takvimi taslağı', role: 'yazar', reviewer: 'editor', done: ['Haftalık takvim'] },
  ],
  closedMode: { deny: ['mcp__claude_ai_Gmail', 'mcp__claude_ai_jeeta', 'Bash(git push*)'] },
  estimates: { quotaPct: 3, usd: 0, days: 1 },
  risks: 'Pilot 0: bağlayıcılar kapalı.',
});

describe('Blueprint — proposing it', () => {
  it('review focus: the onboarding’s required questions come first; then the office checks it and shows it on a plan card', () => {
    const t = make();
    const c = t.coordinator.id;
    expect(() => t.blueprints.propose(c, BP())).toThrow(/Önce şirketin işini öğren.*zorunlu sorular açık: .*Firmanızın adı ne\?/s);
    expect(t.plans.list()).toEqual([]);
    t.profile();
    const { plan } = t.blueprints.propose(c, BP());
    expect(plan).toMatchObject({ title: 'Kurulum: Kıvılcım İçerik', status: 'draft', goal: BP().summary, quotaPct: 3, usd: 0, days: 1 });
    expect(plan.method).toMatchObject({ workType: 'operations' });
    expect(plan.people.split('\n')).toEqual([
      'Ece — İçerik Yazarı (şablon icerik-yazari, sonnet)',
      'Efe — Editör ve Kalite Kontrolcüsü (şablon editor, opus)',
      'Nil — Hesap Asistanı (sonnet)',
    ]);
    // In install order: brief, playbook, roles, goals, routines, tasks.
    expect(plan.steps.map((x) => x.split(':')[0])).toEqual(['Şirket özeti', 'El kitabı', 'El kitabı', 'İşe al', 'İşe al', 'İşe al', 'Hedef', 'Rutin', 'Görev', 'Görev']);
    expect(plan.steps[3]).toMatch(/^İşe al: Ece — İçerik Yazarı \(şablon icerik-yazari, sonnet\); yetenekler: docs\.write \[açık\], social\.draft \[yok\], web\.fetch \[açık\]$/);
    expect(plan.steps[6]).toBe(`Hedef: Haftalık takvim zamanında — KPI: ${kpiText({ ...KPI, metric: null } as never)}`);
    expect(plan.steps[7]).toBe('Rutin: Haftalık müşteri raporu → Nil, inceleyen Efe (her Pazartesi 09:00)');
    expect(plan.steps[8]).toBe('Görev: Pastane müşterisi araştırması → Ece, inceleyen Efe; gereken: web.fetch');
    // Risks: the given ones, what is not open, what goes outward.
    expect(plan.risks).toContain('Pilot 0: bağlayıcılar kapalı.');
    expect(plan.risks).toContain('Açık olmayan yetenekler: social.draft (Ece), email.read (Nil), email.send (Nil), calendar.read (Nil)');
    expect(plan.risks).toContain('Dışa dönük yetenekler (B9’a kadar yalnız metinle korunur): email.send (Nil)');
    // Review, Kerem round 1: what the closed mode does not do, on the card the owner approves.
    expect(plan.risks).toContain('Kapalı kip: 3 kural, her yeni masaya ilk oturumdan önce yazılır; B9’a kadar çalışan kendi masasındaki kuralı kaldırabilir, blueprintRead bunu bir sonraki oturumda “TUTMADI” diye gösterir');
    expect(t.blueprints.read(plan.id).blueprint.roles.map((r) => r.key)).toEqual(['yazar', 'editor', 'hesap']);
  });

  it('review focus: refuses a wrong blueprint, saying what is wrong, and writes nothing', () => {
    const t = make();
    t.profile();
    const c = t.coordinator.id;
    const variant = (change: (b: ReturnType<typeof BP>) => void) => {
      const b = BP() as ReturnType<typeof BP> & Record<string, unknown>;
      change(b);
      return b;
    };
    const bad: Array<[unknown, RegExp]> = [
      [variant((b) => void (b.roles[1]!.template = 'yok')), /Blueprint: rol “editor”: Bilinmeyen rol şablonu: yok/],
      [variant((b) => void (b.roles[0]!.capabilities = ['whatsapp.send'])), /Blueprint: rol “yazar”: Bilinmeyen yetenek: whatsapp.send/],
      [variant((b) => void (b.roles[1]!.key = 'yazar')), /rol anahtarı “yazar” iki kez geçiyor/],
      [variant((b) => void (b.roles[1]!.name = 'Ece')), /“Ece” adı iki rolde geçiyor/],
      [variant((b) => void (b.roles[0]!.key = 'Yazar 1')), /anahtar “Yazar 1”: küçük harf, rakam ve tire olmalı/],
      [variant((b) => void (b.tasks[0]!.role = 'tasarimci')), /görev “arastirma”: rol “tasarimci” blueprint'te yok/],
      [variant((b) => void (b.tasks[0]!.reviewer = 'yazar')), /görev “arastirma”: inceleyen yapanla aynı olamaz/],
      [variant((b) => void (b.routines[0]!.cron = '* * * * *')), /rutin “rapor”: .*en az 60 dakika/],
      [variant((b) => void (b.goals[0]!.kpis = [{ ...KPI, direction: 'more' }])), /yön \(direction\)/],
      [variant((b) => void delete (b.roles[2] as Record<string, unknown>).model), /rol “hesap”: şablonsuz rolde role ve model gerekli/],
      [variant((b) => void ((b as Record<string, unknown>).tasks = Array.from({ length: 33 }, (_, i) => ({ key: `g${i}`, title: `İş ${i}`, role: 'yazar' })))), /en fazla 40 adım olabilir \(şimdi 41\)/],
      [variant((b) => void ((b as Record<string, unknown>).extra = 1)), /“extra” bilinmeyen alan/],
      [variant((b) => void (b.closedMode = { deny: [''] })), /kapalı kip: boş kural/],
    ];
    for (const [blueprint, error] of bad) expect(() => t.blueprints.propose(c, blueprint), String(error)).toThrow(error);
    // Desks: the constitution's limit, counting only those the install would hire.
    t.budget.setConstitution({ maxEmployees: 3 });
    expect(() => t.blueprints.propose(c, BP())).toThrow(/Kurulum 3 kişi işe alacak; ofiste 2 boş yer var/);
    expect(t.plans.list()).toEqual([]);
  });

  it('review focus: plan cards without a blueprint work as before; blueprintRead says there is none', async () => {
    const t = make();
    const c = t.coordinator.id;
    const plan = t.company.propose(c, { method: METHOD, title: 'Sürüm 1', goal: 'g', approach: 'a', steps: ['İş 1'] });
    t.company.approve(plan.id);
    expect(t.plans.get(plan.id)).toMatchObject({ status: 'approved', steps: ['İş 1'] });
    expect(t.notices.pending(c).at(-1)?.text).toBe('Plan onaylandı: “Sürüm 1” (sürüm 1). Görevleri aç ve dağıt.');
    expect(() => t.blueprints.read(plan.id)).toThrow(/“Sürüm 1” planının blueprint'i yok/);
    await expect(t.call(t.coordinator, 'blueprintApply', { planId: plan.id })).rejects.toThrow(/blueprint'i yok/);
  });
});

describe('Blueprint — installing it', () => {
  it('only once approved; then in order: brief, playbook, roles (desk closed before the first session), goals, routines, tasks', async () => {
    const t = make();
    t.profile();
    const c = t.coordinator.id;
    const { plan } = t.blueprints.propose(c, BP());
    expect(() => t.blueprints.apply(c, plan.id)).toThrow(/Plan onaylı değil/);
    t.company.approve(plan.id);
    expect(t.notices.pending(c).at(-1)?.text).toBe('Plan onaylandı: “Kurulum: Kıvılcım İçerik” (sürüm 1). Bu bir kurulum planı: blueprintApply ile kur; yarıda kalırsa yeniden çalıştır, yapılmışı atlar.');
    const report = t.blueprints.apply(c, plan.id);
    expect(report.finished).toBe(true);
    expect(report.steps.map((x) => [x.step, x.result])).toEqual([
      ['brief', 'done'], ['playbook:Yayın onay kuralı', 'done'], ['playbook:Müşteri yanıt kuralları', 'done'],
      ['role:yazar', 'done'], ['role:editor', 'done'], ['role:hesap', 'done'], ['goal:h1', 'done'], ['routine:rapor', 'done'],
      ['task:arastirma', 'done'], ['task:takvim', 'done'],
    ]);
    expect(t.company.brief()).toContain('Altı KOBİ için içerik üreten bir ajans.');
    expect(t.memory.playbookTopic('Yayın onay kuralı').text).toBe('Yayın yalnız kurucunun onayıyla.');
    const people = Object.fromEntries(t.roster.list().map((e) => [e.name, e]));
    expect(people.Ece).toMatchObject({ title: 'İçerik Yazarı', template: { id: 'icerik-yazari' }, capabilities: ['docs.write', 'social.draft', 'web.fetch'] });
    expect(people.Efe).toMatchObject({ model: 'opus', template: { id: 'editor' } });
    expect(people.Nil).toMatchObject({ title: 'Hesap Asistanı', template: null, capabilities: ['email.read', 'email.send', 'calendar.read'] });
    expect(t.company.goals()).toEqual([expect.objectContaining({ title: 'Haftalık takvim zamanında', kpis: [expect.objectContaining({ name: 'Zamanında hazır oranı', target: 90 })] })]);
    expect(t.schedules.list({ statuses: ['active'] })).toEqual([expect.objectContaining({ title: 'Haftalık müşteri raporu', assignee: people.Nil!.id, reviewer: people.Efe!.id, planId: plan.id })]);
    expect(t.tasks.list({ planId: plan.id }).map((x) => [x.title, x.assignee, x.reviewer, x.requires])).toEqual([
      ['Pastane müşterisi araştırması', people.Ece!.id, people.Efe!.id, ['web.fetch']],
      ['İçerik takvimi taslağı', people.Ece!.id, people.Efe!.id, []],
    ]);
    // Closed mode: each new desk's settings deny the rules, and the very first session already read them.
    for (const name of ['Ece', 'Efe', 'Nil']) {
      const file = join(deskDir(t.dataDir, people[name]!.slug), '.claude', 'settings.json');
      expect(JSON.parse(readFileSync(file, 'utf8')), name).toEqual({ permissions: { deny: BP().closedMode.deny } });
    }
    const starts = await readArgv(t.f.argvLog, 4);
    for (const name of ['Ece', 'Efe', 'Nil']) {
      const first = starts.find((x) => x.cwd === deskDir(t.dataDir, people[name]!.slug));
      expect(first?.deny, name).toEqual(BP().closedMode.deny);
    }
    // The coordinator's desk is not the install's to close.
    expect(existsSync(join(deskDir(t.dataDir, t.coordinator.slug), '.claude', 'settings.json'))).toBe(false);
  });

  it('review focus: a second run gives the same result — no employee, goal, playbook version, routine, task or event more', () => {
    const t = make();
    t.profile();
    const c = t.coordinator.id;
    const { plan } = t.blueprints.propose(c, BP());
    t.company.approve(plan.id);
    t.blueprints.apply(c, plan.id);
    const before = t.snapshot();
    const again = t.blueprints.apply(c, plan.id);
    expect(again.finished).toBe(true);
    expect(again.steps.every((x) => x.result === 'skipped')).toBe(true);
    expect(t.snapshot()).toEqual(before);
    // And a third.
    t.blueprints.apply(c, plan.id);
    expect(t.snapshot()).toEqual(before);
  });

  it('review focus: stopped halfway (no desk left), it goes on where it stopped once there is room; nothing twice', () => {
    const t = make();
    t.profile();
    const c = t.coordinator.id;
    const { plan } = t.blueprints.propose(c, BP());
    t.company.approve(plan.id);
    // Room for the coordinator and two more only.
    t.budget.setConstitution({ maxEmployees: 3 });
    const first = t.blueprints.apply(c, plan.id);
    expect(first.finished).toBe(false);
    expect(first.steps.map((x) => x.result)).toEqual(['done', 'done', 'done', 'done', 'done', 'failed', 'pending', 'pending', 'pending', 'pending']);
    expect(first.steps[5]).toMatchObject({ step: 'role:hesap', error: expect.stringMatching(/Anayasa en fazla 3 çalışan/) });
    expect(t.roster.list().map((e) => e.name)).toEqual(['Koordinatör', 'Ece', 'Efe']);
    expect(t.company.goals()).toEqual([]);
    t.budget.setConstitution({ maxEmployees: 8 });
    const second = t.blueprints.apply(c, plan.id);
    expect(second.finished).toBe(true);
    expect(second.steps.map((x) => x.result)).toEqual(['skipped', 'skipped', 'skipped', 'skipped', 'skipped', 'done', 'done', 'done', 'done', 'done']);
    expect(t.roster.list().map((e) => e.name)).toEqual(['Koordinatör', 'Ece', 'Efe', 'Nil']);
    expect(t.tasks.list({ planId: plan.id })).toHaveLength(2);
  });

  it('review focus: what already exists by its natural key is adopted, not made twice — also when a step was done but never recorded', () => {
    const t = make();
    t.profile();
    const c = t.coordinator.id;
    // Before the install: Efe hired by hand, the approval rule already in the playbook (other words), the goal already set.
    const efe = t.company.hire(c, { name: 'efe', role: 'El ile alınmış editör.', model: 'sonnet' });
    t.memory.updatePlaybook(c, { topic: 'yayın onay kuralı', text: 'Şirketin kendi sözü.' });
    const goal = t.company.goalSet(c, { title: 'Haftalık takvim zamanında', why: 'Önceden açıldı.', done: ['x'] });
    // Room for the two the install hires: Efe is adopted, not counted.
    t.budget.setConstitution({ maxEmployees: 4 });
    const { plan } = t.blueprints.propose(c, BP());
    expect(plan.risks).toContain('Var olan kullanılacak: Efe (çalışan), “Yayın onay kuralı” (el kitabı), “Haftalık takvim zamanında” (hedef)');
    t.company.approve(plan.id);
    const report = t.blueprints.apply(c, plan.id);
    expect(Object.fromEntries(report.steps.map((x) => [x.step, x.result]))).toMatchObject({ 'role:editor': 'adopted', 'playbook:Yayın onay kuralı': 'adopted', 'goal:h1': 'adopted' });
    expect(report.steps.find((x) => x.step === 'role:editor')!.ref).toBe(efe.id);
    expect(t.roster.list().filter((e) => e.name.toLocaleLowerCase('tr') === 'efe')).toHaveLength(1);
    expect(t.memory.playbookTopic('Yayın onay kuralı')).toMatchObject({ topic: 'yayın onay kuralı', text: 'Şirketin kendi sözü.', version: 1 });
    expect(t.company.goals().map((g) => g.id)).toEqual([goal.id]);
    // The adopted Efe reviews the tasks; his desk is not closed by the install (it was not the install's hire).
    expect(t.tasks.list({ planId: plan.id }).every((x) => x.reviewer === efe.id)).toBe(true);
    expect(existsSync(join(deskDir(t.dataDir, efe.slug), '.claude', 'settings.json'))).toBe(false);
    // A crash between doing and recording: the records go, the second run finds everything by its natural key.
    const before = t.snapshot();
    t.db.prepare('DELETE FROM blueprint_steps WHERE plan_id = ?').run(plan.id);
    const again = t.blueprints.apply(c, plan.id);
    expect(again.steps.every((x) => x.result === 'adopted')).toBe(true);
    expect(t.snapshot()).toEqual(before);
  });

  it('review focus: a closed goal of the same title is not adopted — the install opens the goal anew', () => {
    const t = make();
    t.profile();
    const c = t.coordinator.id;
    const old = t.company.goalSet(c, { title: 'Haftalık takvim zamanında', why: 'Eskiden.', done: ['x'] });
    t.company.goalSet(c, { goalId: old.id, status: 'dropped' });
    const { plan } = t.blueprints.propose(c, BP());
    t.company.approve(plan.id);
    const report = t.blueprints.apply(c, plan.id);
    expect(report.steps.find((x) => x.step === 'goal:h1')).toMatchObject({ result: 'done' });
    expect(t.company.goals().filter((g) => g.status === 'active').map((g) => g.title)).toEqual(['Haftalık takvim zamanında']);
    expect(report.steps.find((x) => x.step === 'goal:h1')!.ref).not.toBe(old.id);
  });

  it('review focus (Kerem, round 1): a role whose employee was let go is not hired back; new work for it says to name the role anew — and that works', async () => {
    const t = make();
    t.profile();
    const c = t.coordinator.id;
    const { plan } = t.blueprints.propose(c, BP());
    t.company.approve(plan.id);
    t.blueprints.apply(c, plan.id);
    const nil = t.roster.list().find((e) => e.name === 'Nil')!;
    await t.f.engine.fire(nil.id);
    const next = BP();
    next.tasks.push({ key: 'yeni', title: 'Aylık rapor', role: 'hesap', reviewer: 'editor', done: ['Rapor'] } as never);
    const revised = t.blueprints.propose(c, next, { planId: plan.id });
    expect(revised.plan.risks).toContain('Çalışanı işten çıkarılmış rol: hesap (Nil) — kurulum onu geri almaz; ona yeni iş verecek adımlar kurulamaz, rolü yeni bir anahtarla yaz');
    t.company.approve(plan.id);
    for (let run = 0; run < 2; run += 1) {
      const report = t.blueprints.apply(c, plan.id);
      expect(report.steps.find((x) => x.step === 'role:hesap')).toMatchObject({ result: 'skipped', note: 'çalışanı işten çıkarıldı (Nil)' });
      expect(report.steps.find((x) => x.step === 'task:yeni')).toMatchObject({
        result: 'failed', error: expect.stringMatching(/“hesap” rolünün çalışanı Nil işten çıkarıldı; kurulum işten çıkarılanı geri almaz: revizyonda bu role yeni bir anahtar ver/),
      });
    }
    expect(t.roster.list().map((e) => e.name)).not.toContain('Nil');
    // Named anew: a new key hires someone, and the new work goes to them.
    const again = BP();
    again.roles.push({ key: 'hesap2', name: 'Naz', role: 'Gelen kutusu özeti ve aylık rapor.', model: 'sonnet', title: 'Hesap Asistanı' } as never);
    again.tasks.push({ key: 'yeni', title: 'Aylık rapor', role: 'hesap2', reviewer: 'editor', done: ['Rapor'] } as never);
    t.blueprints.propose(c, again, { planId: plan.id });
    t.company.approve(plan.id);
    const report = t.blueprints.apply(c, plan.id);
    expect(report.finished).toBe(true);
    const naz = t.roster.list().find((e) => e.name === 'Naz')!;
    expect(t.tasks.list({ planId: plan.id }).find((x) => x.title === 'Aylık rapor')!.assignee).toBe(naz.id);
  });

  it('review focus (Kerem, round 1): a revision counts against the limits only the routines and tasks it would add', () => {
    const t = make();
    t.profile();
    const c = t.coordinator.id;
    t.budget.setConstitution({ maxSchedules: 2, openTasksPerPlan: 3 });
    const { plan } = t.blueprints.propose(c, BP());
    t.company.approve(plan.id);
    t.blueprints.apply(c, plan.id);
    const next = BP();
    next.routines.push({ key: 'ozet', title: 'Gelen kutusu özeti', role: 'hesap', cron: '30 8 * * 1-5', done: ['Özet'] } as never);
    next.tasks.push({ key: 'sablon', title: 'Rapor şablonu', role: 'hesap', done: ['Şablon'] } as never);
    // One routine installed + one new = 2 (the limit); two tasks open + one new = 3 (the limit).
    expect(t.blueprints.propose(c, next, { planId: plan.id }).plan.status).toBe('draft');
    t.company.approve(plan.id);
    expect(t.blueprints.apply(c, plan.id).finished).toBe(true);
    // One more of each is over.
    next.routines.push({ key: 'fazla', title: 'Fazla', role: 'hesap', cron: '0 12 * * 1', done: ['x'] } as never);
    expect(() => t.blueprints.propose(c, next, { planId: plan.id })).toThrow(/Kurulum 1 rutin açacak; rutin sınırına 0 yer var/);
  });

  it('closing a desk keeps what its settings already say: other keys and rules stay, the new rules join', () => {
    const t = make();
    const dir = join(deskDir(t.dataDir, 'ornek'), '.claude');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ model: 'haiku', permissions: { allow: ['Read'], deny: ['mcp__a'] } }));
    writeDeskDeny(t.dataDir, 'ornek', ['mcp__a', 'mcp__b']);
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ model: 'haiku', permissions: { allow: ['Read'], deny: ['mcp__a', 'mcp__b'] } });
  });

  it('a revision installs what is new and skips the rest; a step taken out is shown as no longer in the blueprint', () => {
    const t = make();
    t.profile();
    const c = t.coordinator.id;
    const { plan } = t.blueprints.propose(c, BP());
    t.company.approve(plan.id);
    t.blueprints.apply(c, plan.id);
    const next = BP();
    next.playbook = next.playbook.slice(0, 1);
    next.tasks.push({ key: 'rapor-sablonu', title: 'Rapor şablonu', role: 'hesap', reviewer: 'editor', done: ['Şablon'] } as never);
    const revised = t.blueprints.propose(c, next, { planId: plan.id });
    expect(revised.plan).toMatchObject({ id: plan.id, status: 'draft', version: 2 });
    // The install's own hires are not "existing ones to adopt" on its revision's card.
    expect(revised.plan.risks).not.toContain('Var olan kullanılacak');
    // A revision of a running plan waits for the owner like any revision.
    expect(() => t.blueprints.apply(c, plan.id)).toThrow(/Plan onaylı değil/);
    t.company.approve(plan.id);
    const report = t.blueprints.apply(c, plan.id);
    expect(report.steps.filter((x) => x.result === 'done').map((x) => x.step)).toEqual(['task:rapor-sablonu']);
    expect(t.blueprints.read(plan.id).steps.find((x) => x.step === 'playbook:Müşteri yanıt kuralları')).toMatchObject({ state: 'removed' });
  });
});

describe('Blueprint — reading it, and the closed mode checked by list only', () => {
  it('per desk and rule: denied in the latest session is verified, open is not, a shell pattern cannot be checked by a list', () => {
    const t = make();
    t.profile();
    const c = t.coordinator.id;
    const efe = t.company.hire(c, { name: 'Efe', role: 'r', model: 'sonnet' });
    const { plan } = t.blueprints.propose(c, BP());
    t.company.approve(plan.id);
    t.blueprints.apply(c, plan.id);
    const ece = t.roster.list().find((e) => e.name === 'Ece')!;
    const before = t.events.lastSeq();
    expect(t.blueprints.read(plan.id).closedMode.find((d) => d.name === 'Ece')!.rules.map((r) => r.check)).toEqual(['no_session', 'no_session', 'unverifiable']);
    // Ece's real session: Gmail connected with none of its tools (the desk's deny), jeeta with all of them (not denied).
    t.events.append(ece.id, { type: 'session.started', model: 'm', mcp: [{ name: 'claude.ai Gmail', status: 'connected', tools: 0, toolNames: [] }, { name: 'claude.ai jeeta', status: 'connected', tools: 2, toolNames: ['jeeta_list_team', 'jeeta_send_message'] }] });
    const view = t.blueprints.read(plan.id);
    expect(view.closedMode.find((d) => d.name === 'Ece')!.rules).toEqual([
      expect.objectContaining({ rule: 'mcp__claude_ai_Gmail', check: 'verified' }),
      expect.objectContaining({ rule: 'mcp__claude_ai_jeeta', check: 'open' }),
      expect.objectContaining({ rule: 'Bash(git push*)', check: 'unverifiable' }),
    ]);
    expect(view.closedMode.find((d) => d.name === 'Efe')).toMatchObject({ employeeId: efe.id, applied: false });
    expect(view.profileVersion).toBe(t.company.profile().version);
    // Reading writes nothing.
    expect(t.events.lastSeq()).toBe(before + 1);
  });

  it('review focus (Kerem, round 1): a rule naming a tool or server no session and no vocabulary has seen is not “verified” — it may close nothing; the card warns before approval', () => {
    const t = make();
    t.profile();
    const c = t.coordinator.id;
    const b = BP();
    b.closedMode = {
      deny: ['mcp__claude_ai_Gmail__send_email', 'mcp__claude_ai_Gmail__send_message', 'mcp__claude_ai_Gmail__create_draft', 'mcp__claude_ai_Gmial', 'mcp__claude_ai_Gmail__untrash_message', 'mcp__blender'],
    };
    // The coordinator's session shows two things no vocabulary names: a Gmail tool and a local server.
    t.events.append(c, { type: 'session.started', model: 'm', mcp: [{ name: 'claude.ai Gmail', status: 'connected', tools: 1, toolNames: ['untrash_message'] }, { name: 'blender', status: 'connected', tools: 1, toolNames: ['look'] }] });
    const { plan } = t.blueprints.propose(c, b);
    expect(plan.risks).toContain('Kapalı kipte tanınmayan ad: mcp__claude_ai_Gmail__send_email, mcp__claude_ai_Gmial — hiçbir oturumda ya da sözlükte görülmedi; kural bir şey kapatmıyor olabilir, adı denetle');
    t.company.approve(plan.id);
    t.blueprints.apply(c, plan.id);
    const ece = t.roster.list().find((e) => e.name === 'Ece')!;
    // The real name is send_message: open on Ece's desk; the guessed send_email closes nothing.
    t.events.append(ece.id, { type: 'session.started', model: 'm', mcp: [{ name: 'claude.ai Gmail', status: 'connected', tools: 2, toolNames: ['send_message', 'list_labels'] }] });
    expect(t.blueprints.read(plan.id).closedMode.find((d) => d.name === 'Ece')!.rules).toEqual([
      { rule: 'mcp__claude_ai_Gmail__send_email', check: 'unknown' },
      { rule: 'mcp__claude_ai_Gmail__send_message', check: 'open' },
      // A tool the office knows (the vocabulary names it) and not in this session: closed there.
      { rule: 'mcp__claude_ai_Gmail__create_draft', check: 'verified' },
      { rule: 'mcp__claude_ai_Gmial', check: 'unknown' },
      // Known from a session alone: a tool another desk lists, a server another desk reported.
      { rule: 'mcp__claude_ai_Gmail__untrash_message', check: 'verified' },
      { rule: 'mcp__blender', check: 'not_connected' },
    ]);
    expect(blueprintText(t.blueprints.read(plan.id), t.plans.get(plan.id))).toContain('mcp__claude_ai_Gmail__send_email tanınmıyor: hiçbir oturumda ya da sözlükte görülmedi, kural bir şey kapatmıyor olabilir');
  });

  it('review focus (task 8d67d8ba): a wildcard rule (mcp__server__*) closes the whole server as the CLI applies it — read like a server rule, never “unknown” for a known server', () => {
    const t = make();
    t.profile();
    const c = t.coordinator.id;
    const b = BP();
    b.closedMode = { deny: ['mcp__claude_ai_Gmail__*', 'mcp__claude_ai_jeeta__*', 'mcp__claude_ai_Notion__*', 'mcp__claude_ai_Gmial__*'] };
    const { plan } = t.blueprints.propose(c, b);
    // The card warns only about the server no session and no vocabulary has seen.
    expect(plan.risks).toContain('Kapalı kipte tanınmayan ad: mcp__claude_ai_Gmial__* — hiçbir oturumda ya da sözlükte görülmedi');
    expect(plan.risks).not.toContain('mcp__claude_ai_Gmail__*');
    t.company.approve(plan.id);
    t.blueprints.apply(c, plan.id);
    const ece = t.roster.list().find((e) => e.name === 'Ece')!;
    const rules = () => t.blueprints.read(plan.id).closedMode.find((d) => d.name === 'Ece')!.rules.map((r) => [r.rule, r.check]);
    expect(rules()).toEqual([
      ['mcp__claude_ai_Gmail__*', 'no_session'], ['mcp__claude_ai_jeeta__*', 'no_session'], ['mcp__claude_ai_Notion__*', 'no_session'], ['mcp__claude_ai_Gmial__*', 'unknown'],
    ]);
    // Ece's session: Gmail denied by the desk (connected, no tools), jeeta with its tools, Notion not in it.
    t.events.append(ece.id, { type: 'session.started', model: 'm', mcp: [{ name: 'claude.ai Gmail', status: 'connected', tools: 0, toolNames: [] }, { name: 'claude.ai jeeta', status: 'connected', tools: 2, toolNames: ['jeeta_list_team', 'jeeta_send_message'] }] });
    expect(rules()).toEqual([
      ['mcp__claude_ai_Gmail__*', 'verified'], ['mcp__claude_ai_jeeta__*', 'open'], ['mcp__claude_ai_Notion__*', 'not_connected'], ['mcp__claude_ai_Gmial__*', 'unknown'],
    ]);
  });

  it('the tools: blueprintPropose and blueprintApply for the coordinator, blueprintRead for leads; the API reads it', async () => {
    const t = make();
    t.profile();
    expect(t.tools.find((x) => x.name === 'blueprintPropose')?.kinds).toEqual(['coordinator']);
    expect(t.tools.find((x) => x.name === 'blueprintApply')?.kinds).toEqual(['coordinator']);
    expect(t.tools.find((x) => x.name === 'blueprintRead')?.kinds).toEqual(['lead', 'coordinator']);
    const proposed = await t.call(t.coordinator, 'blueprintPropose', { blueprint: BP() });
    const planId = /plan (\S+)\)/.exec(proposed)![1]!;
    expect(proposed).toBe(`Blueprint plan kartı olarak sahibine gitti: “Kurulum: Kıvılcım İçerik” (plan ${planId}), 10 adım. Onaylanınca blueprintApply ile kur.`);
    t.company.approve(planId);
    const applied = await t.call(t.coordinator, 'blueprintApply', { planId });
    expect(applied.split('\n')[0]).toBe('Kurulum: “Kurulum: Kıvılcım İçerik” — 10 adım: 10 yapıldı.');
    expect(applied).toContain('• İşe al: Ece — yapıldı');
    expect(await t.call(t.coordinator, 'blueprintApply', { planId })).toBe('Kurulum: “Kurulum: Kıvılcım İçerik” — 10 adım: hepsi zaten yapılmıştı; hiçbir şey eklenmedi.');
    const read = await t.call(t.coordinator, 'blueprintRead', { planId });
    expect(read).toContain('# Blueprint: Kurulum: Kıvılcım İçerik');
    expect(read).toContain('• İşe al: Ece — yapıldı');
    expect(read).toContain('## Kapalı kip (yalnız liste, salt okunur; hiçbir araç çağrılmadı)');
  });

  it('under full autonomy the plan starts at once and the reply says to install now', async () => {
    const t = make();
    t.profile();
    t.budget.setConstitution({ autonomy: 'free' });
    const proposed = await t.call(t.coordinator, 'blueprintPropose', { blueprint: BP() });
    expect(proposed).toMatch(/^Blueprint planı başladı \(tam serbestlik\): “Kurulum: Kıvılcım İçerik” \(plan \S+\), 10 adım\. Şimdi blueprintApply ile kur\.$/);
  });
});
