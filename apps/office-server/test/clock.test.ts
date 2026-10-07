import { afterEach, describe, expect, it } from 'vitest';
import { Clock } from '../src/company/clock.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const T0 = new Date(2026, 9, 7, 14, 10).getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;

/** Fake timers: one pending callback at most (the clock keeps one), fired by advancing the clock. */
function make() {
  let clock = T0;
  const now = () => clock;
  const s = setup(8, now);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, undefined, now);
  let pending: { fn: () => void; at: number } | null = null;
  const timers = {
    set: (fn: () => void, ms: number) => {
      pending = { fn, at: clock + ms };
      return pending;
    },
    clear: () => {
      pending = null;
    },
  };
  const coordinator = c.company.hireCoordinator('sonnet');
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'r' });
  // A long safety interval, so the tests see the due times and the jobs, not the safety tick.
  const newClock = (o: { safetyMs?: number } = {}) => new Clock({ scheduling: c.scheduling, state: c.state, events: s.events, now, timers, safetyMs: o.safetyMs ?? 60 * MIN, label: (at) => (c.scheduling.nextDueAt(at) ? 'bir şey' : null) });
  /** Moves time forward and fires the pending timer if its time came (like a real timer would). */
  const advance = (ms: number) => {
    clock += ms;
    if (pending && pending.at <= clock) {
      const p = pending;
      pending = null;
      p.fn();
    }
  };
  return { ...s, ...c, coordinator, ada, newClock, advance, armedAt: () => pending?.at ?? null, jump: (ms: number) => void (clock += ms) };
}

describe('Clock (spec §5)', () => {
  it('arms to the nearest due time, at most the safety interval away, and re-arms on touch', () => {
    const t = make();
    const clock = t.newClock();
    cleanups.push(clock.start());
    expect(t.armedAt()).toBe(T0 + 60 * MIN);
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'A' });
    t.company.parkTask(t.ada.id, task.id, '+5m', 'kısa'); // parkTask touches the test helper's fake clock, not this one
    clock.touch();
    expect(t.armedAt()).toBe(T0 + 5 * MIN);
    t.advance(5 * MIN);
    expect(t.tasks.get(task.id).status).toBe('waiting');
    expect(t.armedAt()).toBe(T0 + 5 * MIN + 60 * MIN);
    expect(clock.status().lastRunAt).toBe(T0 + 5 * MIN);
  });

  it('runs due items at start (catch-up after a restart) and reports what it did to listeners', () => {
    const t = make();
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'A' });
    t.company.parkTask(t.ada.id, task.id, '+1h', 'uzun');
    t.jump(5 * HOUR);
    const ran: string[][] = [];
    const clock = t.newClock();
    clock.onRan((r) => ran.push(r.returned));
    cleanups.push(clock.start());
    expect(ran).toEqual([[task.id]]);
    expect(t.tasks.get(task.id).status).toBe('waiting');
  });

  it('runs periodic jobs on their interval and never lets one failing job stop the others or the clock', () => {
    const t = make();
    const clock = t.newClock({ safetyMs: 60 * MIN });
    const log: string[] = [];
    let a = 0;
    clock.every('a', 10 * MIN, () => void log.push(`a${(a += 1)}`));
    clock.every('boom', 10 * MIN, () => {
      throw new Error('kötü iş');
    });
    clock.every('b', 30 * MIN, () => void log.push('b'));
    cleanups.push(clock.start());
    expect(log).toEqual(['a1', 'b']);
    t.advance(10 * MIN);
    expect(log).toEqual(['a1', 'b', 'a2']);
    t.advance(10 * MIN);
    t.advance(10 * MIN);
    expect(log.filter((x) => x === 'b')).toHaveLength(2);
    expect(t.events.list({ limit: 500 }).filter((e) => e.event.type === 'clock.error' && e.event.job === 'boom').length).toBeGreaterThanOrEqual(2);
  });

  it('a job added after start runs at once, without counting that as a jump', () => {
    const t = make();
    const clock = t.newClock();
    cleanups.push(clock.start());
    const log: string[] = [];
    clock.every('late', 10 * MIN, () => void log.push('late'));
    expect(t.armedAt()).toBe(T0);
    t.advance(0);
    expect(log).toEqual(['late']);
    expect(clock.status().lastJumpAt).toBeNull();
    expect(t.armedAt()).toBe(T0 + 10 * MIN);
  });

  it('notes a jump when it wakes more than two minutes late, and still processes what became due', () => {
    const t = make();
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'A' });
    t.company.parkTask(t.ada.id, task.id, '+30m', 'x');
    const clock = t.newClock();
    cleanups.push(clock.start());
    clock.touch();
    // The machine slept: the timer fires 3 hours after the moment it was armed for.
    t.jump(3 * HOUR);
    t.advance(0);
    expect(t.tasks.get(task.id).status).toBe('waiting');
    expect(clock.status().lastJumpAt).toBe(T0 + 3 * HOUR);
    expect(t.events.list({ limit: 500 }).some((e) => e.event.type === 'clock.jumped')).toBe(true);
    expect(t.state.get('clock.lastJumpAt')).toBe(String(T0 + 3 * HOUR));
  });

  it('status names the next due time and label', () => {
    const t = make();
    const clock = t.newClock();
    cleanups.push(clock.start());
    expect(clock.status()).toMatchObject({ nextDueAt: null, nextDueLabel: null });
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'A' });
    t.company.parkTask(t.ada.id, task.id, '+2h', 'x');
    expect(clock.status()).toMatchObject({ nextDueAt: T0 + 2 * HOUR, nextDueLabel: 'bir şey' });
  });
});
