import { describe, expect, it } from 'vitest';
import type { Usage } from '@cc/shared';
import { migrateUp, openDb } from '../src/db.ts';
import { EventStore } from '../src/event-store.ts';
import { QuotaTracker } from '../src/quota.ts';

const TODAY_NOON = new Date(2026, 9, 6, 12, 0, 0).getTime();
const YESTERDAY = TODAY_NOON - 24 * 60 * 60 * 1000;

function make() {
  let clock = TODAY_NOON;
  const db = openDb(':memory:');
  migrateUp(db);
  const events = new EventStore(db, () => clock);
  const quota = new QuotaTracker(db, events, () => clock);
  return { events, quota, setClock: (t: number) => (clock = t) };
}

const usage = (n: number): Usage => ({ inputTokens: n, outputTokens: n * 2, cacheReadTokens: n * 10, cacheCreationTokens: n * 5 });

const turn = (cost: number) =>
  ({ type: 'turn.finished', ok: true, subtype: 'success', usage: usage(1), costUsd: cost, numTurns: 3, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0 }) as const;

describe('QuotaTracker', () => {
  it('has no state before any quota event', () => {
    expect(make().quota.state()).toBeNull();
  });

  it('keeps the latest windows and keeps a window an update omits', () => {
    const { events, quota } = make();
    events.append('e1', { type: 'quota.updated', status: 'allowed', fiveHour: { utilization: 0.2, resetsAt: 1000 }, sevenDay: { utilization: 0.1, resetsAt: 2000 } });
    events.append('e2', { type: 'quota.updated', status: 'allowed_warning', fiveHour: { utilization: 0.8, resetsAt: 1000 }, sevenDay: null });
    expect(quota.state()).toEqual({
      status: 'allowed_warning',
      fiveHour: { utilization: 0.8, resetsAt: 1000 },
      sevenDay: { utilization: 0.1, resetsAt: 2000 },
      updatedAt: TODAY_NOON,
    });
  });

  it('sums usage per employee for today and in total, including side answers', () => {
    const { events, quota, setClock } = make();
    setClock(YESTERDAY);
    events.append('e1', { type: 'turn.finished', ok: true, subtype: 'success', usage: usage(100), costUsd: 1, numTurns: 1, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0 });
    setClock(TODAY_NOON);
    events.append('e1', { type: 'turn.finished', ok: true, subtype: 'success', usage: usage(10), costUsd: 0.5, numTurns: 1, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0 });
    events.append('e1', { type: 'side.answer', text: 'x', ok: true, usage: usage(1), costUsd: 0.1 });
    events.append('e2', { type: 'turn.finished', ok: true, subtype: 'success', usage: usage(7), costUsd: 9, numTurns: 1, queuedTurns: 0, sessionUsage: null, sessionCostUsd: 0 });
    events.append('e1', { type: 'message.assistant', text: 'sayılmaz' });

    const e1 = quota.usage('e1');
    expect(e1.today).toMatchObject({ turns: 1, sideAnswers: 1 });
    expect(e1.total).toMatchObject({ turns: 2, sideAnswers: 1 });
    expect(e1.today).toMatchObject({ inputTokens: 11, outputTokens: 22, cacheReadTokens: 110, cacheCreationTokens: 55 });
    expect(e1.today.costUsd).toBeCloseTo(0.6);
    expect(e1.total).toMatchObject({ inputTokens: 111, outputTokens: 222 });
    expect(e1.total.costUsd).toBeCloseTo(1.6);
    expect(quota.usageAll(['e1', 'e2', 'nobody']).nobody).toEqual({
      today: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, turns: 0, sideAnswers: 0 },
      total: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, turns: 0, sideAnswers: 0 },
    });
  });

  it('counts finished turns (not the CLI’s inner steps) per day and in total, side answers apart', () => {
    const { events, quota, setClock } = make();
    setClock(YESTERDAY);
    for (let i = 0; i < 4; i += 1) events.append('c', turn(0.25));
    setClock(TODAY_NOON);
    for (let i = 0; i < 12; i += 1) events.append('c', turn(0.08));
    events.append('c', { type: 'side.answer', text: 'x', ok: true, usage: usage(1), costUsd: 0.01 });
    events.append('c', { type: 'side.answer', text: 'y', ok: false, usage: usage(1), costUsd: 0 });
    events.append('c', { type: 'turn.started' });
    events.append('m', turn(0.1));
    const all = quota.usageAll(['c', 'm']);
    expect(all.c?.today).toMatchObject({ turns: 12, sideAnswers: 2 });
    expect(all.c?.total).toMatchObject({ turns: 16, sideAnswers: 2 });
    expect(all.m?.today).toMatchObject({ turns: 1, sideAnswers: 0 });
  });
});
