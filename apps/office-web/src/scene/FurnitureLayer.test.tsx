import ReactThreeTestRenderer from '@react-three/test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import type { PointLight } from 'three';
import { EMPTY_MANIFEST } from '../assets/manifest.ts';
import { LAYOUT } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import { FurnitureLayer } from './FurnitureLayer.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => useOffice.setState({ departments: {} }));

describe('FurnitureLayer', () => {
  it('review focus 5: an empty room’s lamp is off, a working room’s on; a desk lamp has no light of its own', async () => {
    useOffice.setState({ manifest: EMPTY_MANIFEST, departments: { d: { id: 'd', name: 'Satış', mission: 'm', scope: '', template: null, headId: null, status: 'open', createdAt: 1, closedAt: null, room: 1 } } });
    const r = await ReactThreeTestRenderer.create(<FurnitureLayer />);
    const lights = r.scene.findAll((n) => n.type === 'PointLight').map((n) => n.instance as PointLight);
    const casting = LAYOUT.furniture.filter((p) => p.glow && !p.bulbOnly);
    expect(lights).toHaveLength(casting.length);
    // Every lamp outside the rooms, and room 1's pendant; the five empty rooms' pendants stay, at 0.
    expect(lights.filter((l) => l.intensity > 0)).toHaveLength(casting.filter((p) => p.room === undefined || p.room === 1).length);
    expect(lights.filter((l) => l.intensity === 0)).toHaveLength(5);
    await r.unmount();
  });
});
