/** Isometric view from the south-east, where the office's near walls are cut away (low). */
export const CAMERA_POSITION = [22, 26, 22] as const;
/** Pixels per metre at the start: the 18 × 14 m office fills a 1600-pixel-wide window. */
export const CAMERA_ZOOM = 42;

/**
 * How far the owner may turn the view (OrbitControls azimuth: 0 = from the south, π/2 = from the east). The north
 * and west walls are full height, so turning further would put a wall between the camera and the office.
 */
export const AZIMUTH = { min: 0, max: Math.PI / 2 } as const;
