import ReactThreeTestRenderer from '@react-three/test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnimationClip, Bone, BoxGeometry, Float32BufferAttribute, Group, Skeleton, SkinnedMesh, Uint16BufferAttribute, VectorKeyframeTrack, type Object3D } from 'three';
import type { CharacterAsset } from '../assets/manifest.ts';

// A tiny rig: one bone "Hips" driving a skinned box, plus a clip that moves Hips up over one second.
function rig(): Group {
  const root = new Group();
  const geometry = new BoxGeometry(0.4, 1.7, 0.3);
  const count = geometry.attributes.position!.count;
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(count * 4).fill(0), 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(Array.from({ length: count * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const hips = new Bone();
  hips.name = 'Hips';
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
});
