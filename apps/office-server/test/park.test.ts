import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const T0 = new Date(2026, 9, 7, 14, 10).getTime();

function make() {
  let clock = T0;
  const now = () => clock;
  const s = setup(8, now);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, undefined, now);
  const coordinator = c.company.hireCoordinator('sonnet');
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r', team: 'İçerik' });
  const can = c.company.hire(coordinator.id, { name: 'Can', role: 'r', team: 'İçerik' });
  const plan = c.company.propose(coordinator.id, { title: 'P', goal: 'g', approach: 'a', method: METHOD });
  c.company.approve(plan.id);
  const topics = (id: string) => c.notices.pending(id).map((n) => `${n.kind} ${n.topic}`);
  return { ...s, ...c, coordinator, ada, can, plan, topics, advance: (ms: number) => (clock += ms) };
}

describe('park (spec §4.2)', () => {
  it('the assignee parks their running task until a time with a reason: status parked, the slot free, the clock touched', () => {
    const t = make();
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Adım 1 penceresi', planId: t.plan.id });
    t.company.start(task.id);
    const parked = t.company.parkTask(t.ada.id, task.id, '2026-10-08T14:55', 'ölçüm penceresi dolsun');
    expect(parked).toMatchObject({ status: 'parked', notBefore: new Date(2026, 9, 8, 14, 55).getTime(), parkedReason: 'ölçüm penceresi dolsun', parkCount: 1, startedAt: null, nudged: false });
    expect(t.tasks.inProgressOf(t.ada.id)).toBeNull();
    expect(t.tasks.openInPlan(t.plan.id)).toBe(1);
    expect(t.clockTouches()).toBeGreaterThan(0);
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'task.changed' && e.event.change === 'parked')).toBe(true);
    expect(t.topics(t.ada.id)).not.toContain('decision task.parked');
  });

  it('someone else parking a started task tells the doer to stop; a waiting task parked tells no one', () => {
    const t = make();
    const running = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'süren' });
    t.company.start(running.id);
    t.company.parkTask(t.coordinator.id, running.id, '+6h', 'yarına');
    expect(t.notices.pending(t.ada.id).find((n) => n.topic === 'task.parked')?.text).toMatch(/bırak/);
    const waiting = t.company.createTask(t.coordinator.id, { assignee: t.can.id, title: 'bekleyen' });
    t.company.parkTask(t.coordinator.id, waiting.id, '+1d', 'önce diğeri');
    expect(t.topics(t.can.id)).toEqual([]);
  });

  it('the owner parks from the sheet: the doer is told to stop, the coordinator hears for the record', () => {
    const t = make();
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'sahibinin ertelediği' });
    t.company.start(task.id);
    t.company.parkTask(OWNER, task.id, '+1d', 'Sahibi erteledi');
    expect(t.notices.pending(t.ada.id).find((n) => n.topic === 'task.parked')?.text).toContain('sahibi tarafından yarın 14:10 saatine ertelendi');
    const told = t.notices.pending(t.coordinator.id).find((n) => n.topic === 'agenda.owner_changed');
    expect(told?.kind).toBe('info');
    expect(told?.text).toBe('Sahibi “sahibinin ertelediği” görevini yarın 14:10 saatine erteledi: Sahibi erteledi.');
  });

  it('refuses parking a review, a hand-over, a closed task, or by someone with no say; and a bad until', () => {
    const t = make();
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'incelemeli', reviewer: t.can.id });
    t.company.finish(t.ada.id, task.id, { summary: 'bitti', outputs: [], learned: '' });
    expect(() => t.company.parkTask(t.ada.id, task.id, '+1h', 'x')).toThrow(/incelemede/);
    const handover = t.company.beginHandover(t.can.id);
    expect(() => t.company.parkTask(t.can.id, handover.id, '+1h', 'x')).toThrow(/Devir/);
    const other = t.company.createTask(t.coordinator.id, { assignee: t.can.id, title: 'başkasının' });
    expect(() => t.company.parkTask(t.ada.id, other.id, '+1h', 'x')).toThrow(/Yalnız/);
    expect(() => t.company.parkTask(t.can.id, other.id, 'yarın', 'x')).toThrow(/Dönüş saati/);
    expect(() => t.company.parkTask(t.can.id, other.id, '+1h', ' ')).toThrow(/Gerekçe/);
    t.company.finish(t.can.id, other.id, { summary: 'bitti', outputs: [], learned: '' });
    expect(() => t.company.parkTask(t.can.id, other.id, '+1h', 'x')).toThrow(/kapandı/);
  });

  it('the third park tells the coordinator the task keeps being deferred', () => {
    const t = make();
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'ertelenen' });
    for (let i = 1; i <= 3; i += 1) {
      t.company.parkTask(t.ada.id, task.id, '+1h', `erteleme ${i}`);
      t.advance(2 * 3_600_000);
      expect(t.company.returnFromPark(task.id, T0 + i * 2 * 3_600_000)?.status).toBe('waiting');
    }
    expect(t.tasks.get(task.id).parkCount).toBe(3);
    const stuck = t.notices.pending(t.coordinator.id).find((n) => n.topic === 'task.reparked');
    expect(stuck?.kind).toBe('decision');
    expect(stuck?.text).toContain('ertelenen');
  });

  it('unpark brings a parked or start-timed task back now; the owner’s release also makes it priority 1; running and review tasks are refused', () => {
    const t = make();
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'parklı' });
    t.company.parkTask(t.ada.id, task.id, '+1d', 'bekle');
    expect(() => t.company.unparkTask(t.ada.id, task.id)).toThrow(/Yalnız koordinatör/);
    expect(t.company.unparkTask(t.coordinator.id, task.id)).toMatchObject({ status: 'waiting', notBefore: null, priority: 3 });
    const timed = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'saatli', startAfter: '+2h' });
    expect(timed.notBefore).toBe(T0 + 2 * 3_600_000);
    expect(t.tasks.nextFor(t.ada.id)?.id).toBe(task.id);
    expect(t.company.unparkTask(OWNER, timed.id, { priority: 1 })).toMatchObject({ status: 'waiting', notBefore: null, priority: 1 });
    expect(t.tasks.nextFor(t.ada.id)?.id).toBe(timed.id);
    expect(t.notices.pending(t.coordinator.id).find((n) => n.topic === 'agenda.owner_changed')?.kind).toBe('info');
    t.company.start(timed.id);
    expect(() => t.company.unparkTask(OWNER, timed.id)).toThrow(/sürüyor|park edilmiş/);
  });

  it('a due date orders the queue and, once past, tells the coordinator exactly once', () => {
    const t = make();
    const late = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'geç', dueAt: '+5d' });
    const soon = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'yakın', dueAt: '+1h' });
    expect(t.tasks.nextFor(t.ada.id)?.id).toBe(soon.id);
    expect(() => t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'x', dueAt: '+400d' })).toThrow(/Son tarih en fazla 365 gün/);
    t.advance(2 * 3_600_000);
    expect(t.scheduling.runDue().overdue).toEqual([soon.id]);
    expect(t.notices.pending(t.coordinator.id).filter((n) => n.topic === 'task.overdue')).toHaveLength(1);
    expect(t.scheduling.runDue().overdue).toEqual([]);
    expect(late.dueAt).toBe(T0 + 5 * 24 * 3_600_000);
  });

  it('the owner’s prioritize makes a waiting task priority 1 and tells the coordinator', () => {
    const t = make();
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'öne' });
    expect(t.company.ownerPrioritize(task.id).priority).toBe(1);
    expect(t.notices.pending(t.coordinator.id).some((n) => n.topic === 'agenda.owner_changed' && n.text.includes('öne'))).toBe(true);
  });

  it('a parked task is released to the coordinator when its holder is let go, and cancelled when its plan is stopped', () => {
    const t = make();
    const a = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'A', planId: t.plan.id });
    t.company.parkTask(t.ada.id, a.id, '+1d', 'bekle');
    t.company.releaseTasksOf(t.ada.id);
    expect(t.tasks.get(a.id)).toMatchObject({ status: 'waiting', notBefore: T0 + 24 * 3_600_000 });
    expect(t.notices.pending(t.coordinator.id).find((n) => n.topic === 'task.orphaned')?.text).toContain('A');
    const b = t.company.createTask(t.coordinator.id, { assignee: t.can.id, title: 'B', planId: t.plan.id });
    t.company.parkTask(t.can.id, b.id, '+1d', 'bekle');
    t.company.stopPlan(t.plan.id);
    expect(t.tasks.get(b.id).status).toBe('cancelled');
  });
});
