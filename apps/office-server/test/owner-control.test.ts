import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
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
  const c = companyFor(s, f);
  c.budget.setConstitution({ autonomy: 'free' });
  const coordinator = c.company.hireCoordinator('sonnet');
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r' });
  const can = c.company.hire(coordinator.id, { name: 'Can', role: 'r' });
  const goal = c.company.goalSet(coordinator.id, { title: 'Lansman', why: 'misyon', done: ['site'] });
  const plan = c.company.propose(coordinator.id, { title: 'Site', goal: 'g', approach: 'a', method: METHOD, goalId: goal.id });
  return { ...s, ...c, coordinator, ada, can, goal, plan };
}

describe('the owner’s controls (spec §6.4)', () => {
  it('stopping a plan cancels its open work — waiting, running, in review and the review itself — and tells who must stop', () => {
    const t = make();
    const waiting = t.company.createTask(t.coordinator.id, { assignee: t.can.id, title: 'bekleyen', planId: t.plan.id });
    const running = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'süren', planId: t.plan.id });
    t.company.start(running.id);
    const reviewed = t.company.createTask(t.coordinator.id, { assignee: t.can.id, title: 'incelenen', planId: t.plan.id, reviewer: t.ada.id });
    t.company.finish(t.can.id, reviewed.id, { summary: 'bitti', outputs: [], learned: '' });
    const review = t.tasks.list({ assignee: t.ada.id }).find((x) => x.kind === 'review')!;
    const stopped = t.company.stopPlan(t.plan.id);
    expect(stopped.status).toBe('stopped');
    for (const id of [waiting.id, running.id, reviewed.id, review.id]) expect(t.tasks.get(id).status).toBe('cancelled');
    expect(t.notices.pending(t.ada.id).some((n) => n.topic === 'task.cancelled' && n.text.includes('süren'))).toBe(true);
    expect(t.notices.pending(t.coordinator.id).find((n) => n.topic === 'plan.stopped')?.kind).toBe('decision');
    expect(() => t.company.reviewDecide(t.ada.id, review.id, { decision: 'approve' })).toThrow(/karara bağlandı|incelemede değil/);
    expect(() => t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'yeni', planId: t.plan.id })).toThrow(/durduruldu/);
    expect(() => t.company.revise(t.coordinator.id, t.plan.id, { days: 1 })).toThrow(/durduruldu/);
    expect(() => t.company.stopPlan(t.plan.id)).toThrow(/zaten/);
  });

  it('stopping a goal drops it and stops its running plans, with one notice to the coordinator', () => {
    const t = make();
    const goal = t.company.stopGoal(t.goal.id);
    expect(goal).toMatchObject({ status: 'dropped', note: 'Sahibi durdurdu' });
    expect(t.plans.get(t.plan.id).status).toBe('stopped');
    const notices = t.notices.pending(t.coordinator.id).filter((n) => n.topic === 'goal.stopped' || n.topic === 'plan.stopped');
    expect(notices.map((n) => n.topic)).toEqual(['goal.stopped']);
  });

  it('pausing: the company says it is paused, the screen hears, and resuming clears it', () => {
    const t = make();
    t.company.pause();
    expect(t.company.paused()).toBe(true);
    t.company.resume();
    expect(t.company.paused()).toBe(false);
    const seen = t.events.list({ limit: 500 }).flatMap((e) => (e.event.type === 'company.paused' ? [e.event.paused] : []));
    expect(seen).toEqual([true, false]);
    expect(OWNER).toBe('owner');
  });

  it('final review: a task cancelled by a stopped plan cannot be revived — not blocked, not reassigned', () => {
    const t = make();
    const running = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'süren', planId: t.plan.id });
    t.company.start(running.id);
    t.company.stopPlan(t.plan.id);
    expect(() => t.company.update(t.ada.id, running.id, { blocked: true, note: 'devam etmek istiyorum' })).toThrow(/kapandı/);
    expect(() => t.company.assign(t.coordinator.id, running.id, t.can.id)).toThrow(/kapandı/);
    expect(t.tasks.get(running.id).status).toBe('cancelled');
    expect(t.tasks.openInPlan(t.plan.id)).toBe(0);
  });

  it('final review: a goal the owner stopped stays stopped — the coordinator cannot reopen it', () => {
    const t = make();
    t.company.stopGoal(t.goal.id);
    expect(() => t.company.goalSet(t.coordinator.id, { goalId: t.goal.id, status: 'active' })).toThrow(/sahibi durdurdu/i);
    expect(t.goals.get(t.goal.id).status).toBe('dropped');
  });

  it('final review: a finished plan of a closed goal does not reopen for new work', () => {
    const t = make();
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'tek iş', planId: t.plan.id });
    t.company.finish(t.ada.id, task.id, { summary: 'bitti', outputs: [], learned: '' });
    expect(t.plans.get(t.plan.id).status).toBe('done');
    t.company.goalSet(t.coordinator.id, { goalId: t.goal.id, status: 'done' });
    expect(() => t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'yeni', planId: t.plan.id })).toThrow(/hedefi .* kapalı/);
    expect(t.plans.get(t.plan.id).status).toBe('done');
  });
});
