import { describe, expect, it } from 'vitest';
import { layoutTags, type TagBox } from './tagPlacement.ts';

const GAP = 4;
const box = (id: string, x: number, y: number, w = 80, h = 34): TagBox => ({ id, x, y, w, h });

function expectNoOverlap(boxes: TagBox[], raise: Record<string, number>): void {
  const placed = boxes.map((b) => ({ ...b, y: b.y - (raise[b.id] ?? 0) }));
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const [a, b] = [placed[i]!, placed[j]!];
      const apart = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 + GAP || Math.abs(a.y - b.y) >= (a.h + b.h) / 2 + GAP;
      expect(apart, `${a.id} and ${b.id} overlap`).toBe(true);
    }
  }
}

describe('layoutTags', () => {
  it('leaves tags that do not touch where they are', () => {
    expect(layoutTags([box('a', 100, 100), box('b', 300, 100), box('c', 100, 200)], GAP)).toEqual({ a: 0, b: 0, c: 0 });
  });

  it('keeps the tag nearest the camera (lowest on screen) and lifts the other just clear of it', () => {
    const raise = layoutTags([box('back', 120, 90), box('front', 100, 100)], GAP);
    expect(raise.front).toBe(0);
    // back's bottom must end GAP above front's top: 83 - 4 = 79, so its centre goes to 62: raised 28.
    expect(raise.back).toBe(28);
  });

  it('stacks a crowd at one place, one tag above the next, nearest at the bottom', () => {
    const boxes = [box('a', 100, 100), box('b', 104, 99), box('c', 96, 98), box('d', 100, 97)];
    const raise = layoutTags(boxes, GAP);
    expect(raise.a).toBe(0);
    expectNoOverlap(boxes, raise);
    const heights = boxes.map((b) => b.y - raise[b.id]!);
    for (let i = 1; i < heights.length; i += 1) expect(heights[i]!).toBeLessThan(heights[i - 1]!);
  });

  it('keeps going up when the first clear spot is taken by another tag', () => {
    const boxes = [box('a', 100, 200), box('b', 160, 199), box('c', 100, 198)];
    const raise = layoutTags(boxes, GAP);
    expect(raise.a).toBe(0);
    expectNoOverlap(boxes, raise);
    expect(raise.c).toBeGreaterThan(raise.b!);
  });

  it('lifts only what overlaps sideways too', () => {
    expect(layoutTags([box('a', 100, 100), box('b', 185, 95)], GAP)).toEqual({ a: 0, b: 0 });
  });

  it('review focus: untangles any crowd of eight', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let round = 0; round < 50; round += 1) {
      const boxes = Array.from({ length: 8 }, (_, i) => box(`t${i}`, 300 + rand() * 200, 300 + rand() * 120, 70 + rand() * 50, 34));
      expectNoOverlap(boxes, layoutTags(boxes, GAP));
    }
  });
});
