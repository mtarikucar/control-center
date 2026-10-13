import { describe, expect, it } from 'vitest';
import { COORDINATOR_SEAT, HUB_SEATS, SEAT_COUNT, roomSeats } from '@cc/shared';
import { behaviorOf, IDLE_WANDER_MS } from './behavior.ts';
import { cellOf, findPath, isFreeAt, type Grid, type Pt } from './grid.ts';
import { COUNTER_TOP, GRID, LAYOUT, spotFor, wanderOrder, type Placement } from './layout.ts';

const places = [...LAYOUT.coffeeSpots, ...LAYOUT.loungeSpots, ...LAYOUT.serverSpots, ...LAYOUT.meetingSpots];
const key = (s: Pt) => `${s.x},${s.z}`;
const inside = (p: Pt, r: { x1: number; z1: number; x2: number; z2: number }) => p.x > r.x1 && p.x < r.x2 && p.z > r.z1 && p.z < r.z2;
/** An item's footprint on the floor: a quarter turn swaps its width and depth. */
const footprint = (p: Placement) => (Math.abs(Math.round(p.rotY / (Math.PI / 2))) % 2 === 1 ? { w: p.d, d: p.w } : { w: p.w, d: p.d });

/**
 * The free cells reachable from `from`, 4-way: A* moves 8-way without cutting corners, which reaches exactly these.
 * (findPath falls back to a straight line when there is no route, so its result alone does not prove one.)
 */
function reachable(g: Grid, from: Pt): (p: Pt) => boolean {
  const seen = new Uint8Array(g.nx * g.nz);
  const [i0, k0] = cellOf(g, from);
  const queue = [k0 * g.nx + i0];
  seen[queue[0]!] = 1;
  while (queue.length > 0) {
    const c = queue.pop()!;
    const i = c % g.nx;
    const k = Math.floor(c / g.nx);
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di;
      const nk = k + dk;
      const n = nk * g.nx + ni;
      if (ni < 0 || nk < 0 || ni >= g.nx || nk >= g.nz || seen[n] || g.blocked[n]) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return (p) => {
    const [i, k] = cellOf(g, p);
    return seen[k * g.nx + i] === 1;
  };
}

describe('office layout (spec office rooms §2)', () => {
  it('is 32 × 24 m: three rooms north (z 0–7) and three south (z 17–24) around the hub, the beam on the coordinator’s desk', () => {
    expect([LAYOUT.width, LAYOUT.depth, LAYOUT.cell]).toEqual([32, 24, 0.5]);
    expect(LAYOUT.rooms.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(LAYOUT.rooms.map((r) => [r.rect.z1, r.rect.z2])).toEqual([[0, 7], [0, 7], [0, 7], [17, 24], [17, 24], [17, 24]]);
    for (const r of LAYOUT.rooms) expect(r.rect.x2 - r.rect.x1).toBeCloseTo(32 / 3);
    // The doors are on the hub's side: the north rooms' in their south glass, the south rooms' in their north glass.
    expect(LAYOUT.rooms.map((r) => r.door.z)).toEqual([7, 7, 7, 17, 17, 17]);
    expect(LAYOUT.beam).toEqual({ x: 16, z: 12 });
    const desk = LAYOUT.desks[COORDINATOR_SEAT]!;
    expect([desk.x, desk.z]).toEqual([LAYOUT.beam.x, LAYOUT.beam.z]);
    // The far walls are full height, the two facing the camera low (camera.ts turns only between them).
    expect(LAYOUT.walls.filter((w) => w.kind === 'low').map((w) => [w.x1, w.z1, w.x2, w.z2])).toEqual([[32, 0, 32, 24], [0, 24, 32, 24]]);
  });

  it('has 45 seats with a desk each, and every seat and place stands on a free cell', () => {
    expect(LAYOUT.seats).toHaveLength(SEAT_COUNT);
    expect(LAYOUT.desks).toHaveLength(SEAT_COUNT);
    for (const s of [...LAYOUT.seats, ...places]) expect(isFreeAt(GRID, s), key(s)).toBe(true);
  });

  it('seats each room’s six inside it, and the coordinator’s and the hub’s outside every room; the sign hangs over the door', () => {
    for (const room of LAYOUT.rooms) {
      expect(room.seats).toEqual(roomSeats(room.index));
      for (const n of room.seats) {
        expect(inside(LAYOUT.seats[n]!, room.rect), `seat ${n}`).toBe(true);
        expect(LAYOUT.desks[n]!.room).toBe(room.index);
      }
      expect(room.sign.x).toBeGreaterThan(room.door.x1);
      expect(room.sign.x).toBeLessThan(room.door.x2);
      expect(room.sign.z).toBe(room.door.z);
    }
    for (const n of [COORDINATOR_SEAT, ...HUB_SEATS]) {
      expect(LAYOUT.rooms.some((r) => inside(LAYOUT.seats[n]!, r.rect)), `seat ${n}`).toBe(false);
      expect(LAYOUT.desks[n]!.room).toBeUndefined();
    }
  });

  it('review focus 4: every seat reaches every place — coffee, lounge, the server corner, the meeting table — through free cells only', () => {
    const reached = reachable(GRID, LAYOUT.seats[COORDINATOR_SEAT]!);
    for (const s of [...LAYOUT.seats, ...places]) expect(reached(s), `${key(s)} is cut off`).toBe(true);
    for (const seat of LAYOUT.seats) {
      for (const target of places) {
        const path = findPath(GRID, seat, target);
        expect(path.at(-1)).toEqual({ x: target.x, z: target.z });
        expect(path.every((p) => isFreeAt(GRID, p)), `${key(seat)} → ${key(target)}`).toBe(true);
      }
    }
  });

  it('review focus 4: every room is left through its 1.4 m door, never through its glass', () => {
    for (const room of LAYOUT.rooms) {
      expect(room.door.x2 - room.door.x1).toBeCloseTo(1.4);
      for (const n of room.seats) {
        const from = LAYOUT.seats[n]!;
        const pts = [from, ...findPath(GRID, from, LAYOUT.seats[COORDINATOR_SEAT]!)];
        let crossings = 0;
        for (let i = 1; i < pts.length; i += 1) {
          const a = pts[i - 1]!;
          const b = pts[i]!;
          if ((a.z - room.door.z) * (b.z - room.door.z) >= 0) continue;
          const x = a.x + ((room.door.z - a.z) / (b.z - a.z)) * (b.x - a.x);
          crossings += 1;
          expect(x, `room ${room.index}, seat ${n}: through the glass at x ${x}`).toBeGreaterThan(room.door.x1);
          expect(x).toBeLessThan(room.door.x2);
        }
        expect(crossings, `room ${room.index}, seat ${n}`).toBe(1);
      }
    }
  });

  it('lounge places are seats: walk to a free spot just in front, then sit on the sofa, armchair or pouf', () => {
    for (const s of LAYOUT.loungeSpots) {
      expect(s.seat, key(s)).toBeDefined();
      expect(Math.hypot(s.seat!.x - s.x, s.seat!.z - s.z)).toBeLessThan(1);
    }
  });

  it('lights the office with lamps that glow; a dozen cast light — one pendant per room, the rooms’ desk lamps only glow', () => {
    const lamps = LAYOUT.furniture.filter((p) => (p.glow ?? 0) > 0);
    expect(lamps.length).toBeGreaterThanOrEqual(30);
    expect(lamps.filter((p) => !p.bulbOnly).length).toBeLessThanOrEqual(12);
    for (const r of LAYOUT.rooms) expect(lamps.filter((p) => p.room === r.index && !p.bulbOnly), `room ${r.index}`).toHaveLength(1);
  });

  it('gives every room its own carpet colour', () => {
    expect(new Set(LAYOUT.rooms.map((r) => r.carpet.color)).size).toBe(6);
    for (const r of LAYOUT.rooms) for (const n of r.seats) expect(inside(LAYOUT.seats[n]!, r.carpet), `seat ${n} on its room's carpet`).toBe(true);
  });

  it('maps zones to spots: a desk by seat number (an unknown one wraps), the rest by wandering order', () => {
    expect(spotFor(LAYOUT, 'desk', 37)).toBe(LAYOUT.seats[37]);
    expect(spotFor(LAYOUT, 'desk', 37, 2)).toBe(LAYOUT.seats[37]);
    expect(spotFor(LAYOUT, 'desk', SEAT_COUNT + 3)).toBe(LAYOUT.seats[3]);
    expect(spotFor(LAYOUT, 'coffee', 13, 4)).toBe(LAYOUT.coffeeSpots[2]);
    expect(spotFor(LAYOUT, 'lounge', 13, 5)).toBe(LAYOUT.loungeSpots[2]);
    expect(spotFor(LAYOUT, 'server', 13, 5)).toBe(LAYOUT.serverSpots[5]);
    expect(spotFor(LAYOUT, 'meeting', 0, 0)).toBe(LAYOUT.meetingSpots[0]);
    // Without an order the seat is the order (as before).
    expect(spotFor(LAYOUT, 'server', 5)).toBe(LAYOUT.serverSpots[5]);
  });

  it('review focus: never puts two people on one spot — 45 seats, up to 24 wanderers, 12 at the server corner, 6 at the meeting table', () => {
    expect([LAYOUT.coffeeSpots, LAYOUT.loungeSpots, LAYOUT.serverSpots, LAYOUT.meetingSpots].map((l) => l.length)).toEqual([12, 12, 12, 6]);
    expect(new Set(LAYOUT.seats.map(key)).size).toBe(SEAT_COUNT);
    const wanderers = Array.from({ length: 24 }, (_, order) => {
      const { zone } = behaviorOf({ lifecycle: 'idle', openToolSince: null, idleSince: 0, ownerTypingAt: null, now: IDLE_WANDER_MS * 2, wanderSeed: order });
      return `${zone}:${key(spotFor(LAYOUT, zone, 37, order))}`;
    });
    expect(new Set(wanderers).size).toBe(24);
    expect(new Set(Array.from({ length: 12 }, (_, o) => key(spotFor(LAYOUT, 'server', 0, o)))).size).toBe(12);
    expect(new Set(Array.from({ length: 6 }, (_, o) => key(spotFor(LAYOUT, 'meeting', 0, o)))).size).toBe(6);
  });

  it('orders the people at work by seat, so wanderers spread whatever seats they have', () => {
    const p = (id: string, deskIndex: number, createdAt = 1) => ({ id, deskIndex, createdAt });
    expect(wanderOrder([p('hub', 37), p('coord', 0), p('room', 13), p('room2', 14)])).toEqual({ coord: 0, room: 1, room2: 2, hub: 3 });
  });

  it('stands the coffee machine on the counter top, inside the counter (turned with it)', () => {
    const counter = LAYOUT.furniture.find((p) => p.assetId === 'coffee_counter_sink')!;
    const machine = LAYOUT.furniture.find((p) => p.assetId === 'espresso_machine')!;
    expect(machine.y).toBeCloseTo(counter.y + COUNTER_TOP * counter.h);
    expect(Math.abs(machine.x - counter.x) + footprint(machine).w / 2).toBeLessThan(footprint(counter).w / 2);
    expect(Math.abs(machine.z - counter.z) + footprint(machine).d / 2).toBeLessThan(footprint(counter).d / 2);
  });

  it('keeps everything that stands on the floor: nothing standing is hung in the air', () => {
    for (const p of LAYOUT.furniture.filter((q) => ['server_rack', 'coffee_counter_sink', 'meeting_table_chairs', 'low_credenza', 'work_desk'].includes(q.assetId))) {
      expect(p.y, p.assetId).toBe(0);
    }
  });
});
