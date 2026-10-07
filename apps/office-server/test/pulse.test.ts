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
    expect(notice.text).toContain('restUntil');
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
});
