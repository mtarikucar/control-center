import ReactThreeTestRenderer from '@react-three/test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import type { Mesh, MeshStandardMaterial } from 'three';
import type { Employee } from '@cc/shared';
import { LAYOUT } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import { EMPTY_CARPET, useRoomStates, type RoomState } from './rooms.ts';
import { RoomsLayer } from './RoomsLayer.tsx';

// test-renderer drives React through act(); tell React this is a test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => useOffice.setState({ departments: {}, views: {} }));

const person = (id: string, deskIndex: number): Employee => ({
  id, slug: id, name: id, role: 'r', model: 'haiku', characterId: 'coder', title: '', team: '', kind: 'member', reportsTo: null, deskIndex, sessionId: `s-${id}`, sessionStarted: true,
  lifecycle: 'idle', limitResetsAt: null, lastError: null, createdAt: 1,
});
const views = (...people: Employee[]) => Object.fromEntries(people.map((e) => [e.id, { employee: e, events: [], openTools: {}, idleSince: null, eventsLoaded: true }]));

describe('RoomsLayer', () => {
  it('lays each room’s carpet in its department’s colour, dark grey when empty, and hangs a sign over every door', async () => {
    useOffice.setState({ views: {}, departments: { d: { id: 'd', name: 'Pazarlama', mission: 'm', scope: '', template: null, headId: null, status: 'open', createdAt: 1, closedAt: null, room: 4 } } });
    const r = await ReactThreeTestRenderer.create(<RoomsLayer />);
    const colour = (i: number) => `#${((r.scene.findByProps({ name: `room-carpet-${i}` }).instance as Mesh).material as MeshStandardMaterial).color.getHexString()}`;
    expect(LAYOUT.rooms.map((x) => colour(x.index))).toEqual(LAYOUT.rooms.map((x) => (x.index === 4 ? x.carpet.color : EMPTY_CARPET)));
    expect(LAYOUT.rooms.map((x) => r.scene.findAllByProps({ name: `room-sign-${x.index}` }).length)).toEqual([1, 1, 1, 1, 1, 1]);
    await r.unmount();
  });

  it('final review I1: a room nobody holds where someone sits reads “Ortak oda” on its sign; when they leave, “Boş oda” again', async () => {
    let states: RoomState[] = [];
    function Probe() {
      states = useRoomStates();
      return null;
    }
    useOffice.setState({ views: views(person('nur', 31)), departments: {} });
    const r = await ReactThreeTestRenderer.create(<Probe />);
    expect(states[5]!.sign).toEqual({ title: 'Ortak oda', subtitle: null });
    expect(states[5]!.lit).toBe(true);
    await ReactThreeTestRenderer.act(async () => {
      useOffice.setState({ views: views(person('nur', 40)) });
    });
    expect(states[5]!.sign).toEqual({ title: 'Boş oda', subtitle: null });
    expect(states[5]!.lit).toBe(false);
    await r.unmount();
  });
});
