import type { Zone } from './behavior.ts';
import { buildGrid, type Rect } from './grid.ts';

export interface Wall {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  height: number;
  /** `slats`: a wall clad in vertical oak slats (a feature wall or partition). */
  kind: 'solid' | 'window' | 'glass' | 'low' | 'slats';
}

/** w/d/h are the item's own size before rotation; (x, z) is its centre on the floor, y lifts it onto a surface. */
export interface Placement {
  assetId: string;
  x: number;
  z: number;
  y: number;
  rotY: number;
  w: number;
  d: number;
  h: number;
  color: string;
  blocks: boolean;
  /** A lamp: the strength of its warm light, which sits at `glowAt` of its height (0 = bottom, 1 = top). */
  glow?: number;
  glowAt?: number;
  /** Leaves that move a little in the air. */
  sway?: boolean;
}

export interface Spot {
  x: number;
  z: number;
  rotY: number;
  /** Where to sit once at the spot (a sofa, an armchair): the spot itself is the free floor just in front of it. */
  seat?: { x: number; z: number };
}

/** A desk's own things: monitors, keyboard, a mug. (x, z) is the desk's centre, rotY the way its person faces. */
export interface Desk {
  x: number;
  z: number;
  rotY: number;
  monitors: 1 | 2;
}

/** A framed picture on a wall: (x, y, z) is its centre, rotY the way it faces; `seed` picks the art. */
export interface Frame {
  x: number;
  y: number;
  z: number;
  rotY: number;
  w: number;
  h: number;
  seed: number;
}

export interface Carpet {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  color: string;
}

export interface Layout {
  width: number;
  depth: number;
  cell: number;
  walls: Wall[];
  furniture: Placement[];
  carpets: Carpet[];
  frames: Frame[];
  desks: Desk[];
  seats: Spot[];
  coffeeSpots: Spot[];
  loungeSpots: Spot[];
  serverSpots: Spot[];
}

const PI = Math.PI;
const item = (assetId: string, x: number, z: number, rotY: number, w: number, d: number, h: number, color: string, extra: Partial<Placement> = {}): Placement => ({
  assetId, x, z, y: 0, rotY, w, d, h, color, blocks: true, ...extra,
});
const decor = (assetId: string, x: number, y: number, z: number, rotY: number, w: number, d: number, h: number, color: string, extra: Partial<Placement> = {}) =>
  item(assetId, x, z, rotY, w, d, h, color, { y, blocks: false, ...extra });
const plant = (assetId: string, x: number, z: number, h: number, size = 0.6) => item(assetId, x, z, 0, size, size, h, '#5f9a4a', { sway: true });

// Two clusters of four desks like the reference: pairs back to back, a planter running along the join.
// Row 0 sits north of its desk facing south; row 1 sits south facing north.
const furniture: Placement[] = [];
const desks: Desk[] = [];
const rows: Spot[][] = [[], []];
function cluster(xs: number[], z0: number, dual: boolean[]) {
  xs.forEach((x, col) => {
    for (const row of [0, 1] as const) {
      const deskZ = row === 0 ? z0 : z0 + 0.8;
      const rotY = row === 0 ? 0 : PI;
      const chairZ = row === 0 ? deskZ - 0.85 : deskZ + 0.85;
      furniture.push(item('work_desk', x, deskZ, rotY, 1.4, 0.75, 0.75, '#d9b07a'));
      furniture.push(item('ergonomic_chair', x, chairZ, rotY, 0.6, 0.6, 1.0, '#3a3f47', { blocks: false }));
      desks.push({ x, z: deskZ, rotY, monitors: dual[col * 2 + row] ? 2 : 1 });
      rows[row]!.push({ x, z: chairZ, rotY });
      const s = row === 0 ? 1 : -1;
      if ((col + row) % 2 === 0) furniture.push(decor('desk_plant', x + s * 0.52, 0.75, deskZ - s * 0.18, 0, 0.2, 0.2, 0.26, '#6a9a4a', { sway: true }));
      else furniture.push(decor('desk_lamp', x + s * 0.56, 0.75, deskZ + s * 0.2, rotY + PI, 0.2, 0.2, 0.4, '#2d3138', { glow: 0.7, glowAt: 0.85 }));
    }
    furniture.push(decor('desk_planter', x, 0.75, z0 + 0.4, 0, 1.3, 0.32, 0.3, '#6a9a4a', { sway: true }));
  });
}
cluster([3.0, 4.5], 4.4, [true, false, false, true]);
cluster([8.6, 10.1], 6.6, [false, true, true, false]);
// Desk order: the four north-row seats first, so the first hires spread over both clusters.
const seats: Spot[] = [rows[0]![0]!, rows[0]![1]!, rows[0]![2]!, rows[0]![3]!, rows[1]![0]!, rows[1]![1]!, rows[1]![2]!, rows[1]![3]!];

furniture.push(
  // By the windows: plant shelves, big plants, ivy hanging in front of the glass.
  item('plant_shelf', 0.35, 1.9, PI / 2, 0.9, 0.4, 1.8, '#a6793f', { sway: true }),
  item('plant_shelf', 0.35, 7.4, PI / 2, 0.9, 0.4, 1.8, '#a6793f', { sway: true }),
  plant('large_plant_pot', 0.8, 0.8, 1.3),
  plant('snake_plant', 0.7, 4.6, 1.0, 0.5),
  plant('large_plant_pot', 7.3, 0.8, 1.3),
  decor('hanging_plant', 0.5, 2.0, 3.4, 0, 0.5, 0.5, 0.9, '#5f9a4a', { sway: true }),
  decor('hanging_plant', 0.5, 2.0, 5.8, 0, 0.5, 0.5, 0.9, '#5f9a4a', { sway: true }),
  decor('geometric_wall_art', 5.6, 1.3, 0.16, 0, 1.0, 0.08, 1.0, '#e3a35c'),

  // Glass meeting room (north, middle).
  item('meeting_table_chairs', 10.5, 2.1, 0, 3.0, 1.8, 1.0, '#c99a5b'),
  decor('whiteboard', 10.5, 0.9, 0.2, 0, 1.8, 0.1, 1.2, '#f5f5f2'),
  decor('pendant_lamp', 9.9, 2.2, 2.1, 0, 0.45, 0.45, 0.55, '#2d3138', { glow: 2.4, glowAt: 0.08 }),
  decor('pendant_lamp', 11.1, 2.2, 2.1, 0, 0.45, 0.45, 0.55, '#2d3138', { glow: 2.4, glowAt: 0.08 }),
  plant('large_plant_pot', 12.5, 3.7, 1.1, 0.5),

  // Server room (north-east corner).
  item('server_rack', 15.3, 0.75, 0, 0.7, 0.9, 2.0, '#23262c'),
  item('server_rack', 16.3, 0.75, 0, 0.7, 0.9, 2.0, '#23262c'),
  item('server_rack', 17.2, 0.75, 0, 0.7, 0.9, 2.0, '#23262c'),

  // Coffee bar against the server room's oak-clad south wall, facing the room (and the camera).
  item('coffee_counter_sink', 16.2, 5.25, 0, 3.0, 0.8, 1.0, '#e9e4dc'),
  decor('espresso_machine', 15.2, 1.0, 5.1, 0, 0.5, 0.4, 0.45, '#454a52'),
  decor('cafe_shelf', 16.6, 1.45, 4.68, 0, 1.1, 0.3, 0.62, '#c99a5b'),
  decor('orange_bar_stool', 15.3, 0, 5.95, 0, 0.45, 0.45, 0.75, '#e07a3a'),
  decor('orange_bar_stool', 16.2, 0, 5.95, 0, 0.45, 0.45, 0.75, '#e07a3a'),
  decor('orange_bar_stool', 17.1, 0, 5.95, 0, 0.45, 0.45, 0.75, '#e07a3a'),
  decor('pendant_lamp', 15.5, 2.25, 5.35, 0, 0.45, 0.45, 0.55, '#2d3138', { glow: 2.2, glowAt: 0.08 }),
  decor('pendant_lamp', 16.9, 2.25, 5.35, 0, 0.45, 0.45, 0.55, '#2d3138', { glow: 2.2, glowAt: 0.08 }),
  plant('large_plant_pot', 17.3, 7.4, 1.3),

  // Lounge (front, west): sofa, armchair, pouf, books and a reading lamp.
  item('bookshelf', 0.3, 10.9, PI / 2, 1.8, 0.45, 2.0, '#c99a5b'),
  item('teal_lounge_sofa', 3.0, 13.25, PI, 2.4, 1.0, 0.85, '#3d8a8f'),
  item('lounge_coffee_table', 3.0, 11.6, 0, 1.2, 0.7, 0.45, '#c9a06a'),
  item('armchair', 5.1, 11.9, -PI / 2, 0.95, 0.95, 0.85, '#e07a3a'),
  item('pouf', 1.4, 11.6, 0, 0.5, 0.5, 0.42, '#e07a3a'),
  item('floor_lamp', 0.75, 13.35, 0, 0.4, 0.4, 1.7, '#efe7d2', { glow: 1.8, glowAt: 0.88 }),
  plant('large_plant_pot', 6.7, 9.6, 1.3),
  plant('snake_plant', 6.1, 13.4, 1.0, 0.5),
  decor('wall_shelf', 0.16, 1.55, 12.9, PI / 2, 1.0, 0.25, 0.55, '#c99a5b'),

  // A reading corner between the desks and the lounge.
  item('armchair', 2.4, 8.1, PI / 2, 0.95, 0.95, 0.85, '#e07a3a'),
  item('pouf', 3.6, 8.2, 0, 0.5, 0.5, 0.42, '#2f7c83'),
  item('floor_lamp', 1.4, 8.95, 0, 0.4, 0.4, 1.7, '#efe7d2', { glow: 1.5, glowAt: 0.88 }),
  plant('fiddle_plant', 5.2, 8.8, 1.6, 0.6),

  // Reception (front, middle) behind a low oak slat partition, and a credenza by the coffee bar.
  item('reception_desk', 11.4, 12.0, PI, 2.6, 1.0, 1.1, '#d3a46a'),
  decor('table_lamp', 12.4, 1.1, 11.75, 0, 0.3, 0.3, 0.42, '#efe7d2', { glow: 1.4, glowAt: 0.75 }),
  item('low_credenza', 17.45, 10.6, -PI / 2, 1.8, 0.45, 0.7, '#cfa36d'),
  item('water_cooler', 17.45, 8.9, -PI / 2, 0.4, 0.4, 1.3, '#dfe9f3'),
  item('printer', 15.9, 13.45, PI, 0.7, 0.55, 1.0, '#e9e7e3'),
  item('coat_rack', 14.3, 13.45, 0, 0.5, 0.5, 1.8, '#a6793f'),
  plant('fiddle_plant', 13.2, 13.4, 1.6, 0.6),
  decor('wall_shelf', 6.9, 1.5, 0.17, 0, 1.0, 0.25, 0.55, '#c99a5b'),
  decor('table_lamp', 17.45, 0.7, 11.1, 0, 0.3, 0.3, 0.42, '#efe7d2', { glow: 1.2, glowAt: 0.75 }),
  plant('large_plant_pot', 8.8, 13.3, 1.2),
  plant('large_plant_pot', 13.9, 9.7, 1.3),
  plant('snake_plant', 17.3, 13.3, 1.0, 0.5),
);

export const LAYOUT: Layout = {
  width: 18,
  depth: 14,
  cell: 0.5,
  walls: [
    // Cutaway like the reference: the far walls (north, west) are full height, the two facing the camera are low.
    { x1: 0, z1: 0, x2: 18, z2: 0, height: 3.2, kind: 'solid' },
    { x1: 0, z1: 0, x2: 0, z2: 9, height: 3.2, kind: 'window' },
    { x1: 0, z1: 9, x2: 0, z2: 14, height: 3.2, kind: 'solid' },
    { x1: 18, z1: 0, x2: 18, z2: 14, height: 0.5, kind: 'low' },
    { x1: 0, z1: 14, x2: 18, z2: 14, height: 0.5, kind: 'low' },
    // Oak slats on the north wall by the desks.
    { x1: 2.4, z1: 0.14, x2: 4.8, z2: 0.14, height: 2.6, kind: 'slats' },
    // Glass meeting room with a door at x 9.9–11.1.
    { x1: 8, z1: 0, x2: 8, z2: 4.2, height: 2.6, kind: 'glass' },
    { x1: 13, z1: 0, x2: 13, z2: 4.2, height: 2.6, kind: 'glass' },
    { x1: 8, z1: 4.2, x2: 9.9, z2: 4.2, height: 2.6, kind: 'glass' },
    { x1: 11.1, z1: 4.2, x2: 13, z2: 4.2, height: 2.6, kind: 'glass' },
    // Server room: a door at z 2.9–4.1 in its west wall; its oak-clad south wall backs the coffee bar.
    { x1: 14.5, z1: 0, x2: 14.5, z2: 2.9, height: 3.2, kind: 'solid' },
    { x1: 14.5, z1: 4.1, x2: 14.5, z2: 4.5, height: 3.2, kind: 'solid' },
    { x1: 14.5, z1: 4.5, x2: 18, z2: 4.5, height: 2.6, kind: 'slats' },
    // The reception's low slat partition.
    { x1: 9.6, z1: 10.3, x2: 13.2, z2: 10.3, height: 1.3, kind: 'slats' },
  ],
  furniture,
  carpets: [
    { x1: 8.4, z1: 0.4, x2: 12.6, z2: 3.8, color: '#3f7f86' },
    { x1: 0.7, z1: 10.4, x2: 5.6, z2: 13.7, color: '#e8dcc6' },
    { x1: 9.8, z1: 11.0, x2: 13.4, z2: 13.6, color: '#dccdb4' },
    { x1: 1.2, z1: 7.2, x2: 4.4, z2: 9.3, color: '#cdb293' },
  ],
  frames: [
    { x: 1.5, y: 1.6, z: 0.15, rotY: 0, w: 0.7, h: 0.9, seed: 1 },
    { x: 7.5, y: 2.25, z: 0.15, rotY: 0, w: 0.6, h: 0.45, seed: 2 },
    { x: 0.15, y: 2.55, z: 11.6, rotY: PI / 2, w: 0.9, h: 0.55, seed: 3 },
    { x: 11.4, y: 0.95, z: 10.43, rotY: 0, w: 0.7, h: 0.38, seed: 4 },
    { x: 14.64, y: 1.6, z: 2.4, rotY: PI / 2, w: 0.6, h: 0.8, seed: 5 },
  ],
  desks,
  seats,
  // Half the desks wander to coffee and half to the lounge (behaviorOf), so each needs four places; anyone can be
  // in the server room, so it has one per desk.
  coffeeSpots: [
    { x: 15.0, z: 6.4, rotY: PI },
    { x: 15.8, z: 6.4, rotY: PI },
    { x: 16.6, z: 6.4, rotY: PI },
    { x: 17.4, z: 6.4, rotY: PI },
  ],
  loungeSpots: [
    { x: 2.5, z: 12.3, rotY: PI, seat: { x: 2.5, z: 13.05 } },
    { x: 4.2, z: 11.9, rotY: -PI / 2, seat: { x: 5.15, z: 11.9 } },
    { x: 3.5, z: 12.3, rotY: PI, seat: { x: 3.5, z: 13.05 } },
    { x: 1.4, z: 12.3, rotY: PI / 2, seat: { x: 1.4, z: 11.6 } },
  ],
  serverSpots: [
    { x: 15.3, z: 2.2, rotY: PI },
    { x: 16.0, z: 2.2, rotY: PI },
    { x: 16.7, z: 2.2, rotY: PI },
    { x: 17.4, z: 2.2, rotY: PI },
    { x: 15.3, z: 3.3, rotY: PI },
    { x: 16.0, z: 3.3, rotY: PI },
    { x: 16.7, z: 3.3, rotY: PI },
    { x: 17.4, z: 3.3, rotY: PI },
  ],
};

const WALL_MARGIN = 0.35;
const ITEM_MARGIN = 0.2;

export function obstaclesOf(layout: Layout): Rect[] {
  const rects: Rect[] = layout.walls.map((w) => ({
    x1: Math.min(w.x1, w.x2) - WALL_MARGIN,
    z1: Math.min(w.z1, w.z2) - WALL_MARGIN,
    x2: Math.max(w.x1, w.x2) + WALL_MARGIN,
    z2: Math.max(w.z1, w.z2) + WALL_MARGIN,
  }));
  for (const p of layout.furniture) {
    if (!p.blocks) continue;
    const quarter = Math.abs(Math.round(p.rotY / (PI / 2))) % 2 === 1;
    const w = quarter ? p.d : p.w;
    const d = quarter ? p.w : p.d;
    rects.push({ x1: p.x - w / 2 - ITEM_MARGIN, z1: p.z - d / 2 - ITEM_MARGIN, x2: p.x + w / 2 + ITEM_MARGIN, z2: p.z + d / 2 + ITEM_MARGIN });
  }
  return rects;
}

export const GRID = buildGrid(LAYOUT.width, LAYOUT.depth, LAYOUT.cell, obstaclesOf(LAYOUT));

/**
 * The employee at desk `deskIndex`'s place in `zone`. Wanderers alternate by desk (even → coffee, odd → lounge, see
 * behaviorOf), so those places take every other desk and no two employees ever share one.
 */
export function spotFor(layout: Layout, zone: Zone, deskIndex: number): Spot {
  const list = zone === 'desk' ? layout.seats : zone === 'coffee' ? layout.coffeeSpots : zone === 'lounge' ? layout.loungeSpots : layout.serverSpots;
  const index = zone === 'coffee' || zone === 'lounge' ? Math.floor(deskIndex / 2) : deskIndex;
  return list[((index % list.length) + list.length) % list.length]!;
}
