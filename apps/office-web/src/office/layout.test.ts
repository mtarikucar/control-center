import { describe, expect, it } from 'vitest';
import { findPath, isFreeAt } from './grid.ts';
import { GRID, LAYOUT, spotFor, tagLift } from './layout.ts';

const allSpots = [...LAYOUT.seats, ...LAYOUT.coffeeSpots, ...LAYOUT.loungeSpots, ...LAYOUT.serverSpots];

describe('office layout', () => {
  it('has eight desks and every spot stands on a free cell', () => {
    expect(LAYOUT.seats).toHaveLength(8);
    for (const s of allSpots) expect(isFreeAt(GRID, s), `${s.x},${s.z}`).toBe(true);
  });

  it('review focus: every seat reaches every other place through free cells only', () => {
    for (const seat of LAYOUT.seats) {
      for (const target of [...LAYOUT.coffeeSpots, ...LAYOUT.loungeSpots, ...LAYOUT.serverSpots]) {
        const path = findPath(GRID, seat, target);
        expect(path.at(-1)).toEqual({ x: target.x, z: target.z });
        expect(path.every((p) => isFreeAt(GRID, p)), `${seat.x},${seat.z} → ${target.x},${target.z}`).toBe(true);
      }
    }
  });

  it('review focus: leaves the server room through its door, not its wall', () => {
    const path = findPath(GRID, LAYOUT.serverSpots[0]!, LAYOUT.seats[0]!);
    const pts = [LAYOUT.serverSpots[0]!, ...path];
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      if ((a.x - 19.5) * (b.x - 19.5) < 0) {
        const z = a.z + ((19.5 - a.x) / (b.x - a.x)) * (b.z - a.z);
        expect(z, 'crossing the server room wall').toBeGreaterThan(5.2);
        expect(z).toBeLessThan(6.4);
      }
    }
  });

  it('maps zones to spots by desk index', () => {
    expect(spotFor(LAYOUT, 'desk', 3)).toBe(LAYOUT.seats[3]);
    expect(spotFor(LAYOUT, 'desk', 11)).toBe(LAYOUT.seats[3]);
    expect(spotFor(LAYOUT, 'coffee', 4)).toBe(LAYOUT.coffeeSpots[4 % LAYOUT.coffeeSpots.length]);
    expect(spotFor(LAYOUT, 'server', 1)).toBe(LAYOUT.serverSpots[1]);
    expect(spotFor(LAYOUT, 'lounge', 0)).toBe(LAYOUT.loungeSpots[0]);
  });

  it('lifts the tag of whoever stands further back, so people waiting together keep readable tags', () => {
    expect(tagLift(LAYOUT, 'desk', 5)).toBe(0);
    const lifts = LAYOUT.coffeeSpots.map((_, i) => tagLift(LAYOUT, 'coffee', i));
    const order = LAYOUT.coffeeSpots.map((s, i) => [s.x + s.z, lifts[i]!] as const).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < order.length; i += 1) expect(order[i]![1]).toBeLessThan(order[i - 1]![1]);
    expect(tagLift(LAYOUT, 'coffee', 3)).toBe(tagLift(LAYOUT, 'coffee', 0));
  });
});

