/** Isometric view from the south-east, where the office's near walls are cut away (low). */
export const CAMERA_POSITION = [22, 26, 22] as const;

/**
 * How far the owner may turn the view (OrbitControls azimuth: 0 = from the south, π/2 = from the east). The north
 * and west walls are full height, so turning further would put a wall between the camera and the office.
 */
export const AZIMUTH = { min: 0, max: Math.PI / 2 } as const;

/** The closest the owner may zoom, pixels per metre: a desk fills the view. */
export const MAX_ZOOM = 160;

/** Pixels per metre at the start, so the whole floor is in view: 42 for the first 18 × 14 m office, scaled by the floor's size. */
export function startZoom(width: number, depth: number): number {
  return Math.round((42 * (18 + 14)) / (width + depth));
}

/** The farthest the owner may zoom out: a little beyond the whole floor (22 for 18 × 14 m, as before). */
export function minZoom(width: number, depth: number): number {
  return Math.round(startZoom(width, depth) * 0.53);
}

/**
 * Where the floor's corner (layout (0, 0)) goes: so its middle lands just off the origin, where the camera, light and
 * controls all aim, at origin + (nudge, 0, nudge) — towards the camera, so the far corner clears the top bar (a nudge
 * of 1.1 m for 18 × 14 m, as tuned by hand).
 */
export function sceneOrigin(width: number, depth: number): [number, number, number] {
  const nudge = (width + depth) / 29;
  return [-width / 2 + nudge, 0, -depth / 2 + nudge];
}

/** The box the view's centre may be dragged within, in world metres. */
export interface PanLimits {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Where the view's centre may be dragged: the floor's extents a step (1 m) beyond each side. The floor's middle is not
 * the world's origin (sceneOrigin nudges it towards the camera), so the box follows the floor, not the origin.
 */
export function panLimits(width: number, depth: number): PanLimits {
  const [x, , z] = sceneOrigin(width, depth);
  return { minX: x - 1, maxX: x + width + 1, minZ: z - 1, maxZ: z + depth + 1 };
}

/** A view centre kept within the limits. */
export function clampTarget(p: { x: number; z: number }, limits: PanLimits): { x: number; z: number } {
  return { x: Math.min(limits.maxX, Math.max(limits.minX, p.x)), z: Math.min(limits.maxZ, Math.max(limits.minZ, p.z)) };
}

/** What the owner drags: the controls' target and their camera. */
export interface Pannable {
  target: { x: number; z: number };
  object: { position: { x: number; z: number } };
}

/** Holds the view over the floor: the camera moves back with its target, so dragging stops at the edge without turning the view. */
export function keepInView(c: Pannable, limits: PanLimits): void {
  const next = clampTarget(c.target, limits);
  const dx = next.x - c.target.x;
  const dz = next.z - c.target.z;
  if (dx === 0 && dz === 0) return;
  c.target.x += dx;
  c.target.z += dz;
  c.object.position.x += dx;
  c.object.position.z += dz;
}

/** Half the sun's shadow box, metres: the floor's half-diagonal and a margin (14 for 18 × 14 m). */
export function shadowExtent(width: number, depth: number): number {
  return Math.ceil(Math.hypot(width, depth) / 2) + 2;
}
