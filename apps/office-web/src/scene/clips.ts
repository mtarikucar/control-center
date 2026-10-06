import { AnimationClip, VectorKeyframeTrack } from 'three';
import type { ClipRole } from '../assets/manifest.ts';

const FALLBACK: Record<ClipRole, ClipRole[]> = {
  typing: ['typing', 'sit', 'idle'],
  sit: ['sit', 'idle'],
  talkSeated: ['talkSeated', 'sit', 'idle'],
  idle: ['idle'],
  drink: ['drink', 'idle'],
  walk: ['walk', 'idle'],
  sitDown: ['sitDown', 'sit', 'idle'],
  talk: ['talk', 'idle'],
};

export function pickClip(available: Partial<Record<ClipRole, unknown>>, role: ClipRole): ClipRole | null {
  for (const candidate of FALLBACK[role]) if (available[candidate] !== undefined) return candidate;
  return null;
}

/** Walking clips may carry root motion; the scene moves the character itself, so pin the hips on x/z. */
export function inPlace(clip: AnimationClip): AnimationClip {
  const out = clip.clone();
  out.tracks = out.tracks.map((track) => {
    if (!(track instanceof VectorKeyframeTrack) || !/Hips\.position$/.test(track.name)) return track;
    const values = Array.from(track.values);
    const x0 = values[0] ?? 0;
    const z0 = values[2] ?? 0;
    for (let i = 0; i < values.length; i += 3) {
      values[i] = x0;
      values[i + 2] = z0;
    }
    return new VectorKeyframeTrack(track.name, Array.from(track.times), values);
  });
  return out;
}


/** Seated hips height as a share of the standing one: where Meshy's typing clip sits, the best fit for the chairs. */
export const SEATED_HIPS = 0.675;

/**
 * Meshy's seated clips disagree about where the seat is: the sit idle drifts 18 cm sideways and 35 cm back, talking
 * 13 cm the other way, typing sits centred and 9 cm higher, so switching between them made people slide on (or off)
 * their chairs. Pin the hips over the rest position on x/z and at one sitting height; a transition (sitting down)
 * keeps its first, standing height and lands on that same seat.
 */
export function onSeat(clip: AnimationClip, rest: { x: number; y: number; z: number }, transition: boolean): AnimationClip {
  const target = rest.y * SEATED_HIPS;
  const out = clip.clone();
  out.tracks = out.tracks.map((track) => {
    if (!(track instanceof VectorKeyframeTrack) || !/Hips\.position$/.test(track.name)) return track;
    const v = Array.from(track.values);
    const n = v.length / 3;
    const first = v[1] ?? target;
    const last = v[(n - 1) * 3 + 1] ?? target;
    for (let i = 0; i < n; i += 1) {
      v[i * 3] = rest.x;
      v[i * 3 + 2] = rest.z;
      const y = v[i * 3 + 1]!;
      if (!transition) v[i * 3 + 1] = y + (target - first);
      else v[i * 3 + 1] = Math.abs(first - last) < 1e-6 ? target : target + ((y - last) * (first - target)) / (first - last);
    }
    return new VectorKeyframeTrack(track.name, Array.from(track.times), v);
  });
  return out;
}
