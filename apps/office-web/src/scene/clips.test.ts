import { describe, expect, it } from 'vitest';
import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import { inPlace, pickClip, roleFor } from './clips.ts';

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

  it('walks while moving, otherwise does the activity', () => {
    expect(roleFor('typing', true)).toBe('walk');
    expect(roleFor('drink', false)).toBe('drink');
  });
});
