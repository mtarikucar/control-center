import { useGLTF } from '@react-three/drei';
import { Suspense, useEffect, useMemo } from 'react';
import type { Mesh } from 'three';
import { assetUrl, furnitureAsset } from '../assets/manifest.ts';
import { LAYOUT, type Placement } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { boundsOf, fitToHeight } from './fit.ts';

function VoxelBox({ p }: { p: Placement }) {
  return (
    <mesh position={[0, p.h / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={[p.w, p.h, p.d]} />
      <meshStandardMaterial color={p.color} />
    </mesh>
  );
}

function AssetModel({ url, height }: { url: string; height: number }) {
  const { scene } = useGLTF(url);
  const object = useMemo(() => scene.clone(true), [scene]);
  const fit = useMemo(() => fitToHeight(boundsOf(object), height), [object, height]);
  useEffect(() => {
    object.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }, [object]);
  return <primitive object={object} scale={fit.scale} position={fit.offset} />;
}

export function FurnitureLayer() {
  const manifest = useOffice((s) => s.manifest);
  return (
    <group>
      {LAYOUT.furniture.map((p, i) => {
        const asset = furnitureAsset(manifest, p.assetId);
        const fallback = <VoxelBox p={p} />;
        return (
          <group key={i} position={[p.x, p.y, p.z]} rotation={[0, p.rotY, 0]}>
            {asset ? (
              <ErrorBoundary fallback={fallback}>
                <Suspense fallback={fallback}>
                  <AssetModel url={assetUrl(asset.file)} height={p.h} />
                </Suspense>
              </ErrorBoundary>
            ) : (
              fallback
            )}
          </group>
        );
      })}
    </group>
  );
}
