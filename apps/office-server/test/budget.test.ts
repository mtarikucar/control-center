import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONSTITUTION, OWNER, type QuotaState, type Usage } from '@cc/shared';
import { Budget } from '../src/company/budget.ts';
import { ConstitutionStore, SpendStore } from '../src/company/budget-store.ts';
import { QuotaTracker } from '../src/quota.ts';
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
    expect(t.budget.constitution()).toEqual(DEFAULT_CONSTITUTION);
    expect(t.budget.setConstitution({ ownerReservePct: 40, monthlyUsdCap: 100, maxEmployees: 5 })).toMatchObject({ ownerReservePct: 40, monthlyUsdCap: 100, maxEmployees: 5 });
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'budget.changed')).toBe(true);
    expect(t.budget.setConstitution({ digestHours: [18, 8, 18] }).digestHours).toEqual([8, 18]);
    const models = t.budget.setConstitution({ coordinatorModels: { digest: 'sonnet' }, difficultyModels: { easy: 'sonnet' }, cacheTtlMinutes: 10 });
    expect(models).toMatchObject({
      coordinatorModels: { owner: 'fable', decision: 'sonnet', digest: 'sonnet' },
      difficultyModels: { easy: 'sonnet', medium: 'sonnet', hard: 'opus', critical: 'fable' },
      cacheTtlMinutes: 10,
    });
    expect(t.budget.setConstitution({ digestEnabled: false, modelPolicyEnabled: false, difficultyModelsEnabled: false })).toMatchObject({
      digestEnabled: false, modelPolicyEnabled: false, difficultyModelsEnabled: false,
    });
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
    expect(t.budget.constitution()).toEqual(DEFAULT_CONSTITUTION);
  });

  it('review focus: names from the object prototype are unknown settings too, refused in Turkish', () => {
    const t = make();
    for (const key of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(() => t.budget.setConstitution(JSON.parse(`{"${key}": 1}`)), key).toThrow(/Bilinmeyen anayasa maddesi/);
    }
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
    const plan = t.company.propose(c.id, { title: 'Video', goal: 'g', approach: 'a', usd: 20 });
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
    const plan = t.company.propose(c.id, { title: 'P', goal: 'g', approach: 'a' });
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
    const plan = t.company.propose(c.id, { title: 'P', goal: 'g', approach: 'a' });
    t.company.approve(plan.id);
    const task = t.company.createTask(c.id, { assignee: c.id, title: 'iş', planId: plan.id });
    t.company.start(task.id);
    t.events.append(c.id, { type: 'turn.finished', ok: true, subtype: 'success', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 }, costUsd: 0.05, numTurns: 1, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0.05 });
    expect(t.budget.summary().plans[plan.id]?.claudeUsd).toBe(0.05);
  });
});

describe('Budget — status for the coordinator', () => {
  it('says the quota, the reserve, the month and every running plan in Turkish', () => {
    const t = make();
    const c = t.company.hireCoordinator();
    const plan = t.company.propose(c.id, { title: 'Video', goal: 'g', approach: 'a', usd: 20, quotaPct: 10 });
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
