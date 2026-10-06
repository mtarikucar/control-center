import { describe, expect, it } from 'vitest';
import { stepAlong } from './motion.ts';

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
