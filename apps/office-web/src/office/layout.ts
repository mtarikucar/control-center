import type { Zone } from './behavior.ts';
import { buildGrid, type Rect } from './grid.ts';

export interface Wall {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  height: number;
  kind: 'solid' | 'window' | 'glass' | 'low';
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
}

export interface Spot {
  x: number;
  z: number;
  rotY: number;
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
  seats: Spot[];
  coffeeSpots: Spot[];
  loungeSpots: Spot[];
  serverSpots: Spot[];
}

const PI = Math.PI;
const item = (assetId: string, x: number, z: number, rotY: number, w: number, d: number, h: number, color: string, extra: Partial<Placement> = {}): Placement => ({
  assetId, x, z, y: 0, rotY, w, d, h, color, blocks: true, ...extra,
});

// Open workspace: four columns of back-to-back desk pairs (row 0 faces south, row 1 faces north).
const DESK_XS = [3.5, 6.2, 8.9, 11.6];
const desks: Placement[] = [];
const seats: Spot[] = [];
for (const [row, deskZ, chairZ, rotY] of [[0, 9.6, 8.75, 0], [1, 10.4, 11.25, PI]] as const) {
  DESK_XS.forEach((x, col) => {
    desks.push(item('work_desk', x, deskZ, rotY, 1.5, 0.8, 0.75, '#d8a96a'));
    desks.push(item((row + col) % 2 === 0 ? 'desktop_monitor' : 'laptop', x, deskZ + (row === 0 ? 0.15 : -0.15), rotY + PI, 0.6, 0.25, 0.45, '#2d3138', { y: 0.75, blocks: false }));
    desks.push(item('ergonomic_chair', x, chairZ, rotY, 0.6, 0.6, 1.0, '#3a3f47', { blocks: false }));
    seats.push({ x, z: chairZ, rotY });
  });
}

export const LAYOUT: Layout = {
  width: 24,
  depth: 18,
  cell: 0.5,
  walls: [
    // Cutaway like the reference: the far walls (north, west) are full height, the two facing the camera are low.
    { x1: 0, z1: 0, x2: 24, z2: 0, height: 3, kind: 'window' },
    { x1: 0, z1: 0, x2: 0, z2: 18, height: 3, kind: 'solid' },
    { x1: 24, z1: 0, x2: 24, z2: 18, height: 0.5, kind: 'low' },
    { x1: 0, z1: 18, x2: 24, z2: 18, height: 0.5, kind: 'low' },
    // Server room (north-east) with a door at z 5.2–6.4.
    { x1: 19.5, z1: 0, x2: 19.5, z2: 5.2, height: 3, kind: 'solid' },
    { x1: 19.5, z1: 6.4, x2: 19.5, z2: 7, height: 3, kind: 'solid' },
    { x1: 19.5, z1: 7, x2: 24, z2: 7, height: 2.6, kind: 'glass' },
    // Glass meeting room (north) with a door at x 11.8–13.2.
    { x1: 9, z1: 0, x2: 9, z2: 6, height: 2.6, kind: 'glass' },
    { x1: 16, z1: 0, x2: 16, z2: 6, height: 2.6, kind: 'glass' },
    { x1: 9, z1: 6, x2: 11.8, z2: 6, height: 2.6, kind: 'glass' },
    { x1: 13.2, z1: 6, x2: 16, z2: 6, height: 2.6, kind: 'glass' },
  ],
  furniture: [
    ...desks,
    item('filing_pedestal', 13.2, 10.0, 0, 0.5, 0.6, 0.7, '#e7e2da'),
    item('meeting_table_chairs', 12.5, 3.0, 0, 3.2, 2.2, 1.0, '#c99a5b'),
    item('whiteboard', 12.5, 0.3, 0, 2.0, 0.1, 1.3, '#f5f5f2', { y: 0.8, blocks: false }),
    item('server_rack', 23.3, 1.1, -PI / 2, 0.7, 0.9, 2.0, '#23262c'),
    item('server_rack', 23.3, 2.5, -PI / 2, 0.7, 0.9, 2.0, '#23262c'),
    item('server_rack', 23.3, 3.9, -PI / 2, 0.7, 0.9, 2.0, '#23262c'),
    item('coffee_counter_sink', 22.9, 9.6, -PI / 2, 3.0, 0.9, 1.0, '#e9e4dc'),
    item('espresso_machine', 22.9, 8.9, -PI / 2, 0.5, 0.4, 0.45, '#454a52', { y: 1.0, blocks: false }),
    item('orange_bar_stool', 21.9, 8.6, PI / 2, 0.45, 0.45, 0.75, '#e07a3a'),
    item('orange_bar_stool', 21.9, 9.6, PI / 2, 0.45, 0.45, 0.75, '#e07a3a'),
    item('orange_bar_stool', 21.9, 10.6, PI / 2, 0.45, 0.45, 0.75, '#e07a3a'),
    item('teal_lounge_sofa', 3.2, 16.8, PI, 3.0, 1.1, 0.9, '#3d8a8f'),
    item('lounge_coffee_table', 3.2, 15.1, 0, 1.4, 0.8, 0.45, '#c9a06a'),
    item('floor_lamp', 0.9, 16.9, 0, 0.4, 0.4, 1.7, '#efe7d2'),
    item('reception_desk', 14.5, 16.3, PI, 2.6, 1.0, 1.1, '#d3a46a'),
    item('low_credenza', 19.2, 17.4, PI, 2.0, 0.5, 0.7, '#cfa36d'),
    item('geometric_wall_art', 23.85, 14.5, -PI / 2, 1.2, 0.1, 1.2, '#e3a35c', { y: 1.2, blocks: false }),
    item('bookshelf', 0.4, 6.0, PI / 2, 2.4, 0.5, 2.0, '#c99a5b'),
    item('large_plant_pot', 0.8, 1.2, 0, 0.6, 0.6, 1.3, '#5f9a4a'),
    item('large_plant_pot', 8.4, 6.8, 0, 0.6, 0.6, 1.3, '#5f9a4a'),
    item('large_plant_pot', 17.6, 7.6, 0, 0.6, 0.6, 1.3, '#5f9a4a'),
    item('large_plant_pot', 0.8, 12.2, 0, 0.6, 0.6, 1.3, '#5f9a4a'),
    item('large_plant_pot', 7.6, 17.3, 0, 0.6, 0.6, 1.3, '#5f9a4a'),
    item('large_plant_pot', 18.8, 12.6, 0, 0.6, 0.6, 1.3, '#5f9a4a'),
  ],
  carpets: [
    { x1: 0.6, z1: 13.4, x2: 6.8, z2: 17.6, color: '#eadfcd' },
    { x1: 9.6, z1: 0.8, x2: 15.4, z2: 5.6, color: '#3f7f86' },
    { x1: 12.2, z1: 14.6, x2: 16.8, z2: 17.6, color: '#dccdb4' },
  ],
  seats,
  coffeeSpots: [
    { x: 20.9, z: 8.6, rotY: PI / 2 },
    { x: 20.9, z: 9.6, rotY: PI / 2 },
    { x: 20.9, z: 10.6, rotY: PI / 2 },
  ],
  loungeSpots: [
    { x: 5.4, z: 14.6, rotY: -PI / 2 },
    { x: 1.4, z: 14.4, rotY: PI / 2 },
    { x: 5.4, z: 16.0, rotY: -PI / 2 },
  ],
  serverSpots: [
    { x: 21.8, z: 1.8, rotY: PI / 2 },
    { x: 21.8, z: 3.2, rotY: PI / 2 },
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

export function spotFor(layout: Layout, zone: Zone, index: number): Spot {
  const list = zone === 'desk' ? layout.seats : zone === 'coffee' ? layout.coffeeSpots : zone === 'lounge' ? layout.loungeSpots : layout.serverSpots;
  return list[((index % list.length) + list.length) % list.length]!;
}

const TAG_STEP = 0.45;

/**
 * Extra height for a character's tag at a shared place: the further from the camera (smaller x + z), the higher,
 * so tags of people standing together stack instead of covering each other. Desks are spread out: no lift.
 */
export function tagLift(layout: Layout, zone: Zone, index: number): number {
  if (zone === 'desk') return 0;
  const list = zone === 'coffee' ? layout.coffeeSpots : zone === 'lounge' ? layout.loungeSpots : layout.serverSpots;
  const spot = spotFor(layout, zone, index);
  const nearer = list.filter((s) => s.x + s.z > spot.x + spot.z).length;
  return nearer * TAG_STEP;
}
