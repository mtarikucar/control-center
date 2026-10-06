import { describe, expect, it } from 'vitest';
import { behaviorOf, IDLE_WANDER_MS } from './behavior.ts';
import { findPath, isFreeAt } from './grid.ts';
import { GRID, LAYOUT, spotFor } from './layout.ts';

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

  it('maps zones to spots by desk index (wanderers alternate, so each place takes every other desk)', () => {
    expect(spotFor(LAYOUT, 'desk', 3)).toBe(LAYOUT.seats[3]);
    expect(spotFor(LAYOUT, 'desk', 11)).toBe(LAYOUT.seats[3]);
    expect(spotFor(LAYOUT, 'server', 5)).toBe(LAYOUT.serverSpots[5]);
    expect(spotFor(LAYOUT, 'coffee', 4)).toBe(LAYOUT.coffeeSpots[2]);
    expect(spotFor(LAYOUT, 'lounge', 5)).toBe(LAYOUT.loungeSpots[2]);
  });

  it('review focus: never puts two of the eight employees on the same spot', () => {
    const key = (s: { x: number; z: number }) => `${s.x},${s.z}`;
    const desks = [...Array(LAYOUT.seats.length).keys()];
    for (const zone of ['desk', 'server'] as const) expect(new Set(desks.map((d) => key(spotFor(LAYOUT, zone, d)))).size).toBe(desks.length);
    const wandering = desks.map((d) => {
      const { zone } = behaviorOf({ lifecycle: 'idle', openToolSince: null, idleSince: 0, ownerTypingAt: null, now: IDLE_WANDER_MS * 2, wanderSeed: d });
      return `${zone}:${key(spotFor(LAYOUT, zone, d))}`;
    });
    expect(new Set(wandering).size).toBe(desks.length);
  });
});

