import { afterEach, describe, expect, it } from 'vitest';
import type { Employee } from '@cc/shared';
import { Agenda } from '../src/company/agenda.ts';
import type { McpTool } from '../src/mcp/protocol.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { companyFor, METHOD } from './company-helpers.ts';
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
    return tool.run({ employee: s.roster.get(employee.id) }, args);
  };
  const coordinator = c.company.hireCoordinator();
  return { ...s, ...c, call, coordinator };
}

/** The pilot's KPIs (pilot-senaryosu A10): H1 on time ≥ 90 %, H2 delay 0 days, and the office's own approval rate. */
const ON_TIME = { name: 'Zamanında hazır oranı', target: 90, direction: 'atLeast', unit: '%', source: 'manual', cadence: 'weekly' };
const DELAY = { name: 'Rapor gecikmesi', target: 0, direction: 'atMost', unit: 'gün', source: 'capability', cadence: 'monthly' };
const FIRST_PASS = { name: 'Onay oranı', target: 70, direction: 'atLeast', source: 'office', metric: 'firstPassRate', cadence: 'weekly' };

describe('Goal KPIs — goalSet', () => {
  it('opens a goal with KPIs, replaces them, keeps them when not given and clears them with an empty list', () => {
    const t = make();
    const c = t.coordinator.id;
    const goal = t.company.goalSet(c, { title: 'Haftalık takvim', why: 'Misyon', done: ['6 müşteri'], kpis: [ON_TIME, FIRST_PASS] });
    expect(goal.kpis).toEqual([
      { ...ON_TIME, metric: null },
      { ...FIRST_PASS, unit: '%' },
    ]);
    expect(t.goals.get(goal.id).kpis).toEqual(goal.kpis);
    const changed = t.company.goalSet(c, { goalId: goal.id, kpis: [DELAY] });
    expect(changed.kpis).toEqual([{ ...DELAY, metric: null }]);
    // Changing anything else leaves them; closing and reopening too.
    expect(t.company.goalSet(c, { goalId: goal.id, title: 'Takvim', note: 'n' }).kpis).toEqual(changed.kpis);
    expect(t.company.goalSet(c, { goalId: goal.id, status: 'done' }).kpis).toEqual(changed.kpis);
    expect(t.company.goalSet(c, { goalId: goal.id, kpis: [] }).kpis).toEqual([]);
    // A goal opened without KPIs has none.
    expect(t.company.goalSet(c, { title: 'Başka', why: 'w', done: ['d'] }).kpis).toEqual([]);
    const events = t.events.list({ limit: 1000 }).filter((e) => e.event.type === 'goal.changed');
    expect((events[0]!.event as { goal: { kpis: unknown[] } }).goal.kpis).toHaveLength(2);
  });

  it('review focus: refuses every wrong KPI with a Turkish reason, changing nothing', () => {
    const t = make();
    const c = t.coordinator.id;
    const goal = t.company.goalSet(c, { title: 'H', why: 'w', done: ['d'], kpis: [ON_TIME] });
    const bad: Array<[unknown, RegExp]> = [
      ['ON_TIME', /KPI'lar \(kpis\) bir liste olmalı/],
      [[7], /her KPI bir nesne olmalı/],
      [Array.from({ length: 9 }, (_, i) => ({ ...ON_TIME, name: `k${i}` })), /en fazla 8 KPI/],
      [[{ ...ON_TIME, name: ' ' }], /KPI adı \(name\) boş olamaz/],
      [[{ ...ON_TIME, name: 'x'.repeat(121) }], /KPI adı \(name\) en fazla 120 karakter/],
      [[ON_TIME, { ...ON_TIME, name: 'ZAMANINDA HAZIR ORANI' }], /Aynı adla iki KPI var/],
      [[{ ...ON_TIME, target: '90' }], /hedef değer \(target\) bir sayı olmalı/],
      [[{ ...ON_TIME, target: Number.NaN }], /hedef değer \(target\) bir sayı olmalı/],
      [[{ ...ON_TIME, target: 120 }], /yüzde hedefi 0 ile 100 arasında/],
      [[{ ...ON_TIME, direction: 'up' }], /yön \(direction\) atLeast \(en az\) ya da atMost \(en çok\)/],
      [[{ ...ON_TIME, direction: undefined }], /yön \(direction\) atLeast/],
      [[{ ...ON_TIME, source: 'guess' }], /kaynak \(source\) manual, office ya da capability/],
      [[{ ...ON_TIME, source: undefined }], /kaynak \(source\)/],
      [[{ ...ON_TIME, cadence: 'yearly' }], /sıklık \(cadence\) daily, weekly ya da monthly/],
      [[{ ...ON_TIME, cadence: undefined }], /sıklık \(cadence\)/],
      [[{ ...ON_TIME, unit: '' }], /birim \(unit\) gerekli/],
      [[{ ...ON_TIME, unit: 'x'.repeat(21) }], /birim \(unit\) en fazla 20 karakter/],
      [[{ ...ON_TIME, metric: 'firstPassRate' }], /metric yalnız source office iken verilir/],
      [[{ ...FIRST_PASS, metric: undefined }], /ofis kaynağı için metric şunlardan biri olmalı: firstPassRate, avgRounds/],
      [[{ ...FIRST_PASS, metric: 'revenue' }], /ofis kaynağı için metric şunlardan biri olmalı/],
      [[{ ...FIRST_PASS, unit: 'puan' }], /firstPassRate ofis metriğinin birimi %/],
      [[{ ...ON_TIME, owner: 'Ada' }], /bilinmeyen alan “owner”/],
    ];
    for (const [kpis, error] of bad) {
      expect(() => t.company.goalSet(c, { goalId: goal.id, kpis: kpis as never }), JSON.stringify(kpis).slice(0, 80)).toThrow(error);
      expect(() => t.company.goalSet(c, { title: 'Yeni', why: 'w', done: ['d'], kpis: kpis as never })).toThrow(error);
    }
    expect(t.goals.get(goal.id).kpis).toEqual([{ ...ON_TIME, metric: null }]);
    expect(t.goals.list()).toHaveLength(1);
  });

  it('an office KPI takes its unit from its B4 metric; the same unit given is fine', () => {
    const t = make();
    const goal = t.company.goalSet(t.coordinator.id, {
      title: 'Kalite', why: 'w', done: ['d'],
      kpis: [{ ...FIRST_PASS, unit: '%' }, { name: 'Görev başı maliyet', target: 5, direction: 'atMost', source: 'office', metric: 'usdPerDone', cadence: 'monthly' }],
    });
    expect(goal.kpis.map((k) => [k.metric, k.unit])).toEqual([['firstPassRate', '%'], ['usdPerDone', 'USD']]);
  });
});

describe('Goal KPIs — goalsRead and the tool', () => {
  it('goalsRead shows each goal’s KPIs on one line; a goal without KPIs reads exactly as before', async () => {
    const t = make();
    const c = t.coordinator;
    expect(await t.call(c, 'goalSet', { title: 'Takvim', why: 'Misyon', done: ['6 müşteri'], kpis: [ON_TIME, DELAY, FIRST_PASS] })).toMatch(/Hedef açıldı/);
    await t.call(c, 'goalSet', { title: 'Eski usul', why: 'Neden', done: ['a', 'b'] });
    const [kpied, plain] = t.goals.list();
    await t.call(c, 'planPropose', { title: 'Site', goal: 'g', approach: 'a', method: METHOD, goalId: plain!.id });
    const read = await t.call(c, 'goalsRead');
    expect(read).toContain(
      `• ${kpied!.id} “Takvim” [active] — neden: Misyon\n   bitti: 6 müşteri\n   KPI: Zamanında hazır oranı ≥ %90 (elle, haftalık); Rapor gecikmesi ≤ 0 gün (bağlantıdan, aylık); Onay oranı ≥ %70 (ofis: ilk geçişte onay oranı, haftalık)`,
    );
    // The line as main wrote it before KPIs existed.
    expect(read).toContain(`• ${plain!.id} “Eski usul” [active] — neden: Neden\n   bitti: a; b\n   - Site [${t.plans.list()[0]!.status}]`);
    expect(read.split('\n').filter((l) => l.includes('KPI:'))).toHaveLength(1);
  });
});
