import { afterEach, describe, expect, it } from 'vitest';
import { COORDINATOR_SEAT, HUB_SEATS, ROOM_COUNT, SEAT_COUNT, roomOfSeat, roomSeats } from '@cc/shared';
import { Seating, seatFor } from '../src/seating.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

const taken = (...seats: number[]) => new Set(seats);
const held = (...rooms: number[]) => ({ held: new Set(rooms) });
const member = (room: number | null) => ({ kind: 'member' as const, room });
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** A 45-seat office on a clock that ticks once per write (hire order is creation order); rooms are set by hand. */
function office() {
  let clock = 0;
  const s = setup(SEAT_COUNT, () => (clock += 1));
  cleanups.push(s.cleanup);
  const rooms = new Map<string, number>();
  // A room someone is in is held, as an open department's (Departments.heldRooms); `held` adds rooms held by nobody here.
  const held = new Set<number>();
  const seating = new Seating({ roster: s.roster, events: s.events, roomOf: (id) => rooms.get(id) ?? null, heldRooms: () => new Set([...rooms.values(), ...held]) });
  const seatEvents = () =>
    s.events.list({ limit: 1000 }).filter((e) => e.event.type === 'seat.changed').map((e) => [s.roster.get(e.employeeId!).name, (e.event as { deskIndex: number }).deskIndex]);
  return { ...s, rooms, held, seating, seatEvents };
}

describe('the seats (spec office rooms §3)', () => {
  it('numbers them: the coordinator 0, room r 1 + 6r … 6 + 6r, the hub 37 … 44', () => {
    expect(SEAT_COUNT).toBe(45);
    expect(COORDINATOR_SEAT).toBe(0);
    expect(roomSeats(0)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(roomSeats(5)).toEqual([31, 32, 33, 34, 35, 36]);
    expect(HUB_SEATS).toEqual(range(37, 44));
    expect([0, 1, 6, 7, 36, 37, 44].map(roomOfSeat)).toEqual([null, 0, 0, 1, 5, null, null]);
  });

  it('lays out all 45 once: seat 0, the six rooms’ 1 … 36 in order, the hub’s 37 … 44 (the order seatFor and the scene rely on)', () => {
    expect(SEAT_COUNT).toBe(45);
    expect(ROOM_COUNT).toBe(6);
    const rooms = range(0, ROOM_COUNT - 1).flatMap((r) => roomSeats(r));
    expect(rooms).toEqual(range(1, 36));
    expect([COORDINATOR_SEAT, ...rooms, ...HUB_SEATS]).toEqual(range(0, SEAT_COUNT - 1));
  });
});

describe('seatFor', () => {
  it('the coordinator sits at 0 and nowhere else', () => {
    expect(seatFor({ kind: 'coordinator', room: null }, null, taken())).toBe(0);
    expect(seatFor({ kind: 'coordinator', room: 3 }, 20, taken(1))).toBe(0);
    expect(seatFor({ kind: 'coordinator', room: null }, null, taken(0))).toBeNull();
  });

  it('a department’s member takes its room’s first free seat; a full room sends them to the hub (a department has no size limit)', () => {
    expect(seatFor(member(2), null, taken())).toBe(13);
    expect(seatFor(member(2), null, taken(13, 14))).toBe(15);
    expect(seatFor(member(2), null, taken(...roomSeats(2)))).toBe(37);
    expect(seatFor(member(2), null, taken(...roomSeats(2), 37, 38))).toBe(39);
  });

  it('the centre sits at the hub; with the hub full, in the highest room no department holds, then in other departments’ rooms, the coordinator’s desk last; none free, none', () => {
    expect(seatFor(member(null), null, taken())).toBe(37);
    // Review I1: the 9th of the centre sits in room 5, not room 0 (the next department takes the lowest free room).
    expect(seatFor(member(null), null, taken(...HUB_SEATS))).toBe(31);
    expect(seatFor(member(null), null, taken(...HUB_SEATS, 31))).toBe(32);
    expect(seatFor(member(null), null, taken(...HUB_SEATS, ...roomSeats(5)))).toBe(25);
    expect(seatFor(member(null), null, taken(...HUB_SEATS), held(5, 4))).toBe(19);
    // Every room held: the departments' rooms, lowest first.
    expect(seatFor(member(null), null, taken(...HUB_SEATS), held(0, 1, 2, 3, 4, 5))).toBe(1);
    expect(seatFor(member(null), null, taken(...range(1, 44)))).toBe(0);
    expect(seatFor(member(null), null, taken(...range(1, 44)), held(0, 1, 2, 3, 4, 5))).toBe(0);
    expect(seatFor(member(null), null, taken(...range(0, 44)))).toBeNull();
  });

  it('a full room’s overflow with the hub full: a room nobody holds before another department’s', () => {
    expect(seatFor(member(2), null, taken(...roomSeats(2), ...HUB_SEATS), held(2, 5))).toBe(25);
    expect(seatFor(member(2), null, taken(...roomSeats(2), ...HUB_SEATS, ...range(19, 30), ...range(1, 6)), held(0, 2, 5))).toBe(7);
    expect(seatFor(member(2), null, taken(...roomSeats(2), ...HUB_SEATS, ...range(1, 30)), held(0, 2, 5))).toBe(31);
  });

  it('whoever may stay where they sit stays; someone in the wrong place moves to their own', () => {
    expect(seatFor(member(2), 15, taken())).toBe(15);
    expect(seatFor(member(null), 40, taken())).toBe(40);
    // A room's overflow at the hub goes into the room once a seat frees there; a centre person in a room goes to the hub.
    expect(seatFor(member(2), 38, taken(13))).toBe(14);
    expect(seatFor(member(null), 3, taken())).toBe(37);
    // With nowhere better the seat one has is kept: any room nobody holds is as good as another.
    expect(seatFor(member(null), 3, taken(...HUB_SEATS))).toBe(3);
    expect(seatFor(member(null), 3, taken(...HUB_SEATS), held(5))).toBe(3);
    // A new department: the old room is left for the new one.
    expect(seatFor(member(4), 2, taken())).toBe(25);
  });

  it('review I1: someone of the centre in a room a department now holds moves out as soon as a hub seat or a room nobody holds has room; until then they stay', () => {
    expect(seatFor(member(null), 3, taken(...HUB_SEATS), held(0))).toBe(31);
    expect(seatFor(member(null), 3, taken(...HUB_SEATS.slice(1)), held(0))).toBe(37);
    expect(seatFor(member(null), 3, taken(...HUB_SEATS, ...range(7, 36)), held(0))).toBe(3);
    // Another department's overflow likewise: its own room first, else out of the held room.
    expect(seatFor(member(2), 3, taken(...roomSeats(2), ...HUB_SEATS), held(0, 2))).toBe(31);
  });

  it('counts only the seats a smaller (test) office has, and gives them lowest first as an office of eight desks always did', () => {
    expect(seatFor(member(null), null, taken(0), { seatCount: 8 })).toBe(1);
    expect(seatFor(member(null), null, taken(0, 1), { seatCount: 8 })).toBe(2);
    expect(seatFor(member(null), null, taken(...range(0, 6)), { seatCount: 8 })).toBe(7);
    expect(seatFor(member(1), null, taken(...range(0, 6)), { seatCount: 8 })).toBe(7);
    expect(seatFor(member(1), null, taken(...range(0, 7)), { seatCount: 8 })).toBeNull();
    // A room a department holds still comes after one nobody holds.
    expect(seatFor(member(null), null, taken(0), { seatCount: 12, held: new Set([0]) })).toBe(7);
  });
});

describe('Seating', () => {
  it('seats a newcomer and walks someone whose department changed; a seat that stays sends nothing', () => {
    const t = office();
    const ada = t.roster.create({ name: 'Ada', role: 'r', deskIndex: t.seating.forHire(member(null))! });
    expect(ada.deskIndex).toBe(37);
    t.rooms.set(ada.id, 1);
    expect(t.seating.reseat(ada.id).deskIndex).toBe(7);
    expect(t.seating.reseat(ada.id).deskIndex).toBe(7);
    expect(t.seatEvents()).toEqual([['Ada', 7]]);
  });

  it('the coordinator’s desk is theirs: whoever sits there moves first', () => {
    const t = office();
    const can = t.roster.create({ name: 'Can', role: 'r', deskIndex: 0 });
    expect(t.seating.forHire({ kind: 'coordinator', room: null })).toBe(0);
    expect(t.roster.get(can.id).deskIndex).toBe(37);
    expect(t.seatEvents()).toEqual([['Can', 37]]);
  });

  it('review focus 1: an office of before (eight desks, the coordinator fourth) is reseated at its start, and a second time moves nobody', () => {
    const t = office();
    const names = ['Ada', 'Bora', 'Cem', 'Koordinatör', 'Deniz', 'Ece', 'Filiz', 'Gül'];
    const people = names.map((name) => t.roster.create({ name, role: 'r', kind: name === 'Koordinatör' ? 'coordinator' : 'member' }));
    expect(people.map((e) => e.deskIndex)).toEqual(range(0, 7));
    // Bora and Deniz are in room 0's department (a team adopted at the start), Ece in room 2's; the rest the centre.
    for (const [name, room] of [['Bora', 0], ['Deniz', 0], ['Ece', 2]] as const) t.rooms.set(people[names.indexOf(name)]!.id, room);
    expect(t.seating.reseatAll()).toBe(6);
    // Bora and Deniz may stay (their desks are room 0's seats); Ada leaves the coordinator's desk for the hub.
    expect(Object.fromEntries(t.roster.list().map((e) => [e.name, e.deskIndex]))).toEqual({ Koordinatör: 0, Ada: 37, Bora: 1, Cem: 38, Deniz: 4, Ece: 13, Filiz: 39, Gül: 40 });
    const sent = t.seatEvents().length;
    expect(sent).toBe(6);
    expect(t.seating.reseatAll()).toBe(0);
    expect(t.seatEvents()).toHaveLength(sent);
  });

  it('review (task 4): reseatAll is a cascade — a move frees a seat for someone already passed, so a second pass seats the earlier hired in their room; then nobody moves', () => {
    const t = office();
    // X (room 0, hired first) sits on room 1's seat 7; five of room 0 on 2 … 6; Y (the centre, hired later) on room 0's seat 1; the hub is empty.
    const x = t.roster.create({ name: 'X', role: 'r', deskIndex: 7 });
    const mates = range(2, 6).map((seat) => t.roster.create({ name: `Üye ${seat}`, role: 'r', deskIndex: seat }));
    const y = t.roster.create({ name: 'Y', role: 'r', deskIndex: 1 });
    for (const e of [x, ...mates]) t.rooms.set(e.id, 0);
    // The first pass sends X to the hub (room 0 is full) and Y off room 0's seat; only the second can seat X there.
    expect(t.seating.reseatAll()).toBe(2);
    expect(roomOfSeat(t.roster.get(x.id).deskIndex)).toBe(0);
    expect(HUB_SEATS).toContain(t.roster.get(y.id).deskIndex);
    expect(mates.map((e) => t.roster.get(e.id).deskIndex)).toEqual(range(2, 6));
    const sent = t.seatEvents().length;
    expect(t.seating.reseatAll()).toBe(0);
    expect(t.seatEvents()).toHaveLength(sent);
  });

  it('review I1: the centre past the hub sits in the highest room; once a department holds that room they move to the next one nobody holds, and a second pass moves nobody', () => {
    const t = office();
    t.roster.create({ name: 'Koordinatör', role: 'r', kind: 'coordinator' });
    for (const i of range(1, 8)) t.roster.create({ name: `Merkez ${i}`, role: 'r', deskIndex: t.seating.forHire(member(null))! });
    const ada = t.roster.create({ name: 'Ada', role: 'r', deskIndex: t.seating.forHire(member(null))! });
    expect(ada.deskIndex).toBe(31);
    expect(t.seating.reseatAll()).toBe(0);
    t.held.add(5);
    expect(t.seating.reseatAll()).toBe(1);
    expect(t.seatEvents()).toEqual([['Ada', 25]]);
    expect(t.seating.reseatAll()).toBe(0);
  });

  it('review focus 3: a department of seven — the room’s six, the seventh at the hub, nobody on another’s chair', () => {
    const t = office();
    const seats = range(1, 7).map((i) => t.roster.create({ name: `Kişi ${i}`, role: 'r', deskIndex: t.seating.forHire(member(4))! }).deskIndex);
    expect(seats).toEqual([...roomSeats(4), 37]);
  });

  it('a full office has no seat to give: the roster then refuses with “Ofis dolu”', () => {
    const t = office();
    for (const i of range(0, 44)) t.roster.create({ name: `K${i}`, role: 'r', deskIndex: i });
    expect(t.seating.forHire(member(null))).toBeNull();
    expect(() => t.roster.create({ name: 'Son', role: 'r' })).toThrow('Ofis dolu: 45 masanın hepsi dolu.');
  });
});
