import { describe, expect, it } from 'vitest';
import type { Department, Employee } from '@cc/shared';
import { LAYOUT } from '../office/layout.ts';
import { EMPTY_CARPET, darkDesks, darkRooms, heldRooms, roomStates, roomTags, sceneSeat, signText } from './rooms.ts';

const dep = (id: string, name: string, room: number | null, o: Partial<Department> = {}): Department => ({
  id, name, mission: 'm', scope: '', template: null, headId: null, status: 'open', createdAt: 1, closedAt: null, room, ...o,
});
const person = (id: string, name: string, deskIndex = -1) => ({ id, name, deskIndex }) as Employee;
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('signText (spec office rooms §4.2)', () => {
  it('names the department and its head; a headless one says so; an empty room says “Boş oda”', () => {
    expect(signText(dep('d', 'Pazarlama', 0), person('p', 'Pelin'))).toEqual({ title: 'Pazarlama', subtitle: 'Başkan: Pelin' });
    expect(signText(dep('d', 'Satış', 1), null)).toEqual({ title: 'Satış', subtitle: 'Başkan yok' });
    expect(signText(null, null)).toEqual({ title: 'Boş oda', subtitle: null });
  });

  it('final review I1: a room no department holds where someone sits says “Ortak oda”, without a subtitle', () => {
    expect(signText(null, null, true)).toEqual({ title: 'Ortak oda', subtitle: null });
    expect(signText(dep('d', 'Pazarlama', 0), null, true)).toEqual({ title: 'Pazarlama', subtitle: 'Başkan yok' });
  });
});

describe('roomStates', () => {
  it('review focus 5: a room with an open department is lit in its colour with its sign; the rest are dark — a closed department leaves its room', () => {
    const states = roomStates(
      LAYOUT.rooms,
      { a: dep('a', 'Pazarlama', 2, { headId: 'p' }), b: dep('b', 'Satış', 0), c: dep('c', 'Eski', 3, { status: 'closed', closedAt: 5 }) },
      [person('p', 'Pelin')],
    );
    expect(states.map((s) => s.lit)).toEqual([true, false, true, false, false, false]);
    expect(states.map((s) => s.carpet)).toEqual([LAYOUT.rooms[0]!.carpet.color, EMPTY_CARPET, LAYOUT.rooms[2]!.carpet.color, EMPTY_CARPET, EMPTY_CARPET, EMPTY_CARPET]);
    expect(states[2]!.sign).toEqual({ title: 'Pazarlama', subtitle: 'Başkan: Pelin' });
    expect(states[0]!.sign).toEqual({ title: 'Satış', subtitle: 'Başkan yok' });
    expect(states[1]!.sign).toEqual({ title: 'Boş oda', subtitle: null });
  });

  it('an office without departments has six dark rooms; a department from a server without rooms lights none', () => {
    expect(roomStates(LAYOUT.rooms, {}, []).every((s) => !s.lit)).toBe(true);
    const { room: _none, ...old } = dep('x', 'X', 0);
    expect(roomStates(LAYOUT.rooms, { x: old as Department }, []).every((s) => !s.lit)).toBe(true);
  });
});

describe('rooms where the centre’s overflow sits (final review I1)', () => {
  it('a room no department holds with someone at a desk is lit, keeps the dark carpet and says “Ortak oda”; an empty one stays dark, “Boş oda”', () => {
    // The ninth of the centre at seat 31 (room 5); room 0 a department's, with its head at seat 1.
    const states = roomStates(LAYOUT.rooms, { a: dep('a', 'Satış', 0, { headId: 'h' }) }, [person('h', 'Hale', 1), person('n', 'Nur', 31)]);
    expect(states.map((s) => [s.occupied, s.lit])).toEqual([[true, true], [false, false], [false, false], [false, false], [false, false], [true, true]]);
    expect(states[5]!.carpet).toBe(EMPTY_CARPET);
    expect(states[5]!.sign).toEqual({ title: 'Ortak oda', subtitle: null });
    expect(states[4]!.sign).toEqual({ title: 'Boş oda', subtitle: null });
    expect(states[0]!.sign).toEqual({ title: 'Satış', subtitle: 'Başkan: Hale' });
  });

  it('its lamp is on, and only the desks someone sits at have their screens on; a department’s room, the hub and the beam’s desk are always on', () => {
    const held = heldRooms({ a: dep('a', 'Satış', 0), c: dep('c', 'Eski', 2, { status: 'closed', closedAt: 5 }) });
    expect(held).toEqual(new Set([0]));
    const seated = new Set([31, 40]);
    expect(darkRooms(LAYOUT.rooms, held, seated)).toEqual(new Set([1, 2, 3, 4]));
    const dark = darkDesks(LAYOUT.desks, held, seated);
    expect(dark.has(31)).toBe(false);
    expect(range(32, 36).every((seat) => dark.has(seat))).toBe(true);
    expect([0, ...range(1, 6), ...range(37, 44)].some((seat) => dark.has(seat))).toBe(false);
    expect(dark.size).toBe(36 - 6 - 1);
  });

  it('seats as the scene wraps them: a seat past this page’s 45 is the one spotFor draws', () => {
    expect([0, 31, 44, 45, 76].map(sceneSeat)).toEqual([0, 31, 44, 0, 31]);
    expect(roomStates(LAYOUT.rooms, {}, [person('n', 'Nur', 76)])[5]!.occupied).toBe(true);
  });
});

describe('roomTags (final review I2)', () => {
  it('one for each room a department holds — its name, the room’s colour — by the room’s outer wall, away from the hub, at its middle, just above the floor', () => {
    const tags = roomTags(LAYOUT.rooms, new Map([[0, 'Pazarlama'], [4, 'Çok uzun bir departman adı kırk karakter!']]), LAYOUT.depth / 2);
    expect(tags.map((t) => [t.room, t.name, t.colour])).toEqual([[0, 'Pazarlama', LAYOUT.rooms[0]!.carpet.color], [4, 'Çok uzun bir departman adı kırk karakter!', LAYOUT.rooms[4]!.carpet.color]]);
    const [north, south] = tags;
    const r0 = LAYOUT.rooms[0]!.rect;
    const r4 = LAYOUT.rooms[4]!.rect;
    expect(north!.position[0]).toBeCloseTo((r0.x1 + r0.x2) / 2);
    expect(south!.position[0]).toBeCloseTo((r4.x1 + r4.x2) / 2);
    // North rooms by z ≈ 0.6, south rooms by z ≈ 23.4: beyond the carpet, on the side away from the hub.
    expect(north!.position[2]).toBeCloseTo(0.6);
    expect(south!.position[2]).toBeCloseTo(LAYOUT.depth - 0.6);
    expect(north!.position[2]).toBeLessThan(LAYOUT.rooms[0]!.carpet.z1);
    expect(south!.position[2]).toBeGreaterThan(LAYOUT.rooms[4]!.carpet.z2);
    expect(tags.every((t) => t.position[1] > 0 && t.position[1] < 0.3)).toBe(true);
    expect(roomTags(LAYOUT.rooms, new Map(), LAYOUT.depth / 2)).toEqual([]);
  });
});
