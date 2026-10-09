import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONSTITUTION, type Constitution, type QuotaState } from '@cc/shared';
import { Dispatcher } from '../src/company/dispatcher.ts';
import { QuotaStop } from '../src/company/quota-stop.ts';
import { companyFor } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

/* The owner's weekly line (2026-10-09: "haftalık limit 90 olunca dursunlar bana da lazım hesap"): the office pauses
   itself once the 7-day Claude quota reaches weeklyStopPct, once per weekly window; resuming is the owner's. */

const HOUR = 3_600_000;
const T0 = new Date(2026, 9, 9, 9, 0).getTime();

function make(o: { pct?: number; limit?: number; paused?: boolean } = {}) {
  let now = T0;
  let quota: QuotaState | null = { status: 'allowed', fiveHour: { utilization: 0.2, resetsAt: T0 + 3 * HOUR }, sevenDay: { utilization: (o.pct ?? 50) / 100, resetsAt: T0 + 50 * HOUR }, updatedAt: T0 };
  let constitution: Constitution = { ...DEFAULT_CONSTITUTION, ...(o.limit === undefined ? {} : { weeklyStopPct: o.limit }) };
  let paused = o.paused ?? false;
  const pauses: Array<string | undefined> = [];
  const notices: Array<{ to: string; topic: string; text: string }> = [];
  const state = new Map<string, string>();
  const stop = new QuotaStop({
    quota: { state: () => quota },
    constitution: () => constitution,
    company: {
      paused: () => paused,
      pause: (reason?: string) => {
        paused = true;
        pauses.push(reason);
      },
      coordinator: () => ({ id: 'k' }) as never,
    },
    state: { get: (k) => state.get(k) ?? null, set: (k, v) => void (v === null ? state.delete(k) : state.set(k, v)) },
    notices: { add: (to, topic, text) => void notices.push({ to, topic, text }) },
    now: () => now,
  });
  return {
    stop,
    pauses,
    notices,
    week: (pct: number, resetsAt = T0 + 50 * HOUR) => void (quota = { ...quota!, sevenDay: { utilization: pct / 100, resetsAt } }),
    noQuota: () => void (quota = null),
    limit: (n: number) => void (constitution = { ...constitution, weeklyStopPct: n }),
    resume: () => void (paused = false),
    advance: (ms: number) => void (now += ms),
  };
}

describe('QuotaStop — the office stops itself at the owner’s weekly line', () => {
  it('the default line is 90 %', () => {
    expect(DEFAULT_CONSTITUTION.weeklyStopPct).toBe(90);
  });

  it('below the line nothing happens; at it the company pauses with the reason, and the coordinator hears it as a note', () => {
    const t = make({ pct: 89 });
    expect(t.stop.check()).toBe(false);
    expect(t.pauses).toEqual([]);
    t.week(90);
    expect(t.stop.check()).toBe(true);
    expect(t.pauses).toEqual(['Haftalık Claude kotası %90 (sınır %90): ofis kendini duraklattı; sürdürmek sahibinde.']);
    expect(t.notices).toEqual([{ to: 'k', topic: 'quota.weekly_stop', text: 'Haftalık Claude kotası %90 oldu (sınır %90): şirket duraklatıldı. Sahibi sürdürünce devam et; o zamana kadar kota harcayan iş açma.' }]);
  });

  it('once per weekly window: the owner resumes above the line and it stays resumed; the next window stops it again', () => {
    const t = make({ pct: 93 });
    expect(t.stop.check()).toBe(true);
    t.resume();
    t.advance(HOUR);
    t.week(95);
    expect(t.stop.check()).toBe(false);
    expect(t.pauses).toHaveLength(1);
    // A new week (its reset moved on): the line holds again.
    t.week(91, T0 + 220 * HOUR);
    expect(t.stop.check()).toBe(true);
    expect(t.pauses).toHaveLength(2);
  });

  it('already paused by the owner when the line is crossed: no second pause, and resuming in that window is not undone', () => {
    const t = make({ pct: 92, paused: true });
    expect(t.stop.check()).toBe(false);
    expect(t.pauses).toEqual([]);
    t.resume();
    expect(t.stop.check()).toBe(false);
    expect(t.pauses).toEqual([]);
  });

  it('a pause that fails leaves the week unmarked: the next look tries again (review)', () => {
    let fail = true;
    const stop = new QuotaStop({
      quota: { state: () => ({ status: 'allowed', fiveHour: null, sevenDay: { utilization: 0.95, resetsAt: T0 + 50 * HOUR }, updatedAt: T0 }) },
      constitution: () => DEFAULT_CONSTITUTION,
      company: { paused: () => false, pause: () => { if (fail) throw new Error('disk dolu'); }, coordinator: () => null },
      state: (() => { const m = new Map<string, string>(); return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string | null) => void (v === null ? m.delete(k) : m.set(k, v)) }; })(),
      notices: { add: () => undefined },
      now: () => T0,
    });
    expect(() => stop.check()).toThrow('disk dolu');
    fail = false;
    expect(stop.check()).toBe(true);
  });

  it('0 switches it off; no quota reading yet, or a window already past its reset, is no reason to stop', () => {
    const off = make({ pct: 99, limit: 0 });
    expect(off.stop.check()).toBe(false);
    const none = make();
    none.noQuota();
    expect(none.stop.check()).toBe(false);
    const past = make();
    past.week(99, T0 - HOUR);
    expect(past.stop.check()).toBe(false);
    expect([...off.pauses, ...none.pauses, ...past.pauses]).toEqual([]);
  });
});

describe('QuotaStop — on the office tick', () => {
  it('the tick looks at the weekly line first, before the reserve and the pulse; a failing look does not stop the tick', () => {
    const s = setup();
    const f = fakeEngine(s);
    cleanups.push(f.cleanup, s.cleanup);
    const c = companyFor(s, f);
    const order: string[] = [];
    const dispatcher = new Dispatcher({
      events: s.events, roster: s.roster, tasks: c.tasks, notices: c.notices, plans: c.plans, company: c.company, engine: { ready: () => false, send: () => undefined, fire: async () => undefined, sleep: async () => undefined, wake: () => undefined },
      quotaStop: { check: () => { order.push('quota'); throw new Error('bozuk'); } },
      pulse: { check: () => order.push('pulse') },
      defer: () => undefined,
    });
    expect(() => dispatcher.tick()).not.toThrow();
    expect(order).toEqual(['quota', 'pulse']);
  });
});
