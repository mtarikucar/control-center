import { useFrame } from '@react-three/fiber';
import { useMemo, type RefObject } from 'react';
import { Vector3, type Group } from 'three';
import { layoutTags, type TagBox } from './tagPlacement.ts';

/** Where a character's tag floats above the floor, in metres. */
export const TAG_HEIGHT = 2.15;
const GAP = 4;

interface Entry {
  group: RefObject<Group | null>;
  el: HTMLElement;
  /** The lift currently shown, eased towards the layout's answer so tags glide instead of jumping. */
  shown: number;
}

const entries = new Map<string, Entry>();

/** Called by each character's tag element (a callback ref): the element, or null when it goes away. */
export function registerTag(id: string, group: RefObject<Group | null>, el: HTMLElement | null): void {
  if (el) entries.set(id, { group, el, shown: 0 });
  else entries.delete(id);
}

/**
 * Keeps the characters' tags from covering each other: every frame it projects each tag's anchor to the screen
 * and lifts the ones behind just clear of the ones in front (layoutTags). Works at any zoom, angle or crowd.
 */
export function TagLayout() {
  const p = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    const boxes: TagBox[] = [];
    for (const [id, e] of entries) {
      const g = e.group.current;
      if (!g || !e.el.isConnected) continue;
      g.getWorldPosition(p);
      p.y += TAG_HEIGHT;
      p.project(camera);
      boxes.push({ id, x: ((p.x + 1) / 2) * size.width, y: ((1 - p.y) / 2) * size.height, w: e.el.offsetWidth, h: e.el.offsetHeight });
    }
    const raise = layoutTags(boxes, GAP);
    for (const b of boxes) {
      const e = entries.get(b.id)!;
      const target = raise[b.id] ?? 0;
      e.shown = Math.abs(target - e.shown) < 0.5 ? target : e.shown + (target - e.shown) * 0.3;
      e.el.style.transform = e.shown > 0 ? `translateY(${-e.shown}px)` : '';
    }
  });
  return null;
}
