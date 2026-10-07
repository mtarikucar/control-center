import { describe, expect, it } from 'vitest';
import { modelPolicy } from '../src/model-policy.ts';

const MIN = 60_000;
const at = (minutesAgo: number | null) => ({ now: 100 * MIN, lastTurnFinishedAt: minutesAgo === null ? null : (100 - minutesAgo) * MIN, ttlMinutes: 5 });

describe('modelPolicy.decide', () => {
  it('moves to a stronger model at once, however warm the cache', () => {
    expect(modelPolicy.decide({ current: 'sonnet', wanted: 'fable', ...at(0) })).toBe('switch');
    expect(modelPolicy.decide({ current: 'haiku', wanted: 'sonnet', ...at(1) })).toBe('switch');
  });

  it('moves to a weaker model only once the cache is cold: the TTL since the last turn, or no turn yet', () => {
    expect(modelPolicy.decide({ current: 'fable', wanted: 'sonnet', ...at(0) })).toBe('keep');
    expect(modelPolicy.decide({ current: 'fable', wanted: 'sonnet', ...at(4.9) })).toBe('keep');
    expect(modelPolicy.decide({ current: 'fable', wanted: 'sonnet', ...at(5) })).toBe('switch');
    expect(modelPolicy.decide({ current: 'opus', wanted: 'haiku', ...at(null) })).toBe('switch');
  });

  it('keeps the model without a wish or with the same one', () => {
    expect(modelPolicy.decide({ current: 'opus', ...at(60) })).toBe('keep');
    expect(modelPolicy.decide({ current: 'opus', wanted: 'opus', ...at(60) })).toBe('keep');
  });

  it('at a task’s start the task’s model applies either way', () => {
    expect(modelPolicy.decide({ current: 'opus', wanted: 'haiku', taskStart: true, ...at(0) })).toBe('switch');
    expect(modelPolicy.decide({ current: 'haiku', wanted: 'opus', taskStart: true, ...at(0) })).toBe('switch');
    expect(modelPolicy.decide({ current: 'sonnet', wanted: 'sonnet', taskStart: true, ...at(0) })).toBe('keep');
  });
});
