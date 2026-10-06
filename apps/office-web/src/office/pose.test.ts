import { describe, expect, it } from 'vitest';
import { SIT_DOWN_MS, STAND_UP_MS, TO_SEAT_MS, advance, clipFor, initialPose, onGoal, seatOffset } from './pose.ts';

const seatedAt = (since = 0) => ({ phase: 'seated' as const, since });

describe('pose', () => {
  it('starts seated where people sit and standing elsewhere', () => {
    expect(initialPose(true, 5).phase).toBe('seated');
    expect(initialPose(false, 5).phase).toBe('standing');
  });

  it('gets up before walking off, and only then walks', () => {
    const p = onGoal(seatedAt(), 1000);
    expect(p).toEqual({ phase: 'standingUp', since: 1000 });
    expect(advance(p, 1000 + STAND_UP_MS - 1, { walkDone: false, hasSeat: false, sits: false }).phase).toBe('standingUp');
    expect(advance(p, 1000 + STAND_UP_MS, { walkDone: false, hasSeat: false, sits: false })).toEqual({ phase: 'walking', since: 1000 + STAND_UP_MS });
  });

  it('a new goal while walking or standing just (re)starts the walk', () => {
    expect(onGoal({ phase: 'walking', since: 0 }, 50).phase).toBe('walking');
    expect(onGoal({ phase: 'standing', since: 0 }, 50).phase).toBe('walking');
  });

  it('arriving at a desk chair sits down, then stays seated', () => {
    const arrived = advance({ phase: 'walking', since: 0 }, 2000, { walkDone: true, hasSeat: false, sits: true });
    expect(arrived).toEqual({ phase: 'sittingDown', since: 2000 });
    expect(advance(arrived, 2000 + SIT_DOWN_MS, { walkDone: true, hasSeat: false, sits: true })).toEqual({ phase: 'seated', since: 2000 + SIT_DOWN_MS });
  });

  it('arriving at the lounge steps onto the seat first, then sits down', () => {
    const arrived = advance({ phase: 'walking', since: 0 }, 2000, { walkDone: true, hasSeat: true, sits: true });
    expect(arrived.phase).toBe('toSeat');
    expect(advance(arrived, 2000 + TO_SEAT_MS, { walkDone: true, hasSeat: true, sits: true }).phase).toBe('sittingDown');
  });

  it('arriving at the coffee bar just stands there', () => {
    expect(advance({ phase: 'walking', since: 0 }, 2000, { walkDone: true, hasSeat: false, sits: false }).phase).toBe('standing');
  });

  it('picks the clip for each phase: walk, stand up, sit down, then what the work asks for', () => {
    expect(clipFor({ phase: 'walking', since: 0 }, 'typing')).toBe('walk');
    expect(clipFor({ phase: 'toSeat', since: 0 }, 'sit')).toBe('walk');
    expect(clipFor({ phase: 'standingUp', since: 0 }, 'sit')).toBe('standUp');
    expect(clipFor({ phase: 'sittingDown', since: 0 }, 'typing')).toBe('sitDown');
    expect(clipFor({ phase: 'seated', since: 0 }, 'typing')).toBe('typing');
    expect(clipFor({ phase: 'standing', since: 0 }, 'drink')).toBe('drink');
  });

  it('lowers the body onto a seat lower than a desk chair while sitting down, and back up when getting up', () => {
    const drop = -0.08;
    expect(seatOffset({ phase: 'walking', since: 0 }, 100, drop)).toBe(0);
    expect(seatOffset({ phase: 'sittingDown', since: 0 }, SIT_DOWN_MS / 2, drop)).toBeCloseTo(drop / 2);
    expect(seatOffset({ phase: 'seated', since: 0 }, 99_999, drop)).toBe(drop);
    expect(seatOffset({ phase: 'standingUp', since: 0 }, STAND_UP_MS / 4, drop)).toBeCloseTo(drop * 0.75);
    expect(seatOffset({ phase: 'standingUp', since: 0 }, STAND_UP_MS * 2, drop)).toBeCloseTo(0);
  });
});
