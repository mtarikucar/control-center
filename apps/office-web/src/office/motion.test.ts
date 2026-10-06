import { describe, expect, it } from 'vitest';
import { stepAlong, turnToward } from './motion.ts';

describe('stepAlong', () => {
  it('moves the right distance, turns toward the next point and arrives exactly', () => {
    const path = [{ x: 0, z: 2 }, { x: 2, z: 2 }];
    let s = stepAlong(path, { x: 0, z: 0 }, 0, 1, 1);
    expect(s.pos.x).toBeCloseTo(0);
    expect(s.pos.z).toBeCloseTo(1);
    expect(s.heading).toBeCloseTo(0);
    expect(s.arrived).toBe(false);
    s = stepAlong(s.path, s.pos, s.heading, 1, 1.5);
    expect(s.pos.x).toBeCloseTo(0.5);
    expect(s.pos.z).toBeCloseTo(2);
    expect(s.heading).toBeCloseTo(Math.PI / 2);
    s = stepAlong(s.path, s.pos, s.heading, 1, 10);
    expect(s).toMatchObject({ pos: { x: 2, z: 2 }, path: [], arrived: true });
  });

  it('is already there with an empty path', () => {
    expect(stepAlong([], { x: 1, z: 1 }, 0.5, 1, 1)).toEqual({ path: [], pos: { x: 1, z: 1 }, heading: 0.5, arrived: true });
  });
});

describe('turnToward', () => {
  it('turns the short way round, never further than the step, and lands exactly on the target', () => {
    expect(turnToward(0, 0.5, 0.2)).toBeCloseTo(0.2);
    expect(turnToward(3.0, -3.0, 0.1)).toBeCloseTo(3.1);
    expect(turnToward(0, 0.05, 0.2)).toBeCloseTo(0.05);
    expect(turnToward(0.1, 0.1 + 2 * Math.PI, 0.2)).toBeCloseTo(0.1);
  });
});
