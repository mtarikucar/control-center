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
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    const looked = new Set<number>();
    for (const w of LAYOUT.walls.filter((x) => x.faces)) {
      const label = `${w.x1},${w.z1} → ${w.x2},${w.z2}`;
      // `faces` must be a room's own centre (a typo'd point would still be "inward" for the check below), and the wall one of that room's edges.
      const room = LAYOUT.rooms.find(({ rect: r }) => near(w.faces!.x, (r.x1 + r.x2) / 2) && near(w.faces!.z, (r.z1 + r.z2) / 2));
      expect(room, `${label}: faces is no room's centre`).toBeDefined();
      const r = room!.rect;
      const along = near(w.z1, w.z2) ? [r.z1, r.z2].some((z) => near(w.z1, z)) && w.x1 >= r.x1 - 1e-9 && w.x2 <= r.x2 + 1e-9 : [r.x1, r.x2].some((x) => near(w.x1, x)) && w.z1 >= r.z1 - 1e-9 && w.z2 <= r.z2 + 1e-9;
      expect(along, `${label}: not on room ${room!.index}'s edge`).toBe(true);
      looked.add(room!.index);
      const f = frameOf(w, CENTRE);
      const n = inward(w);
      expect(n.x * (w.faces!.x - f.cx) + n.z * (w.faces!.z - f.cz), label).toBeGreaterThan(0);
    }
    expect([...looked].sort()).toEqual(LAYOUT.rooms.map((x) => x.index));
  });
});
