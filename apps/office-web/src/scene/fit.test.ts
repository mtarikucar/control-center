import { describe, expect, it } from 'vitest';
import { BoxGeometry, Mesh, Object3D } from 'three';
import { boundsOf, fitToHeight } from './fit.ts';

describe('fitToHeight', () => {
  it('scales to the wanted height and puts the base on the floor, centred', () => {
    const fit = fitToHeight({ min: { x: 1, y: -1, z: 2 }, max: { x: 3, y: 3, z: 4 } }, 2);
    expect(fit.scale).toBeCloseTo(0.5);
    expect(fit.offset[0]).toBeCloseTo(-1);
    expect(fit.offset[1]).toBeCloseTo(0.5);
    expect(fit.offset[2]).toBeCloseTo(-1.5);
  });

  it('leaves a flat model unscaled and reads bounds from an object', () => {
    expect(fitToHeight({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 0, z: 1 } }, 2).scale).toBe(1);
    const root = new Object3D();
    root.add(new Mesh(new BoxGeometry(2, 4, 6)));
    const b = boundsOf(root);
    expect(b.max.y - b.min.y).toBeCloseTo(4);
  });
});
