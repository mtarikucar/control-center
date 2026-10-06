import { describe, expect, it } from 'vitest';
import { buildGrid, cellOf, findPath, isFreeAt } from './grid.ts';

// 10 × 6 m room, a wall around x = 5 (covering two cell columns) with a door between z = 2.5 and 3.5.
const grid = buildGrid(10, 6, 0.5, [
  { x1: 4.6, z1: 0, x2: 5.4, z2: 2.5 },
  { x1: 4.6, z1: 3.5, x2: 5.4, z2: 6 },
]);

describe('grid + A*', () => {
  it('marks cells inside obstacles as blocked', () => {
    expect(isFreeAt(grid, { x: 5, z: 1 })).toBe(false);
    expect(isFreeAt(grid, { x: 5, z: 3 })).toBe(true);
    expect(cellOf(grid, { x: 9.99, z: 0.01 })).toEqual([19, 0]);
    expect(cellOf(grid, { x: 50, z: -3 })).toEqual([19, 0]);
  });

  it('goes through the door and never through a blocked cell', () => {
    const path = findPath(grid, { x: 1, z: 1 }, { x: 9, z: 1 });
    expect(path.at(-1)).toEqual({ x: 9, z: 1 });
    expect(path.every((p) => isFreeAt(grid, p))).toBe(true);
    const pts = [{ x: 1, z: 1 }, ...path];
    let crossings = 0;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      if ((a.x - 5) * (b.x - 5) < 0) {
        crossings += 1;
        const z = a.z + ((5 - a.x) / (b.x - a.x)) * (b.z - a.z);
        expect(z).toBeGreaterThan(2.5);
        expect(z).toBeLessThan(3.5);
      }
    }
    expect(crossings).toBe(1);
  });

  it('returns just the goal for the same cell or an unreachable goal', () => {
    expect(findPath(grid, { x: 1, z: 1 }, { x: 1.1, z: 1.1 })).toEqual([{ x: 1.1, z: 1.1 }]);
    const sealed = buildGrid(4, 4, 0.5, [{ x1: 1.6, z1: 0, x2: 2.4, z2: 4 }]);
    expect(findPath(sealed, { x: 0.5, z: 0.5 }, { x: 3.5, z: 0.5 })).toEqual([{ x: 3.5, z: 0.5 }]);
  });

  it('starts from the nearest free cell when standing in a blocked one', () => {
    const path = findPath(grid, { x: 5, z: 1 }, { x: 1, z: 1 });
    expect(path.at(-1)).toEqual({ x: 1, z: 1 });
    expect(path.slice(0, -1).every((p) => isFreeAt(grid, p))).toBe(true);
  });
});
