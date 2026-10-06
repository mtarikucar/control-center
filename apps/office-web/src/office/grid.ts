export interface Pt {
  x: number;
  z: number;
}

export interface Rect {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export interface Grid {
  cell: number;
  nx: number;
  nz: number;
  blocked: Uint8Array;
}

export function buildGrid(width: number, depth: number, cell: number, obstacles: Rect[]): Grid {
  const nx = Math.round(width / cell);
  const nz = Math.round(depth / cell);
  const blocked = new Uint8Array(nx * nz);
  for (let k = 0; k < nz; k += 1) {
    for (let i = 0; i < nx; i += 1) {
      const cx = (i + 0.5) * cell;
      const cz = (k + 0.5) * cell;
      if (obstacles.some((r) => cx > r.x1 && cx < r.x2 && cz > r.z1 && cz < r.z2)) blocked[k * nx + i] = 1;
    }
  }
  return { cell, nx, nz, blocked };
}

export function cellOf(g: Grid, p: Pt): [number, number] {
  const i = Math.min(g.nx - 1, Math.max(0, Math.floor(p.x / g.cell)));
  const k = Math.min(g.nz - 1, Math.max(0, Math.floor(p.z / g.cell)));
  return [i, k];
}

const free = (g: Grid, i: number, k: number) => i >= 0 && k >= 0 && i < g.nx && k < g.nz && g.blocked[k * g.nx + i] === 0;

export function isFreeAt(g: Grid, p: Pt): boolean {
  const [i, k] = cellOf(g, p);
  return free(g, i, k);
}

const centerOf = (g: Grid, i: number, k: number): Pt => ({ x: (i + 0.5) * g.cell, z: (k + 0.5) * g.cell });

function nearestFree(g: Grid, i0: number, k0: number): [number, number] | null {
  if (free(g, i0, k0)) return [i0, k0];
  const seen = new Uint8Array(g.nx * g.nz);
  const queue: Array<[number, number]> = [[i0, k0]];
  seen[k0 * g.nx + i0] = 1;
  while (queue.length > 0) {
    const [i, k] = queue.shift()!;
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di;
      const nk = k + dk;
      if (ni < 0 || nk < 0 || ni >= g.nx || nk >= g.nz || seen[nk * g.nx + ni]) continue;
      if (free(g, ni, nk)) return [ni, nk];
      seen[nk * g.nx + ni] = 1;
      queue.push([ni, nk]);
    }
  }
  return null;
}

/** A* over the grid (8-way, no corner cutting). Waypoints exclude the start and end exactly at `to`. */
export function findPath(g: Grid, from: Pt, target: Pt): Pt[] {
  const to: Pt = { x: target.x, z: target.z };
  const s0 = cellOf(g, from);
  const g0 = cellOf(g, to);
  const start = nearestFree(g, s0[0], s0[1]);
  const goal = nearestFree(g, g0[0], g0[1]);
  if (!start || !goal) return [to];
  const startIdx = start[1] * g.nx + start[0];
  const goalIdx = goal[1] * g.nx + goal[0];
  if (startIdx === goalIdx) return [to];

  const n = g.nx * g.nz;
  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const h = (idx: number) => {
    const dx = Math.abs((idx % g.nx) - goal[0]);
    const dz = Math.abs(Math.floor(idx / g.nx) - goal[1]);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  const open: Array<[number, number]> = [[h(startIdx), startIdx]];
  gScore[startIdx] = 0;

  while (open.length > 0) {
    let best = 0;
    for (let j = 1; j < open.length; j += 1) if (open[j]![0] < open[best]![0]) best = j;
    const [, current] = open.splice(best, 1)[0]!;
    if (current === goalIdx) break;
    if (closed[current]) continue;
    closed[current] = 1;
    const ci = current % g.nx;
    const ck = Math.floor(current / g.nx);
    for (let dk = -1; dk <= 1; dk += 1) {
      for (let di = -1; di <= 1; di += 1) {
        if (di === 0 && dk === 0) continue;
        const ni = ci + di;
        const nk = ck + dk;
        if (!free(g, ni, nk)) continue;
        if (di !== 0 && dk !== 0 && (!free(g, ci + di, ck) || !free(g, ci, ck + dk))) continue;
        const next = nk * g.nx + ni;
        const tentative = gScore[current]! + (di !== 0 && dk !== 0 ? Math.SQRT2 : 1);
        if (tentative < gScore[next]!) {
          gScore[next] = tentative;
          came[next] = current;
          open.push([tentative + h(next), next]);
        }
      }
    }
  }
  if (came[goalIdx] === -1) return [to];

  const cells: number[] = [];
  for (let c = goalIdx; c !== startIdx; c = came[c]!) cells.push(c);
  cells.reverse();
  // Keep only the corners of the route, then end exactly at the requested point.
  const pts = cells.map((c) => centerOf(g, c % g.nx, Math.floor(c / g.nx)));
  const corners: Pt[] = [];
  for (let j = 0; j < pts.length - 1; j += 1) {
    const prev = j === 0 ? centerOf(g, start[0], start[1]) : pts[j - 1]!;
    const here = pts[j]!;
    const next = pts[j + 1]!;
    const sameDirection = Math.sign(here.x - prev.x) === Math.sign(next.x - here.x) && Math.sign(here.z - prev.z) === Math.sign(next.z - here.z);
    if (!sameDirection) corners.push(here);
  }
  corners.push(to);
  return corners;
}
