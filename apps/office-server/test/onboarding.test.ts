import { afterEach, describe, expect, it } from 'vitest';
import { ONBOARDING_QUESTIONS, PROFILE_SPEC, type Employee } from '@cc/shared';
import { Agenda } from '../src/company/agenda.ts';
import { pmText } from '../src/company/craft.ts';
import type { McpTool } from '../src/mcp/protocol.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { companyFor } from './company-helpers.ts';
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
  const c = companyFor(s, f, ['coder']);
  const agenda = new Agenda({ roster: s.roster, tasks: c.tasks, schedules: c.schedules, company: c.company, budget: c.budget });
  const tools = officeTools({ company: c.company, roster: s.roster, tasks: c.tasks, characters: () => ['coder'], memory: c.memory, budget: c.budget, engine: f.engine, plans: () => c.plans.list(), agenda });
  const call = async (employee: Employee, name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.find((x: McpTool) => x.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    const current = s.roster.get(employee.id);
    if (!tool.kinds.includes(current.kind)) throw new Error(`Bilinmeyen ya da bu çalışana kapalı araç: ${name}`);
    return tool.run({ employee: current }, args);
  };
  const coordinator = c.company.hireCoordinator();
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r' });
  const events = (change?: string) =>
    s.events.list({ limit: 5000 }).flatMap((e) => (e.event.type === 'onboarding.changed' && (!change || e.event.change === change) ? [e.event] : []));
  /** The owner writes to someone in the chat, as the engine logs it. */
  const ownerSays = (to: Employee, text = 'cevaplar') => s.events.append(to.id, { type: 'message.user', text, source: 'owner' });
  return { ...s, ...c, tools, call, coordinator, ada, events, ownerSays, log: s.events };
}

/** The pilot's one sentence (pilot-senaryosu §2). */
const PILOT =
  "İstanbul'da üç kişilik bir dijital içerik ajansıyız; altı KOBİ müşterisi için Instagram, TikTok ve LinkedIn içeriği üretiyoruz, haftalık yayın takvimi yapıyoruz ve her ay performans raporu gönderiyoruz; müşteri yazışmaları ve raporlar bizi yoruyor, yayın kararı bende kalsın.";
const REQUIRED = ['name', 'sector', 'products', 'segments', 'channels', 'goals', 'success', 'tools', 'budget', 'limits'];

describe('Onboarding — the question set (ships with the office)', () => {
  it('has 10 required questions, first and in order, then the optional ones; every question sits on fields of the profile', () => {
    expect(ONBOARDING_QUESTIONS.filter((q) => q.required).map((q) => q.id)).toEqual(REQUIRED);
    const firstOptional = ONBOARDING_QUESTIONS.findIndex((q) => !q.required);
    expect(ONBOARDING_QUESTIONS.slice(firstOptional).every((q) => !q.required)).toBe(true);
    expect(new Set(ONBOARDING_QUESTIONS.map((q) => q.id)).size).toBe(ONBOARDING_QUESTIONS.length);
    for (const q of ONBOARDING_QUESTIONS) {
      expect(q.fields.length, q.id).toBeGreaterThan(0);
      for (const f of q.fields) expect(Object.keys(PROFILE_SPEC[q.section].fields), `${q.id}.${f}`).toContain(f);
      expect(q.text, q.id).toMatch(/\?$/);
    }
    expect(pmText()).toContain('onboardingStart');
  });
});

describe('Onboarding — the dialog', () => {
  it('onboardingStart writes the sentence as the owner’s word, opens one dialog at a time and hands the coordinator the guide', async () => {
    const t = make();
    await expect(t.call(t.ada, 'onboardingStart', { description: PILOT })).rejects.toThrow(/kapalı araç/);
    const reply = await t.call(t.coordinator, 'onboardingStart', { description: PILOT });
    expect(reply).toContain('Onboarding başladı');
    expect(reply).toContain('## Onboarding diyaloğu');
    expect(reply).toContain('onboardingNext');
    expect(t.company.profile().sections.identity).toMatchObject({ fields: { summary: PILOT }, assumedFields: [] });
    expect(t.company.onboarding().onboarding).toMatchObject({ status: 'active', description: PILOT, startedBy: t.coordinator.id, rounds: [] });
    expect(t.events('started')).toHaveLength(1);
    await expect(t.call(t.coordinator, 'onboardingStart', { description: 'başka' })).rejects.toThrow(/zaten sürüyor/);
  });

  it('refuses an empty sentence, opening nothing', () => {
    const t = make();
    expect(() => t.company.onboardingStart(t.coordinator.id, '  ')).toThrow(/İş tarifi boş olamaz/);
    expect(t.company.onboarding().onboarding).toBeNull();
    expect(t.company.profile().version).toBe(0);
  });

  it('onboardingNext asks at most 5, required first in order, guesses to be confirmed with their value; each block is a round', async () => {
    const t = make();
    await t.call(t.coordinator, 'onboardingStart', { description: PILOT });
    t.company.profileUpdate(t.coordinator.id, { section: 'identity', fields: { sector: 'dijital içerik ajansı' }, assumed: true });
    const text = await t.call(t.coordinator, 'onboardingNext');
    expect(text).toContain('Tur 1 — sahibine tek mesajda sor:');
    expect(text).toContain('1. Firmanızın adı ne?');
    expect(text).toContain('2. Hangi sektörde çalışıyorsunuz? (şu an varsayım: dijital içerik ajansı; doğru mu?)');
    expect(text).toContain('5. Müşteriler size nereden geliyor, hangi kanallarda çalışıyorsunuz?');
    expect(text).not.toContain('6.');
    expect(t.company.onboarding().onboarding!.rounds).toEqual([{ round: 1, questions: ['name', 'sector', 'products', 'segments', 'channels'], askedAt: expect.any(Number), replied: false }]);
    expect(t.events('round').map((e) => (e as { round: { questions: string[] } }).round.questions)).toEqual([['name', 'sector', 'products', 'segments', 'channels']]);
    const view = t.company.onboarding().questions.find((q) => q.id === 'sector')!;
    // Asked once the owner replies to the round, not before.
    expect(view).toMatchObject({ state: 'assumed', asked: 0, value: { sector: 'dijital içerik ajansı' } });
    t.ownerSays(t.coordinator);
    expect(t.company.onboarding().questions.find((q) => q.id === 'sector')).toMatchObject({ asked: 1 });
  });

  it('answers fill the profile field by field: the owner’s word unmarked, guesses marked; twice unanswered goes to assumption; finish only with no required question open', async () => {
    const t = make();
    const c = t.coordinator.id;
    const write = (section: never, fields: Record<string, unknown>, assumed: boolean) => t.company.profileUpdate(c, { section, fields, assumed });
    t.company.onboardingStart(c, PILOT);
    write('identity' as never, { sector: 'dijital içerik ajansı' }, true);
    // Round 1: the owner answers three; segments stays unanswered, the sector unconfirmed.
    expect(t.company.onboardingNext(c).ask.map((q) => q.id)).toEqual(['name', 'sector', 'products', 'segments', 'channels']);
    t.ownerSays(t.coordinator);
    write('identity' as never, { name: 'Kıvılcım İçerik' }, false);
    write('offer' as never, { products: ['sosyal medya içeriği', 'aylık rapor'] }, false);
    write('customers' as never, { channels: ['Instagram', 'TikTok', 'LinkedIn'] }, false);
    // Round 2: what is still open or a guess, asked fewer than twice, in order, five at most.
    expect(t.company.onboardingNext(c).ask.map((q) => q.id)).toEqual(['sector', 'segments', 'goals', 'success', 'tools']);
    t.ownerSays(t.coordinator);
    write('goals' as never, { goals: ['haftalık takvim zamanında'] }, false);
    write('success' as never, { done: ['raporlar ayın 3. günü hazır'] }, false);
    write('tools' as never, { social: ['Instagram', 'TikTok', 'LinkedIn'] }, false);
    expect(() => t.company.onboardingFinish(c)).toThrow(/Zorunlu sorular cevapsız: segments, budget, limits/);
    // Round 3: segments was asked twice and is still open: to be assumed, not asked again; the sector too is not asked again.
    const third = t.company.onboardingNext(c);
    expect(third.ask.map((q) => q.id)).toEqual(['budget', 'limits']);
    expect(third.assume.map((q) => q.id)).toEqual(['segments']);
    // Called again before the owner answers round 3: the same round, nothing recorded.
    const text = await t.call(t.coordinator, 'onboardingNext');
    expect(text).toContain('Tur 3 henüz cevaplanmadı');
    expect(text).toContain('İki kez sorulup cevapsız kaldı — varsayımla doldur (profileUpdate, assumed: true):');
    expect(text).toContain('• segments → customers.segments: Müşterileriniz kimler (tür ve yaklaşık sayı)?');
    t.ownerSays(t.coordinator);
    write('constraints' as never, { budget: 'aylık 2000 TL', other: ['yayın kararı bende'] }, false);
    write('customers' as never, { segments: ['KOBİ (tahmin)'] }, true);
    const done = t.company.onboardingNext(c);
    expect(done).toMatchObject({ ask: [], assume: [], complete: true, round: null });
    const finished = await t.call(t.coordinator, 'onboardingFinish');
    expect(finished).toContain('Onboarding bitti: zorunlu 10 sorunun 8’i sahibinden, 2’si varsayım (sector, segments).');
    expect(t.company.onboarding().onboarding).toMatchObject({ status: 'done', finishedAt: expect.any(Number) });
    expect(t.events('finished')).toHaveLength(1);
    // The guesses stay marked field by field; the owner's word around them does not.
    expect(t.company.profile().sections.customers).toMatchObject({ assumedFields: ['segments'], fields: { channels: ['Instagram', 'TikTok', 'LinkedIn'] } });
    expect(t.company.profile().sections.identity?.assumedFields).toEqual(['sector']);
    expect(() => t.company.onboardingNext(c)).toThrow(/Sürmekte olan bir onboarding yok/);
    expect(t.company.onboardingStart(c, 'yeni iş').status).toBe('active');
  });

  it('review focus (Kerem, round 1): a round counts as asked only once the owner replied after it; asking again before that opens no round and assumes nothing', async () => {
    const t = make();
    const c = t.coordinator.id;
    const FIRST = ['name', 'sector', 'products', 'segments', 'channels'];
    t.ownerSays(t.coordinator, PILOT);
    t.company.onboardingStart(c, PILOT);
    // Asked three times with no reply: one round, the same five, nothing to assume.
    for (let i = 0; i < 3; i += 1) {
      const next = t.company.onboardingNext(c);
      expect(next.ask.map((q) => q.id)).toEqual(FIRST);
      expect(next).toMatchObject({ waiting: i > 0, assume: [], round: { round: 1, replied: false } });
    }
    expect(t.events('round')).toHaveLength(1);
    expect(t.company.onboarding().questions.filter((q) => q.asked > 0)).toEqual([]);
    expect(await t.call(t.coordinator, 'onboardingNext')).toContain('Tur 1 henüz cevaplanmadı — aynı soruları sor ya da sahibinin cevabını bekle (yeni tur açılmadı):');
    // What does not count as the owner's reply: a system message to the coordinator, the owner writing to someone else.
    t.log.append(c, { type: 'message.user', text: 'bildirim', source: 'system' });
    t.ownerSays(t.ada);
    expect(t.company.onboardingNext(c)).toMatchObject({ waiting: true, round: { round: 1 } });
    // The owner replies (without answering): round 1 was asked once; the same five come as round 2.
    t.ownerSays(t.coordinator, 'sonra bakarım');
    expect(t.company.onboarding().onboarding!.rounds).toEqual([expect.objectContaining({ round: 1, replied: true })]);
    expect(t.company.onboardingNext(c)).toMatchObject({ waiting: false, round: { round: 2, questions: FIRST }, assume: [] });
    t.ownerSays(t.coordinator, 'yine sonra');
    // Asked twice, replied twice, still open: now, and only now, to be assumed.
    const third = t.company.onboardingNext(c);
    expect(third.ask.map((q) => q.id)).toEqual(['goals', 'success', 'tools', 'budget', 'limits']);
    expect(third.assume.map((q) => q.id)).toEqual(FIRST);
    expect(t.events('round')).toHaveLength(3);
  });

  it('onboardingRead shows where the dialog stands and what comes next, recording nothing', async () => {
    const t = make();
    const c = t.coordinator.id;
    await expect(t.call(t.ada, 'onboardingRead')).rejects.toThrow(/kapalı araç/);
    t.company.onboardingStart(c, PILOT);
    const before = await t.call(t.coordinator, 'onboardingRead');
    expect(before).toContain('Salt okunur: hiçbir tur kaydedilmedi.');
    expect(before).toContain('Sıradaki tur (1) şunları soracak:');
    expect(before).toContain('1. Firmanızın adı ne?');
    expect(t.company.onboarding().onboarding!.rounds).toEqual([]);
    t.company.onboardingNext(c);
    const waiting = await t.call(t.coordinator, 'onboardingRead');
    expect(waiting).toContain('Tur 1 sahibinin cevabını bekliyor:');
    // The name was in the owner's own sentence: written as their word, the waiting round no longer asks it.
    t.company.profileUpdate(c, { section: 'identity', fields: { name: 'Kıvılcım İçerik' }, assumed: false });
    const again = t.company.onboardingNext(c);
    expect(again).toMatchObject({ waiting: true, round: { round: 1 } });
    expect(again.ask.map((q) => q.id)).toEqual(['sector', 'products', 'segments', 'channels']);
    expect(t.events('round')).toHaveLength(1);
    t.ownerSays(t.coordinator);
    expect(await t.call(t.coordinator, 'onboardingRead')).toContain('Sıradaki tur (2) şunları soracak:');
    expect(t.company.onboarding().onboarding!.rounds).toHaveLength(1);
  });

  it('the owner answers directly: fields written as the owner’s word, guesses confirmed, the coordinator told; unknown questions and fields refused', () => {
    const t = make();
    const c = t.coordinator.id;
    expect(() => t.company.onboardingAnswer({ name: 'x' })).toThrow(/Sürmekte olan bir onboarding yok/);
    t.company.onboardingStart(c, PILOT);
    t.company.profileUpdate(c, { section: 'identity', fields: { sector: 'ajans' }, assumed: true });
    t.company.onboardingNext(c);
    const view = t.company.onboardingAnswer({ name: 'Kıvılcım İçerik', sector: 'ajans', tools: { social: ['Instagram'], email: ['Gmail'] }, segments: ['6 KOBİ'] });
    expect(view.questions.filter((q) => q.state === 'answered').map((q) => q.id)).toEqual(['name', 'sector', 'segments', 'tools']);
    expect(t.company.profile().sections.identity).toMatchObject({ by: 'owner', assumedFields: [], fields: { name: 'Kıvılcım İçerik', sector: 'ajans' } });
    expect(t.company.profile().sections.tools?.fields).toEqual({ email: ['Gmail'], social: ['Instagram'] });
    expect(t.notices.pending(c).at(-1)?.text).toMatch(/Sahibi onboarding sorularını cevapladı: name, sector, tools, segments\. onboardingNext ile devam et/);
    expect(t.events('answered')).toHaveLength(1);
    for (const [answers, error] of [
      [{ revenue: '1M' }, /Bilinmeyen onboarding sorusu: revenue/],
      [{ tools: ['Instagram'] }, /“tools” birden çok alana yazılır: \{email, social, payment, accounting, ecommerce, other\} gibi bir nesne ver/],
      [{ tools: { crm: ['x'] } }, /“tools” sorusunun alanı değil: crm/],
      [{ name: ['a'] }, /Ad metin olmalı/],
      ['name=x', /cevaplar \(answers\) soru id'si → değer nesnesi olmalı/],
    ] as const) {
      expect(() => t.company.onboardingAnswer(answers), JSON.stringify(answers)).toThrow(error);
    }
    expect(t.events('answered')).toHaveLength(1);
    // Checked whole first: one wrong answer among good ones writes none of them.
    const before = t.company.profile();
    expect(() => t.company.onboardingAnswer({ products: ['ekmek'], channels: 'Instagram' })).toThrow(/Kanallar bir liste olmalı/);
    expect(t.company.profile()).toEqual(before);
  });

  it('once the required ones are in, optional: true brings the optional questions; without it there is nothing more to ask', () => {
    const t = make();
    const c = t.coordinator.id;
    t.company.onboardingStart(c, PILOT);
    // While a required one is still to be asked, optional: true brings the required ones.
    expect(t.company.onboardingNext(c, { optional: true }).ask.map((q) => q.id)).toEqual(['name', 'sector', 'products', 'segments', 'channels']);
    t.company.onboardingAnswer({ name: 'K', sector: 's', products: ['p'], segments: ['m'], channels: ['k'], goals: ['g'], success: ['b'], tools: { social: ['i'] } });
    // Two required ones left: only they come, no optional one beside them.
    expect(t.company.onboardingNext(c, { optional: true }).ask.map((q) => q.id)).toEqual(['budget', 'limits']);
    t.company.onboardingAnswer({ budget: '1', limits: ['yok'] });
    expect(t.company.onboardingNext(c)).toMatchObject({ ask: [], complete: true, round: null });
    expect(t.company.onboardingNext(c, { optional: true }).ask.map((q) => q.id)).toEqual(['pricing', 'platforms', 'brandVoice', 'legal', 'timezone']);
  });

  it('KÖ1 stand-in: from the pilot’s sentence, a cooperative owner fills the required sections in 2 rounds and 10 questions', () => {
    const t = make();
    const c = t.coordinator.id;
    t.company.onboardingStart(c, PILOT);
    const answers: Record<string, unknown> = {
      name: 'Kıvılcım İçerik', sector: 'dijital içerik ajansı', products: ['sosyal medya içeriği', 'yayın takvimi', 'aylık rapor'], segments: ['6 KOBİ müşterisi'],
      channels: ['Instagram', 'TikTok', 'LinkedIn'], goals: ['takvim her Cuma 17:00 hazır'], success: ['raporlar ayın 3. iş günü kurucuda'], tools: { social: ['Instagram', 'TikTok', 'LinkedIn'], email: ['Gmail'] },
      budget: 'aylık 3000 TL', limits: ['yayın kararı kurucuda'],
    };
    for (let guard = 0; guard < 10; guard += 1) {
      const next = t.company.onboardingNext(c);
      if (next.ask.length === 0) break;
      t.company.onboardingAnswer(Object.fromEntries(next.ask.map((q) => [q.id, answers[q.id]])));
    }
    t.company.onboardingFinish(c);
    const rounds = t.events('round').map((e) => (e as { round: { questions: string[] } }).round.questions);
    expect(rounds).toHaveLength(2);
    expect(rounds.flat()).toEqual(REQUIRED);
    expect(t.events('finished')).toHaveLength(1);
  });
});
