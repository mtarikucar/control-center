import { afterEach, describe, expect, it } from 'vitest';
import { OWNER, type EmployeeKind, type Goal, type Plan, type Task } from '@cc/shared';
import { Agenda } from '../src/company/agenda.ts';
import { buildBoard } from '../src/company/board.ts';
import { QuotaTracker } from '../src/quota.ts';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

/* Management cycle §3.2 — the board: the coordinator's whole picture as one Turkish text, read only. */

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = new Date(2026, 9, 8, 9, 0).getTime();
const HEADINGS = ['## 1. Ne değişti (son turdan beri)', '## 2. Hedefler ve planlar', '## 3. İnsanlar', '## 4. Zincirler ve kritik yol', '## 5. Riskler', '## 6. Kaynak', '## 7. Açık kararlar'];

/** An office on a simulated clock; people straight on the roster (no sessions), ready for work. */
function make(desks = 8) {
  let clock = T0;
  const now = () => clock;
  const s = setup(desks, now);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, undefined, now);
  c.budget.setConstitution({ autonomy: 'free' });
  const quota = new QuotaTracker(s.db, s.events, now);
  const agenda = new Agenda({ roster: s.roster, tasks: c.tasks, schedules: c.schedules, company: c.company, budget: c.budget, now });
  const person = (name: string, o: { title?: string; kind?: EmployeeKind } = {}) => {
    const e = s.roster.create({ name, role: 'r', title: o.title ?? '', kind: o.kind });
    return s.roster.update(e.id, { lifecycle: 'idle' });
  };
  const coordinator = person('Koordinatör', { kind: 'coordinator', title: 'Koordinatör' });
  const deps = { db: s.db, events: s.events, roster: s.roster, company: c.company, tasks: c.tasks, plans: c.plans, state: c.state, agenda, budget: c.budget, proposals: c.proposals, quota, kpis: c.kpis };
  const board = (o: { since?: number; unclosedWarning?: boolean } = {}) => buildBoard(deps, { since: o.since ?? T0, now: clock, unclosedWarning: o.unclosedWarning });
  /** One section of the board, heading included. */
  const section = (text: string, n: number) => text.split('\n\n').find((b) => b.startsWith(`## ${n}.`)) ?? '';
  const advance = (ms: number) => void (clock += ms);
  const goal = (title: string) => c.company.goalSet(coordinator.id, { title, why: 'misyon', done: ['tamam'] });
  const plan = (title: string, o: { goalId?: string; streams?: unknown[] } = {}) => c.company.propose(coordinator.id, { title, goal: 'g', approach: 'a', method: METHOD, ...o });
  const task = (assignee: string, title: string, o: Record<string, unknown> = {}) => c.company.createTask(coordinator.id, { assignee, title, ...o });
  const finish = (by: string, id: string) => c.company.finish(by, id, { summary: 'tamam', outputs: [], learned: '' });
  return { ...s, ...c, coordinator, person, board, section, advance, goal, plan, task, finish, now };
}

describe('board — shape', () => {
  it('a fresh office (the coordinator alone): every section with “yok”, no active goal; nothing asks for a project start yet, so no kickoff', () => {
    const t = make();
    const b = t.board({ since: 0 });
    expect(b.kickoff).toBe(false);
    expect(b.text).toBe(
      [
        'Yönetim panosu · 8 Eki 2026 09:00 · ilk tur',
        '## 1. Ne değişti (son turdan beri)\n- yok',
        '## 2. Hedefler ve planlar\n- Aktif hedef yok ve açık iş yok: şirket özetindeki misyona ve vizyona bakıp sıradaki hedefi aç (goalSet: neden ve ölçülebilir bitti tanımıyla) ve ilk planını hemen başlat (planPropose, goalId ile).',
        '## 3. İnsanlar\n- yok: ekipte koordinatörden başka kimse yok',
        '## 4. Zincirler ve kritik yol\n- yok',
        '## 5. Riskler\n- yok',
        '## 6. Kaynak\n- Kota: henüz okunmadı; ofisin sınırı %75 (sahibinin payı %25)\n- Son 24 saat: Claude ~$0 (0 tur); kayıtlı harcama $0; bu ay $0',
        '## 7. Açık kararlar\n- yok',
      ].join('\n\n'),
    );
  });

  it('the same seven headings in the same order whatever the office holds', () => {
    const t = make();
    const ada = t.person('Ada');
    const g = t.goal('Lansman');
    const p = t.plan('Site', { goalId: g.id, streams: [{ id: 'api', title: 'API', owner: 'Ada' }] });
    t.task(ada.id, 'Uç noktalar', { planId: p.id, streamId: 'api' });
    for (const text of [t.board().text, make().board().text]) {
      // “İnsanlar” carries the head count when there is a team.
      const headings = text.split('\n').filter((l) => l.startsWith('## '));
      expect(headings.map((h, i) => h.startsWith(HEADINGS[i]!))).toEqual(HEADINGS.map(() => true));
    }
  });

  it('the header says when the last cycle started', () => {
    const t = make();
    t.advance(45 * MIN);
    expect(t.board({ since: T0 }).text.split('\n')[0]).toBe('Yönetim panosu · 8 Eki 2026 09:45 · son tur 09:00 (45 dk önce)');
  });

  it('an unclosed previous cycle puts one warning line at the very top', () => {
    const t = make();
    const text = t.board({ unclosedWarning: true }).text;
    expect(text.split('\n')[0]).toBe('UYARI: Önceki tur cycleClose ile kapanmadı. Bu turu cycleClose ile kapat; değişiklik yoksa nedenini yaz (“değişiklik yok, çünkü …”).');
    expect(text.split('\n')[1]).toBe('');
    expect(text.split('\n')[2]).toMatch(/^Yönetim panosu · /);
    expect(text.match(/UYARI/g)).toHaveLength(1);
    expect(t.board().text).not.toMatch(/UYARI|cycleClose/);
  });

  it('reads only: building it writes no event, no notice, nothing in the tables', () => {
    const t = make();
    const ada = t.person('Ada');
    const g = t.goal('Lansman');
    const p = t.plan('Site', { goalId: g.id, streams: [{ id: 'api', title: 'API', owner: 'Ada' }] });
    t.task(ada.id, 'Uç noktalar', { planId: p.id, streamId: 'api' });
    const dump = () =>
      ['events', 'tasks', 'plans', 'goals', 'notices', 'company_state', 'employees', 'proposals', 'constitution'].map((table) => t.db.prepare(`SELECT * FROM ${table}`).all());
    const before = JSON.stringify(dump());
    t.board({ since: 0, unclosedWarning: true });
    t.board();
    expect(JSON.stringify(dump())).toBe(before);
  });
});

describe('board — a goal’s KPIs (K3, Kerem’s management cycle review)', () => {
  const ON_TIME = { name: 'Zamanında hazır oranı', target: 90, direction: 'atLeast', unit: '%', source: 'manual', cadence: 'weekly' };
  const DELAY = { name: 'Rapor gecikmesi', target: 0, direction: 'atMost', unit: 'gün', source: 'manual', cadence: 'daily' };

  it('the goal’s line carries each KPI’s last reading and whether it met its target, and a KPI read by hand whose period passed is due', () => {
    const t = make();
    const g = t.company.goalSet(t.coordinator.id, { title: 'Kaliteli teslim', why: 'misyon', done: ['tamam'], kpis: [ON_TIME, DELAY] });
    t.plan('Teslim', { goalId: g.id });
    t.kpis.record(t.coordinator.id, { goalId: g.id, kpi: ON_TIME.name, value: 92 });
    const goals = () => t.section(t.board({ since: 0 }).text, 2);
    expect(goals()).toContain('  · KPI: Zamanında hazır oranı ≥ %90: son %92 (8 Eki 2026 09:00, tuttu); Rapor gecikmesi ≤ 0 gün: okuma yok');
    expect(goals()).not.toContain('ölçüm zamanı');
    // A day on: the daily one read by hand never was — its reading is due (listed first); the weekly one is not yet.
    t.advance(25 * HOUR);
    expect(goals()).toContain('  · KPI: Rapor gecikmesi ≤ 0 gün: okuma yok — ölçüm zamanı geçti, kpiRecord ile yaz; Zamanında hazır oranı ≥ %90: son %92');
    // Right under the goal's line, before the plan's streams.
    expect(goals().split('\n')[2]).toMatch(/^  · KPI: /);
    expect(goals()).not.toContain('tuttu) — ölçüm');
  });

  it('a goal without KPIs gets no KPI line', () => {
    const t = make();
    const g = t.goal('Sade hedef');
    t.plan('Sade plan', { goalId: g.id });
    expect(t.section(t.board({ since: 0 }).text, 2)).not.toContain('KPI:');
  });
});

describe('board — kickoff: a real project start (spec §3.5; waiting with no plan is none)', () => {
  it('every active goal has a running plan (approved, or waiting for the owner): no kickoff, whatever came since', () => {
    const t = make();
    const a = t.goal('Lansman');
    t.plan('Site', { goalId: a.id });
    t.events.append(t.coordinator.id, { type: 'message.user', text: 'Yeni iş: mağaza', source: 'owner' });
    expect(t.board({ since: 0 }).kickoff).toBe(false);
    t.budget.setConstitution({ autonomy: 'plans' });
    const b = t.goal('Satış');
    t.plan('Teklifler', { goalId: b.id });
    expect(t.plans.list().find((p) => p.title === 'Teklifler')?.status).toBe('draft');
    expect(t.board({ since: 0 }).kickoff).toBe(false);
  });

  it('no goal’s work under way, and since the last cycle the owner’s message, a goal set, closed or stopped, or a plan finished, declined or stopped: kickoff', () => {
    const t = make();
    const ada = t.person('Ada');
    /** Something happens a minute on; the board a minute after it, since just before it (a cycle that came for it). */
    const after = (fn: () => void) => {
      t.advance(MIN);
      const since = t.now() - 1;
      fn();
      t.advance(MIN);
      return t.board({ since }).kickoff;
    };
    // The owner's message to the coordinator; not the office's own message, nor the owner's to someone else.
    expect(after(() => void t.events.append(t.coordinator.id, { type: 'message.user', text: 'Yeni iş: mağaza', source: 'owner' }))).toBe(true);
    expect(after(() => void t.events.append(t.coordinator.id, { type: 'message.user', text: 'not', source: 'system' }))).toBe(false);
    expect(after(() => void t.events.append(ada.id, { type: 'message.user', text: 'merhaba', source: 'owner' }))).toBe(false);
    // A goal set: its first plan is to be made.
    let a = null as Goal | null;
    expect(after(() => void (a = t.goal('Lansman')))).toBe(true);
    // Its plan runs: no start — a second goal waiting for its plan beside it is the cycle's work.
    let site = null as Plan | null;
    expect(after(() => void (site = t.plan('Site', { goalId: a!.id })))).toBe(false);
    let b = null as Goal | null;
    expect(after(() => void (b = t.goal('Satış')))).toBe(false);
    // The running plan finishes: a new plan or goal is needed.
    const only = t.task(ada.id, 'tek iş', { planId: site!.id });
    t.company.start(only.id);
    expect(after(() => void t.finish(ada.id, only.id))).toBe(true);
    expect(t.plans.get(site!.id).status).toBe('done');
    // A plan waiting for the owner runs; declined or stopped, its goal needs another.
    t.budget.setConstitution({ autonomy: 'plans' });
    let offers = null as Plan | null;
    expect(after(() => void (offers = t.plan('Teklifler', { goalId: b!.id })))).toBe(false);
    expect(after(() => void t.company.decline(offers!.id))).toBe(true);
    let again = null as Plan | null;
    expect(after(() => void (again = t.plan('Teklifler 2', { goalId: b!.id })))).toBe(false);
    expect(after(() => void t.company.stopPlan(again!.id))).toBe(true);
    // A goal closed by the coordinator, or stopped by the owner: the next one is to be found.
    expect(after(() => void t.company.goalSet(t.coordinator.id, { goalId: a!.id, status: 'done' }))).toBe(true);
    expect(after(() => void t.company.stopGoal(b!.id))).toBe(true);
  });

  it('waiting is no start: no goal, or goals with no running plan, and nothing new that asks for one — the owner awaited, a rest, the office moving on', () => {
    const t = make();
    const ada = t.person('Ada');
    // No goal and nothing in the log (an idle pulse, a rest's end): no start.
    expect(t.board({ since: 0 }).kickoff).toBe(false);
    t.advance(MIN);
    t.plan('Hedefsiz plan');
    t.advance(MIN);
    expect(t.board({ since: T0 }).kickoff).toBe(false);
    // A goal set: the cycle after it is a start; the coordinator rests and waits for the owner instead of planning.
    const before = t.now();
    t.advance(MIN);
    t.goal('Ürün çekirdeği');
    t.advance(MIN);
    expect(t.board({ since: before }).kickoff).toBe(true);
    const since = t.now();
    t.company.restUntil(t.coordinator.id, 2, 'Sahibinin kararı bekleniyor');
    t.advance(HOUR);
    // The office moves on meanwhile — a task, a hand-in, someone idle again, the office's own note — and nothing asks
    // for a new plan: every cycle of the wait (the heartbeat, the rest's end) is no start.
    const x = t.task(ada.id, 'Rapor');
    t.company.start(x.id);
    t.finish(ada.id, x.id);
    t.events.append(t.coordinator.id, { type: 'message.user', text: 'Ofisten notlar', source: 'system' });
    t.advance(2 * HOUR);
    const b = t.board({ since });
    expect(t.section(b.text, 2)).toContain('- Hedef “Ürün çekirdeği”: süren planı yok');
    expect(b.kickoff).toBe(false);
  });
});

describe('board — its shape: what it says, the clock left out (a heartbeat with nothing new is passed by)', () => {
  const turn = (costUsd: number) =>
    ({ type: 'turn.finished', ok: true, subtype: 'success', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 }, costUsd, numTurns: 1, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0 }) as const;

  /** An office at work: a goal and its plan, Ada at a task, Can idle, Ece's task parked, Selin's in review, some money spent. */
  function busy() {
    const t = make();
    const [ada, can, ece, selin] = ['Ada', 'Can', 'Ece', 'Selin'].map((n) => t.person(n));
    const g = t.goal('Lansman');
    const p = t.plan('Site', { goalId: g.id });
    const x = t.task(ada!.id, 'Uç noktalar', { planId: p.id });
    t.company.start(x.id);
    const y = t.task(ece!.id, 'Ödeme', { planId: p.id });
    t.company.parkTask(ece!.id, y.id, '+1d', 'Sağlayıcının cevabı bekleniyor');
    const z = t.task(selin!.id, 'Metin', { planId: p.id, reviewer: can!.id });
    t.company.start(z.id);
    t.finish(selin!.id, z.id);
    t.budget.recordSpend(ada!.id, { service: 'alan adı', usd: 12, purpose: 'site' });
    t.events.append(ada!.id, turn(0.4));
    t.setQuota({ status: 'allowed', fiveHour: { utilization: 0.2, resetsAt: T0 + 5 * HOUR }, sevenDay: { utilization: 0.5, resetsAt: T0 + 100 * HOUR }, updatedAt: T0 });
    t.advance(50 * MIN);
    return { t, ada: ada!, can: can!, ece: ece!, selin: selin!, g, p, x, y, z };
  }

  it('the same office later has the same shape: times, spans, money, the quota’s and Claude’s use are not what the board says', () => {
    const { t, ada } = busy();
    const since = T0 + MIN;
    const before = t.board({ since });
    // Fifty minutes on: Ada's estimate passed long ago, Can idle longer, more use and money, the quota climbed.
    t.events.append(ada.id, turn(1.7));
    t.events.append(ada.id, turn(0.3));
    t.setQuota({ status: 'allowed', fiveHour: { utilization: 0.45, resetsAt: T0 + 5 * HOUR }, sevenDay: { utilization: 0.52, resetsAt: T0 + 100 * HOUR }, updatedAt: t.now() });
    t.advance(50 * MIN);
    const later = t.board({ since });
    expect(later.text).not.toBe(before.text);
    expect(later.shape).toBe(before.shape);
    // The previous cycle not closed: a line for the coordinator, not a change of the office.
    expect(t.board({ since, unclosedWarning: true }).shape).toBe(before.shape);
    // The shape is drawn at full detail, whatever limits the board's text needed.
    expect(later.shape).toMatch(/^[0-9a-f]{64}$/);
  });

  it('anything the board says differently is another shape: a task’s state, a new task, the owner’s message, a mark the clock brings', () => {
    const { t, ada, can, p, y } = busy();
    const since = T0 + MIN;
    const shapes = [t.board({ since }).shape];
    const look = () => shapes.push(t.board({ since }).shape);
    // Ece's parked task comes back by the owner's hand.
    t.company.unparkTask(OWNER, y.id);
    look();
    // A new task of the plan for Can; the owner's message to the coordinator. (A second task waiting in Can's queue
    // outside a plan is not on the board — its text stays the same, and so does its shape.)
    const text = t.board({ since }).text;
    t.task(can.id, 'Notlar');
    expect(t.board({ since }).text).toBe(text);
    expect(t.board({ since }).shape).toBe(shapes.at(-1));
    t.task(can.id, 'Testler', { planId: p.id });
    look();
    t.events.append(t.coordinator.id, { type: 'message.user', text: 'Yarın demo var', source: 'owner' });
    look();
    // Hours on, Ada idle since her task closed: the board marks her “uzun süredir”.
    t.finish(ada.id, t.tasks.list({ assignee: ada.id, statuses: ['in_progress'] })[0]!.id);
    look();
    t.advance(3 * HOUR);
    look();
    expect(new Set(shapes).size).toBe(shapes.length);
  });
});

describe('board — 1. Ne değişti', () => {
  it('deliveries since the last cycle: who, what, and how its review went', () => {
    const t = make();
    const [ada, can, ece] = ['Ada', 'Can', 'Ece'].map((n) => t.person(n));
    const old = t.task(ada!.id, 'Eski iş');
    t.company.start(old.id);
    t.finish(ada!.id, old.id);
    t.advance(10 * MIN);
    const since = t.now();
    t.advance(5 * MIN);
    const plain = t.task(ada!.id, 'Uç noktalar');
    t.company.start(plain.id);
    t.finish(ada!.id, plain.id);
    const waiting = t.task(ada!.id, 'Giriş', { reviewer: can!.id });
    t.company.start(waiting.id);
    t.finish(ada!.id, waiting.id);
    const approved = t.task(can!.id, 'Ödeme', { reviewer: ece!.id });
    t.company.start(approved.id);
    t.finish(can!.id, approved.id);
    t.company.reviewDecide(ece!.id, t.tasks.list({ assignee: ece!.id }).find((x) => x.reviewOf === approved.id)!.id, { decision: 'approve' });
    const back = t.task(ece!.id, 'Arama', { reviewer: can!.id });
    t.company.start(back.id);
    t.finish(ece!.id, back.id);
    t.company.reviewDecide(can!.id, t.tasks.list({ assignee: can!.id }).find((x) => x.reviewOf === back.id)!.id, { decision: 'changes', findings: [{ severity: 'important', text: 'boş sorgu çöküyor' }] });
    const body = t.section(t.board({ since }).text, 1);
    expect(body.split('\n').filter((l) => l.startsWith('- Teslim'))).toEqual([
      '- Teslim: “Uç noktalar” — Ada → bitti',
      '- Teslim: “Giriş” — Ada → incelemede (Can)',
      '- Teslim: “Ödeme” — Can → onaylandı (Ece)',
      '- Teslim: “Arama” — Ece → değişiklik istendi (Can: 1 önemli)',
    ]);
    expect(body).not.toContain('Eski iş');
  });

  it('new stalls (blocked, past due, still open after a reminder), who became idle, team changes', () => {
    const t = make();
    const [ada, can, bora, ece, mert, eski] = ['Ada', 'Can', 'Bora', 'Ece', 'Mert', 'Eski'].map((n) => t.person(n));
    // Before the last cycle: Can is idle from his hire, Bora was already stuck.
    const before = t.task(bora!.id, 'Eski takılma');
    t.company.start(before.id);
    t.company.update(bora!.id, before.id, { blocked: true, note: 'eskiden' });
    const late = t.task(ece!.id, 'Rapor', { dueAt: '+20m' });
    const slow = t.task(mert!.id, 'Çeviri');
    t.company.start(slow.id);
    const mine = t.task(ada!.id, 'Uç noktalar');
    t.company.start(mine.id);
    t.advance(10 * MIN);
    const since = t.now();
    t.advance(5 * MIN);
    const stuck = t.task(bora!.id, 'Kurulum');
    t.company.start(stuck.id);
    t.company.update(bora!.id, stuck.id, { blocked: true, note: 'erişim yok' });
    t.tasks.update(slow.id, { nudged: true, nudgedAt: t.now() });
    t.finish(ada!.id, mine.id);
    const selin = t.person('Selin');
    t.events.append(selin.id, { type: 'employee.hired', name: 'Selin' });
    t.roster.update(eski!.id, { lifecycle: 'archived' });
    t.events.append(eski!.id, { type: 'employee.fired' });
    t.advance(10 * MIN);
    const lines = t.section(t.board({ since }).text, 1).split('\n');
    expect(lines).toContain('- Yeni takılmalar: “Kurulum” (Bora, takıldı: erişim yok); “Rapor” (Ece, son tarih geçti 09:20); “Çeviri” (Mert, hatırlatmaya rağmen ilerlemiyor)');
    // A new hire never had work: not “became idle”; the people section marks them new.
    expect(lines).toContain('- Boşa çıktı: Ada');
    expect(t.section(t.board({ since }).text, 3).split('\n')[1]).toBe('- Boşta (3): Can — 25 dk; Ada — 10 dk; Selin — 10 dk (yeni)');
    expect(lines).toContain('- Ekip: Selin işe alındı; Eski ayrıldı');
    expect(lines.join('\n')).not.toMatch(/Eski takılma|Can/);
    expect(late.id).toBeTruthy();
    expect(can).toBeTruthy();
  });

  it('constraints: what the owner changed in the constitution, the owner’s share, a pause — the net change since the last cycle', () => {
    const t = make();
    t.budget.ownerSetConstitution({ maxEmployees: 6 });
    t.advance(10 * MIN);
    const since = t.now();
    t.advance(5 * MIN);
    t.budget.ownerSetConstitution({ ownerReservePct: 40 });
    t.setQuota({ status: 'allowed', fiveHour: { utilization: 0.8, resetsAt: t.now() + HOUR }, sevenDay: null, updatedAt: t.now() });
    t.budget.checkReserve();
    t.company.pause();
    const line = () => t.section(t.board({ since }).text, 1).split('\n').find((l) => l.startsWith('- Kısıt'));
    expect(line()).toBe('- Kısıt: Ofisin kota sınırı %75 → %60; sahibinin kota payı devreye girdi; sahibi şirketi duraklattı');
    // Back where it was: nothing changed on balance.
    t.budget.ownerSetConstitution({ ownerReservePct: 25 });
    t.company.resume();
    expect(line()).toBe('- Kısıt: sahibinin kota payı devreye girdi');
  });

  it('constraints against a snapshot an older office logged (the coordinator’s models before the turn types): read as today’s, no false change', () => {
    const t = make();
    t.advance(MIN);
    // What the office logged before the turn types: the same rules, the coordinator's models under their old keys.
    const summary = t.budget.summary();
    const old = { ...summary, constitution: { ...summary.constitution, coordinatorModels: { owner: 'sonnet', decision: 'sonnet', digest: 'haiku' } } };
    t.events.append(null, { type: 'budget.changed', budget: old as unknown as typeof summary });
    t.advance(10 * MIN);
    const since = t.now();
    t.advance(5 * MIN);
    t.budget.ownerSetConstitution({ maxEmployees: 6 });
    const line = () => t.section(t.board({ since }).text, 1).split('\n').find((l) => l.startsWith('- Kısıt'));
    expect(line()).toBe('- Kısıt: Çalışan sınırı 8 → 6');
    // Back where it was: nothing changed on balance, so no line at all.
    t.budget.ownerSetConstitution({ maxEmployees: 8 });
    expect(line()).toBeUndefined();
  });

  it('plans and goals that moved, and the owner’s messages to the coordinator (short)', () => {
    const t = make();
    const ada = t.person('Ada');
    t.plan('Eski plan');
    t.events.append(t.coordinator.id, { type: 'message.user', text: 'eski mesaj', source: 'owner' });
    t.advance(10 * MIN);
    const since = t.now();
    t.advance(5 * MIN);
    const g = t.goal('Satış');
    t.plan('Teklifler', { goalId: g.id });
    t.events.append(t.coordinator.id, { type: 'message.user', text: 'Kota sınırını %60’a çektim;\nönce mobil sürümü bitirelim, sonra masaüstüne geçeriz. Bu arada fiyat sayfası da beklemesin, Ada boşsa ona ver lütfen, ben akşam bakarım.', source: 'owner' });
    t.events.append(t.coordinator.id, { type: 'message.user', text: 'sistem notu', source: 'system' });
    t.events.append(ada.id, { type: 'message.user', text: 'Ada’ya özel', source: 'owner' });
    const lines = t.section(t.board({ since }).text, 1).split('\n');
    expect(lines).toContain('- Plan ve hedef: “Satış” hedefi açıldı; “Teklifler” planı onaylandı');
    expect(lines).toContain('- Sahibinin mesajı: 09:15 “Kota sınırını %60’a çektim; önce mobil sürümü bitirelim, sonra masaüstüne geçeriz. Bu arada fiyat sayfası da beklemesin…”');
    expect(lines.join('\n')).not.toMatch(/Eski plan|eski mesaj|sistem notu|Ada’ya özel/);
  });

  it('plans the coordinator’s closing of their goal closed: done, or stopped with the goal — not as the owner’s stop, which still says so', () => {
    const t = make();
    const [sales, help, launch] = ['Satış', 'Destek', 'Lansman'].map((n) => t.goal(n));
    t.plan('Teklifler', { goalId: sales!.id });
    const desk = t.plan('Yardım', { goalId: help!.id });
    t.plan('Site', { goalId: launch!.id });
    const since = t.now();
    t.advance(MIN);
    t.company.goalSet(t.coordinator.id, { goalId: sales!.id, status: 'dropped' });
    t.company.stopPlan(desk.id);
    t.company.goalSet(t.coordinator.id, { goalId: launch!.id, status: 'done' });
    expect(t.section(t.board({ since }).text, 1).split('\n')).toContain(
      '- Plan ve hedef: “Satış” hedefi bırakıldı; “Teklifler” planı hedefiyle durdu; “Yardım” planı sahibince durduruldu; “Lansman” hedefi tamamlandı; “Site” planı bitti',
    );
  });

  it('a note on a task already blocked is not a new stall; only the move into blocked is', () => {
    const t = make();
    const [bora, can, ece] = ['Bora', 'Can', 'Ece'].map((n) => t.person(n));
    const old = t.task(bora!.id, 'Eski takılma');
    t.company.start(old.id);
    t.company.update(bora!.id, old.id, { blocked: true, note: 'ilk' });
    t.advance(MIN);
    const again = t.task(ece!.id, 'Tekrar takılan');
    t.company.start(again.id);
    t.company.update(ece!.id, again.id, { blocked: true, note: 'önce' });
    t.advance(MIN);
    const fresh = t.task(can!.id, 'Yeni takılan');
    t.company.start(fresh.id);
    t.advance(10 * MIN);
    const since = t.now();
    t.advance(5 * MIN);
    t.company.update(bora!.id, old.id, { note: 'hâlâ bekliyor' });
    t.company.update(can!.id, fresh.id, { blocked: true, note: 'anahtar yok' });
    t.company.update(can!.id, fresh.id, { note: 'anahtar hâlâ yok' });
    t.company.update(ece!.id, again.id, { blocked: false });
    t.company.update(ece!.id, again.id, { blocked: true, note: 'yine' });
    const line = t.section(t.board({ since }).text, 1).split('\n').find((l) => l.startsWith('- Yeni takılmalar'));
    expect(line).toBe('- Yeni takılmalar: “Tekrar takılan” (Ece, takıldı: yine); “Yeni takılan” (Can, takıldı: anahtar hâlâ yok)');
  });

  it('a log read that hits its cap says so at the head of the section', () => {
    const t = make();
    for (let i = 0; i < 2001; i += 1) t.events.append(t.coordinator.id, { type: 'message.user', text: `mesaj ${i}`, source: 'owner' });
    expect(t.section(t.board({ since: T0 - 1 }).text, 1).split('\n')[1]).toBe('- (günlüğün yalnız son 2 000 olayı okundu)');
    const u = make();
    for (let i = 0; i < 1999; i += 1) u.events.append(u.coordinator.id, { type: 'message.user', text: `mesaj ${i}`, source: 'owner' });
    // 1 999 messages and make()'s own budget.changed: exactly the cap, all of it read.
    expect(u.events.since(T0 - 1, ['message.user', 'budget.changed'], 5000)).toHaveLength(2000);
    expect(u.section(u.board({ since: T0 - 1 }).text, 1)).not.toContain('günlüğün yalnız');
  });

  it('only what was logged after the last cycle started: the same events before it are left out', () => {
    const t = make();
    const ada = t.person('Ada');
    const g = t.goal('Lansman');
    t.plan('Site', { goalId: g.id });
    const a = t.task(ada.id, 'Birinci');
    t.company.start(a.id);
    t.finish(ada.id, a.id);
    t.events.append(t.coordinator.id, { type: 'message.user', text: 'merhaba', source: 'owner' });
    // Everything above was logged at T0: a cycle that started then has seen it.
    expect(t.section(t.board({ since: T0 }).text, 1)).toBe('## 1. Ne değişti (son turdan beri)\n- yok');
    expect(t.section(t.board({ since: T0 - 1 }).text, 1)).toMatch(/Teslim: “Birinci”[\s\S]*“Lansman” hedefi açıldı[\s\S]*merhaba/);
  });
});

describe('board — 2. Hedefler ve planlar', () => {
  it('each active goal with its running plans; each running plan’s streams with status, owner, work and order; the comparisons with reality', () => {
    const t = make();
    const [ada, can, bora, mert, eski] = ['Ada', 'Can', 'Bora', 'Mert', 'Eski'].map((n) => t.person(n));
    const g = t.goal('Lansman');
    t.goal('Satış');
    const p = t.plan('Site', {
      goalId: g.id,
      streams: [
        { id: 'api', title: 'API', owner: 'Ada' },
        { id: 'ui', title: 'Arayüz', owner: 'Ada', dependsOn: ['api'] },
        { id: 'test', title: 'Test', owner: 'Ada', dependsOn: ['ui'] },
        { id: 'mobil', title: 'Mobil', owner: 'Can' },
        { id: 'doc', title: 'Belgeler', owner: 'alınacak: yazar' },
        { id: 'arsiv', title: 'Arşiv', owner: 'Eski' },
        { id: 'ceviri', title: 'Çeviri', owner: 'Mert' },
      ],
    });
    const api = t.task(ada!.id, 'Uç noktalar', { planId: p.id, streamId: 'api' });
    t.task(ada!.id, 'Ekranlar', { planId: p.id, streamId: 'ui' });
    t.task(ada!.id, 'Uçtan uca test', { planId: p.id, streamId: 'test' });
    const m1 = t.task(can!.id, 'Mobil iskelet', { planId: p.id, streamId: 'mobil' });
    t.task(bora!.id, 'Mobil ödeme', { planId: p.id, streamId: 'mobil' });
    for (const [who, id] of [[ada!.id, api.id], [can!.id, m1.id]] as const) {
      t.company.start(id);
      t.finish(who, id);
    }
    t.roster.update(eski!.id, { lifecycle: 'archived' });
    t.roster.update(mert!.id, { lifecycle: 'limited' });
    t.advance(MIN);
    t.plan('Bakım');
    t.advance(89 * MIN);
    expect(t.section(t.board().text, 2)).toBe(
      [
        '## 2. Hedefler ve planlar',
        '- Hedef “Lansman” → plan “Site” (sürüyor; 2/5 iş bitti)',
        '  · api (Ada): bitti, 1/1 iş',
        '  · ui (Ada): planlı, 0/1 iş, önce api',
        '  · test (Ada): planlı, 0/1 iş, önce ui',
        '  · mobil (Can): sürüyor, 1/2 iş',
        '  · doc (alınacak: yazar): planlı, görevi yok',
        '  · arsiv (Eski): planlı, görevi yok',
        '  · ceviri (Mert): planlı, görevi yok',
        // The most actionable first: no usable owner, then an idle owner, then the rest.
        '  ! doc: sahibi yok (alınacak: yazar)',
        '  ! arsiv: sahibi Eski işten ayrıldı',
        '  ! ceviri: sahibi Mert iş alamıyor (limit doldu)',
        '  ! mobil: sahibi Can boşta (1 sa 30 dk)',
        '  ! tek kişide 2 açık akış (Ada): ui, test — bağımlı: ui → test',
        '- Hedef “Satış”: süren planı yok — planPropose ile goalId vererek başlat ya da goalSet ile kapat',
        '- Hedefsiz plan “Bakım” (sürüyor; görevi yok)',
        '  ! onaylı ama hiç görevi açılmadı (onay 1 sa 29 dk önce) — görevlerini taskCreate ile aç ya da yerine yeni plan öner',
      ].join('\n'),
    );
  });

  it('a stream that may start (what it waits for is done) whose owner is idle; streams on one person that do not wait for each other', () => {
    const t = make();
    const [ada, can] = ['Ada', 'Can'].map((n) => t.person(n));
    const g = t.goal('Lansman');
    const p = t.plan('Site', {
      goalId: g.id,
      streams: [
        { id: 'api', title: 'API', owner: 'Ada' },
        { id: 'ui', title: 'Arayüz', owner: 'Can', dependsOn: ['api'] },
        { id: 'doc', title: 'Belgeler', owner: 'Ada' },
        { id: 'seo', title: 'SEO', owner: 'Ada' },
      ],
    });
    const api = t.task(ada!.id, 'Uç noktalar', { planId: p.id, streamId: 'api' });
    t.task(ada!.id, 'README', { planId: p.id, streamId: 'doc' });
    t.task(ada!.id, 'Meta etiketleri', { planId: p.id, streamId: 'seo' });
    t.company.start(api.id);
    t.finish(ada!.id, api.id);
    t.advance(20 * MIN);
    const flags = t.section(t.board().text, 2).split('\n').filter((l) => l.startsWith('  !'));
    expect(flags).toEqual([
      '  ! ui: önündeki api bitti, görevi yok (sahibi Can boşta, 20 dk) — görev aç ya da akışı kaldır',
      '  ! tek kişide 2 açık akış (Ada): doc, seo — paralel yürüyemez',
    ]);
    expect(can).toBeTruthy();
  });

  it('a healthy plan has no comparison line; a plan waiting for the owner says so', () => {
    const t = make();
    const [ada, can] = ['Ada', 'Can'].map((n) => t.person(n));
    const g = t.goal('Lansman');
    const p = t.plan('Site', { goalId: g.id, streams: [{ id: 'api', title: 'API', owner: 'Ada' }, { id: 'ui', title: 'Arayüz', owner: 'Can' }] });
    for (const [who, title, stream] of [[ada!.id, 'Uç noktalar', 'api'], [can!.id, 'Ekranlar', 'ui']] as const) t.company.start(t.task(who, title, { planId: p.id, streamId: stream }).id);
    t.budget.setConstitution({ autonomy: 'plans' });
    const g2 = t.goal('Satış');
    t.plan('Teklifler', { goalId: g2.id, streams: [{ id: 'liste', title: 'Liste', owner: 'Ada' }] });
    const body = t.section(t.board().text, 2);
    expect(body).not.toContain('  !');
    expect(body).toBe(
      [
        '## 2. Hedefler ve planlar',
        '- Hedef “Lansman” → plan “Site” (sürüyor; 0/2 iş bitti)',
        '  · api (Ada): sürüyor, 0/1 iş',
        '  · ui (Can): sürüyor, 0/1 iş',
        '- Hedef “Satış” → plan “Teklifler” (sahibinin onayında; görevi yok)',
        '  · liste (Ada): planlı, görevi yok',
      ].join('\n'),
    );
  });
});

describe('board — done streams and a plan that runs on', () => {
  it('a stream’s last task closes while the stream after it has no task yet: the plan runs on, no kickoff, the planned streams listed, the action named', () => {
    const t = make();
    const [ada] = ['Ada', 'Can'].map((n) => t.person(n));
    const g = t.goal('Lansman');
    const p = t.plan('Site', {
      goalId: g.id,
      streams: [
        { id: 'api', title: 'API', owner: 'Ada' },
        { id: 'ui', title: 'Arayüz', owner: 'Can', dependsOn: ['api'] },
        { id: 'test', title: 'Test', owner: 'alınacak: testçi', dependsOn: ['ui'] },
      ],
    });
    const api = t.task(ada!.id, 'Uç noktalar', { planId: p.id, streamId: 'api' });
    t.company.start(api.id);
    t.finish(ada!.id, api.id);
    t.advance(15 * MIN);
    const b = t.board();
    expect(t.plans.get(p.id).status).toBe('approved');
    expect(b.kickoff).toBe(false);
    expect(t.section(b.text, 2)).toBe(
      [
        '## 2. Hedefler ve planlar',
        '- Hedef “Lansman” → plan “Site” (sürüyor; 1/1 iş bitti)',
        '  · api (Ada): bitti, 1/1 iş',
        '  · ui (Can): planlı, görevi yok, önce api',
        '  · test (alınacak: testçi): planlı, görevi yok, önce ui',
        '  ! test: sahibi yok (alınacak: testçi)',
        '  ! ui: önündeki api bitti, görevi yok (sahibi Can boşta, 15 dk) — görev aç ya da akışı kaldır',
      ].join('\n'),
    );
  });

  it('a stream that became done is told once, in what changed since the last cycle', () => {
    const t = make();
    const ada = t.person('Ada');
    const p = t.plan('Site', { streams: [{ id: 'api', title: 'API', owner: 'Ada' }, { id: 'ui', title: 'Arayüz', owner: 'Ada', dependsOn: ['api'] }] });
    const api = t.task(ada.id, 'Uç noktalar', { planId: p.id, streamId: 'api' });
    t.task(ada.id, 'Ekranlar', { planId: p.id, streamId: 'ui' });
    t.advance(10 * MIN);
    const before = t.now();
    t.advance(5 * MIN);
    t.company.start(api.id);
    t.finish(ada.id, api.id);
    t.advance(5 * MIN);
    expect(t.section(t.board({ since: before }).text, 1)).toContain('- Akış bitti: api (plan “Site”)');
    const next = t.now();
    t.advance(5 * MIN);
    expect(t.section(t.board({ since: next }).text, 1)).not.toContain('Akış bitti');
    // Not repeated as a comparison either: nothing to act on.
    expect(t.section(t.board({ since: next }).text, 2)).not.toContain('  !');
  });

  it('a stream left without work while one that waits for it has started (its part done outside a task): one line naming the first started ones and both ways out; not while they wait, not once the stream has its task', () => {
    const t = make();
    const [ada, can] = ['Ada', 'Can'].map((n) => t.person(n));
    const g = t.goal('Araç');
    const p = t.plan('Araç', {
      goalId: g.id,
      streams: [
        { id: 'temel', title: 'Temel', owner: 'Koordinatör' },
        { id: 'cekirdek', title: 'Çekirdek', owner: 'Ada', dependsOn: ['temel'] },
        { id: 'arayuz', title: 'Arayüz', owner: 'Can', dependsOn: ['temel'] },
        { id: 'butun', title: 'Bütün', owner: 'Ada', dependsOn: ['cekirdek', 'arayuz'] },
      ],
    });
    const flags = () => t.section(t.board().text, 2).split('\n').filter((l) => l.startsWith('  !'));
    const chain = '  ! tek kişide 2 açık akış (Ada): cekirdek, butun — bağımlı: cekirdek → butun';
    const core = t.task(ada!.id, 'Çekirdek', { planId: p.id, streamId: 'cekirdek' });
    const ui = t.task(can!.id, 'Arayüz', { planId: p.id, streamId: 'arayuz' });
    // What waits for it has its tasks but has not started: nothing to say yet.
    expect(flags()).toEqual([chain]);
    t.company.start(core.id);
    t.company.start(ui.id);
    t.finish(can!.id, ui.id);
    t.advance(10 * MIN);
    // Both that wait for it started (one done): named; “butun”, which waits for them, is implied.
    expect(flags()).toEqual(['  ! temel: görevi yok ama ona bağlı cekirdek, arayuz başladı — iş yapıldıysa akışı kaldır (planRevise), yoksa görev aç', chain]);
    // Given its task (the coordinator's own, waiting), then done: no line.
    const base = t.task(t.coordinator.id, 'Temel', { planId: p.id, streamId: 'temel' });
    expect(flags()).toEqual([chain]);
    t.company.start(base.id);
    t.finish(t.coordinator.id, base.id);
    expect(flags()).toEqual([chain]);
  });

  it('a stream left without work behind one that started further down the chain: flagged too, ranked with the next stream’s missing tasks (its idle owner first)', () => {
    const t = make();
    const [, , bora] = ['Ada', 'Can', 'Bora'].map((n) => t.person(n));
    const p = t.plan('Zincir', {
      streams: [
        { id: 'a', title: 'A', owner: 'Can' },
        { id: 'b', title: 'B', owner: 'Bora', dependsOn: ['a'] },
        { id: 'c', title: 'C', owner: 'Bora', dependsOn: ['b'] },
      ],
    });
    t.company.start(t.task(bora!.id, 'C işi', { planId: p.id, streamId: 'c' }).id);
    t.advance(20 * MIN);
    expect(t.section(t.board().text, 2).split('\n').filter((l) => l.startsWith('  !'))).toEqual([
      '  ! a: görevi yok ama ona bağlı c başladı (sahibi Can boşta, 20 dk) — iş yapıldıysa akışı kaldır (planRevise), yoksa görev aç',
      '  ! b: görevi yok ama ona bağlı c başladı — iş yapıldıysa akışı kaldır (planRevise), yoksa görev aç',
      '  ! tek kişide 2 açık akış (Bora): b, c — bağımlı: b → c',
    ]);
  });

  it('every stream done while the plan still runs: one line for the plan', () => {
    const t = make();
    const ada = t.person('Ada');
    const p = t.plan('Site', { streams: [{ id: 'api', title: 'API', owner: 'Ada' }] });
    const api = t.task(ada.id, 'Uç noktalar', { planId: p.id, streamId: 'api' });
    t.task(ada.id, 'Akışsız iş', { planId: p.id });
    t.company.start(api.id);
    t.finish(ada.id, api.id);
    expect(t.section(t.board().text, 2).split('\n').filter((l) => l.startsWith('  !'))).toEqual(['  ! bütün akışlar bitti, plan sürüyor — 1 açık iş akışsız']);
  });

  it('every stream done and no open task: a live routine keeps the plan running and says so; with none it is said that the plan should close', () => {
    const t = make();
    const ada = t.person('Ada');
    /** The comparison lines under one plan's heading. */
    const flags = (id: string) => {
      const lines = t.section(t.board().text, 2).split('\n');
      const from = lines.findIndex((l) => l.includes(`plan “${t.plans.get(id).title}”`)) + 1;
      const end = lines.findIndex((l, i) => i >= from && !l.startsWith('  '));
      return lines.slice(from, end < 0 ? undefined : end).filter((l) => l.startsWith('  !'));
    };
    const done = (planId: string) => {
      const x = t.task(ada.id, 'Uç noktalar', { planId, streamId: 'api' });
      t.company.start(x.id);
      t.finish(ada.id, x.id);
    };
    const stream = [{ id: 'api', title: 'API', owner: 'Ada' }];
    const g = t.goal('Lansman');
    const measured = t.plan('Ölçüm', { goalId: g.id, streams: stream });
    t.company.createSchedule(t.coordinator.id, { title: 'Günlük ölçüm', assignee: ada.id, cron: '0 9 * * *', planId: measured.id });
    done(measured.id);
    expect(t.plans.get(measured.id).status).toBe('approved');
    expect(flags(measured.id)).toEqual(['  ! bütün akışlar bitti, plan sürüyor — açık rutin var']);
    // A plan an older office left running with nothing in it (its streams done, no task, no routine).
    const stuck = t.plan('Site', { goalId: g.id, streams: stream });
    done(stuck.id);
    t.plans.update(stuck.id, { status: 'approved' });
    expect(flags(stuck.id)).toEqual(['  ! bütün akışlar bitti, açık iş yok — plan kapanmalı']);
  });

  it('under the cap the most actionable comparisons stay: no usable owner, then an idle owner', () => {
    const t = make(16);
    for (const n of ['Ada', 'Can', 'Ece', 'Deniz', 'Selin']) t.person(n);
    const streams = [
      ...['a1', 'a2', 'a3'].map((id) => ({ id, title: id, owner: 'Ada' })),
      ...['h1', 'h2', 'h3', 'h4', 'h5'].map((id) => ({ id, title: id, owner: 'alınacak: yazar' })),
      ...['Can', 'Ece', 'Deniz', 'Selin'].map((owner, i) => ({ id: `b${i + 1}`, title: owner, owner })),
    ];
    t.plan('Site', { streams });
    const flags = t.section(t.board().text, 2).split('\n').filter((l) => l.startsWith('  !'));
    expect(flags.slice(0, 5)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5'].map((id) => `  ! ${id}: sahibi yok (alınacak: yazar)`));
    expect(flags.slice(5, 8)).toEqual(['a1', 'a2', 'a3'].map((id) => `  ! ${id}: başlayabilir, sahibi Ada boşta (0 dk)`));
    expect(flags.slice(8)).toEqual(['  ! … ve 5 uyarı daha']);
  });
});

describe('board — 3. İnsanlar', () => {
  it('everyone but the coordinator in one group: idle (how long), cannot take work (why), holds work (what), at work (until when, the agenda’s estimates)', () => {
    const t = make(12);
    const [ada, bora, can, ece, deniz, selin, kaan, mert, ali] = ['Ada', 'Bora', 'Can', 'Ece', 'Deniz', 'Selin', 'Kaan', 'Mert', 'Ali'].map((n) => t.person(n));
    const now = t.task(ada!.id, 'Uç noktalar');
    t.company.start(now.id);
    t.task(ada!.id, 'Arama');
    t.task(ada!.id, 'Filtre');
    const stuck = t.task(bora!.id, 'Kurulum');
    t.company.start(stuck.id);
    t.company.update(bora!.id, stuck.id, { blocked: true });
    const giris = t.task(ece!.id, 'Giriş', { reviewer: can!.id });
    t.company.start(giris.id);
    t.finish(ece!.id, giris.id);
    // Can reviews it: he takes the review up below.
    const rapor = t.task(deniz!.id, 'Rapor');
    t.company.start(rapor.id);
    t.company.parkTask(deniz!.id, rapor.id, '+5h', 'müşteri dönüşü');
    t.task(selin!.id, 'Bülten', { startAfter: '+4h' });
    t.task(kaan!.id, 'Uçtan uca test', { dependsOn: [now.id] });
    t.task(mert!.id, 'Çeviri');
    t.roster.update(mert!.id, { lifecycle: 'limited', limitResetsAt: T0 + 3 * HOUR });
    t.roster.update(ali!.id, { lifecycle: 'in_terminal' });
    const review = t.tasks.list({ assignee: can!.id })[0]!;
    t.company.start(review.id);
    t.advance(30 * MIN);
    expect(t.section(t.board().text, 3)).toBe(
      [
        '## 3. İnsanlar (9 kişi: 3 işte, 4 elinde iş, 0 boşta, 2 iş alamıyor)',
        '- İş alamıyor (2): Mert — limit doldu, açılış 12:00, elinde 1 iş; Ali — sahibinin terminalinde',
        '- Elinde iş, başında değil (4): Ece — “Giriş” incelemede (Can); Deniz — “Rapor” ertelendi, dönüş 14:00; Selin — “Bülten” başlangıç 13:00; Kaan — sırada “Uçtan uca test” (“Uç noktalar” bitince)',
        '- İşte (3): Ada — “Uç noktalar” 09:00 → ~09:45, sırada 2 → ~11:15; Bora — “Kurulum” 09:00 → ~09:45 (takıldı); Can — “İnceleme: Giriş (tur 1)” 09:00 → ~09:30 (uzuyor)',
      ].join('\n'),
    );
  });

  it('idle the longest first; “uzun süredir” from the constitution’s idleCapacityHours (0: never)', () => {
    const t = make();
    const [ada, can] = ['Ada', 'Can'].map((n) => t.person(n));
    t.advance(60 * MIN);
    const x = t.task(ada!.id, 'kısa iş');
    t.company.start(x.id);
    t.finish(ada!.id, x.id);
    t.advance(70 * MIN);
    expect(t.section(t.board().text, 3).split('\n')[1]).toBe('- Boşta (2): Can — 2 sa 10 dk (uzun süredir); Ada — 1 sa 10 dk');
    t.budget.setConstitution({ idleCapacityHours: 1 });
    expect(t.section(t.board().text, 3).split('\n')[1]).toBe('- Boşta (2): Can — 2 sa 10 dk (uzun süredir); Ada — 1 sa 10 dk (uzun süredir)');
    t.budget.setConstitution({ idleCapacityHours: 0 });
    expect(t.section(t.board().text, 3).split('\n')[1]).toBe('- Boşta (2): Can — 2 sa 10 dk; Ada — 1 sa 10 dk');
    expect(can).toBeTruthy();
  });
});

describe('board — 4. Zincirler ve kritik yol', () => {
  it('chained open work, whose it is, and the longest path with its estimated end', () => {
    const t = make();
    const [ada, can, bora, ece] = ['Ada', 'Can', 'Bora', 'Ece'].map((n) => t.person(n));
    const a = t.task(ada!.id, 'Şema');
    t.company.start(a.id);
    const b = t.task(can!.id, 'Uç noktalar', { dependsOn: [a.id] });
    t.task(ada!.id, 'Ekranlar', { dependsOn: [b.id] });
    t.task(can!.id, 'Bağımsız iş');
    // A closed dependency holds nothing (cancelled: a finished one would give the estimates a 0-minute history).
    const closed = t.task(bora!.id, 'Kapandı zaten');
    t.tasks.update(closed.id, { status: 'cancelled' });
    const d = t.task(bora!.id, 'Taslak', { dependsOn: [closed.id] });
    t.task(ece!.id, 'Düzelti', { dependsOn: [d.id] });
    expect(t.section(t.board().text, 4)).toBe(
      [
        '## 4. Zincirler ve kritik yol',
        '- Zincirli açık iş: 5 (bağımlılık bekleyen 3)',
        '- Kimde: Ada (2), Bora (1), Can (1), Ece (1)',
        // The agenda's estimate, as it gives it (it does not ask Ada's agenda again while working it out).
        '- En uzun yol (3 iş, tahmini bitiş ~10:30): “Şema” (Ada) → “Uç noktalar” (Can) → “Ekranlar” (Ada)',
      ].join('\n'),
    );
  });

  it('a long path is shortened in the middle; a dependency ring does not hang it', () => {
    const t = make();
    const ada = t.person('Ada');
    let prev: string[] = [];
    for (let i = 1; i <= 7; i += 1) prev = [t.task(ada.id, `Adım ${i}`, { dependsOn: prev }).id];
    expect(t.section(t.board().text, 4).split('\n').at(-1)).toBe(
      '- En uzun yol (7 iş, tahmini bitiş ~14:15): “Adım 1” (Ada) → “Adım 2” (Ada) → … 3 iş … → “Adım 6” (Ada) → “Adım 7” (Ada)',
    );
    const x = t.task(ada.id, 'Halka A');
    const y = t.task(ada.id, 'Halka B', { dependsOn: [x.id] });
    t.db.prepare('UPDATE tasks SET depends_on = ? WHERE id = ?').run(JSON.stringify([y.id]), x.id);
    expect(t.section(t.board().text, 4)).toContain('- Zincirli açık iş: 9 (bağımlılık bekleyen 8)');
  });

  it('no dependency between open tasks: “yok”', () => {
    const t = make();
    const ada = t.person('Ada');
    t.task(ada.id, 'Tek iş');
    expect(t.section(t.board().text, 4)).toBe('## 4. Zincirler ve kritik yol\n- yok');
  });
});

describe('board — 5. Riskler', () => {
  it('blocked, past due, stalled after a reminder, due soon (and whether the estimate makes it), waiting in review — each task once', () => {
    const t = make();
    const [bora, ece, mert, selin, can] = ['Bora', 'Ece', 'Mert', 'Selin', 'Can'].map((n) => t.person(n));
    const kurulum = t.task(bora!.id, 'Kurulum');
    t.company.start(kurulum.id);
    t.company.update(bora!.id, kurulum.id, { blocked: true, note: 'sunucu erişimi yok' });
    t.task(ece!.id, 'Rapor', { dueAt: '+10m' });
    const giris = t.task(ece!.id, 'Giriş', { reviewer: can!.id });
    t.company.start(giris.id);
    t.finish(ece!.id, giris.id);
    // Handed in for review, then past its due date: counted once, as late.
    const late = t.task(selin!.id, 'Geç teslim', { reviewer: can!.id, dueAt: '+20m' });
    t.company.start(late.id);
    t.finish(selin!.id, late.id);
    const ceviri = t.task(mert!.id, 'Çeviri');
    t.company.start(ceviri.id);
    t.advance(5 * MIN);
    t.tasks.update(ceviri.id, { nudged: true, nudgedAt: t.now() });
    t.company.start(t.task(selin!.id, 'Uzun iş').id);
    t.task(selin!.id, 'Bülten', { dueAt: '+55m' });
    t.task(selin!.id, 'Yarınki', { dueAt: '+20h' });
    t.task(selin!.id, 'Uzak', { dueAt: '+3d' });
    t.advance(25 * MIN);
    expect(t.section(t.board().text, 5)).toBe(
      [
        '## 5. Riskler',
        '- Takıldı: “Kurulum” (Bora): sunucu erişimi yok',
        '- Son tarihi geçti: “Rapor” (Ece), 09:10',
        '- Son tarihi geçti: “Geç teslim” (Selin), 09:20',
        '- Hatırlatmaya rağmen ilerlemiyor: “Çeviri” (Mert), hatırlatma 09:05',
        '- Son tarih yaklaşıyor: “Bülten” (Selin), 10:00 — tahmini bitiş ~10:35, yetişmiyor',
        '- Son tarih yaklaşıyor: “Yarınki” (Selin), yarın 05:05',
        '- İncelemede: “Giriş” (Ece → Can), 30 dk',
      ].join('\n'),
    );
  });

  it('at most eight lines; the rest counted by kind', () => {
    const t = make();
    const [bora, ece, can] = ['Bora', 'Ece', 'Can'].map((n) => t.person(n));
    for (let i = 1; i <= 12; i += 1) {
      const x = t.task(bora!.id, `Takılan ${i}`);
      t.company.start(x.id);
      t.company.update(bora!.id, x.id, { blocked: true });
    }
    for (let i = 1; i <= 3; i += 1) {
      const x = t.task(ece!.id, `İncelenen ${i}`, { reviewer: can!.id });
      t.company.start(x.id);
      t.finish(ece!.id, x.id);
    }
    const lines = t.section(t.board().text, 5).split('\n');
    expect(lines).toHaveLength(10);
    expect(lines.at(-1)).toBe('- … ve 7 risk daha: 4 takılı, 3 incelemede');
  });
});

describe('board — 6. Kaynak', () => {
  const turn = (costUsd: number) =>
    ({ type: 'turn.finished', ok: true, subtype: 'success', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 }, costUsd, numTurns: 1, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0 }) as const;

  it('quota windows against the office’s limit, the last day’s use and spending, the month against its cap, each plan against its estimates', () => {
    const t = make();
    const ada = t.person('Ada');
    t.budget.setConstitution({ monthlyUsdCap: 100 });
    t.advance(-30 * HOUR);
    t.events.append(ada.id, turn(9));
    t.budget.recordSpend(ada.id, { service: 'Alan adı', usd: 5, purpose: 'site' });
    t.advance(30 * HOUR);
    const g = t.goal('Lansman');
    const site = t.plan('Site', { goalId: g.id });
    t.plans.update(site.id, { quotaPct: 20, usd: 10, days: 3 });
    const bakim = t.plan('Bakım');
    t.plans.update(bakim.id, { usd: 2, days: 1 });
    t.advance(36 * HOUR);
    t.events.append(ada.id, turn(1.2));
    t.events.append(t.coordinator.id, turn(0.3));
    t.events.append(ada.id, { type: 'side.answer', text: 'x', ok: true, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 }, costUsd: 0.1 });
    t.budget.recordSpend(ada.id, { service: 'Figma', usd: 15, purpose: 'tasarım', planId: site.id });
    t.budget.recordSpend(ada.id, { service: 'Sunucu', usd: 3, purpose: 'bakım', planId: bakim.id });
    const x = t.task(ada.id, 'Uç noktalar', { planId: site.id });
    t.tasks.charge(x.id, 2.5, 1000);
    t.setQuota({ status: 'allowed', fiveHour: { utilization: 0.42, resetsAt: t.now() + HOUR }, sevenDay: { utilization: 0.55, resetsAt: t.now() + 3 * 24 * HOUR }, updatedAt: t.now() });
    expect(t.section(t.board().text, 6)).toBe(
      [
        '## 6. Kaynak',
        '- Kota: 5 saat %42, 7 gün %55; ofisin sınırı %75 (sahibinin payı %25)',
        '- Son 24 saat: Claude ~$1.6 (2 tur); kayıtlı harcama $18; bu ay $23 / sınır $100',
        '- Plan “Site”: Claude ~$2.5; harcama $15 / tahmin $10 (aşıldı); 1,5 / 3 gün; tahmini kota %20',
        '- Plan “Bakım”: Claude ~$0; harcama $3 / tahmin $2 (aşıldı); 1,5 / 1 gün (aşıldı)',
      ].join('\n'),
    );
    t.setQuota({ status: 'allowed', fiveHour: { utilization: 0.8, resetsAt: t.now() + HOUR }, sevenDay: null, updatedAt: t.now() });
    expect(t.section(t.board().text, 6).split('\n')[1]).toBe('- Kota: 5 saat %80, 7 gün —; ofisin sınırı %75 (sahibinin payı %25); PAY DEVREDE: yalnız öncelik 1 işler başlıyor');
  });
});

describe('board — 7. Açık kararlar', () => {
  it('plans and revisions waiting for the owner, proposals with the owner, proposals the coordinator decides, onboarding questions the owner has not answered', () => {
    const t = make();
    const [ada, can] = ['Ada', 'Can'].map((n) => t.person(n));
    t.budget.setConstitution({ autonomy: 'plans' });
    const site = t.plan('Site');
    t.company.approve(site.id);
    t.company.openProposal(ada!.id, { kind: 'purchase', title: 'Figma lisansı', text: 'tasarım için', usd: 15 });
    t.advance(30 * MIN);
    t.plan('Teklifler');
    t.company.revise(t.coordinator.id, site.id, { days: 4 });
    t.company.openProposal(can!.id, { kind: 'idea', title: 'Önbellek', text: 'sayfalar hızlansın' });
    t.company.onboardingStart(t.coordinator.id, 'Küçük bir kafe zinciri');
    t.company.onboardingNext(t.coordinator.id);
    t.advance(20 * MIN);
    expect(t.section(t.board().text, 7)).toBe(
      [
        '## 7. Açık kararlar',
        '- Sahibinin onayında: plan “Site” revizyonu (sürüm 2, 20 dk önce)',
        '- Sahibinin onayında: plan “Teklifler” (sürüm 1, 20 dk önce)',
        '- Sahibinde (1): satın alma “Figma lisansı” ($15, Ada, 50 dk önce)',
        '- Sende (1): fikir “Önbellek” (Can, 20 dk önce)',
        '- Onboarding: sahibine 5 soru soruldu (09:30), cevap bekleniyor',
      ].join('\n'),
    );
    // The owner answers in the chat: the round is no longer waiting.
    t.events.append(t.coordinator.id, { type: 'message.user', text: 'Adımız Kahve Durağı…', source: 'owner' });
    expect(t.section(t.board().text, 7)).not.toContain('Onboarding');
  });
});

/**
 * A big office: 40 people (30 with work, 6 idle, 4 at their quota limit), 3 goals with a plan each (6 chained streams),
 * 300 open tasks (in progress, blocked, in review, chained, due soon), and a busy hour since the last cycle (20
 * deliveries, the owner's messages, proposals).
 */
function bigOffice() {
  const t = make(48);
  t.budget.setConstitution({ openTasksPerPlan: 200, tasksPerDay: 500 });
  const people = Array.from({ length: 40 }, (_, i) => t.person(`Kişi ${i + 1}`, { title: 'Yazılımcı' }));
  const plans = [1, 2, 3].map((n) => {
    const g = t.goal(`Hedef ${n}: müşteri sayısını artıracak uzun soluklu bir iş`);
    const streams = Array.from({ length: 6 }, (_, s) => ({ id: `akis-${s + 1}`, title: `Akış ${s + 1}`, owner: people[((n - 1) * 6 + s) % 30]!.name, dependsOn: s ? [`akis-${s}`] : [] }));
    return t.plan(`Plan ${n}: lansman öncesi hazırlıklar ve ölçüm`, { goalId: g.id, streams });
  });
  const tasks: Task[] = [];
  for (let i = 0; i < 300; i += 1) {
    const who = people[i % 30]!;
    const plan = plans[i % 3]!;
    const prev = tasks.at(-1);
    tasks.push(
      t.task(who.id, `İş ${i + 1}: uzunca bir başlık, ne yapılacağını anlatan`, {
        planId: plan.id,
        streamId: `akis-${(i % 6) + 1}`,
        dependsOn: i % 3 === 2 && prev ? [prev.id] : [],
        reviewer: i % 30 >= 25 && i < 60 ? people[(i + 1) % 30]!.id : undefined,
        dueAt: i % 17 === 0 ? '+3h' : undefined,
      }),
    );
  }
  for (let p = 0; p < 30; p += 1) {
    const first = tasks[p]!;
    t.company.start(first.id);
    if (p >= 20 && p < 25) t.company.update(people[p]!.id, first.id, { blocked: true, note: 'bir şey bekliyor, ayrıntı notta' });
    if (p >= 25) t.finish(people[p]!.id, first.id);
  }
  for (const p of people.slice(36)) t.roster.update(p.id, { lifecycle: 'limited', limitResetsAt: T0 + 5 * HOUR });
  t.advance(10 * MIN);
  const since = t.now();
  t.advance(5 * MIN);
  for (let i = 0; i < 20; i += 1) {
    const x = t.task(people[30 + (i % 6)]!.id, `Hızlı iş ${i + 1}: kısa ama başlığı uzun bir teslim`);
    t.company.start(x.id);
    t.finish(people[30 + (i % 6)]!.id, x.id);
  }
  for (let i = 0; i < 5; i += 1) t.events.append(t.coordinator.id, { type: 'message.user', text: `Mesaj ${i + 1}: `.padEnd(400, 'uzun bir açıklama '), source: 'owner' });
  for (let i = 0; i < 10; i += 1) {
    t.company.openProposal(people[i]!.id, { kind: 'purchase', title: `Lisans ${i + 1}`, text: 'gerekli', usd: 20 });
    t.company.openProposal(people[i]!.id, { kind: 'idea', title: `Fikir ${i + 1}`, text: 'iyi olur' });
  }
  t.advance(30 * MIN);
  return { t, since };
}

describe('board — short', () => {
  it('each list is capped and the rest counted: deliveries, who became idle, the idle', () => {
    const t = make(24);
    const people = Array.from({ length: 12 }, (_, i) => t.person(`Kişi ${i + 1}`));
    t.advance(MIN);
    const since = t.now();
    t.advance(MIN);
    for (const p of people) {
      const x = t.task(p.id, `İş ${p.name}`);
      t.company.start(x.id);
      t.finish(p.id, x.id);
    }
    const text = t.board({ since }).text;
    const changed = t.section(text, 1).split('\n');
    expect(changed.filter((l) => l.startsWith('- Teslim'))).toHaveLength(8);
    expect(changed).toContain('- … ve 4 teslim daha');
    expect(changed).toContain('- Boşa çıktı: Kişi 1, Kişi 2, Kişi 3, Kişi 4, Kişi 5, Kişi 6, Kişi 7, Kişi 8, … ve 4 kişi daha');
    expect(t.section(text, 3).split('\n')[1]).toBe(`- Boşta (12): ${people.slice(0, 8).map((p) => `${p.name} — 0 dk`).join('; ')}; … ve 4 kişi daha`);
  });

  it('every stream of a plan while the board is short; a board over the budget is drawn again, tighter', () => {
    const t = make();
    const ada = t.person('Ada');
    const g = t.goal('Lansman');
    const streams = Array.from({ length: 12 }, (_, i) => ({ id: `s${i + 1}`, title: `Akış ${i + 1}`, owner: 'Ada' }));
    t.plan('Site', { goalId: g.id, streams });
    expect(t.section(t.board().text, 2).split('\n').filter((l) => l.startsWith('  · '))).toHaveLength(12);
    expect(ada).toBeTruthy();
    const { t: big, since } = bigOffice();
    const text = big.board({ since }).text;
    // Over the budget with the first two limits (most of each plan's chained streams have no task while a later one
    // started: flagged): three lines of a list, three streams of a plan.
    expect(t.section(text, 1).split('\n').filter((l) => l.startsWith('- Teslim'))).toHaveLength(3);
    expect(text).toContain('- … ve 17 teslim daha');
    expect(text).toContain('  · … ve 3 akış daha');
  });

  it('offices without proposals or a usage reader still get a board', () => {
    const t = make();
    const agenda = new Agenda({ roster: t.roster, tasks: t.tasks, schedules: t.schedules, company: t.company, budget: t.budget, now: t.now });
    const b = buildBoard({ db: t.db, events: t.events, roster: t.roster, company: t.company, tasks: t.tasks, plans: t.plans, state: t.state, agenda, budget: t.budget }, { since: 0, now: t.now() });
    expect(t.section(b.text, 6).split('\n')[2]).toBe('- Son 24 saat: kayıtlı harcama $0; bu ay $0');
    expect(t.section(b.text, 7)).toBe('## 7. Açık kararlar\n- yok');
  });

  it('a big office (40 people, 300 open tasks, a busy hour) stays under 4 000 characters, every section there', () => {
    const { t, since } = bigOffice();
    expect(t.tasks.list({ statuses: ['waiting', 'in_progress', 'review', 'blocked', 'parked'], limit: 10_000 }).length).toBeGreaterThanOrEqual(300);
    const { text } = t.board({ since, unclosedWarning: true });
    expect(text.length).toBeLessThan(4000);
    expect(text.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(0, 6))).toEqual(HEADINGS.map((h) => h.slice(0, 6)));
  });
});

describe('board — a realistic office', () => {
  const turn = (costUsd: number) =>
    ({ type: 'turn.finished', ok: true, subtype: 'success', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 }, costUsd, numTurns: 1, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0 }) as const;

  it('the whole board, as the coordinator reads it', () => {
    const t = make();
    const [ada, can, ece, bora, mert] = [['Ada', 'Yazılımcı'], ['Can', 'Yazılımcı'], ['Ece', 'Tasarımcı'], ['Bora', 'Testçi'], ['Mert', 'Yazar']].map(([n, title]) => t.person(n!, { title }));
    const g = t.goal('Lansman');
    t.goal('Satış ortaklıkları');
    const site = t.plan('Web sitesi', {
      goalId: g.id,
      streams: [
        { id: 'api', title: 'API', owner: 'Ada' },
        { id: 'ui', title: 'Arayüz', owner: 'Ece', dependsOn: ['api'] },
        { id: 'test', title: 'Test', owner: 'Bora', dependsOn: ['ui'] },
        { id: 'icerik', title: 'İçerik', owner: 'alınacak: metin yazarı' },
      ],
    });
    t.plans.update(site.id, { quotaPct: 15, usd: 20, days: 2 });
    const sema = t.task(ada!.id, 'Şema ve uç noktalar', { planId: site.id, streamId: 'api', reviewer: can!.id });
    const ana = t.task(ece!.id, 'Ana sayfa tasarımı', { planId: site.id, streamId: 'ui', dependsOn: [sema.id] });
    t.task(bora!.id, 'Uçtan uca testler', { planId: site.id, streamId: 'test', dependsOn: [ana.id], dueAt: '2026-10-08T11:30' });
    t.task(mert!.id, 'Blog yazısı');
    t.company.start(sema.id);
    t.advance(10 * MIN);
    const odeme = t.task(can!.id, 'Ödeme entegrasyonu', { planId: site.id });
    t.company.start(odeme.id);
    t.advance(30 * MIN);
    t.company.finish(ada!.id, sema.id, { summary: 'tamam', outputs: [], learned: '', evidence: [] });
    t.budget.recordSpend(ada!.id, { service: 'Alan adı ve barındırma', usd: 12, purpose: 'site', planId: site.id });
    t.events.append(t.coordinator.id, turn(0.42));
    t.events.append(ada!.id, turn(1.1));
    t.tasks.charge(sema.id, 1.1, 1000);
    t.advance(20 * MIN);
    // 10:00 — the last cycle.
    const since = t.now();
    t.advance(5 * MIN);
    t.company.openProposal(ece!.id, { kind: 'purchase', title: 'Figma lisansı', text: 'tasarım için', usd: 15 });
    t.roster.update(mert!.id, { lifecycle: 'limited', limitResetsAt: T0 + 4 * HOUR });
    t.setQuota({ status: 'allowed', fiveHour: { utilization: 0.48, resetsAt: T0 + 3 * HOUR }, sevenDay: { utilization: 0.61, resetsAt: T0 + 3 * 24 * HOUR }, updatedAt: t.now() });
    t.advance(5 * MIN);
    t.events.append(t.coordinator.id, { type: 'message.user', text: 'Lansmanı cumaya çekebilir miyiz? Ödeme olmadan da açabiliriz.', source: 'owner' });
    t.advance(2 * MIN);
    t.budget.ownerSetConstitution({ ownerReservePct: 40 });
    t.advance(3 * MIN);
    t.company.update(can!.id, odeme.id, { blocked: true, note: 'sağlayıcı anahtarı yok' });
    t.events.append(can!.id, turn(0.65));
    t.advance(5 * MIN);
    t.company.reviewDecide(can!.id, t.tasks.list({ assignee: can!.id }).find((x) => x.reviewOf === sema.id)!.id, { decision: 'approve' });
    t.company.openProposal(bora!.id, { kind: 'idea', title: 'Test verisini otomatik üret', text: 'her koşuda aynı veri' });
    t.advance(10 * MIN);
    const b = t.board({ since });
    // “Satış ortaklıkları” waits for its plan while “Lansman”'s runs: a management cycle, not a project start.
    expect(b.kickoff).toBe(false);
    expect(b.text).toBe(`Yönetim panosu · 8 Eki 2026 10:30 · son tur 10:00 (30 dk önce)

## 1. Ne değişti (son turdan beri)
- Teslim: “Şema ve uç noktalar” — Ada → onaylandı (Can)
- Akış bitti: api (plan “Web sitesi”)
- Yeni takılmalar: “Ödeme entegrasyonu” (Can, takıldı: sağlayıcı anahtarı yok)
- Boşa çıktı: Ada
- Kısıt: Ofisin kota sınırı %75 → %60; sahibinin kota payı devreye girdi
- Sahibinin mesajı: 10:10 “Lansmanı cumaya çekebilir miyiz? Ödeme olmadan da açabiliriz.”

## 2. Hedefler ve planlar
- Hedef “Lansman” → plan “Web sitesi” (sürüyor; 1/4 iş bitti)
  · api (Ada): bitti, 1/1 iş
  · ui (Ece): planlı, 0/1 iş, önce api
  · test (Bora): planlı, 0/1 iş, önce ui
  · icerik (alınacak: metin yazarı): planlı, görevi yok
  ! icerik: sahibi yok (alınacak: metin yazarı)
- Hedef “Satış ortaklıkları”: süren planı yok — planPropose ile goalId vererek başlat ya da goalSet ile kapat

## 3. İnsanlar (5 kişi: 1 işte, 2 elinde iş, 1 boşta, 1 iş alamıyor)
- Boşta (1): Ada (Yazılımcı) — 10 dk
- İş alamıyor (1): Mert — limit doldu, açılış 13:00, elinde 1 iş
- Elinde iş, başında değil (2): Ece — sırada “Ana sayfa tasarımı”; Bora — sırada “Uçtan uca testler” (“Ana sayfa tasarımı” bitince)
- İşte (1): Can — “Ödeme entegrasyonu” 09:10 → ~10:30 (takıldı)

## 4. Zincirler ve kritik yol
- Zincirli açık iş: 2 (bağımlılık bekleyen 1)
- Kimde: Bora (1), Ece (1)
- En uzun yol (2 iş, tahmini bitiş ~13:10): “Ana sayfa tasarımı” (Ece) → “Uçtan uca testler” (Bora)

## 5. Riskler
- Takıldı: “Ödeme entegrasyonu” (Can): sağlayıcı anahtarı yok
- Son tarih yaklaşıyor: “Uçtan uca testler” (Bora), 11:30 — tahmini bitiş ~13:10, yetişmiyor

## 6. Kaynak
- Kota: 5 saat %48, 7 gün %61; ofisin sınırı %60 (sahibinin payı %40); PAY DEVREDE: yalnız öncelik 1 işler başlıyor
- Son 24 saat: Claude ~$2.17 (3 tur); kayıtlı harcama $12; bu ay $12
- Plan “Web sitesi”: Claude ~$1.1; harcama $12 / tahmin $20; 0,1 / 2 gün; tahmini kota %15

## 7. Açık kararlar
- Sahibinde (1): satın alma “Figma lisansı” ($15, Ece, 25 dk önce)
- Sende (1): fikir “Test verisini otomatik üret” (Bora, 10 dk önce)`);
    expect(b.text.length).toBeGreaterThan(2000);
    expect(b.text.length).toBeLessThan(4000);
  });
});

describe('board — what the pulse used to say (management cycle §3.6)', () => {
  const NO_GOAL_LINE =
    '- Aktif hedef yok ve açık iş yok: şirket özetindeki misyona ve vizyona bakıp sıradaki hedefi aç (goalSet: neden ve ölçülebilir bitti tanımıyla) ve ilk planını hemen başlat (planPropose, goalId ile).';

  it('the idle with their title, the longest first; “uzun süredir” from idleCapacityHours, as the idle-capacity notice named them', () => {
    const t = make();
    t.person('Ada', { title: 'Geliştirici' });
    t.advance(30 * MIN);
    t.person('Can');
    t.advance(2 * HOUR);
    expect(t.section(t.board().text, 3).split('\n')[1]).toBe('- Boşta (2): Ada (Geliştirici) — 2 sa 30 dk (uzun süredir); Can — 2 sa (yeni, uzun süredir)');
  });

  it('an approved plan that never got a task: after the grace a comparison line says so and what to do; a plan waiting for the owner has none', () => {
    const t = make();
    const g = t.goal('Lansman');
    t.plan('Site', { goalId: g.id });
    t.advance(9 * MIN);
    expect(t.section(t.board().text, 2)).not.toContain('  !');
    t.advance(16 * MIN);
    expect(t.section(t.board().text, 2)).toBe(
      [
        '## 2. Hedefler ve planlar',
        '- Hedef “Lansman” → plan “Site” (sürüyor; görevi yok)',
        '  ! onaylı ama hiç görevi açılmadı (onay 25 dk önce) — görevlerini taskCreate ile aç ya da yerine yeni plan öner',
      ].join('\n'),
    );
    t.budget.setConstitution({ autonomy: 'plans' });
    const s = t.goal('Satış');
    t.plan('Teklifler', { goalId: s.id });
    t.advance(HOUR);
    expect(t.section(t.board().text, 2).split('\n').filter((l) => l.startsWith('  !'))).toEqual([
      '  ! onaylı ama hiç görevi açılmadı (onay 1 sa 25 dk önce) — görevlerini taskCreate ile aç ya da yerine yeni plan öner',
    ]);
  });

  it('no active goal: whether any work is open, and the coordinator’s rest with its reason until it ends', () => {
    const t = make();
    const line = () => t.section(t.board().text, 2).split('\n')[1];
    expect(line()).toBe(NO_GOAL_LINE);
    t.company.restUntil(t.coordinator.id, 24, 'Sahibinin cevabı bekleniyor');
    expect(line()).toBe(
      '- Aktif hedef yok ve açık iş yok; dinlenme kararın sürüyor (bitiş yarın 09:00): “Sahibinin cevabı bekleniyor”. Değerli bir iş çıkarsa hedefi aç (goalSet); yeni hedef dinlenmeyi bitirir.',
    );
    t.advance(24 * HOUR);
    expect(line()).toBe(NO_GOAL_LINE);
    const ada = t.person('Ada');
    t.task(ada.id, 'Sahibinin işi');
    expect(line()).toBe('- Aktif hedef yok: şirket özetindeki misyona ve vizyona bakıp sıradaki hedefi aç (goalSet: neden ve ölçülebilir bitti tanımıyla) ve ilk planını hemen başlat (planPropose, goalId ile).');
  });

  it('a plan running without a goal is open work too', () => {
    const t = make();
    t.plan('Bakım');
    expect(t.section(t.board().text, 2).split('\n')[1]).toMatch(/^- Aktif hedef yok: /);
  });
});
