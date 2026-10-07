import { afterEach, describe, expect, it } from 'vitest';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const T0 = new Date(2026, 9, 7, 14, 10).getTime();
const HOUR = 3_600_000;

function make() {
  let clock = T0;
  const now = () => clock;
  const s = setup(8, now);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, undefined, now);
  const coordinator = c.company.hireCoordinator('sonnet');
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r' });
  return { ...s, ...c, coordinator, ada, advance: (ms: number) => (clock += ms) };
}

describe('Scheduling.runDue — tasks (spec §5)', () => {
  it('returns parked tasks whose time came, each exactly once, and reports them', () => {
    const t = make();
    const a = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'A' });
    const b = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'B' });
    t.company.parkTask(t.ada.id, a.id, '+1h', 'a');
    t.company.parkTask(t.ada.id, b.id, '+3h', 'b');
    expect(t.scheduling.nextDueAt()).toBe(T0 + HOUR);
    expect(t.scheduling.runDue().returned).toEqual([]);
    t.advance(HOUR);
    expect(t.scheduling.runDue().returned).toEqual([a.id]);
    expect(t.tasks.get(a.id)).toMatchObject({ status: 'waiting', notBefore: null, parkedReason: null });
    expect(t.scheduling.runDue().returned).toEqual([]);
    expect(t.scheduling.nextDueAt()).toBe(T0 + 3 * HOUR);
    expect(t.events.list({ limit: 500 }).filter((e) => e.event.type === 'task.changed' && e.event.change === 'returned')).toHaveLength(1);
  });

  it('a new Scheduling on the same database catches up once after a long gap', () => {
    const t = make();
    const a = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'A' });
    t.company.parkTask(t.ada.id, a.id, '+1h', 'a');
    t.advance(50 * HOUR);
    const report = t.freshScheduling().runDue();
    expect(report.returned).toEqual([a.id]);
    expect(t.freshScheduling().runDue().returned).toEqual([]);
  });

  it('review focus: while the company is paused a parked task still returns to waiting (delivery is the dispatcher’s, and it hands out nothing)', () => {
    const t = make();
    const a = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'A' });
    t.company.parkTask(t.ada.id, a.id, '+1h', 'a');
    t.company.pause();
    t.advance(HOUR);
    expect(t.scheduling.runDue().returned).toEqual([a.id]);
    expect(t.tasks.get(a.id).status).toBe('waiting');
  });

  it('one failing item does not stop the others; the failure is in the log', () => {
    const t = make();
    const a = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'A' });
    const b = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'B' });
    t.company.parkTask(t.ada.id, a.id, '+1h', 'a');
    t.company.parkTask(t.ada.id, b.id, '+1h', 'b');
    t.advance(HOUR);
    t.breakReturnOf(a.id);
    const report = t.scheduling.runDue();
    expect(report.returned).toEqual([b.id]);
    expect(report.errors).toHaveLength(1);
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'clock.error' && e.event.job.includes(a.id))).toBe(true);
  });
});
