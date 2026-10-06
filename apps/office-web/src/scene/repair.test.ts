import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh } from 'three';
import { repairNormals } from './repair.ts';

describe('repairNormals', () => {
  it('gives a vertex with a zero-length normal a real one, so lighting never turns it into NaN', () => {
    const geometry = new BoxGeometry(1, 1, 1);
    const normals = geometry.getAttribute('normal');
    normals.setXYZ(3, 0, 0, 0);
    const root = new Group();
    root.add(new Mesh(geometry));
    expect(repairNormals(root)).toBe(1);
    const [x, y, z] = [normals.getX(3), normals.getY(3), normals.getZ(3)];
    expect(Math.hypot(x, y, z)).toBeCloseTo(1);
    expect(repairNormals(root)).toBe(0);
  });
});
