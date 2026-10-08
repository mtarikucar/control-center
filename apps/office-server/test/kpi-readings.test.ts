import { afterEach, describe, expect, it } from 'vitest';
import type { Employee } from '@cc/shared';
import { Agenda } from '../src/company/agenda.ts';
import { Dispatcher } from '../src/company/dispatcher.ts';
import type { McpTool } from '../src/mcp/protocol.ts';
import { officeTools } from '../src/mcp/tools.ts';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = new Date(2026, 9, 8, 9, 0).getTime();

/** The pilot's KPIs (as in kpi.test.ts): a manual weekly %, a monthly count from a connection, the office's approval rate. */
const ON_TIME = { name: 'Zamanında hazır oranı', target: 90, direction: 'atLeast', unit: '%', source: 'manual', cadence: 'weekly' };
const DELAY = { name: 'Rapor gecikmesi', target: 0, direction: 'atMost', unit: 'gün', source: 'capability', cadence: 'monthly' };
const FIRST_PASS = { name: 'Onay oranı', target: 70, direction: 'atLeast', source: 'office', metric: 'firstPassRate', cadence: 'weekly' };

function make() {
  let clock = T0;
  const now = () => clock;
  const s = setup(8, now);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder'], now);
  const agenda = new Agenda({ roster: s.roster, tasks: c.tasks, schedules: c.schedules, company: c.company, budget: c.budget });
  const tools = officeTools({ company: c.company, roster: s.roster, tasks: c.tasks, characters: () => ['coder'], memory: c.memory, budget: c.budget, engine: f.engine, plans: () => c.plans.list(), agenda, kpis: c.kpis });
  const call = async (employee: Employee, name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.find((x: McpTool) => x.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    const current = s.roster.get(employee.id);
    if (!tool.kinds.includes(current.kind)) throw new Error(`Bilinmeyen ya da bu çalışana kapalı araç: ${name}`);
    return tool.run({ employee: current }, args);
  };
  const coordinator = c.company.hireCoordinator();
  const advance = (ms: number) => void (clock += ms);
  const readings = () =>
    (s.db.prepare('SELECT goal_id, kpi, value, unit, target, direction, source, period_start, recorded_at, recorded_by, note FROM kpi_readings ORDER BY id').all() as unknown as Array<Record<string, unknown>>).map((r) => ({ ...r }));
  const dueNotices = () => c.notices.pending(coordinator.id).filter((n) => n.topic === 'kpi.due');
  return { ...s, ...c, call, coordinator, advance, now, readings, dueNotices };
}

/** A goal with the three KPIs and a plan serving it; another plan with no goal; Ada works, Can reviews. */
function office() {
  const t = make();
  const c = t.coordinator.id;
  const ada = t.company.hire(c, { name: 'Ada', role: 'r' });
  const can = t.company.hire(c, { name: 'Can', role: 'r' });
  const goal = t.company.goalSet(c, { title: 'Kaliteli teslim', why: 'Misyon', done: ['Onay oranı yüksek'], kpis: [FIRST_PASS, ON_TIME, DELAY] });
  const plan = t.company.propose(c, { method: METHOD, title: 'Teslim', goal: 'g', approach: 'a', goalId: goal.id });
  t.company.approve(plan.id);
  const other = t.company.propose(c, { method: METHOD, title: 'Başka iş', goal: 'g', approach: 'a' });
  t.company.approve(other.id);
  /** A work task of `planId` handed in once per decision, each decided by Can. */
  const deliver = (planId: string, decisions: Array<'approve' | 'changes'>) => {
    const task = t.company.createTask(c, { assignee: ada.id, title: 'İş', planId, reviewer: can.id });
    for (const decision of decisions) {
      t.company.start(task.id);
      t.company.finish(ada.id, task.id, { summary: 's', outputs: [], learned: '' });
      const review = t.tasks.list({ assignee: can.id, statuses: ['waiting'] }).find((x) => x.kind === 'review')!;
      t.company.start(review.id);
      t.company.reviewDecide(can.id, review.id, decision === 'approve' ? { decision } : { decision, findings: [{ severity: 'important', text: 'eksik' }] });
    }
    return task;
  };
  return { ...t, goal, plan, other, ada, can, deliver };
}

describe('KPI readings — kpiRecord', () => {
  it('the coordinator records a reading by hand; the answer says whether it met the target, and it is kept with what it was measured against', async () => {
    const t = office();
    const onTime = await t.call(t.coordinator, 'kpiRecord', { goalId: t.goal.id, kpi: 'zamanında HAZIR oranı', value: 92, note: 'Ekim 1. hafta' });
    expect(onTime).toBe('“Zamanında hazır oranı” okuması kaydedildi: %92; hedef ≥ %90: tuttu.');
    t.advance(HOUR);
    const delay = await t.call(t.coordinator, 'kpiRecord', { goalId: t.goal.id, kpi: 'Rapor gecikmesi', value: 2 });
    expect(delay).toBe('“Rapor gecikmesi” okuması kaydedildi: 2 gün; hedef ≤ 0 gün: tutmadı.');
    expect(t.readings()).toEqual([
      { goal_id: t.goal.id, kpi: 'Zamanında hazır oranı', value: 92, unit: '%', target: 90, direction: 'atLeast', source: 'manual', period_start: null, recorded_at: T0, recorded_by: t.coordinator.id, note: 'Ekim 1. hafta' },
      { goal_id: t.goal.id, kpi: 'Rapor gecikmesi', value: 2, unit: 'gün', target: 0, direction: 'atMost', source: 'capability', period_start: null, recorded_at: T0 + HOUR, recorded_by: t.coordinator.id, note: null },
    ]);
  });

  it('a value right at the target meets it, either way', async () => {
    const t = office();
    expect(await t.call(t.coordinator, 'kpiRecord', { goalId: t.goal.id, kpi: 'Zamanında hazır oranı', value: 90 })).toBe('“Zamanında hazır oranı” okuması kaydedildi: %90; hedef ≥ %90: tuttu.');
    expect(await t.call(t.coordinator, 'kpiRecord', { goalId: t.goal.id, kpi: 'Rapor gecikmesi', value: 0 })).toBe('“Rapor gecikmesi” okuması kaydedildi: 0 gün; hedef ≤ 0 gün: tuttu.');
  });

  it('review focus: refuses every wrong reading with a Turkish reason and writes nothing', async () => {
    const t = office();
    const c = t.coordinator;
    const refuse = (args: Record<string, unknown>) => t.call(c, 'kpiRecord', { goalId: t.goal.id, kpi: 'Zamanında hazır oranı', value: 50, ...args });
    await expect(refuse({ goalId: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow(/Hedef bulunamadı/);
    await expect(refuse({ kpi: 'Müşteri memnuniyeti' })).rejects.toThrow(/“Müşteri memnuniyeti” bu hedefin KPI'sı değil.*Onay oranı, Zamanında hazır oranı, Rapor gecikmesi/);
    await expect(refuse({ kpi: 'Onay oranı' })).rejects.toThrow(/ofis kaynaklı.*kendisi okur/);
    for (const value of ['92', Number.NaN, Number.POSITIVE_INFINITY, null]) await expect(refuse({ value })).rejects.toThrow(/değer \(value\) bir sayı olmalı/);
    for (const value of [-1, 100.5]) await expect(refuse({ value })).rejects.toThrow(/0 ile 100 arasında/);
    await expect(refuse({ note: 'x'.repeat(501) })).rejects.toThrow(/en fazla 500/);
    t.company.goalSet(c.id, { goalId: t.goal.id, status: 'done', note: 'bitti' });
    await expect(refuse({})).rejects.toThrow(/aktif değil/);
    expect(t.readings()).toEqual([]);
    // Only the coordinator records: the tool is closed to others, and so is the service behind it.
    await expect(t.call(t.ada, 'kpiRecord', { goalId: t.goal.id, kpi: 'Zamanında hazır oranı', value: 50 })).rejects.toThrow(/kapalı araç/);
    expect(() => t.kpis.record(t.ada.id, { goalId: t.goal.id, kpi: 'Zamanında hazır oranı', value: 50 })).toThrow(/yalnız koordinatör/);
    expect(t.readings()).toEqual([]);
  });
});

describe('KPI readings — the office reads its own KPIs', () => {
  it('an office KPI is read from the work of the goal’s plans in its window: the approval rate as a %, other plans and older work left out', () => {
    const t = office();
    t.deliver(t.plan.id, ['approve']); // done at T0: outside the window a week later
    t.advance(2 * DAY);
    t.deliver(t.plan.id, ['approve']); // first pass
    t.deliver(t.plan.id, ['changes', 'approve']); // not first pass
    t.deliver(t.other.id, ['changes', 'approve']); // another plan: not this goal's
    t.advance(5 * DAY + HOUR);
    t.kpis.measure();
    expect(t.readings().filter((r) => r.source === 'office')).toEqual([
      { goal_id: t.goal.id, kpi: 'Onay oranı', value: 50, unit: '%', target: 70, direction: 'atLeast', source: 'office', period_start: t.now() - 7 * DAY, recorded_at: t.now(), recorded_by: 'office', note: null },
    ]);
  });

  it('with nothing to measure in the window the reading has no value (no data), and it is not tried again each minute', () => {
    const t = office();
    t.advance(7 * DAY);
    t.kpis.measure();
    t.advance(60_000);
    t.kpis.measure();
    expect(t.readings().filter((r) => r.source === 'office').map((r) => [r.kpi, r.value])).toEqual([['Onay oranı', null]]);
  });
});

describe('KPI readings — the measuring routine', () => {
  it('nothing is read or reminded before a KPI’s period has passed since the goal opened; then the office reads and the coordinator is told what to read by hand', () => {
    const t = office();
    t.advance(7 * DAY - 60_000);
    t.kpis.measure();
    expect(t.readings()).toEqual([]);
    expect(t.dueNotices()).toEqual([]);
    t.advance(60_000);
    t.kpis.measure();
    expect(t.readings().map((r) => r.kpi)).toEqual(['Onay oranı']);
    // The weekly manual KPI is due; the monthly one from a connection is not yet.
    expect(t.dueNotices().map((n) => n.text)).toEqual([
      'KPI ölçüm zamanı: “Kaliteli teslim” hedefinin “Zamanında hazır oranı” KPI\'sı (haftalık; son okuma yok). Değeri kpiRecord ile yaz.',
    ]);
  });

  it('a KPI read by hand is reminded once a period; a reading moves its next turn', async () => {
    const t = office();
    t.advance(7 * DAY);
    t.kpis.measure();
    t.advance(HOUR);
    t.kpis.measure();
    expect(t.dueNotices()).toHaveLength(1);
    // Read a day later: the next reminder is a week after that reading, not after the reminder.
    t.advance(DAY);
    await t.call(t.coordinator, 'kpiRecord', { goalId: t.goal.id, kpi: 'Zamanında hazır oranı', value: 88 });
    const readAt = t.now();
    t.advance(7 * DAY - 60_000);
    t.kpis.measure();
    expect(t.dueNotices()).toHaveLength(1);
    t.advance(60_000);
    t.kpis.measure();
    expect(t.dueNotices().map((n) => n.text).at(-1)).toContain('(haftalık; son okuma: %88');
    expect(t.now()).toBe(readAt + 7 * DAY);
    // Not read again: reminded once more only a period after the last reminder.
    t.advance(7 * DAY - 60_000);
    t.kpis.measure();
    expect(t.dueNotices()).toHaveLength(2);
    t.advance(60_000);
    t.kpis.measure();
    expect(t.dueNotices()).toHaveLength(3);
  });

  it('with no coordinator nobody is reminded, but the office still reads its own KPIs', () => {
    const t = office();
    t.roster.update(t.coordinator.id, { kind: 'member' });
    t.advance(7 * DAY);
    t.kpis.measure();
    expect(t.readings().map((r) => r.kpi)).toEqual(['Onay oranı']);
    expect(t.notices.pending(t.coordinator.id).filter((n) => n.topic === 'kpi.due')).toEqual([]);
    // Nobody was told, so nothing counts as told: a coordinator again hears at once.
    t.roster.update(t.coordinator.id, { kind: 'coordinator' });
    t.advance(60_000);
    t.kpis.measure();
    expect(t.dueNotices()).toHaveLength(1);
  });

  it('runs on the office tick, after the pulse; a failing measurement does not stop the tick', () => {
    const t = make();
    const order: string[] = [];
    const dispatcher = new Dispatcher({
      events: t.events, roster: t.roster, tasks: t.tasks, notices: t.notices, plans: t.plans, company: t.company, engine: { ready: () => false, send: () => undefined, fire: async () => undefined, sleep: async () => undefined, wake: () => undefined },
      pulse: { check: () => order.push('pulse') },
      kpis: { measure: () => { order.push('kpis'); throw new Error('bozuk'); } },
      defer: () => undefined,
    });
    expect(() => dispatcher.tick()).not.toThrow();
    expect(order).toEqual(['pulse', 'kpis']);
  });

  it('closed goals are not measured', () => {
    const t = office();
    t.company.goalSet(t.coordinator.id, { goalId: t.goal.id, status: 'dropped', note: 'vazgeçildi' });
    t.advance(31 * DAY);
    t.kpis.measure();
    expect(t.readings()).toEqual([]);
    expect(t.dueNotices()).toEqual([]);
  });
});

const RETRO = { wentWell: 'iyi', stuck: 'takılan', change: 'değişecek' };
const OLD_RETRO_ANSWER = 'Değerlendirme şirket notlarına yazıldı. Şirkete özgü dersleri playbookUpdate ile el kitabına işle, sonra reportToOwner ile sahibine kısaca raporla.';
const retroNote = (t: ReturnType<typeof make>, title: string) => t.memory.notes(undefined, 100).map((n) => n.note).find((n) => n.title === `Değerlendirme: ${title}`)!;

describe('KPI readings — the retro’s KPI table', () => {
  it('the retro of a plan whose goal has KPIs carries their table, in its note and in the answer: the office KPI read then, last and previous readings by hand, none yet', async () => {
    const t = office();
    t.deliver(t.plan.id, ['changes', 'approve']);
    await t.call(t.coordinator, 'kpiRecord', { goalId: t.goal.id, kpi: 'Zamanında hazır oranı', value: 85 });
    t.advance(DAY);
    await t.call(t.coordinator, 'kpiRecord', { goalId: t.goal.id, kpi: 'Zamanında hazır oranı', value: 92 });
    t.advance(HOUR);
    const answer = await t.call(t.coordinator, 'planRetro', { planId: t.plan.id, ...RETRO });
    const table = [
      '| KPI | Hedef | Son okuma | Önceki | Durum |',
      '|---|---|---|---|---|',
      '| Onay oranı | ≥ %70 | %0 (9 Eki 2026 10:00, ofis) | — | tutmadı |',
      '| Zamanında hazır oranı | ≥ %90 | %92 (9 Eki 2026 09:00) | %85 (8 Eki 2026 09:00) | tuttu |',
      '| Rapor gecikmesi | ≤ 0 gün | okuma yok | — | kpiRecord ile yaz |',
    ].join('\n');
    expect(answer).toBe(`${OLD_RETRO_ANSWER}\n\nKPI'lar:\n${table}`);
    expect(retroNote(t, 'Teslim').text.endsWith(`## Bir dahaki sefere\n\ndeğişecek\n\n## KPI'lar\n\n${table}`)).toBe(true);
    expect(t.readings().filter((r) => r.source === 'office').map((r) => r.recorded_at)).toEqual([t.now()]);
  });

  it('a plan with no goal, or whose goal has no KPIs, is assessed exactly as before', async () => {
    const t = office();
    const bare = t.company.goalSet(t.coordinator.id, { title: 'KPI’sız hedef', why: 'Misyon', done: ['bitti'] });
    const plain = t.company.propose(t.coordinator.id, { method: METHOD, title: 'Sade', goal: 'g', approach: 'a', goalId: bare.id });
    t.company.approve(plain.id);
    for (const [plan, title] of [[t.other.id, 'Başka iş'], [plain.id, 'Sade']] as const) {
      expect(await t.call(t.coordinator, 'planRetro', { planId: plan, ...RETRO })).toBe(OLD_RETRO_ANSWER);
      expect(retroNote(t, title).text).toBe([`Plan: ${title} (sürüm 1)`, '', '## Ne iyi gitti', '', 'iyi', '', '## Ne takıldı', '', 'takılan', '', '## Bir dahaki sefere', '', 'değişecek'].join('\n'));
    }
    expect(t.readings()).toEqual([]);
  });
});

describe('KPI readings — goalsRead', () => {
  it('shows the last reading of each KPI that has one; a goal whose KPIs have none reads as before', async () => {
    const t = office();
    const before = await t.call(t.coordinator, 'goalsRead');
    expect(before).not.toContain('son okuma');
    await t.call(t.coordinator, 'kpiRecord', { goalId: t.goal.id, kpi: 'Zamanında hazır oranı', value: 85 });
    t.advance(7 * DAY);
    t.kpis.measure();
    const after = await t.call(t.coordinator, 'goalsRead');
    expect(after).toBe(before.replace(/(\n   KPI: [^\n]*)/, '$1\n   son okuma: Onay oranı veri yok (15 Eki 2026 09:00); Zamanında hazır oranı %85 (8 Eki 2026 09:00, tutmadı)'));
  });
});
