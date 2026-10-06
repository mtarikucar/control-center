/** A tag on screen: centre and size in CSS pixels (y grows downwards). */
export interface TagBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * How far to lift each tag (px) so that none covers another. The tag nearest the camera (lowest on screen) keeps its
 * place; each one behind it is pushed up just enough to clear the tags already placed.
 */
export function layoutTags(boxes: TagBox[], gap: number): Record<string, number> {
  const order = [...boxes].sort((a, b) => b.y - a.y || a.id.localeCompare(b.id));
  const placed: Array<{ x: number; w: number; top: number; bottom: number }> = [];
  const raise: Record<string, number> = {};
  for (const b of order) {
    let top = b.y - b.h / 2;
    for (;;) {
      const hit = placed.filter((p) => Math.abs(p.x - b.x) < (p.w + b.w) / 2 + gap && top < p.bottom + gap && top + b.h > p.top - gap);
      if (hit.length === 0) break;
      top = Math.min(...hit.map((p) => p.top)) - gap - b.h;
    }
    placed.push({ x: b.x, w: b.w, top, bottom: top + b.h });
    raise[b.id] = b.y - b.h / 2 - top;
  }
  return raise;
}
