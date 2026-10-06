import { useAnimations, useGLTF } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import type { AnimationAction, AnimationClip, Group, Material, Mesh } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { assetUrl, type CharacterAsset, type ClipRole } from '../assets/manifest.ts';
import { inPlace, pickClip } from './clips.ts';
import { boundsOf, fitToHeight } from './fit.ts';

export function CharacterModel({ asset, role, faded }: { asset: CharacterAsset; role: ClipRole; faded: boolean }) {
  const roles = useMemo(() => Object.keys(asset.clips) as ClipRole[], [asset]);
  const urls = useMemo(() => [assetUrl(asset.file), ...roles.map((r) => assetUrl(asset.clips[r]!))], [asset, roles]);
  const loaded = useGLTF(urls);
  const [base, ...clipFiles] = loaded;

  const model = useMemo(() => {
    const copy = cloneSkinned(base!.scene);
    copy.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : (mesh.material as Material).clone();
    });
    return copy;
  }, [base]);
  const fit = useMemo(() => fitToHeight(boundsOf(model), asset.height), [model, asset.height]);

  const clips = useMemo(() => {
    const out: Partial<Record<ClipRole, AnimationClip>> = {};
    roles.forEach((r, i) => {
      const source = clipFiles[i]?.animations[0];
      if (!source) return;
      const clip = r === 'walk' ? inPlace(source) : source.clone();
      clip.name = r;
      out[r] = clip;
    });
    return out;
  }, [roles, clipFiles]);

  const root = useRef<Group>(null);
  const { actions } = useAnimations(Object.values(clips) as AnimationClip[], root);
  const current = useRef<ClipRole | null>(null);

  useEffect(() => {
    const target = pickClip(clips, role);
    if (!target || target === current.current) return;
    const next = actions[target] as AnimationAction | null | undefined;
    if (!next) return;
    const previous = current.current ? (actions[current.current] as AnimationAction | null | undefined) : null;
    next.reset().fadeIn(0.25).play();
    previous?.fadeOut(0.25);
    current.current = target;
  }, [role, actions, clips]);

  useEffect(() => {
    model.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        m.transparent = faded;
        m.opacity = faded ? 0.45 : 1;
        m.needsUpdate = true;
      }
    });
  }, [model, faded]);

  return (
    <group ref={root}>
      <primitive object={model} scale={fit.scale} position={fit.offset} />
    </group>
  );
}
