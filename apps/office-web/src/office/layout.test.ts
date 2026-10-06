import { describe, expect, it } from 'vitest';
import { behaviorOf, IDLE_WANDER_MS } from './behavior.ts';
import { findPath, isFreeAt } from './grid.ts';
import { COUNTER_TOP, GRID, LAYOUT, spotFor } from './layout.ts';

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

  it('is compact like the reference: 18 × 14 m', () => {
    expect([LAYOUT.width, LAYOUT.depth]).toEqual([18, 14]);
  });

  it('review focus: leaves the server room through its door, not its walls', () => {
    // The door is in the server room's west wall (x 14.5) at z 2.9–4.1; its south wall backs the coffee bar.
    const door = { x: 14.5, z1: 2.9, z2: 4.1 };
    for (const from of LAYOUT.serverSpots) {
      const pts = [from, ...findPath(GRID, from, LAYOUT.seats[0]!)];
      let crossings = 0;
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        expect(a.z < 4.5 && a.x > 14.5 && b.z > 4.5, `${a.x},${a.z} → ${b.x},${b.z} through the south wall`).toBe(false);
        if ((a.x - door.x) * (b.x - door.x) >= 0) continue;
        const z = a.z + ((door.x - a.x) / (b.x - a.x)) * (b.z - a.z);
        if (z > 4.5) continue; // the line x = 14.5 south of the server room is open floor
        crossings += 1;
        expect(z, 'crossing the server room west wall').toBeGreaterThan(door.z1);
        expect(z).toBeLessThan(door.z2);
      }
      expect(crossings).toBe(1);
    }
  });

  it('lounge places are seats: walk to a free spot just in front, then sit on the sofa, armchair or pouf', () => {
    for (const s of LAYOUT.loungeSpots) {
      expect(s.seat, `${s.x},${s.z}`).toBeDefined();
      expect(Math.hypot(s.seat!.x - s.x, s.seat!.z - s.z)).toBeLessThan(1);
    }
  });

  it('lights the room with lamps that glow', () => {
    const lamps = LAYOUT.furniture.filter((p) => (p.glow ?? 0) > 0);
    expect(lamps.length).toBeGreaterThanOrEqual(4);
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

  it('stands the coffee machine on the counter top, inside the counter', () => {
    const counter = LAYOUT.furniture.find((p) => p.assetId === 'coffee_counter_sink')!;
    const machine = LAYOUT.furniture.find((p) => p.assetId === 'espresso_machine')!;
    expect(machine.y).toBeCloseTo(counter.y + COUNTER_TOP * counter.h);
    expect(Math.abs(machine.x - counter.x) + machine.w / 2).toBeLessThan(counter.w / 2);
    expect(Math.abs(machine.z - counter.z) + machine.d / 2).toBeLessThan(counter.d / 2);
  });

  it('keeps every board on the floor: nothing that stands is hung in the air', () => {
    for (const p of LAYOUT.furniture.filter((q) => ['whiteboard', 'server_rack', 'reception_desk', 'coffee_counter_sink'].includes(q.assetId))) {
      expect(p.y, p.assetId).toBe(0);
    }
  });


  it('the meeting spot is free and reachable from every desk', () => {
    const spot = spotFor(LAYOUT, 'meeting', 3);
    expect(isFreeAt(GRID, spot)).toBe(true);
    for (const seat of LAYOUT.seats) expect(findPath(GRID, seat, spot).length).toBeGreaterThan(0);
  });
});
