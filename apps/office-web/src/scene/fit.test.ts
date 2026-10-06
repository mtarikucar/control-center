import { describe, expect, it } from 'vitest';
import { Bone, BoxGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, Object3D, Skeleton, SkinnedMesh, Uint16BufferAttribute } from 'three';
import { boundsOf, fitToBox, fitToHeight } from './fit.ts';

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

  it('measures a Meshy-style rig at its rendered size, even when it is a fresh clone with stale bones', () => {
    // Meshy rig: an armature scaled 0.01, joints in centimetres, mesh vertices in metres (1.7 m tall);
    // the inverse bind matrix maps those metres to joint space, so the rendered figure is 1.7 m.
    const root = new Group();
    const armature = new Group();
    armature.scale.setScalar(0.01);
    root.add(armature);
    const geometry = new BoxGeometry(0.5, 1.7, 0.3);
    geometry.translate(0, 0.85, 0);
    const count = geometry.attributes.position!.count;
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(count * 4).fill(0), 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(Array.from({ length: count * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    const bone = new Bone();
    const mesh = new SkinnedMesh(geometry);
    armature.add(mesh, bone);
    root.updateMatrixWorld(true);
    mesh.bind(new Skeleton([bone], [new Matrix4().makeScale(10_000, 10_000, 10_000)]), mesh.matrixWorld);
    bone.matrixWorld.identity(); // a never-rendered clone
    const b = boundsOf(root);
    expect(b.max.y - b.min.y).toBeCloseTo(1.7, 3);
  });

describe('fitToBox', () => {
  it('scales each axis to the wanted size, base on the floor, centred (for models drawn with the wrong proportions)', () => {
    const fit = fitToBox({ min: { x: -1, y: 2, z: 0 }, max: { x: 1, y: 6, z: 1 } }, { w: 1, h: 2, d: 3 });
    expect(fit.scale).toEqual([0.5, 0.5, 3]);
    expect(fit.offset[0]).toBeCloseTo(0);
    expect(fit.offset[1]).toBeCloseTo(-1);
    expect(fit.offset[2]).toBeCloseTo(-1.5);
  });
});
});
