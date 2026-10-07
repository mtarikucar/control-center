import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const T0 = new Date(2026, 9, 7, 14, 10).getTime(); // Wednesday

function make() {
  let clock = T0;
  const now = () => clock;
  const s = setup(8, now);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, undefined, now);
  const coordinator = c.company.hireCoordinator('sonnet');
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r', team: 'Ops' });
  const can = c.company.hire(coordinator.id, { name: 'Can', role: 'r', team: 'Ops' });
  const plan = c.company.propose(coordinator.id, { title: 'P', goal: 'g', approach: 'a', method: METHOD });
  c.company.approve(plan.id);
  const daily = () => c.company.createSchedule(coordinator.id, { title: 'Günlük ölçüm', description: 'economy-report çalıştır', done: ['rapor notlarda'], assignee: ada.id, cron: '0 9 * * *', reviewer: can.id, planId: plan.id, priority: 2, difficulty: 'easy' });
  return { ...s, ...c, coordinator, ada, can, plan, daily, advance: (ms: number) => (clock += ms), set: (ms: number) => (clock = ms) };
}

describe('routines (spec §4.4)', () => {
  it('creates a routine with its next run computed in local time, and refuses bad input in Turkish', () => {
    const t = make();
    const s = t.daily();
    expect(s).toMatchObject({ status: 'active', skipCount: 0, failCount: 0, reviewer: t.can.id, planId: t.plan.id, priority: 2, difficulty: 'easy' });
    expect(s.nextRunAt).toBe(new Date(2026, 9, 8, 9, 0).getTime());
    expect(t.clockTouches()).toBeGreaterThan(0);
    expect(() => t.company.createSchedule(t.coordinator.id, { title: 'X', assignee: t.ada.id, cron: '0 9 * *' })).toThrow(/5 alan/);
    expect(() => t.company.createSchedule(t.coordinator.id, { title: 'X', assignee: t.ada.id, cron: '*/5 * * * *' })).toThrow(/en az 60 dk/);
    expect(() => t.company.createSchedule(t.coordinator.id, { title: 'X', assignee: t.ada.id, cron: '0 9 * * *', reviewer: t.ada.id })).toThrow(/kendi işinin inceleyicisi/);
    expect(() => t.company.createSchedule(t.coordinator.id, { title: 'X', assignee: t.ada.id, cron: '0 9 * * *', until: '-1d' })).toThrow(/Bitiş/);
    expect(() => t.company.createSchedule(t.ada.id, { title: 'X', assignee: t.can.id, cron: '0 9 * * *' })).toThrow(/Yalnız koordinatör|Ekip lideri/);
    t.budget.setConstitution({ maxSchedules: 1 });
    expect(() => t.company.createSchedule(t.coordinator.id, { title: 'Y', assignee: t.ada.id, cron: '0 10 * * *' })).toThrow(/En fazla 1 rutin/);
  });

  it('fires at its time: an ordinary task with the routine’s fields opens, the next run moves on, and the event says so', () => {
    const t = make();
    const s = t.daily();
    t.set(new Date(2026, 9, 8, 9, 0).getTime());
    const report = t.scheduling.runDue();
    expect(report.fired).toEqual([s.id]);
    const task = t.tasks.list({ assignee: t.ada.id })[0]!;
    expect(task).toMatchObject({ title: 'Günlük ölçüm — bugün 09:00', description: 'economy-report çalıştır', done: ['rapor notlarda'], reviewer: t.can.id, planId: t.plan.id, priority: 2, difficulty: 'easy', scheduleId: s.id, requester: t.coordinator.id, status: 'waiting' });
    const after = t.schedules.get(s.id);
    expect(after.nextRunAt).toBe(new Date(2026, 9, 9, 9, 0).getTime());
    expect(after).toMatchObject({ lastRunAt: new Date(2026, 9, 8, 9, 0).getTime(), lastTaskId: task.id });
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'schedule.changed' && e.event.change === 'fired')).toBe(true);
    expect(t.scheduling.runDue().fired).toEqual([]);
  });

  it('pile-up brake: no new instance while the previous one is open; the third skip tells the coordinator', () => {
    const t = make();
    const s = t.daily();
    t.set(new Date(2026, 9, 8, 9, 0).getTime());
    t.scheduling.runDue();
    for (let day = 9; day <= 11; day += 1) {
      t.set(new Date(2026, 9, day, 9, 0).getTime());
      expect(t.scheduling.runDue().skipped).toEqual([s.id]);
    }
    expect(t.schedules.get(s.id).skipCount).toBe(3);
    expect(t.tasks.list({ assignee: t.ada.id })).toHaveLength(1);
    expect(t.notices.pending(t.coordinator.id).filter((n) => n.topic === 'schedule.skipped')).toHaveLength(1);
    expect(t.schedules.get(s.id).nextRunAt).toBe(new Date(2026, 9, 12, 9, 0).getTime());
  });

  it('single catch-up: after a week closed, one task opens and the next run is after now', () => {
    const t = make();
    const s = t.daily();
    t.set(new Date(2026, 9, 15, 12, 0).getTime());
    expect(t.freshScheduling().runDue().fired).toEqual([s.id]);
    expect(t.tasks.list({ assignee: t.ada.id })).toHaveLength(1);
    expect(t.schedules.get(s.id).nextRunAt).toBe(new Date(2026, 9, 16, 9, 0).getTime());
  });

  it('while the company is paused routines wait; on resume, one catch-up', () => {
    const t = make();
    const s = t.daily();
    t.company.pause();
    t.set(new Date(2026, 9, 10, 12, 0).getTime());
    expect(t.scheduling.runDue().fired).toEqual([]);
    expect(t.tasks.list({ assignee: t.ada.id })).toHaveLength(0);
    t.company.resume();
    expect(t.scheduling.runDue().fired).toEqual([s.id]);
    expect(t.tasks.list({ assignee: t.ada.id })).toHaveLength(1);
  });

  it('review focus: a let-go assignee pauses the routine with a notice; a stopped plan stops it; neither fires again even if due', () => {
    const t = make();
    const s = t.daily();
    const other = t.company.createSchedule(t.coordinator.id, { title: 'Haftalık', assignee: t.can.id, cron: '0 10 * * 1', planId: t.plan.id });
    t.set(new Date(2026, 9, 8, 9, 30).getTime());
    t.company.releaseTasksOf(t.ada.id);
    expect(t.schedules.get(s.id).status).toBe('paused');
    expect(t.notices.pending(t.coordinator.id).find((n) => n.topic === 'schedule.unassigned')?.text).toContain('Günlük ölçüm');
    expect(t.scheduling.runDue().fired).toEqual([]);
    t.company.stopPlan(t.plan.id);
    expect(t.schedules.get(other.id).status).toBe('stopped');
    expect(t.schedules.get(s.id).status).toBe('stopped');
    t.set(new Date(2026, 9, 12, 10, 0).getTime());
    expect(t.scheduling.runDue().fired).toEqual([]);
  });

  it('the until date stops the routine; update changes cron, assignee and status; the owner pauses, resumes and stops', () => {
    const t = make();
    const s = t.company.createSchedule(t.coordinator.id, { title: 'Kısa', assignee: t.ada.id, cron: '0 9 * * *', until: '+1d' });
    t.set(new Date(2026, 9, 9, 9, 0).getTime());
    expect(t.scheduling.runDue().fired).toEqual([]);
    expect(t.schedules.get(s.id).status).toBe('stopped');
    const w = t.company.createSchedule(t.coordinator.id, { title: 'Haftalık', assignee: t.ada.id, cron: '0 10 * * 1' });
    const changed = t.company.updateSchedule(t.coordinator.id, w.id, { cron: '0 11 * * 2', assignee: t.can.id });
    expect(changed).toMatchObject({ cron: '0 11 * * 2', assignee: t.can.id });
    expect(changed.nextRunAt).toBe(new Date(2026, 9, 13, 11, 0).getTime());
    expect(t.company.ownerSchedule(w.id, 'pause').status).toBe('paused');
    expect(t.company.ownerSchedule(w.id, 'resume').status).toBe('active');
    expect(t.company.ownerSchedule(w.id, 'stop').status).toBe('stopped');
    expect(() => t.company.ownerSchedule(w.id, 'resume')).toThrow(/durduruldu/);
    expect(t.notices.pending(t.coordinator.id).filter((n) => n.topic === 'agenda.owner_changed')).toHaveLength(3);
    expect(t.company.schedules().map((x) => x.title)).toEqual(['Kısa', 'Haftalık']);
    expect(OWNER).toBe('owner');
  });

  it('three failed firings pause the routine and tell the coordinator', () => {
    const t = make();
    const s = t.daily();
    t.roster.update(t.can.id, { lifecycle: 'archived' }); // the reviewer is gone: createTask refuses the reviewer
    for (let day = 8; day <= 10; day += 1) {
      t.set(new Date(2026, 9, day, 9, 0).getTime());
      expect(t.scheduling.runDue().errors.length).toBe(1);
    }
    expect(t.schedules.get(s.id)).toMatchObject({ status: 'paused', failCount: 3 });
    expect(t.notices.pending(t.coordinator.id).some((n) => n.topic === 'schedule.failed')).toBe(true);
    // Each failure is also logged by the clock, and the sheet hears of the pause.
    expect(t.events.list({ limit: 500 }).filter((e) => e.event.type === 'clock.error')).toHaveLength(3);
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'schedule.changed' && e.event.change === 'paused' && e.event.schedule.id === s.id)).toBe(true);
  });

  it('a firing is one transaction: when moving the next run fails, the task it opened is gone too', () => {
    const t = make();
    const s = t.daily();
    const real = t.schedules.update.bind(t.schedules);
    t.schedules.update = (id, patch) => {
      if (patch.lastTaskId !== undefined) throw new Error('disk dolu');
      return real(id, patch);
    };
    t.set(new Date(2026, 9, 8, 9, 0).getTime());
    expect(t.scheduling.runDue().errors).toEqual([`schedule ${s.id}: disk dolu`]);
    expect(t.tasks.list({ assignee: t.ada.id })).toHaveLength(0);
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'task.changed')).toBe(false);
    expect(t.schedules.get(s.id)).toMatchObject({ status: 'active', failCount: 1, nextRunAt: new Date(2026, 9, 9, 9, 0).getTime() });
  });

  it('a resumed routine starts counting failures afresh, and one whose assignee left cannot resume until it has a new one', () => {
    const t = make();
    const s = t.daily();
    t.roster.update(t.can.id, { lifecycle: 'archived' });
    for (let day = 8; day <= 10; day += 1) {
      t.set(new Date(2026, 9, day, 9, 0).getTime());
      t.scheduling.runDue();
    }
    // The coordinator fixes the cause (a new reviewer) and resumes: three more tries before it pauses again.
    const resumed = t.company.updateSchedule(t.coordinator.id, s.id, { reviewer: t.coordinator.id, status: 'active' });
    expect(resumed).toMatchObject({ status: 'active', failCount: 0 });
    t.roster.update(t.ada.id, { lifecycle: 'archived' });
    t.company.releaseTasksOf(t.ada.id);
    expect(t.schedules.get(s.id).status).toBe('paused');
    expect(() => t.company.ownerSchedule(s.id, 'resume')).toThrow(/Ada işten çıkarıldı/);
    expect(() => t.company.updateSchedule(t.coordinator.id, s.id, { status: 'active' })).toThrow(/Ada işten çıkarıldı/);
    expect(t.schedules.get(s.id).status).toBe('paused');
    const ece = t.company.hire(t.coordinator.id, { name: 'Ece', role: 'r', team: 'Ops' });
    expect(t.company.updateSchedule(t.coordinator.id, s.id, { assignee: ece.id, status: 'active' })).toMatchObject({ assignee: ece.id, status: 'active' });
  });
});
