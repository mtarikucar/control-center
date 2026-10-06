import { AnimationClip, VectorKeyframeTrack } from 'three';
import type { ClipRole } from '../assets/manifest.ts';
import type { Activity } from '../office/behavior.ts';

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

export const roleFor = (activity: Activity, moving: boolean): ClipRole => (moving ? 'walk' : activity);
