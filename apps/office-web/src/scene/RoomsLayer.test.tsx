import ReactThreeTestRenderer from '@react-three/test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import type { Mesh, MeshStandardMaterial } from 'three';
import { LAYOUT } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import { EMPTY_CARPET } from './rooms.ts';
import { RoomsLayer } from './RoomsLayer.tsx';

// test-renderer drives React through act(); tell React this is a test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => useOffice.setState({ departments: {}, views: {} }));

describe('RoomsLayer', () => {
  it('lays each room’s carpet in its department’s colour, dark grey when empty, and hangs a sign over every door', async () => {
    useOffice.setState({ views: {}, departments: { d: { id: 'd', name: 'Pazarlama', mission: 'm', scope: '', template: null, headId: null, status: 'open', createdAt: 1, closedAt: null, room: 4 } } });
    const r = await ReactThreeTestRenderer.create(<RoomsLayer />);
    const colour = (i: number) => `#${((r.scene.findByProps({ name: `room-carpet-${i}` }).instance as Mesh).material as MeshStandardMaterial).color.getHexString()}`;
    expect(LAYOUT.rooms.map((x) => colour(x.index))).toEqual(LAYOUT.rooms.map((x) => (x.index === 4 ? x.carpet.color : EMPTY_CARPET)));
    expect(LAYOUT.rooms.map((x) => r.scene.findAllByProps({ name: `room-sign-${x.index}` }).length)).toEqual([1, 1, 1, 1, 1, 1]);
    await r.unmount();
  });
});
