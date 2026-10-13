import { COORDINATOR_SEAT, HUB_SEATS, ROOM_COUNT, roomSeats, type Employee } from '@cc/shared';
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
  /** The centre of the room this wall bounds: its inside face looks there (Room.tsx); absent: at the floor's middle. */
  faces?: { x: number; z: number };
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
  /** The bulb glows but casts no light: the rooms' many desk lamps and the coordinator's, whose light is the beam's (every point light costs every pixel). */
  bulbOnly?: boolean;
  /** Leaves that move a little in the air. */
  sway?: boolean;
  /** `box`: stretch the model to w × h × d (for models drawn with the wrong proportions); otherwise fit its height. */
  fit?: 'box';
  /** The department room it stands in: its lamp is off while the room is empty (FurnitureLayer). */
  room?: number;
}

export interface Spot {
  x: number;
  z: number;
  rotY: number;
  /**
   * Where to sit once at the spot (a sofa, an armchair): the spot itself is the free floor just in front of it.
   * `height` is the seat's surface (metres, measured from the model); a desk chair's is CHAIR_SEAT.
   */
  seat?: { x: number; z: number; height: number };
}

/** A desk's own things: monitors, keyboard, a mug. (x, z) is the desk's centre, rotY the way its person faces. */
export interface Desk {
  x: number;
  z: number;
  rotY: number;
  monitors: 1 | 2;
  /** The department room it stands in: its screens are off while the room is empty (DeskDressing). */
  room?: number;
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

/** A department room (spec office rooms §4): where it is, its door and sign on the hub's side, its carpet, its seats. */
export interface RoomGeometry {
  index: number;
  rect: { x1: number; z1: number; x2: number; z2: number };
  /** The gap in the hub-facing glass. */
  door: { x1: number; x2: number; z: number };
  /** The door sign's centre; rotY turns its front to the hub. */
  sign: { x: number; y: number; z: number; rotY: number };
  /** Its carpet, in its colour when a department works there (RoomsLayer). */
  carpet: Carpet;
  seats: number[];
}

export interface Layout {
  width: number;
  depth: number;
  cell: number;
  walls: Wall[];
  furniture: Placement[];
  carpets: Carpet[];
  frames: Frame[];
  /** Seat n's desk (deskIndex n). */
  desks: Desk[];
  /** Seat n's chair. */
  seats: Spot[];
  coffeeSpots: Spot[];
  loungeSpots: Spot[];
  serverSpots: Spot[];
  meetingSpots: Spot[];
  rooms: RoomGeometry[];
  /** Where the light beam comes down: the coordinator's desk. */
  beam: { x: number; z: number };
}

const PI = Math.PI;
/**
 * The kitchenette model carries its own hutch of shelves: its counter top is at 48% of the model's height (measured
 * from the model), so things that stand on the counter go there, not on top of the whole model.
 */
export const COUNTER_TOP = 0.48;
/** The desk chairs' seat height (measured from the model): the seated clips are set for it. */
export const CHAIR_SEAT = 0.5;
const KITCHEN_H = 2.0;
const item = (assetId: string, x: number, z: number, rotY: number, w: number, d: number, h: number, color: string, extra: Partial<Placement> = {}): Placement => ({
  assetId, x, z, y: 0, rotY, w, d, h, color, blocks: true, ...extra,
});
const decor = (assetId: string, x: number, y: number, z: number, rotY: number, w: number, d: number, h: number, color: string, extra: Partial<Placement> = {}) =>
  item(assetId, x, z, rotY, w, d, h, color, { y, blocks: false, ...extra });
const plant = (assetId: string, x: number, z: number, h: number, size = 0.6) => item(assetId, x, z, 0, size, size, h, '#5f9a4a', { sway: true });

const WIDTH = 32;
const DEPTH = 24;
const ROOM_W = WIDTH / 3;
/** The hub-facing glass: the north rooms' south wall and the south rooms' north wall. */
const NORTH_Z = 7;
const SOUTH_Z = 17;
const GLASS_H = 2.6;
const DOOR_W = 1.4;
/**
 * Where each column's doors start: 0.1 m before a cell line, so two cell columns stay walkable between the glass's
 * 0.35 m margins (the walkers' grid, obstaclesOf).
 */
const DOOR_X1 = [4.4, 15.4, 25.9];
/** The rooms' carpets when a department works there, one per room (an empty room's is dark grey: RoomsLayer). */
export const ROOM_COLORS = ['#3f7f86', '#c9783f', '#6b7fb0', '#7d9a55', '#b0605e', '#c9a94f'] as const;

const furniture: Placement[] = [];
const desks: Desk[] = [];
const seats: Spot[] = [];
const walls: Wall[] = [];
const rooms: RoomGeometry[] = [];
const frames: Frame[] = [];

/**
 * Desks back to back like the reference, a planter along the join: row 0 sits north of its desk facing south (the
 * camera), row 1 south facing north. `seatNos` numbers row 0 west to east, then row 1.
 */
function cluster(xs: number[], z0: number, seatNos: readonly number[], room?: number) {
  const tag = room === undefined ? {} : { room };
  let k = 0;
  for (const row of [0, 1] as const) {
    xs.forEach((x, col) => {
      const deskZ = row === 0 ? z0 : z0 + 0.8;
      const rotY = row === 0 ? 0 : PI;
      const chairZ = row === 0 ? deskZ - 0.85 : deskZ + 0.85;
      const seat = seatNos[k]!;
      k += 1;
      furniture.push(item('work_desk', x, deskZ, rotY, 1.4, 0.75, 0.75, '#d9b07a', tag));
      furniture.push(item('ergonomic_chair', x, chairZ, rotY, 0.6, 0.6, 1.0, '#3a3f47', { blocks: false, ...tag }));
      const s = row === 0 ? 1 : -1;
      if ((col + row) % 2 === 0) furniture.push(decor('desk_plant', x + s * 0.52, 0.75, deskZ - s * 0.18, 0, 0.2, 0.2, 0.26, '#6a9a4a', { sway: true, ...tag }));
      else furniture.push(decor('desk_lamp', x + s * 0.56, 0.75, deskZ + s * 0.2, rotY + PI, 0.2, 0.2, 0.4, '#2d3138', { glow: 0.7, glowAt: 0.85, bulbOnly: true, ...tag }));
      desks[seat] = { x, z: deskZ, rotY, monitors: (seat + col) % 3 === 0 ? 2 : 1, ...tag };
      seats[seat] = { x, z: chairZ, rotY };
    });
  }
  furniture.push(decor('desk_planter', xs[Math.floor(xs.length / 2)]!, 0.75, z0 + 0.4, 0, 1.33, 0.43, 0.34, '#6a9a4a', { sway: true, ...tag }));
}

// The six department rooms (spec office rooms §2): three north of the hub, three south, glass between them and towards the hub.
for (let r = 0; r < ROOM_COUNT; r += 1) {
  const north = r < 3;
  const x1 = (r % 3) * ROOM_W;
  const x2 = x1 + ROOM_W;
  const z1 = north ? 0 : SOUTH_Z;
  const z2 = north ? NORTH_Z : DEPTH;
  const cx = (x1 + x2) / 2;
  const centre = { x: cx, z: (z1 + z2) / 2 };
  const wallZ = north ? NORTH_Z : SOUTH_Z;
  const door = { x1: DOOR_X1[r % 3]!, x2: DOOR_X1[r % 3]! + DOOR_W, z: wallZ };
  const z0 = north ? 3.1 : 20.1;
  cluster([cx - 1.5, cx, cx + 1.5], z0, roomSeats(r), r);
  // The room's own light over its desks: off while it is empty.
  furniture.push(decor('pendant_lamp', cx, 2.2, z0 + 0.4, 0, 0.45, 0.45, 0.55, '#2d3138', { glow: 2.0, glowAt: 0.08, room: r }));
  // A picture on the north rooms' outer wall; the south rooms have only glass and a low wall, so a low credenza instead.
  if (north) frames.push({ x: cx + 3.4, y: 1.6, z: 0.15, rotY: 0, w: 0.8, h: 0.6, seed: r + 1 });
  else furniture.push(item('low_credenza', cx + 3.2, 23.4, PI, 1.8, 0.45, 0.7, '#cfa36d', { room: r }));
  walls.push({ x1, z1: wallZ, x2: door.x1, z2: wallZ, height: GLASS_H, kind: 'glass', faces: centre });
  walls.push({ x1: door.x2, z1: wallZ, x2, z2: wallZ, height: GLASS_H, kind: 'glass', faces: centre });
  if (r % 3 < 2) walls.push({ x1: x2, z1, x2, z2, height: GLASS_H, kind: 'glass', faces: centre });
  rooms.push({
    index: r,
    rect: { x1, z1, x2, z2 },
    door,
    sign: { x: (door.x1 + door.x2) / 2, y: 2.3, z: wallZ, rotY: north ? 0 : PI },
    carpet: { x1: cx - 3.0, z1: z0 - 1.7, x2: cx + 3.0, z2: z0 + 2.5, color: ROOM_COLORS[r]! },
    seats: roomSeats(r),
  });
}

// The coordinator's desk under the beam, facing south (the camera).
furniture.push(
  item('work_desk', 16, 12, 0, 1.4, 0.75, 0.75, '#d9b07a'),
  item('ergonomic_chair', 16, 11.15, 0, 0.6, 0.6, 1.0, '#3a3f47', { blocks: false }),
  // Its bulb only glows: the beam's spot light (scene/Beam) is the light over this desk, and the dozen that may cast are spent.
  decor('desk_lamp', 16.56, 0.75, 12.2, PI, 0.2, 0.2, 0.4, '#2d3138', { glow: 0.9, glowAt: 0.85, bulbOnly: true }),
);
desks[COORDINATOR_SEAT] = { x: 16, z: 12, rotY: 0, monitors: 2 };
seats[COORDINATOR_SEAT] = { x: 16, z: 11.15, rotY: 0 };
// The hub's eight desks, two rows on each side of the coordinator: north rows first, so the first hires spread over both.
cluster([10.5, 12.0], 11.6, [HUB_SEATS[0]!, HUB_SEATS[1]!, HUB_SEATS[4]!, HUB_SEATS[5]!]);
cluster([20.0, 21.5], 11.6, [HUB_SEATS[2]!, HUB_SEATS[3]!, HUB_SEATS[6]!, HUB_SEATS[7]!]);

furniture.push(
  // The meeting table, north of the coordinator.
  item('meeting_table_chairs', 16, 9.4, 0, 3.0, 1.8, 1.0, '#c99a5b'),
  decor('pendant_lamp', 15.4, 2.2, 9.4, 0, 0.45, 0.45, 0.55, '#2d3138', { glow: 2.4, glowAt: 0.08 }),
  decor('pendant_lamp', 16.6, 2.2, 9.4, 0, 0.45, 0.45, 0.55, '#2d3138', { glow: 2.4, glowAt: 0.08 }),

  // The coffee corner (west), its counter against the windows, facing the hub.
  item('coffee_counter_sink', 0.9, 9.4, PI / 2, 2.58, 1.02, KITCHEN_H, '#e9e4dc'),
  decor('espresso_machine', 0.85, COUNTER_TOP * KITCHEN_H, 9.9, PI / 2, 0.3, 0.58, 0.45, '#454a52'),
  decor('orange_bar_stool', 1.75, 0, 8.7, 0, 0.45, 0.45, 0.75, '#e07a3a'),
  decor('orange_bar_stool', 1.75, 0, 9.4, 0, 0.45, 0.45, 0.75, '#e07a3a'),
  decor('orange_bar_stool', 1.75, 0, 10.1, 0, 0.45, 0.45, 0.75, '#e07a3a'),
  decor('pendant_lamp', 1.2, 2.35, 8.8, 0, 0.45, 0.45, 0.55, '#2d3138', { glow: 2.2, glowAt: 0.08 }),
  decor('pendant_lamp', 1.2, 2.35, 10.0, 0, 0.45, 0.45, 0.55, '#2d3138', { glow: 2.2, glowAt: 0.08 }),
  item('water_cooler', 0.6, 11.6, PI / 2, 0.4, 0.4, 1.3, '#dfe9f3'),
  plant('large_plant_pot', 0.8, 7.8, 1.3),

  // The server corner (south-west), behind an oak slat partition; the racks face south (their lights are on +z).
  item('server_rack', 0.9, 14.25, 0, 1.03, 0.87, 1.9, '#23262c'),
  item('server_rack', 1.95, 14.25, 0, 1.03, 0.87, 1.9, '#23262c'),
  item('server_rack', 3.0, 14.25, 0, 1.03, 0.87, 1.9, '#23262c'),
  item('server_rack', 4.05, 14.25, 0, 1.03, 0.87, 1.9, '#23262c'),

  // The lounge (east): two sofas facing each other over two tables, armchairs, poufs and a reading lamp.
  item('teal_lounge_sofa', 28.6, 8.1, 0, 2.4, 1.0, 0.85, '#3d8a8f'),
  item('lounge_coffee_table', 28.6, 10.2, 0, 1.28, 1.11, 0.45, '#c9a06a'),
  item('teal_lounge_sofa', 28.6, 15.9, PI, 2.4, 1.0, 0.85, '#3d8a8f'),
  item('lounge_coffee_table', 28.6, 13.8, 0, 1.28, 1.11, 0.45, '#c9a06a'),
  item('armchair', 30.8, 10.2, -PI / 2, 0.95, 0.95, 0.85, '#e07a3a'),
  item('armchair', 30.8, 13.8, -PI / 2, 0.95, 0.95, 0.85, '#e07a3a'),
  item('pouf', 26.5, 9.85, 0, 0.5, 0.5, 0.42, '#e07a3a', { fit: 'box' }),
  item('pouf', 26.5, 10.6, 0, 0.5, 0.5, 0.42, '#2f7c83', { fit: 'box' }),
  item('pouf', 26.5, 13.4, 0, 0.5, 0.5, 0.42, '#2f7c83', { fit: 'box' }),
  item('pouf', 26.5, 14.15, 0, 0.5, 0.5, 0.42, '#e07a3a', { fit: 'box' }),
  item('low_credenza', 31.35, 12.0, -PI / 2, 1.8, 0.45, 0.7, '#cfa36d'),
  item('floor_lamp', 31.2, 8.0, 0, 0.4, 0.4, 1.7, '#efe7d2', { glow: 1.8, glowAt: 0.88 }),
  plant('fiddle_plant', 31.2, 16.1, 1.6, 0.6),

  // Plants by the hub's south doors.
  plant('snake_plant', 13.6, 16.1, 1.0, 0.5),
  plant('large_plant_pot', 18.6, 16.1, 1.3),
);

walls.push(
  // Cutaway like the reference: the far walls (north, west) are full height, the two facing the camera are low.
  { x1: 0, z1: 0, x2: WIDTH, z2: 0, height: 3.2, kind: 'solid' },
  { x1: 0, z1: 0, x2: 0, z2: NORTH_Z, height: 3.2, kind: 'window', faces: { x: ROOM_W / 2, z: NORTH_Z / 2 } },
  { x1: 0, z1: NORTH_Z, x2: 0, z2: SOUTH_Z, height: 3.2, kind: 'window' },
  { x1: 0, z1: SOUTH_Z, x2: 0, z2: DEPTH, height: 3.2, kind: 'window', faces: { x: ROOM_W / 2, z: (SOUTH_Z + DEPTH) / 2 } },
  { x1: WIDTH, z1: 0, x2: WIDTH, z2: DEPTH, height: 0.5, kind: 'low' },
  { x1: 0, z1: DEPTH, x2: WIDTH, z2: DEPTH, height: 0.5, kind: 'low' },
  // The server corner's partition.
  { x1: 0, z1: 13.4, x2: 4.8, z2: 13.4, height: 2.2, kind: 'slats' },
);

/** Standing spots in a grid, all facing one way. */
const grid = (xs: number[], zs: number[], rotY: number): Spot[] => xs.flatMap((x) => zs.map((z) => ({ x, z, rotY })));
/** A sofa's three places: the free floor in front, the seat behind it (seat height measured from the model: 0.425). */
const sofa = (x: number, seatZ: number, spotZ: number, rotY: number): Spot[] =>
  [-0.75, 0, 0.75].map((dx) => ({ x: x + dx, z: spotZ, rotY, seat: { x: x + dx, z: seatZ, height: 0.425 } }));

export const LAYOUT: Layout = {
  width: WIDTH,
  depth: DEPTH,
  cell: 0.5,
  walls,
  furniture,
  carpets: [
    { x1: 13.2, z1: 8.0, x2: 18.8, z2: 13.4, color: '#dccdb4' },
    { x1: 25.4, z1: 8.9, x2: 31.4, z2: 15.1, color: '#e8dcc6' },
    { x1: 1.9, z1: 7.8, x2: 4.5, z2: 11.0, color: '#cdb293' },
  ],
  frames,
  desks,
  seats,
  // Wanderers alternate between coffee and lounge along their order (wanderOrder), so 12 each keep 24 apart.
  coffeeSpots: grid([2.3, 3.1, 3.9], [8.2, 9.0, 9.8, 10.6], -PI / 2),
  loungeSpots: [
    ...sofa(28.6, 8.3, 9.05, 0),
    ...sofa(28.6, 15.7, 14.95, PI),
    // Seat heights measured from the models: armchair 0.41, pouf 0.42.
    { x: 29.95, z: 10.2, rotY: -PI / 2, seat: { x: 30.85, z: 10.2, height: 0.41 } },
    { x: 29.95, z: 13.8, rotY: -PI / 2, seat: { x: 30.85, z: 13.8, height: 0.41 } },
    { x: 25.85, z: 9.85, rotY: PI / 2, seat: { x: 26.5, z: 9.85, height: 0.42 } },
    { x: 25.85, z: 10.6, rotY: PI / 2, seat: { x: 26.5, z: 10.6, height: 0.42 } },
    { x: 25.85, z: 13.4, rotY: PI / 2, seat: { x: 26.5, z: 13.4, height: 0.42 } },
    { x: 25.85, z: 14.15, rotY: PI / 2, seat: { x: 26.5, z: 14.15, height: 0.42 } },
  ],
  // In front of the racks, facing them.
  serverSpots: grid([0.9, 1.6, 2.3, 3.0, 3.7, 4.4], [15.3, 16.1], PI),
  // Around the meeting table, facing it; the first (the planning coordinator's) on its north side, facing the camera.
  meetingSpots: [
    { x: 15.25, z: 8.05, rotY: 0 },
    { x: 16.75, z: 8.05, rotY: 0 },
    { x: 14.0, z: 9.4, rotY: PI / 2 },
    { x: 18.0, z: 9.4, rotY: -PI / 2 },
    { x: 15.25, z: 10.75, rotY: PI },
    { x: 16.75, z: 10.75, rotY: PI },
  ],
  rooms,
  beam: { x: 16, z: 12 },
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
 * Each person's place in the wandering order: the people at work by seat (then hire time). Coffee and lounge alternate
 * along it and each takes every other place, so up to 24 never share a spot whatever seats they have (spec office rooms
 * §2); a hire or a move may give someone another spot.
 */
export function wanderOrder(people: ReadonlyArray<Pick<Employee, 'id' | 'deskIndex' | 'createdAt'>>): Record<string, number> {
  const sorted = [...people].sort((a, b) => a.deskIndex - b.deskIndex || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  return Object.fromEntries(sorted.map((e, i) => [e.id, i]));
}

/**
 * Someone's place in `zone`: their own desk by seat number; elsewhere by their wandering `order` (coffee and lounge each
 * every other one, see behaviorOf). An unknown seat (an older server's) wraps onto a known one.
 */
export function spotFor(layout: Layout, zone: Zone, seat: number, order: number = seat): Spot {
  const list = zone === 'desk' ? layout.seats : zone === 'coffee' ? layout.coffeeSpots : zone === 'lounge' ? layout.loungeSpots : zone === 'meeting' ? layout.meetingSpots : layout.serverSpots;
  const index = zone === 'desk' ? seat : zone === 'coffee' || zone === 'lounge' ? Math.floor(order / 2) : order;
  return list[((index % list.length) + list.length) % list.length]!;
}
