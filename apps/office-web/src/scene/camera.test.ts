import { describe, expect, it } from 'vitest';
import { AZIMUTH, CAMERA_POSITION } from './camera.ts';

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
});
