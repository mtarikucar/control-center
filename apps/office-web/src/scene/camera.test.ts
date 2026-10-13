import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../office/layout.ts';
import { AZIMUTH, CAMERA_POSITION, MAX_ZOOM, clampTarget, keepInView, minZoom, panLimits, sceneOrigin, shadowExtent, startZoom } from './camera.ts';

// OrbitControls' azimuth: the angle around the vertical axis, 0 = looking from +z (south), π/2 = from +x (east).
const azimuthOf = ([x, , z]: readonly [number, number, number]) => Math.atan2(x, z);

describe('camera', () => {
  it('starts inside its turning limits', () => {
    const a = azimuthOf(CAMERA_POSITION);
    expect(a).toBeGreaterThanOrEqual(AZIMUTH.min);
    expect(a).toBeLessThanOrEqual(AZIMUTH.max);
  });

  it('review focus: only turns as far as the cut-away (low) south and east walls, never behind a full-height wall', () => {
    for (const a of [AZIMUTH.min, AZIMUTH.max]) {
      expect(Math.sin(a), 'camera east of the office').toBeGreaterThanOrEqual(-1e-9);
      expect(Math.cos(a), 'camera south of the office').toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('starts with the whole floor in view and zooms out a little beyond it, both from the floor’s size (42 and 22 for 18 × 14 m, as by hand)', () => {
    expect([startZoom(18, 14), minZoom(18, 14)]).toEqual([42, 22]);
    expect(startZoom(LAYOUT.width, LAYOUT.depth)).toBe(24);
    expect(minZoom(LAYOUT.width, LAYOUT.depth)).toBeLessThan(startZoom(LAYOUT.width, LAYOUT.depth));
    expect(MAX_ZOOM).toBe(160);
  });

  it('holds the view’s centre within the floor ± 1 m, where the floor really is: its world extents from sceneOrigin, not around the origin', () => {
    const { width, depth } = LAYOUT;
    const [ox, , oz] = sceneOrigin(width, depth);
    const limits = panLimits(width, depth);
    expect(limits.minX).toBeCloseTo(ox - 1, 9);
    expect(limits.maxX).toBeCloseTo(ox + width + 1, 9);
    expect(limits.minZ).toBeCloseTo(oz - 1, 9);
    expect(limits.maxZ).toBeCloseTo(oz + depth + 1, 9);
    // As by hand for 32 × 24 m: the floor's corner goes to (-16, -12) + 56 / 29 m, so x reaches -15.07 … 18.93 and z -11.07 … 14.93.
    expect([limits.minX, limits.maxX, limits.minZ, limits.maxZ].map((m) => Math.round(m * 100) / 100)).toEqual([-15.07, 18.93, -11.07, 14.93]);
    // The view starts at the origin, which is over the floor: a start is never pulled.
    expect(clampTarget({ x: 0, z: 0 }, limits)).toEqual({ x: 0, z: 0 });
  });

  it('stops dragging at the limits, the camera moving back with its target (each axis on its own)', () => {
    const limits = { minX: -15, maxX: 19, minZ: -11, maxZ: 15 };
    const c = { target: { x: 30, z: -2 }, object: { position: { x: 52, z: 20 } } };
    keepInView(c, limits);
    expect(c).toEqual({ target: { x: 19, z: -2 }, object: { position: { x: 41, z: 20 } } });
    keepInView(c, limits);
    expect(c.target).toEqual({ x: 19, z: -2 });
    const south = { target: { x: 4, z: 21 }, object: { position: { x: 26, z: 47 } } };
    keepInView(south, limits);
    expect(south).toEqual({ target: { x: 4, z: 15 }, object: { position: { x: 26, z: 41 } } });
    const north = { target: { x: -20, z: -30 }, object: { position: { x: 2, z: -4 } } };
    keepInView(north, limits);
    expect(north).toEqual({ target: { x: -15, z: -11 }, object: { position: { x: 7, z: 15 } } });
    expect(clampTarget({ x: -40, z: 40 }, limits)).toEqual({ x: -15, z: 15 });
  });

  it('sizes the scene from the floor: its middle near the origin, the sun’s shadow over all of it (as by hand for 18 × 14 m)', () => {
    const [x, y, z] = sceneOrigin(18, 14);
    expect(x).toBeCloseTo(-7.9, 1);
    expect(y).toBe(0);
    expect(z).toBeCloseTo(-5.9, 1);
    expect(shadowExtent(18, 14)).toBe(14);
    expect(shadowExtent(LAYOUT.width, LAYOUT.depth)).toBeGreaterThanOrEqual(Math.hypot(LAYOUT.width, LAYOUT.depth) / 2);
  });
});
