import { describe, expect, it } from 'vitest';
import type { Lifecycle } from '@cc/shared';
import { IDLE_WANDER_MS, LONG_TOOL_MS, TYPING_FRESH_MS, behaviorOf } from './behavior.ts';

const NOW = 1_000_000;
const input = (lifecycle: Lifecycle, over: Partial<Parameters<typeof behaviorOf>[0]> = {}) =>
  behaviorOf({ lifecycle, openToolSince: null, idleSince: NOW, ownerTypingAt: null, now: NOW, wanderSeed: 0, ...over });

describe('behaviorOf (spec §6)', () => {
  it('working: types at the desk, goes to the server room for a long tool', () => {
    expect(input('working')).toEqual({ zone: 'desk', activity: 'typing', marker: 'none' });
    expect(input('working', { openToolSince: NOW - LONG_TOOL_MS + 1 })).toEqual({ zone: 'desk', activity: 'typing', marker: 'none' });
    expect(input('working', { openToolSince: NOW - LONG_TOOL_MS - 1 })).toEqual({ zone: 'server', activity: 'idle', marker: 'none' });
  });

  it('turns to the owner while they type', () => {
    const typing = { ownerTypingAt: NOW - TYPING_FRESH_MS + 1 };
    expect(input('working', typing)).toEqual({ zone: 'desk', activity: 'talkSeated', marker: 'none' });
    expect(input('idle', { ...typing, idleSince: NOW - IDLE_WANDER_MS * 5 })).toEqual({ zone: 'desk', activity: 'talkSeated', marker: 'none' });
    expect(input('working', { ownerTypingAt: NOW - TYPING_FRESH_MS - 1 }).activity).toBe('typing');
  });

  it('idle: stays at the desk for a minute, then coffee or a seat in the lounge', () => {
    expect(input('idle', { idleSince: NOW - IDLE_WANDER_MS + 1 })).toEqual({ zone: 'desk', activity: 'sit', marker: 'none' });
    expect(input('idle', { idleSince: NOW - IDLE_WANDER_MS - 1, wanderSeed: 2 })).toEqual({ zone: 'coffee', activity: 'drink', marker: 'none' });
    expect(input('idle', { idleSince: NOW - IDLE_WANDER_MS - 1, wanderSeed: 3 })).toEqual({ zone: 'lounge', activity: 'sit', marker: 'none' });
    expect(input('starting').zone).toBe('desk');
  });

  it('review focus: an employee idle since long before the page loaded wanders off, a fresh hire sits down', () => {
    expect(input('idle', { idleSince: NOW - 3 * 60 * 60 * 1000 }).zone).not.toBe('desk');
    expect(input('idle', { idleSince: NOW - 2000 }).zone).toBe('desk');
  });

  it('marks trouble, stop and terminal at the desk', () => {
    for (const l of ['limited', 'error', 'interrupted'] as const) expect(input(l)).toEqual({ zone: 'desk', activity: 'sit', marker: 'alert' });
    expect(input('stopped')).toEqual({ zone: 'desk', activity: 'sit', marker: 'faded' });
    expect(input('in_terminal')).toEqual({ zone: 'desk', activity: 'sit', marker: 'terminal' });
  });


  it('sends a coordinator discussing a plan to the meeting room, working or between turns', () => {
    expect(input('working', { planning: true })).toEqual({ zone: 'meeting', activity: 'idle', marker: 'none' });
    expect(input('idle', { planning: true })).toEqual({ zone: 'meeting', activity: 'idle', marker: 'none' });
    expect(input('stopped', { planning: true }).zone).toBe('desk');
  });
});
