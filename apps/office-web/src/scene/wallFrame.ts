import type { Wall } from '../office/layout.ts';

export interface WallFrame {
  len: number;
  /** +1 when the wall's local +z faces into its room, −1 otherwise. */
  inside: 1 | -1;
  cx: number;
  cz: number;
  rot: number;
}

/**
 * Where a wall stands and which of its faces is inside: the one looking at `wall.faces` (the centre of the room it
 * bounds, spec office rooms §6), else at `centre` (the floor's middle: right for the outer walls).
 */
export function frameOf(wall: Wall, centre: { x: number; z: number }): WallFrame {
  const dx = wall.x2 - wall.x1;
  const dz = wall.z2 - wall.z1;
  const rot = -Math.atan2(dz, dx);
  const cx = (wall.x1 + wall.x2) / 2;
  const cz = (wall.z1 + wall.z2) / 2;
  // Local +z in world space after rotating by `rot` about y.
  const nx = Math.sin(rot);
  const nz = Math.cos(rot);
  const towards = wall.faces ?? centre;
  const inside = nx * (towards.x - cx) + nz * (towards.z - cz) >= 0 ? 1 : -1;
  return { len: Math.hypot(dx, dz), inside, cx, cz, rot };
}
