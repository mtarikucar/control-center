import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Department, Employee } from '@cc/shared';
import { LAYOUT, type Desk, type RoomGeometry } from '../office/layout.ts';
import type { EmployeeView } from '../store/reducers.ts';
import { useOffice, type OfficeStore } from '../store/office.ts';

/** An empty room's carpet: dark grey, the room asleep (spec office rooms §4.2). */
export const EMPTY_CARPET = '#45474c';

export interface SignText {
  title: string;
  subtitle: string | null;
}

export interface RoomState {
  room: RoomGeometry;
  /** The open department working here; null: no department holds it. */
  department: Department | null;
  /** Someone sits at one of its desks: a department's people, or the centre's past the hub's eight (final review I1). */
  occupied: boolean;
  /** Its lamp is on: a department works here or someone sits here. */
  lit: boolean;
  /** The room's colour while a department holds it; dark grey otherwise. */
  carpet: string;
  sign: SignText;
}

/** Who the rooms need: someone at work, their name (a head's sign) and their seat. */
export type Seated = Pick<Employee, 'id' | 'name' | 'deskIndex'>;

/** The scene's seat for a deskIndex, wrapped as spotFor wraps it (a server with more seats than this page). */
export function sceneSeat(deskIndex: number): number {
  const n = LAYOUT.seats.length;
  return ((deskIndex % n) + n) % n;
}

/** What a door sign says: the department and its head; "Ortak oda" where only the centre's overflow sits; or "Boş oda". */
export function signText(department: Department | null, head: Pick<Employee, 'name'> | null, occupied = false): SignText {
  if (!department) return { title: occupied ? 'Ortak oda' : 'Boş oda', subtitle: null };
  return { title: department.name, subtitle: head ? `Başkan: ${head.name}` : 'Başkan yok' };
}

/** The rooms open departments hold. */
export function heldRooms(departments: Readonly<Record<string, Department>>): Set<number> {
  return new Set(Object.values(departments).flatMap((d) => (d.status === 'open' && typeof d.room === 'number' ? [d.room] : [])));
}

/** Each room as the scene draws it, from the open departments (by their room) and the people at work (pure). */
export function roomStates(rooms: readonly RoomGeometry[], departments: Readonly<Record<string, Department>>, people: readonly Seated[]): RoomState[] {
  const open = Object.values(departments).filter((d) => d.status === 'open');
  const seated = new Set(people.map((e) => sceneSeat(e.deskIndex)));
  return rooms.map((room) => {
    const department = open.find((d) => d.room === room.index) ?? null;
    const head = department?.headId ? (people.find((e) => e.id === department.headId) ?? null) : null;
    const occupied = room.seats.some((seat) => seated.has(seat));
    return { room, department, occupied, lit: department !== null || occupied, carpet: department ? room.carpet.color : EMPTY_CARPET, sign: signText(department, head, occupied) };
  });
}

/** The rooms whose lamp is off: no department holds them and nobody sits in them (FurnitureLayer). */
export function darkRooms(rooms: readonly RoomGeometry[], held: ReadonlySet<number>, seated: ReadonlySet<number>): Set<number> {
  return new Set(rooms.filter((r) => !held.has(r.index) && !r.seats.some((seat) => seated.has(seat))).map((r) => r.index));
}

/** The seats whose screens are off: a desk in a room no department holds, with nobody at it (DeskDressing). */
export function darkDesks(desks: readonly Desk[], held: ReadonlySet<number>, seated: ReadonlySet<number>): Set<number> {
  return new Set(desks.flatMap((d, seat) => (d.room !== undefined && !held.has(d.room) && !seated.has(seat) ? [seat] : [])));
}

const atWork = (views: Readonly<Record<string, EmployeeView>>) => Object.values(views).map((v) => v.employee).filter((e) => e.lifecycle !== 'archived');

// The selectors below return arrays of primitives: useShallow then keeps the same array while nobody is hired, let go,
// renamed or moved, so a streamed event re-renders no room, lamp or screen (a fresh array alone would never settle in zustand 5).

/** The people at work, flat (id, name, deskIndex, …). */
const seatedFlat = (s: OfficeStore): Array<string | number> => atWork(s.views).flatMap((e) => [e.id, e.name, e.deskIndex]);
/** The scene's seats someone at work sits at, in order. */
const seatsTaken = (s: OfficeStore): number[] => [...new Set(atWork(s.views).map((e) => sceneSeat(e.deskIndex)))].sort((a, b) => a - b);

/** The scene's seats someone sits at. */
export function useSeated(): ReadonlySet<number> {
  const seats = useOffice(useShallow(seatsTaken));
  return useMemo(() => new Set(seats), [seats]);
}

/** The rooms as they are now, from the store. */
export function useRoomStates(): RoomState[] {
  const departments = useOffice((s) => s.departments);
  const flat = useOffice(useShallow(seatedFlat));
  return useMemo(() => {
    const people: Seated[] = [];
    for (let i = 0; i < flat.length; i += 3) people.push({ id: flat[i] as string, name: flat[i + 1] as string, deskIndex: flat[i + 2] as number });
    return roomStates(LAYOUT.rooms, departments ?? {}, people);
  }, [departments, flat]);
}

/** The rooms nobody works in: their lamp is off (FurnitureLayer). */
export function useDarkRooms(): ReadonlySet<number> {
  const departments = useOffice((s) => s.departments);
  const seated = useSeated();
  return useMemo(() => darkRooms(LAYOUT.rooms, heldRooms(departments ?? {}), seated), [departments, seated]);
}

/** The desks whose screens are off (DeskDressing). */
export function useDarkDesks(): ReadonlySet<number> {
  const departments = useOffice((s) => s.departments);
  const seated = useSeated();
  return useMemo(() => darkDesks(LAYOUT.desks, heldRooms(departments ?? {}), seated), [departments, seated]);
}

/** A room's floor tag (RoomsLayer): the department holding it, in the room's colour, where it stands. */
export interface RoomTag {
  room: number;
  name: string;
  colour: string;
  position: [number, number, number];
}

/** How far in from the room's camera-side edge its tag stands, and how high: just above the floor. */
const TAG_INSET = 0.6;
const TAG_Y = 0.1;

/**
 * A tag for each room an open department holds, at the room's middle by its camera-side (south) edge, just above the
 * floor (pure): a seated person's tag rises up-screen, towards the room's north side, so this edge stays clear of the
 * room's own people (north rooms: the hub-side glass; south rooms: the low outer wall).
 */
export function roomTags(rooms: readonly RoomGeometry[], names: ReadonlyMap<number, string>): RoomTag[] {
  return rooms.flatMap((r) => {
    const name = names.get(r.index);
    if (name === undefined) return [];
    const { x1, x2, z2 } = r.rect;
    return [{ room: r.index, name, colour: r.carpet.color, position: [(x1 + x2) / 2, TAG_Y, z2 - TAG_INSET] }];
  });
}

/** The held rooms and their departments' names, flat (room, name, …): the only things a tag shows. */
const roomNamesFlat = (s: OfficeStore): Array<number | string> =>
  Object.values(s.departments ?? {}).flatMap((d) => (d.status === 'open' && typeof d.room === 'number' ? [d.room, d.name] : []));

/** The rooms' tags, re-made only when a department opens, closes, moves room or is renamed. */
export function useRoomTags(): RoomTag[] {
  const flat = useOffice(useShallow(roomNamesFlat));
  return useMemo(() => {
    const names = new Map<number, string>();
    for (let i = 0; i < flat.length; i += 2) names.set(flat[i] as number, flat[i + 1] as string);
    return roomTags(LAYOUT.rooms, names);
  }, [flat]);
}
