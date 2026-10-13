import { describe, expect, it } from 'vitest';
import { LAYOUT, type Wall } from '../office/layout.ts';
import { frameOf } from './wallFrame.ts';

const CENTRE = { x: LAYOUT.width / 2, z: LAYOUT.depth / 2 };
/** The world direction a wall's inside face looks. */
const inward = (w: Wall) => {
  const f = frameOf(w, CENTRE);
  return { x: Math.sin(f.rot) * f.inside, z: Math.cos(f.rot) * f.inside };
};

describe('frameOf (spec office rooms §6)', () => {
  it('turns an outer wall’s inside to the floor’s middle', () => {
    expect(inward({ x1: 0, z1: 0, x2: 32, z2: 0, height: 3.2, kind: 'solid' }).z).toBeCloseTo(1);
    expect(inward({ x1: 0, z1: 7, x2: 0, z2: 17, height: 3.2, kind: 'window' }).x).toBeCloseTo(1);
  });

  it('turns a room’s own wall into the room, not to the floor’s middle: a south room’s north wall looks south', () => {
    const wall: Wall = { x1: 0, z1: 17, x2: 4.4, z2: 17, height: 2.6, kind: 'solid' };
    expect(inward(wall).z).toBeCloseTo(-1);
    expect(inward({ ...wall, faces: { x: 16 / 3, z: 20.5 } }).z).toBeCloseTo(1);
  });

  it('every wall of the plan that bounds a room looks into it', () => {
    for (const w of LAYOUT.walls.filter((x) => x.faces)) {
      const f = frameOf(w, CENTRE);
      const n = inward(w);
      expect(n.x * (w.faces!.x - f.cx) + n.z * (w.faces!.z - f.cz), `${w.x1},${w.z1} → ${w.x2},${w.z2}`).toBeGreaterThan(0);
    }
  });
});
