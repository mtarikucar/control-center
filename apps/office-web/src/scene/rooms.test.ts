import { describe, expect, it } from 'vitest';
import type { Department, Employee } from '@cc/shared';
import { LAYOUT } from '../office/layout.ts';
import { EMPTY_CARPET, roomStates, signText } from './rooms.ts';

const dep = (id: string, name: string, room: number | null, o: Partial<Department> = {}): Department => ({
  id, name, mission: 'm', scope: '', template: null, headId: null, status: 'open', createdAt: 1, closedAt: null, room, ...o,
});
const person = (id: string, name: string) => ({ id, name }) as Employee;

describe('signText (spec office rooms §4.2)', () => {
  it('names the department and its head; a headless one says so; an empty room says “Boş oda”', () => {
    expect(signText(dep('d', 'Pazarlama', 0), person('p', 'Pelin'))).toEqual({ title: 'Pazarlama', subtitle: 'Başkan: Pelin' });
    expect(signText(dep('d', 'Satış', 1), null)).toEqual({ title: 'Satış', subtitle: 'Başkan yok' });
    expect(signText(null, null)).toEqual({ title: 'Boş oda', subtitle: null });
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
