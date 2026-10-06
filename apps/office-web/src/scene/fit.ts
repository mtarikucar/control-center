import { Box3, type Object3D } from 'three';

interface Bounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

/** Uniform scale to `height` metres, base on the floor, centred on x/z. The source file's own scale is ignored. */
export function fitToHeight(b: Bounds, height: number): { scale: number; offset: [number, number, number] } {
  const sizeY = b.max.y - b.min.y;
  const scale = sizeY > 1e-6 ? height / sizeY : 1;
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  return { scale, offset: [-cx * scale, -b.min.y * scale, -cz * scale] };
}

/**
 * Bounds as rendered. World matrices are refreshed first: a freshly cloned rig still carries stale bone matrices, and
 * skinned meshes are measured through their bones (a Meshy rig's mesh node sits under a 0.01 armature while its
 * inverse bind matrices restore metres), so the mesh's own geometry box would be off by the armature's scale.
 */
export function boundsOf(object: Object3D): Bounds {
  object.updateMatrixWorld(true);
  const box = new Box3().setFromObject(object);
  return { min: box.min, max: box.max };
}
