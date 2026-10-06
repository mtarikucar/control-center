import type { BufferAttribute, Mesh, Object3D } from 'three';

/**
 * Models come from outside the office (assets/3d). A vertex with a zero-length normal makes the lighting NaN, and
 * bloom spreads one NaN pixel over the whole picture (a black screen). Give such vertices a normal pointing up.
 * Returns how many it fixed; idempotent, so shared (cached) geometry can be repaired by every instance.
 */
export function repairNormals(root: Object3D): number {
  let fixed = 0;
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const normals = mesh.geometry.getAttribute('normal') as BufferAttribute | undefined;
    if (!normals) return;
    let changed = false;
    for (let i = 0; i < normals.count; i += 1) {
      const x = normals.getX(i);
      const y = normals.getY(i);
      const z = normals.getZ(i);
      if (x * x + y * y + z * z > 1e-12 && Number.isFinite(x + y + z)) continue;
      normals.setXYZ(i, 0, 1, 0);
      fixed += 1;
      changed = true;
    }
    if (changed) normals.needsUpdate = true;
  });
  return fixed;
}
