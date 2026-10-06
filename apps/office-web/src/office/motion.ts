import type { Pt } from './grid.ts';

export interface Step {
  path: Pt[];
  pos: Pt;
  heading: number;
  arrived: boolean;
}

/** Walks `speed * dt` metres along `path`. Heading follows the walking direction (models face +Z). */
export function stepAlong(path: Pt[], pos: Pt, heading: number, speed: number, dt: number): Step {
  let remaining = speed * dt;
  let p = pos;
  let h = heading;
  const rest = [...path];
  while (remaining > 0 && rest.length > 0) {
    const target = rest[0]!;
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1e-6) h = Math.atan2(dx, dz);
    if (dist <= remaining) {
      p = { x: target.x, z: target.z };
      remaining -= dist;
      rest.shift();
    } else {
      p = { x: p.x + (dx / dist) * remaining, z: p.z + (dz / dist) * remaining };
      remaining = 0;
    }
  }
  return { path: rest, pos: p, heading: h, arrived: rest.length === 0 };
}
