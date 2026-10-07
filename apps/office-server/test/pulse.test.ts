import { afterEach, describe, expect, it } from 'vitest';
import { Pulse } from '../src/company/pulse.ts';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const HOUR = 60 * 60_000;

function make() {
  let clock = new Date(2026, 9, 7, 10, 0).getTime();
  const now = () => clock;
  const s = setup(8, now);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, undefined, now);
  c.budget.setConstitution({ autonomy: 'free' });
  const pulse = () => new Pulse({ company: c.company, goals: c.goals, state: c.state, plans: c.plans, tasks: c.tasks, notices: c.notices, budget: c.budget, now });
  return { ...s, ...c, pulse, advance: (ms: number) => (clock += ms) };
}

describe('the pulse (spec §6.3)', () => {
  it('says nothing without a coordinator, while paused, or during the owner’s reserve', () => {
    const t = make();
    expect(t.pulse().check()).toEqual([]);
    t.company.hireCoordinator('sonnet');
    t.company.pause();
    expect(t.pulse().check()).toEqual([]);
    t.company.resume();
    t.setQuota({ status: 'allowed', fiveHour: { utilization: 0.99, resetsAt: Date.now() + HOUR }, sevenDay: null, updatedAt: Date.now() });
    t.budget.checkReserve();
    expect(t.pulse().check()).toEqual([]);
  });

  it('no goal, no plan, no work: tells the coordinator once per pulseHours, and not while it rests', () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    expect(t.pulse().check()).toEqual(['pulse.no_goal']);
    const notice = t.notices.pending(c.id).find((n) => n.topic === 'pulse.no_goal')!;
    expect(notice.kind).toBe('decision');
    // B3: no self-braking — the next goal comes from the mission and the brief's vision, and it starts.
    expect(notice.text).toBe(
      'Aktif hedef yok ve açık iş yok. Şirket özetindeki misyona ve vizyona bakarak sıradaki hedefi çıkar (goalSet: neden ve ölçülebilir bitti tanımıyla) ve ilk planını hemen başlat (planPropose, goalId ile).',
    );
    expect(notice.text).not.toContain('icat etme');
    expect(t.pulse().check()).toEqual([]);
    t.advance(6 * HOUR);
    expect(t.pulse().check()).toEqual(['pulse.no_goal']);
    t.company.restUntil(c.id, 24, 'Bu hafta sahibinin işi bekleniyor');
    t.advance(6 * HOUR);
    expect(t.pulse().check()).toEqual([]);
    t.advance(19 * HOUR);
    expect(t.pulse().check()).toEqual(['pulse.no_goal']);
    t.budget.setConstitution({ pulseHours: 0 });
    t.advance(48 * HOUR);
    expect(t.pulse().check()).toEqual([]);
  });

  it('an active goal without a running plan: once per episode — a plan that ends re-arms it; it survives a restart', () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    const goal = t.company.goalSet(c.id, { title: 'Lansman', why: 'misyon', done: ['site'] });
    expect(t.pulse().check()).toEqual(['pulse.goal_idle']);
    expect(t.notices.pending(c.id).find((n) => n.topic === 'pulse.goal_idle')?.text).toContain('Lansman');
    // A new Pulse is a restarted office: the marker is in the database.
    expect(t.pulse().check()).toEqual([]);
    const plan = t.company.propose(c.id, { title: 'Site', goal: 'g', approach: 'a', method: METHOD, goalId: goal.id });
    expect(t.pulse().check()).toEqual([]);
    const task = t.company.createTask(c.id, { assignee: c.id, title: 'iş', planId: plan.id });
    t.company.finish(c.id, task.id, { summary: 'bitti', outputs: [], learned: '' });
    expect(t.plans.get(plan.id).status).toBe('done');
    expect(t.pulse().check()).toEqual(['pulse.goal_idle']);
    t.company.goalSet(c.id, { goalId: goal.id, status: 'done' });
    expect(t.pulse().check()).toEqual(['pulse.no_goal']);
  });

  it('open work without goals is not idle: no notice while a task is open', () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    t.company.createTask(c.id, { assignee: c.id, title: 'sahibinin işi' });
    expect(t.pulse().check()).toEqual([]);
  });

  it('a parked task is open work too: no "no goal" notice while it waits for its time', () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    const task = t.company.createTask(c.id, { assignee: c.id, title: 'yarın tekrar ölç' });
    t.company.parkTask(c.id, task.id, '+1d', 'ölçüm penceresi');
    expect(t.pulse().check()).toEqual([]);
    expect(t.notices.pending(c.id).some((n) => n.topic === 'pulse.no_goal')).toBe(false);
  });

  it('a new goal ends the rest', () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    t.company.restUntil(c.id, 48, 'dinleniyorum');
    expect(t.state.restUntil()).toBeGreaterThan(0);
    t.company.goalSet(c.id, { title: 'Yeni', why: 'misyon', done: ['x'] });
    expect(t.state.restUntil()).toBe(0);
    expect(() => t.company.restUntil(c.id, 0, 'x')).toThrow(/1 ile 168/);
    expect(() => t.company.restUntil(c.id, 5, ' ')).toThrow(/boş olamaz/);
  });

  it('final review: while the coordinator is working the pulse waits — no stale notice, no marker', () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    t.company.goalSet(c.id, { title: 'Lansman', why: 'misyon', done: ['site'] });
    t.roster.update(c.id, { lifecycle: 'working' });
    expect(t.pulse().check()).toEqual([]);
    expect(t.state.get(`pulse.goal.${t.goals.list()[0]!.id}`)).toBeNull();
    t.roster.update(c.id, { lifecycle: 'idle' });
    expect(t.pulse().check()).toEqual(['pulse.goal_idle']);
  });

  it('final review: an approved plan that never got a task stops counting as running after a grace period', () => {
    const t = make();
    const c = t.company.hireCoordinator('sonnet');
    const goal = t.company.goalSet(c.id, { title: 'Lansman', why: 'misyon', done: ['site'] });
    const plan = t.company.propose(c.id, { title: 'Boş plan', goal: 'g', approach: 'a', method: METHOD, goalId: goal.id });
    expect(plan.status).toBe('approved');
    expect(t.pulse().check()).toEqual([]);
    t.advance(11 * 60_000);
    expect(t.pulse().check()).toEqual(['pulse.goal_idle']);
    expect(t.notices.pending(c.id).find((n) => n.topic === 'pulse.goal_idle')?.text).toContain('Boş plan');
  });
});
