import { describe, expect, it } from 'vitest';
import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import { SEATED_HIPS, inPlace, onSeat, pickClip } from './clips.ts';

describe('clips', () => {
  it('falls back to a close clip when a role is missing', () => {
    expect(pickClip({ typing: 1, sit: 1, idle: 1 }, 'typing')).toBe('typing');
    expect(pickClip({ sit: 1, idle: 1 }, 'typing')).toBe('sit');
    expect(pickClip({ idle: 1 }, 'talkSeated')).toBe('idle');
    expect(pickClip({ idle: 1 }, 'walk')).toBe('idle');
    expect(pickClip({}, 'drink')).toBeNull();
  });

  it('keeps the hips in place horizontally for walking, keeps the bob and other tracks', () => {
    const hips = new VectorKeyframeTrack('Hips.position', [0, 1], [1, 2, 3, 5, 2.5, 9]);
    const spin = new QuaternionKeyframeTrack('Spine.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
    const clip = inPlace(new AnimationClip('walk', 1, [hips, spin]));
    expect(Array.from(clip.tracks[0]!.values)).toEqual([1, 2, 3, 1, 2.5, 3]);
    expect(clip.tracks[1]!.name).toBe('Spine.quaternion');
    expect(Array.from(clip.tracks[1]!.values)).toEqual(Array.from(spin.values));
    expect(Array.from(hips.values)).toEqual([1, 2, 3, 5, 2.5, 9]);
  });

  it('puts every seated clip on the same seat: hips pinned over the chair at one sitting height', () => {
    const rest = { x: 0, y: 79, z: -2.4 };
    // Meshy's sit idle drifts 18 cm sideways and 35 cm back; its typing clip sits centred and 9 cm higher.
    const sit = new VectorKeyframeTrack('Hips.position', [0, 1], [17.8, 44.7, -34.9, 17.7, 45.1, -34.9]);
    const typing = new VectorKeyframeTrack('Hips.position', [0, 1], [0.9, 53.4, -0.8, 0.9, 53.9, -0.2]);
    const target = rest.y * SEATED_HIPS;
    for (const track of [sit, typing]) {
      const v = Array.from(onSeat(new AnimationClip('c', 1, [track]), rest, false).tracks[0]!.values);
      [v[0], v[2], v[3], v[5]].forEach((n, k) => expect(n).toBeCloseTo([rest.x, rest.z, rest.x, rest.z][k]!));
      expect(v[1]).toBeCloseTo(target);
      // The small breathing motion stays.
      expect(v[4]! - v[1]!).toBeCloseTo(track.values[4]! - track.values[1]!);
    }
  });

  it('sits down straight onto the seat: from the standing height of its first frame down to the sitting height', () => {
    const rest = { x: 0, y: 79, z: -2.4 };
    const sitDown = new VectorKeyframeTrack('Hips.position', [0, 0.5, 1], [8.9, 76.8, -22.7, 10, 60, -40, 11.4, 45.5, -58.9]);
    const v = Array.from(onSeat(new AnimationClip('sitDown', 1, [sitDown]), rest, true).tracks[0]!.values);
    [v[0], v[2], v[6], v[8]].forEach((n, k) => expect(n).toBeCloseTo([rest.x, rest.z, rest.x, rest.z][k]!));
    expect(v[1]).toBeCloseTo(76.8);
    expect(v[7]).toBeCloseTo(rest.y * SEATED_HIPS);
    expect(v[4]).toBeLessThan(v[1]!);
    expect(v[4]).toBeGreaterThan(v[7]!);
  });
});
