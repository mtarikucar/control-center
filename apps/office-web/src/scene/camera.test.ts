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

  it('keeps the view’s centre over the floor: dragging stops at its edge, the camera moving back with its target', () => {
    const limits = panLimits(LAYOUT.width, LAYOUT.depth);
    expect(limits).toEqual({ x: 17, z: 13 });
    const c = { target: { x: 30, z: -2 }, object: { position: { x: 52, z: 20 } } };
    keepInView(c, limits);
    expect(c).toEqual({ target: { x: 17, z: -2 }, object: { position: { x: 39, z: 20 } } });
    keepInView(c, limits);
    expect(c.target).toEqual({ x: 17, z: -2 });
    expect(clampTarget({ x: -40, z: 40 }, limits)).toEqual({ x: -17, z: 13 });
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
