import { afterEach, describe, expect, it } from 'vitest';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make(autonomy: 'free' | 'plans') {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f);
  c.budget.setConstitution({ autonomy });
  const coordinator = c.company.hireCoordinator('sonnet');
  return { ...s, ...c, coordinator };
}

const DRAFT = { title: 'Site', goal: 'g', approach: 'a', method: METHOD };

describe('autonomy (spec §6.2)', () => {
  it('free: a proposed plan starts at once, marked as started by the coordinator, with no notice to itself', () => {
    const t = make('free');
    const plan = t.company.propose(t.coordinator.id, DRAFT);
    expect(plan).toMatchObject({ status: 'approved', approvedBy: 'coordinator' });
    expect(plan.approvedAt).not.toBeNull();
    const changes = t.events.list({ limit: 500 }).flatMap((e) => (e.event.type === 'plan.changed' ? [e.event.change] : []));
    expect(changes).toEqual(['proposed', 'approved']);
    expect(t.notices.pending(t.coordinator.id).some((n) => n.topic === 'plan.approved')).toBe(false);
    const task = t.company.createTask(t.coordinator.id, { assignee: t.coordinator.id, title: 'iş', planId: plan.id });
    expect(task.planId).toBe(plan.id);
  });

  it('free: a revision goes on at once (new version, still approved, no snapshot)', () => {
    const t = make('free');
    const plan = t.company.propose(t.coordinator.id, DRAFT);
    const revised = t.company.revise(t.coordinator.id, plan.id, { days: 3 });
    expect(revised).toMatchObject({ status: 'approved', version: 2, days: 3, approvedBy: 'coordinator' });
    expect(t.plans.approvedSnapshot(plan.id)).toBeNull();
  });

  it('plans: as before — a draft waits for the owner, who approves it as the owner', () => {
    const t = make('plans');
    const plan = t.company.propose(t.coordinator.id, DRAFT);
    expect(plan).toMatchObject({ status: 'draft', approvedBy: null });
    expect(t.company.approve(plan.id)).toMatchObject({ status: 'approved', approvedBy: 'owner' });
    expect(t.notices.pending(t.coordinator.id).some((n) => n.topic === 'plan.approved')).toBe(true);
  });

  it('review focus: a draft from before autonomy was set free can still be approved or declined by the owner; revising it under free starts it', () => {
    const t = make('plans');
    const a = t.company.propose(t.coordinator.id, { ...DRAFT, title: 'A' });
    const b = t.company.propose(t.coordinator.id, { ...DRAFT, title: 'B' });
    t.budget.setConstitution({ autonomy: 'free' });
    expect(t.company.approve(a.id)).toMatchObject({ status: 'approved', approvedBy: 'owner' });
    expect(t.company.revise(t.coordinator.id, b.id, { days: 1 })).toMatchObject({ status: 'approved', approvedBy: 'coordinator' });
  });
});
