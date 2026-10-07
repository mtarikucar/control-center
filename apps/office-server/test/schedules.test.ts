import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { ConflictError } from '../src/errors.ts';
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
    expect(task).toMatchObject({ title: 'Günlük ölçüm — 8 Eki 2026 09:00', description: 'economy-report çalıştır', done: ['rapor notlarda'], reviewer: t.can.id, planId: t.plan.id, priority: 2, difficulty: 'easy', scheduleId: s.id, requester: t.coordinator.id, status: 'waiting' });
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
    // The note names the firing itself, not “bugün”: it is read days later.
    expect(t.schedules.get(s.id).note).toBe('11 Eki 2026 09:00: önceki örnek (“Günlük ölçüm — 8 Eki 2026 09:00”) hâlâ açık, atlandı');
  });

  it('final review F5: a firing ends the run of skips — skip, skip, fire, skip, skip tells no one; the third skip in a row does', () => {
    const t = make();
    const s = t.company.createSchedule(t.coordinator.id, { title: 'Ölçüm', assignee: t.ada.id, cron: '0 9 * * *' });
    const skipped = () => t.notices.pending(t.coordinator.id).filter((n) => n.topic === 'schedule.skipped');
    const run = (day: number) => {
      t.set(new Date(2026, 9, day, 9, 0).getTime());
      return t.scheduling.runDue();
    };
    run(8);
    const first = t.tasks.list({ assignee: t.ada.id })[0]!;
    expect(run(9).skipped).toEqual([s.id]);
    expect(run(10).skipped).toEqual([s.id]);
    t.company.start(first.id);
    t.company.finish(t.ada.id, first.id, { summary: 'bitti', outputs: [], learned: '' });
    expect(run(11).fired).toEqual([s.id]);
    expect(t.schedules.get(s.id).skipCount).toBe(0);
    expect(run(12).skipped).toEqual([s.id]);
    expect(run(13).skipped).toEqual([s.id]);
    expect(t.schedules.get(s.id).skipCount).toBe(2);
    expect(skipped()).toHaveLength(0);
    expect(run(14).skipped).toEqual([s.id]);
    expect(skipped()).toHaveLength(1);
    expect(skipped()[0]!.text).toContain('3 kez atlandı');
  });

  it('review focus: each instance carries its own date and time, so a daily routine’s tasks are told apart', () => {
    const t = make();
    t.company.createSchedule(t.coordinator.id, { title: 'Ölçüm', assignee: t.ada.id, cron: '0 9 * * *' });
    t.set(new Date(2026, 9, 8, 9, 0).getTime());
    t.scheduling.runDue();
    const first = t.tasks.list({ assignee: t.ada.id })[0]!;
    t.company.start(first.id);
    t.company.finish(t.ada.id, first.id, { summary: 'bitti', outputs: [], learned: '' });
    t.set(new Date(2026, 9, 9, 9, 0).getTime());
    t.scheduling.runDue();
    expect(t.tasks.list({ assignee: t.ada.id }).map((x) => x.title)).toEqual(['Ölçüm — 8 Eki 2026 09:00', 'Ölçüm — 9 Eki 2026 09:00']);
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

  it('final review F6: resuming the company touches the clock, so it re-arms for the nearest time', () => {
    const t = make();
    t.daily();
    t.company.pause();
    const before = t.clockTouches();
    t.company.resume();
    expect(t.clockTouches()).toBe(before + 1);
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

  it('review focus: a routine with no run in the next 366 days fires this one, then stops with a notice — no error on every clock run', () => {
    const t = make();
    t.set(new Date(2028, 1, 1, 12, 0).getTime());
    const s = t.company.createSchedule(t.coordinator.id, { title: 'Artık gün', assignee: t.ada.id, cron: '0 9 29 2 *' });
    expect(s.nextRunAt).toBe(new Date(2028, 1, 29, 9, 0).getTime());
    t.set(new Date(2028, 1, 29, 9, 0).getTime());
    const report = t.scheduling.runDue();
    expect(report).toMatchObject({ fired: [s.id], errors: [] });
    expect(t.tasks.list({ assignee: t.ada.id })).toHaveLength(1);
    expect(t.schedules.get(s.id)).toMatchObject({ status: 'stopped', note: 'Sonraki çalışma 366 gün içinde yok' });
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'schedule.changed' && e.event.change === 'stopped' && e.event.schedule.id === s.id)).toBe(true);
    t.advance(3_600_000);
    expect(t.scheduling.runDue()).toMatchObject({ fired: [], skipped: [], errors: [] });
    expect(t.tasks.list({ assignee: t.ada.id })).toHaveLength(1);
    expect(t.events.list({ limit: 500 }).filter((e) => e.event.type === 'clock.error')).toHaveLength(0);
    const failed = t.notices.pending(t.coordinator.id).filter((n) => n.topic === 'schedule.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.text).toContain('366 gün');
  });

  it('review focus: a routine is open work on its plan — the plan stays running while it lives, and finishes once (one retro) when it stops', () => {
    const t = make();
    const retros = () => t.notices.pending(t.coordinator.id).filter((n) => n.topic === 'plan.retro');
    const s = t.company.createSchedule(t.coordinator.id, { title: 'Ölçüm', assignee: t.ada.id, cron: '0 9 * * *', planId: t.plan.id });
    for (const day of [8, 9]) {
      t.set(new Date(2026, 9, day, 9, 0).getTime());
      expect(t.scheduling.runDue().fired).toEqual([s.id]);
      const instance = t.tasks.list({ assignee: t.ada.id, statuses: ['waiting'] })[0]!;
      t.company.start(instance.id);
      t.company.finish(t.ada.id, instance.id, { summary: 'bitti', outputs: [], learned: '' });
      expect(t.plans.get(t.plan.id).status).toBe('approved');
    }
    expect(retros()).toHaveLength(0);
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'plan.changed' && (e.event.change === 'done' || e.event.change === 'reopened'))).toBe(false);
    t.company.ownerSchedule(s.id, 'stop');
    expect(t.plans.get(t.plan.id).status).toBe('done');
    expect(retros()).toHaveLength(1);
  });

  it('review focus: a routine that ends by itself or by the coordinator lets its plan finish; a finished plan takes no routine; stopping a plan stops its routines and never finishes it', () => {
    const t = make();
    const retros = () => t.notices.pending(t.coordinator.id).filter((n) => n.topic === 'plan.retro');
    const second = t.company.propose(t.coordinator.id, { title: 'Q', goal: 'g', approach: 'a', method: METHOD });
    t.company.approve(second.id);
    const third = t.company.propose(t.coordinator.id, { title: 'R', goal: 'g', approach: 'a', method: METHOD });
    t.company.approve(third.id);
    // until passed (the clock ends it) → its plan finishes, once.
    t.company.createSchedule(t.coordinator.id, { title: 'Kısa', assignee: t.ada.id, cron: '0 9 * * *', until: '+1d', planId: t.plan.id });
    // stopped by the coordinator → its plan finishes, once.
    const weekly = t.company.createSchedule(t.coordinator.id, { title: 'Haftalık', assignee: t.ada.id, cron: '0 10 * * 1', planId: second.id });
    t.company.updateSchedule(t.coordinator.id, weekly.id, { status: 'stopped' });
    expect(t.plans.get(second.id).status).toBe('done');
    t.set(new Date(2026, 9, 9, 9, 0).getTime());
    t.scheduling.runDue();
    expect(t.plans.get(t.plan.id).status).toBe('done');
    expect(retros()).toHaveLength(2);
    expect(() => t.company.createSchedule(t.coordinator.id, { title: 'Geç', assignee: t.ada.id, cron: '0 9 * * *', planId: t.plan.id })).toThrow(ConflictError);
    expect(() => t.company.createSchedule(t.coordinator.id, { title: 'Geç', assignee: t.ada.id, cron: '0 9 * * *', planId: t.plan.id })).toThrow(/“P” planı bitti; rutin yalnız süren bir plana bağlanabilir/);
    // The owner stops a plan whose only work is a routine: stopped, not done, and no retro.
    const daily = t.company.createSchedule(t.coordinator.id, { title: 'Günlük', assignee: t.ada.id, cron: '0 9 * * *', planId: third.id });
    t.company.stopPlan(third.id);
    expect(t.plans.get(third.id).status).toBe('stopped');
    expect(t.schedules.get(daily.id).status).toBe('stopped');
    expect(retros()).toHaveLength(2);
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'plan.changed' && e.event.change === 'done' && e.event.plan.id === third.id)).toBe(false);
  });

  it('review focus: a let-go reviewer pauses the routine with a notice, and it cannot resume until it has a new reviewer', () => {
    const t = make();
    const s = t.daily();
    t.roster.update(t.can.id, { lifecycle: 'archived' });
    t.company.releaseTasksOf(t.can.id);
    expect(t.schedules.get(s.id).status).toBe('paused');
    const notice = t.notices.pending(t.coordinator.id).find((n) => n.topic === 'schedule.unassigned');
    expect(notice?.text).toBe('“Günlük ölçüm” rutininin inceleyicisi (Can) işten çıkarıldı; rutin duraklatıldı. scheduleUpdate ile yeni bir inceleyici ver ve sürdür.');
    expect(() => t.company.ownerSchedule(s.id, 'resume')).toThrow(ConflictError);
    expect(() => t.company.ownerSchedule(s.id, 'resume')).toThrow(/Can işten çıkarıldı; rutin yeni bir inceleyici verilene kadar/);
    expect(() => t.company.updateSchedule(t.coordinator.id, s.id, { status: 'active' })).toThrow(/Can işten çıkarıldı/);
    expect(t.schedules.get(s.id).status).toBe('paused');
    expect(t.company.updateSchedule(t.coordinator.id, s.id, { reviewer: t.coordinator.id, status: 'active' })).toMatchObject({ reviewer: t.coordinator.id, status: 'active' });
  });
});
