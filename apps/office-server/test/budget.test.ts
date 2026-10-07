import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONSTITUTION, OWNER, type QuotaState, type Usage } from '@cc/shared';
import { Budget } from '../src/company/budget.ts';
import { ConstitutionStore, SpendStore } from '../src/company/budget-store.ts';
import { QuotaTracker } from '../src/quota.ts';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

/** companyFor keeps the owner's approval flow (autonomy 'plans'); otherwise the defaults. */
const HELPER_DEFAULTS = { ...DEFAULT_CONSTITUTION, autonomy: 'plans' as const };

function make() {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  return { ...s, ...companyFor(s, f), engine: f.engine };
}

const quota = (five: number, seven = 0.1, resetsIn = 3_600_000): QuotaState => ({
  status: 'allowed',
  fiveHour: { utilization: five, resetsAt: Date.now() + resetsIn },
  sevenDay: { utilization: seven, resetsAt: Date.now() + resetsIn },
  updatedAt: Date.now(),
});

describe('Budget — constitution', () => {
  it('starts from the defaults and takes the owner’s changes', () => {
    const t = make();
    expect(t.budget.constitution()).toEqual(HELPER_DEFAULTS);
    expect(t.budget.setConstitution({ ownerReservePct: 40, monthlyUsdCap: 100, maxEmployees: 5 })).toMatchObject({ ownerReservePct: 40, monthlyUsdCap: 100, maxEmployees: 5 });
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'budget.changed')).toBe(true);
    expect(t.budget.setConstitution({ digestHours: [18, 8, 18] }).digestHours).toEqual([8, 18]);
    const models = t.budget.setConstitution({ coordinatorModels: { digest: 'sonnet' }, difficultyModels: { easy: 'sonnet' }, cacheTtlMinutes: 10 });
    expect(models).toMatchObject({
      coordinatorModels: { owner: 'sonnet', decision: 'sonnet', digest: 'sonnet' },
      difficultyModels: { easy: 'sonnet', medium: 'sonnet', hard: 'opus', critical: 'fable' },
      cacheTtlMinutes: 10,
    });
    expect(t.budget.setConstitution({ digestEnabled: false, modelPolicyEnabled: false, difficultyModelsEnabled: false })).toMatchObject({
      digestEnabled: false, modelPolicyEnabled: false, difficultyModelsEnabled: false,
    });
  });

  it('R9: the economy switches are off by default, also in a database written before they existed; the owner turns them on and off', () => {
    const t = make();
    const off = { digestEnabled: false, modelPolicyEnabled: false, difficultyModelsEnabled: false };
    expect(DEFAULT_CONSTITUTION).toMatchObject({ ...off, cacheTtlMinutes: 5, coordinatorModels: { owner: 'sonnet' } });
    expect(t.budget.constitution()).toMatchObject(off);
    // The live office's constitution today: one row, nothing about the switches.
    t.db.prepare("INSERT INTO constitution (key, value) VALUES ('ownerReservePct', '80')").run();
    expect(t.budget.constitution()).toMatchObject({ ...off, ownerReservePct: 80 });
    expect(t.budget.setConstitution({ digestEnabled: true }).digestEnabled).toBe(true);
    expect(t.budget.setConstitution({ digestEnabled: false })).toMatchObject(off);
  });

  it('review focus: refuses wrong types, out-of-range values and unknown keys, changing nothing', () => {
    const t = make();
    for (const bad of [
      { maxEmployees: 9 }, { maxEmployees: 0 }, { maxEmployees: 2.5 }, { ownerReservePct: -1 }, { ownerReservePct: 95 }, { ownerReservePct: '25' },
      { monthlyUsdCap: -5 }, { chainDepth: 0 }, { tasksPerDay: 501 }, { idleSleepMinutes: 1441 }, { salary: 10 },
      { digestHours: [] }, { digestHours: [24] }, { digestHours: [9.5] }, { digestHours: '9, 17' }, { digestHours: [1, 2, 3, 4, 5, 6, 7] },
      { cacheTtlMinutes: 61 }, { digestEnabled: 'false' }, { modelPolicyEnabled: 0 }, { difficultyModelsEnabled: null }, { coordinatorModels: { boss: 'fable' } }, { coordinatorModels: { owner: 'gpt' } }, { difficultyModels: 'haiku' }, { difficultyModels: [] },
    ]) {
      expect(() => t.budget.setConstitution(bad), JSON.stringify(bad)).toThrow(/Anayasa|anayasa/);
    }
    expect(t.budget.constitution()).toEqual(HELPER_DEFAULTS);
  });

  it('review focus: names from the object prototype are unknown settings too, refused in Turkish', () => {
    const t = make();
    for (const key of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(() => t.budget.setConstitution(JSON.parse(`{"${key}": 1}`)), key).toThrow(/Bilinmeyen anayasa maddesi/);
    }
  });

  it('the PM keys: autonomy free by default, the active-goal limit and the pulse interval, validated in Turkish', () => {
    const t = make();
    // B4: the default is the rule's own maximum — the office sets the limit, the coordinator does not brake itself.
    expect(DEFAULT_CONSTITUTION).toMatchObject({ autonomy: 'free', activeGoals: 10, pulseHours: 6 });
    expect(() => t.budget.setConstitution({ activeGoals: 11 })).toThrow(/aktif hedef/);
    expect(t.budget.setConstitution({ autonomy: 'plans', activeGoals: 5, pulseHours: 0 })).toMatchObject({ autonomy: 'plans', activeGoals: 5, pulseHours: 0 });
    expect(() => t.budget.setConstitution({ autonomy: 'yarım' })).toThrow(/Serbestlik/);
    expect(() => t.budget.setConstitution({ activeGoals: 0 })).toThrow(/aktif hedef/);
    expect(() => t.budget.setConstitution({ pulseHours: 200 })).toThrow(/Nabız/);
  });

  it('the scheduler keys: default task minutes, the routine minimum interval and the routine cap, validated in Turkish', () => {
    const t = make();
    expect(DEFAULT_CONSTITUTION).toMatchObject({ defaultTaskMinutes: 45, minScheduleMinutes: 60, maxSchedules: 20 });
    expect(t.budget.setConstitution({ defaultTaskMinutes: 30, minScheduleMinutes: 15, maxSchedules: 5 })).toMatchObject({ defaultTaskMinutes: 30, minScheduleMinutes: 15, maxSchedules: 5 });
    expect(() => t.budget.setConstitution({ defaultTaskMinutes: 1 })).toThrow(/Varsayılan görev süresi/);
    expect(() => t.budget.setConstitution({ minScheduleMinutes: 0 })).toThrow(/Rutin aralığı/);
    expect(() => t.budget.setConstitution({ maxSchedules: 101 })).toThrow(/En fazla rutin/);
  });
});

describe('Budget — the owner’s reserve', () => {
  it('is in force at 100 − the owner’s share, tells the coordinator once each way, and ends when the window resets', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    t.setQuota(quota(0.5));
    t.budget.checkReserve();
    expect(t.budget.reserveActive()).toBe(false);
    t.setQuota(quota(0.8));
    t.budget.checkReserve();
    t.budget.checkReserve();
    expect(t.budget.reserve()).toMatchObject({ active: true, limitPct: 75, fiveHourPct: 80 });
    expect(t.notices.pending(c.id).filter((n) => n.text.includes('kota payı devrede'))).toHaveLength(1);
    t.setQuota(quota(0.8, 0.1, -1000));
    t.budget.checkReserve();
    expect(t.budget.reserve()).toMatchObject({ active: false, fiveHourPct: 0 });
    expect(t.notices.pending(c.id).at(-1)?.text).toMatch(/serbest/);
  });

  it('never applies when the owner keeps no share', () => {
    const t = make();
    t.budget.setConstitution({ ownerReservePct: 0 });
    t.setQuota(quota(1));
    expect(t.budget.reserveActive()).toBe(false);
  });
});

describe('Budget — money', () => {
  it('review focus: records spending, warns past the monthly cap and the plan’s money, and tells the coordinator', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    const plan = t.company.propose(c.id, { method: METHOD, title: 'Video', goal: 'g', approach: 'a', usd: 20 });
    t.company.approve(plan.id);
    t.budget.setConstitution({ monthlyUsdCap: 30 });
    expect(t.budget.recordSpend(ada.id, { service: 'ElevenLabs', usd: 15, purpose: 'ses', planId: plan.id }).warnings).toEqual([]);
    const over = t.budget.recordSpend(ada.id, { service: 'Canva', usd: 16, purpose: 'görsel', planId: plan.id });
    expect(over.warnings.join(' ')).toMatch(/aylık sınırı/);
    expect(over.warnings.join(' ')).toMatch(/onaylanan \$20/);
    expect(t.notices.pending(c.id).at(-1)?.text).toMatch(/aylık sınırı/);
    expect(t.budget.summary()).toMatchObject({ month: { usd: 31 }, plans: { [plan.id]: { spentUsd: 31 } } });
    expect(t.budget.spending(plan.id)).toHaveLength(2);
    for (const bad of [0, -3, Number.NaN, 2_000_000, '5' as unknown as number]) {
      expect(() => t.budget.recordSpend(ada.id, { service: 's', usd: bad, purpose: 'p' })).toThrow(/Tutar/);
    }
    expect(() => t.budget.recordSpend(ada.id, { service: 's', usd: 1, purpose: 'p', planId: 'nope' })).toThrow(/Plan bulunamadı/);
  });
});

describe('Budget — Claude usage per plan', () => {
  it('review focus: charges a turn to the running task, nothing without one, and the hand-over too', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    t.budget.chargeTurn(ada.id, 1, 100);
    const plan = t.company.propose(c.id, { method: METHOD, title: 'P', goal: 'g', approach: 'a' });
    t.company.approve(plan.id);
    const task = t.company.createTask(c.id, { assignee: ada.id, title: 'iş', planId: plan.id });
    t.company.start(task.id);
    t.budget.chargeTurn(ada.id, 0.4, 1000);
    expect(t.budget.summary().plans[plan.id]).toEqual({ spentUsd: 0, claudeUsd: 0.4 });
    const handover = t.company.beginHandover(ada.id);
    t.company.start(handover.id);
    expect(() => t.budget.chargeTurn(ada.id, 0.2, 10)).not.toThrow();
  });

  it('charges finished turns as they happen once watching', async () => {
    const t = make();
    const stop = t.budget.watch();
    cleanups.push(stop);
    const c = t.company.hireCoordinator();
    const plan = t.company.propose(c.id, { method: METHOD, title: 'P', goal: 'g', approach: 'a' });
    t.company.approve(plan.id);
    const task = t.company.createTask(c.id, { assignee: c.id, title: 'iş', planId: plan.id });
    t.company.start(task.id);
    t.events.append(c.id, { type: 'turn.finished', ok: true, subtype: 'success', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 }, costUsd: 0.05, numTurns: 1, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0.05 });
    expect(t.budget.summary().plans[plan.id]?.claudeUsd).toBe(0.05);
  });

  /** A turn as the engine logs it: started, then one result per claude reply (queuedTurns > 0: the turn goes on). */
  const turnOf = (t: ReturnType<typeof make>) => ({
    start: (id: string) => t.events.append(id, { type: 'turn.started' }),
    finish: (id: string, costUsd: number, usage: Usage, queuedTurns = 0) =>
      t.events.append(id, { type: 'turn.finished', ok: true, subtype: 'success', usage, costUsd, numTurns: 3, queuedTurns, sessionUsage: null, sessionCostUsd: 0 }),
  });
  const costOf = (t: ReturnType<typeof make>, id: string) =>
    t.db.prepare('SELECT cost_usd AS usd, tokens FROM tasks WHERE id = ?').get(id) as unknown as { usd: number; tokens: number };

  it('review focus: a turn that hands its task in (taskFinish) or decides its review (reviewDecide) is charged to that task', () => {
    const t = make();
    cleanups.push(t.budget.watch());
    const turn = turnOf(t);
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    const can = t.company.hire(c.id, { name: 'Can', role: 'r' });
    const plan = t.company.propose(c.id, { method: METHOD, title: 'P', goal: 'g', approach: 'a' });
    t.company.approve(plan.id);
    const task = t.company.createTask(c.id, { assignee: ada.id, title: 'iş', planId: plan.id, reviewer: can.id, done: ['yazıldı'] });
    // The office hands the task out and the turn opens; Ada hands it in before the turn ends.
    t.company.start(task.id);
    turn.start(ada.id);
    t.company.finish(ada.id, task.id, { summary: 'bitti', outputs: [], learned: '', evidence: ['dosya yazıldı'] });
    turn.finish(ada.id, 0.3, { inputTokens: 100, outputTokens: 20, cacheReadTokens: 1000, cacheCreationTokens: 50 });
    expect(costOf(t, task.id)).toEqual({ usd: 0.3, tokens: 1170 });
    // Can's review the same way: decided within the turn that delivered it.
    const review = t.tasks.list({ assignee: can.id }).find((x) => x.kind === 'review')!;
    t.company.start(review.id);
    turn.start(can.id);
    t.company.reviewDecide(can.id, review.id, { decision: 'approve' });
    turn.finish(can.id, 0.2, { inputTokens: 40, outputTokens: 10, cacheReadTokens: 500, cacheCreationTokens: 0 });
    expect(costOf(t, review.id)).toEqual({ usd: 0.2, tokens: 550 });
    expect(costOf(t, task.id)).toEqual({ usd: 0.3, tokens: 1170 });
    expect(t.budget.summary().plans[plan.id]?.claudeUsd).toBe(0.5);
  });

  it('review focus: the turn’s task is the one running at its start through every queued reply, else the one handed in during it; else nothing', () => {
    const t = make();
    cleanups.push(t.budget.watch());
    const turn = turnOf(t);
    const usage: Usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 };
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    const can = t.company.hire(c.id, { name: 'Can', role: 'r' });
    // Parked in the first reply; the queued reply after it is still that turn's.
    const parked = t.company.createTask(c.id, { assignee: ada.id, title: 'bekleyen' });
    t.company.start(parked.id);
    turn.start(ada.id);
    t.company.parkTask(ada.id, parked.id, '+1d', 'pencere dolsun');
    turn.finish(ada.id, 0.25, usage, 1);
    turn.finish(ada.id, 0.125, usage);
    expect(costOf(t, parked.id)).toEqual({ usd: 0.375, tokens: 30 });
    // Blocked before the turn (so nothing runs at its start), unblocked and handed in during it.
    const blocked = t.company.createTask(c.id, { assignee: ada.id, title: 'takılan' });
    t.company.start(blocked.id);
    t.company.update(ada.id, blocked.id, { blocked: true, note: 'cevap bekliyorum' });
    turn.start(ada.id);
    t.company.update(ada.id, blocked.id, { blocked: false });
    t.company.finish(ada.id, blocked.id, { summary: 'bitti', outputs: [], learned: '' });
    turn.finish(ada.id, 0.2, usage);
    expect(costOf(t, blocked.id)).toEqual({ usd: 0.2, tokens: 15 });
    // A turn about no task: Can approving Ada's hand-in meanwhile is his work, not this turn's.
    const reviewed = t.company.createTask(c.id, { assignee: ada.id, title: 'incelenen', reviewer: can.id });
    t.company.finish(ada.id, reviewed.id, { summary: 'bitti', outputs: [], learned: '' });
    turn.start(ada.id);
    t.company.reviewDecide(can.id, t.tasks.list({ assignee: can.id }).find((x) => x.kind === 'review')!.id, { decision: 'approve' });
    turn.finish(ada.id, 0.4, usage);
    expect(costOf(t, reviewed.id)).toEqual({ usd: 0, tokens: 0 });
    // That turn is over. A result whose start was not seen (main.ts recovers sessions before it watches) goes to the
    // task running now.
    const later = t.company.createTask(c.id, { assignee: ada.id, title: 'sonraki' });
    t.company.start(later.id);
    turn.finish(ada.id, 0.3, usage);
    expect(costOf(t, later.id)).toEqual({ usd: 0.3, tokens: 15 });
  });

  it('review focus: a turn that started on no task and hands none in goes to the task running at its end (unblocked during it)', () => {
    const t = make();
    cleanups.push(t.budget.watch());
    const turn = turnOf(t);
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    // Blocked while waiting for an answer; the answer opens a turn about no task, Ada goes on and does not finish yet.
    const task = t.company.createTask(c.id, { assignee: ada.id, title: 'takılan' });
    t.company.start(task.id);
    t.company.update(ada.id, task.id, { blocked: true, note: 'cevap bekliyorum' });
    const usage: Usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 };
    turn.start(ada.id);
    t.company.update(ada.id, task.id, { blocked: false });
    turn.finish(ada.id, 0.25, usage);
    expect(t.tasks.get(task.id).status).toBe('in_progress');
    expect(costOf(t, task.id)).toEqual({ usd: 0.25, tokens: 15 });
    // Handed in in the next turn, which is then over: a result whose start was not seen goes to the task running now.
    turn.start(ada.id);
    t.company.finish(ada.id, task.id, { summary: 'bitti', outputs: [], learned: '' });
    turn.finish(ada.id, 0.5, usage);
    const next = t.company.createTask(c.id, { assignee: ada.id, title: 'sonraki' });
    t.company.start(next.id);
    turn.finish(ada.id, 0.125, usage);
    expect(costOf(t, task.id)).toEqual({ usd: 0.75, tokens: 30 });
    expect(costOf(t, next.id)).toEqual({ usd: 0.125, tokens: 15 });
  });
});

describe('Budget — status for the coordinator', () => {
  it('says the quota, the reserve, the month and every running plan in Turkish', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const plan = t.company.propose(c.id, { method: METHOD, title: 'Video', goal: 'g', approach: 'a', usd: 20, quotaPct: 10 });
    t.company.approve(plan.id);
    t.setQuota(quota(0.3));
    const text = t.budget.status();
    expect(text).toContain('5 saat %30');
    expect(text).toContain('sınır %75');
    expect(text).toContain('Bu ay harcanan: $0');
    expect(text).toContain('“Video”');
  });

  it('names who used most today with their turns, side answers apart (the quota tracker wired like main.ts)', () => {
    const t = make();
    const budget = new Budget({
      constitution: new ConstitutionStore(t.db), spend: new SpendStore(t.db), tasks: t.tasks, plans: t.plans, roster: t.roster, events: t.events, notices: t.notices,
      quota: new QuotaTracker(t.db, t.events), deskCount: 8,
    });
    const c = t.company.hireCoordinator();
    const ada = t.company.hire(c.id, { name: 'Ada', role: 'r' });
    t.company.hire(c.id, { name: 'Can', role: 'r' });
    const usage: Usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 };
    const turn = (id: string, costUsd: number) =>
      t.events.append(id, { type: 'turn.finished', ok: true, subtype: 'success', usage, costUsd, numTurns: 4, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0 });
    for (let i = 0; i < 12; i += 1) turn(c.id, 0.08);
    for (let i = 0; i < 3; i += 1) turn(ada.id, 0.05);
    t.events.append(ada.id, { type: 'side.answer', text: 'a', ok: true, usage, costUsd: 0.01 });
    expect(budget.status()).toContain('Bugün en çok kullananlar: Koordinatör ~$0.96, 12 tur; Ada ~$0.16, 3 tur + 1 yan cevap.');
  });
});
