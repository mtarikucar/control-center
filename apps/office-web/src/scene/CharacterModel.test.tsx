import ReactThreeTestRenderer from '@react-three/test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnimationClip, Bone, BoxGeometry, Float32BufferAttribute, Group, Skeleton, SkinnedMesh, Uint16BufferAttribute, VectorKeyframeTrack, type Material, type Mesh, type Object3D } from 'three';
import type { CharacterAsset } from '../assets/manifest.ts';

// test-renderer drives React through act(); tell React this is a test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A tiny rig: one bone "Hips" driving a skinned box, plus a clip that moves Hips up over one second.
function rig(): Group {
  const root = new Group();
  const geometry = new BoxGeometry(0.4, 1.7, 0.3);
  const count = geometry.attributes.position!.count;
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(count * 4).fill(0), 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(Array.from({ length: count * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const hips = new Bone();
  hips.name = 'Hips';
  // Standing hips height 1: seated clips are pinned to SEATED_HIPS of it.
  hips.position.y = 1;
  const mesh = new SkinnedMesh(geometry);
  root.add(hips, mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new Skeleton([hips]));
  return root;
}
const sitClip = new AnimationClip('Armature|sit', 1, [new VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 0, 1, 0])]);
// useGLTF caches: the same array object comes back on every render, as drei does.
const loaded = [{ scene: rig(), animations: [] }, { scene: new Group(), animations: [sitClip] }];

vi.mock('@react-three/drei', async (importOriginal) => ({ ...(await importOriginal<object>()), useGLTF: () => loaded }));
const { CharacterModel } = await import('./CharacterModel.tsx');
const { SEATED_HIPS } = await import('./clips.ts');

const asset: CharacterAsset = { id: 'coder', kind: 'character', name: 'Kodcu', file: 'c/base.glb', height: 1.7, clips: { sit: 'c/sit.glb' } };

function hipsY(renderer: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>): number {
  const root = renderer.scene.children[0]!.instance as Object3D;
  return root.getObjectByName('Hips')!.position.y;
}

afterEach(() => vi.clearAllMocks());

describe('CharacterModel', () => {
  it('keeps the clip playing across re-renders that do not change the model', async () => {
    const renderer = await ReactThreeTestRenderer.create(<CharacterModel asset={asset} role="sit" faded={false} />);
    await renderer.advanceFrames(3, 0.1);
    const before = hipsY(renderer);
    expect(before).toBeGreaterThan(0);
    await renderer.update(<CharacterModel asset={asset} role="sit" faded />);
    await renderer.update(<CharacterModel asset={asset} role="sit" faded={false} />);
    await renderer.advanceFrames(3, 0.1);
    expect(hipsY(renderer)).toBeGreaterThan(before + 0.1);
    await renderer.unmount();
  });

  it('frees its own copies of the materials when it goes away, and leaves the shared model alone', async () => {
    const materialsOf = (o: Object3D) => {
      const out: Material[] = [];
      o.traverse((c) => {
        if ((c as Mesh).isMesh) out.push((c as Mesh).material as Material);
      });
      return out;
    };
    const renderer = await ReactThreeTestRenderer.create(<CharacterModel asset={asset} role="sit" faded={false} />);
    const copies = materialsOf(renderer.scene.children[0]!.instance as Object3D);
    const shared = materialsOf(loaded[0]!.scene);
    const disposed: Material[] = [];
    for (const m of [...copies, ...shared]) m.addEventListener('dispose', () => disposed.push(m));
    await renderer.unmount();
    expect(copies.length).toBeGreaterThan(0);
    expect(disposed).toEqual(copies);
  });

  it('sits down once and holds the seated pose; standing up plays the same motion backwards', async () => {
    const seat: CharacterAsset = { ...asset, clips: { sitDown: 'c/sitDown.glb' } };
    const renderer = await ReactThreeTestRenderer.create(<CharacterModel asset={seat} role="sitDown" faded={false} />);
    await renderer.advanceFrames(30, 0.1);
    const seated = hipsY(renderer);
    expect(seated).toBeCloseTo(SEATED_HIPS, 2);
    await renderer.advanceFrames(10, 0.1);
    expect(hipsY(renderer)).toBeCloseTo(seated, 3);
    await renderer.update(<CharacterModel asset={seat} role="standUp" faded={false} />);
    await renderer.advanceFrames(4, 0.1);
    expect(hipsY(renderer)).toBeLessThan(seated - 0.1);
    await renderer.unmount();
  });
});
