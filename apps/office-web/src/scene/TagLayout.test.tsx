import ReactThreeTestRenderer from '@react-three/test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { Group } from 'three';
import { TagLayout, registerTag } from './TagLayout.tsx';

// test-renderer drives React through act(); tell React this is a test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function tag(width = 80, height = 34): HTMLElement {
  const el = document.createElement('button');
  Object.defineProperty(el, 'offsetWidth', { value: width });
  Object.defineProperty(el, 'offsetHeight', { value: height });
  document.body.append(el);
  return el;
}
function at(x: number, y: number) {
  const g = new Group();
  g.position.set(x, y, 0);
  return { current: g };
}
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  document.body.innerHTML = '';
});

describe('TagLayout', () => {
  it('lifts the tag behind so it clears the one in front, every frame', async () => {
    const front = tag();
    const back = tag();
    cleanups.push(registerTag('front', at(0, 0), front), registerTag('back', at(0.05, 0.05), back));
    const r = await ReactThreeTestRenderer.create(<TagLayout />, { width: 800, height: 600 });
    await r.advanceFrames(40, 1 / 60);
    expect(front.style.transform).toBe('');
    expect(back.style.transform).toMatch(/translateY\(-\d/);
    await r.unmount();
  });

  it('a late clean-up of an old tag element does not drop the newer one for the same employee', async () => {
    const front = tag();
    const old = tag();
    const fresh = tag();
    cleanups.push(registerTag('front', at(0, 0), front));
    const dropOld = registerTag('back', at(0.05, 0.05), old);
    cleanups.push(registerTag('back', at(0.05, 0.05), fresh));
    dropOld();
    const r = await ReactThreeTestRenderer.create(<TagLayout />, { width: 800, height: 600 });
    await r.advanceFrames(40, 1 / 60);
    expect(fresh.style.transform).toMatch(/translateY\(-\d/);
    expect(old.style.transform).toBe('');
    await r.unmount();
  });
});
