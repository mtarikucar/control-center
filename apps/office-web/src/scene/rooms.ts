import { useMemo } from 'react';
import type { Department, Employee } from '@cc/shared';
import { LAYOUT, type RoomGeometry } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';

/** An empty room's carpet: dark grey, the room asleep (spec office rooms §4.2). */
export const EMPTY_CARPET = '#45474c';

export interface SignText {
  title: string;
  subtitle: string | null;
}

export interface RoomState {
  room: RoomGeometry;
  /** The open department working here; null: an empty room. */
  department: Department | null;
  /** A department works here: its carpet in its colour, its lamp lit, its screens on. */
  lit: boolean;
  carpet: string;
  sign: SignText;
}

/** What a door sign says: the department and its head, or "Boş oda". */
export function signText(department: Department | null, head: Employee | null): SignText {
  if (!department) return { title: 'Boş oda', subtitle: null };
  return { title: department.name, subtitle: head ? `Başkan: ${head.name}` : 'Başkan yok' };
}

/** Each room as the scene draws it, from the open departments (by their room) and the people at work (pure). */
export function roomStates(rooms: readonly RoomGeometry[], departments: Readonly<Record<string, Department>>, people: readonly Employee[]): RoomState[] {
  const open = Object.values(departments).filter((d) => d.status === 'open');
  return rooms.map((room) => {
    const department = open.find((d) => d.room === room.index) ?? null;
    const head = department?.headId ? (people.find((e) => e.id === department.headId) ?? null) : null;
    return { room, department, lit: department !== null, carpet: department ? room.carpet.color : EMPTY_CARPET, sign: signText(department, head) };
  });
}

/** The rooms as they are now, from the store. */
export function useRoomStates(): RoomState[] {
  const departments = useOffice((s) => s.departments);
  const views = useOffice((s) => s.views);
  return useMemo(
    () => roomStates(LAYOUT.rooms, departments ?? {}, Object.values(views).map((v) => v.employee).filter((e) => e.lifecycle !== 'archived')),
    [departments, views],
  );
}

/** The rooms nobody works in: their lamp and screens are off (FurnitureLayer, DeskDressing). */
export function useDarkRooms(): ReadonlySet<number> {
  const departments = useOffice((s) => s.departments);
  return useMemo(() => new Set(roomStates(LAYOUT.rooms, departments ?? {}, []).filter((r) => !r.lit).map((r) => r.room.index)), [departments]);
}
