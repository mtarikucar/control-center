import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Color, type Group, type Mesh } from 'three';
import { assetUrl, furnitureAsset } from '../assets/manifest.ts';
import { LAYOUT, type Placement } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { boundsOf, fitToBox, fitToHeight } from './fit.ts';
import { PALETTE } from './palette.ts';
import { repairNormals } from './repair.ts';
import { useDarkRooms } from './rooms.ts';

function VoxelBox({ p }: { p: Placement }) {
  return (
    <mesh position={[0, p.h / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={[p.w, p.h, p.d]} />
      <meshStandardMaterial color={p.color} />
    </mesh>
  );
}

function AssetModel({ url, p }: { url: string; p: Placement }) {
  const { scene } = useGLTF(url);
  const object = useMemo(() => {
    repairNormals(scene);
    return scene.clone(true);
  }, [scene]);
  const fit = useMemo(() => {
    const bounds = boundsOf(object);
    return p.fit === 'box' ? fitToBox(bounds, p) : fitToHeight(bounds, p.h);
  }, [object, p]);
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

/** Leaves stirring in the air: a slow, slight tilt, each plant on its own beat. */
function Sway({ seed, children }: { seed: number; children: ReactNode }) {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.getElapsedTime() * 0.7 + seed * 1.7;
    g.rotation.x = Math.sin(t) * 0.018;
    g.rotation.z = Math.cos(t * 0.8) * 0.014;
  });
  return <group ref={ref}>{children}</group>;
}

const BULB = new Color(PALETTE.bulb).multiplyScalar(5);
const BULB_OFF = new Color('#3a3328');

/** A lamp's bulb glows (and blooms) and, unless it is a desk lamp in a room, lights its corner; a room's lamps are off while no department holds it and nobody sits there. */
function Glow({ p, off }: { p: Placement; off: boolean }) {
  const y = p.h * (p.glowAt ?? 0.5);
  return (
    <group position={[0, y, 0]}>
      <mesh>
        <sphereGeometry args={[0.07, 12, 8]} />
        <meshBasicMaterial color={off ? BULB_OFF : BULB} toneMapped={false} />
      </mesh>
      {/* Kept at 0 rather than removed: adding or taking away a light recompiles every material's shader. */}
      {p.bulbOnly ? null : <pointLight color={PALETTE.lampLight} intensity={off ? 0 : p.glow} distance={5} decay={1.6} />}
    </group>
  );
}

export function FurnitureLayer() {
  const manifest = useOffice((s) => s.manifest);
  const dark = useDarkRooms();
  return (
    <group>
      {LAYOUT.furniture.map((p, i) => {
        const asset = furnitureAsset(manifest, p.assetId);
        const fallback = <VoxelBox p={p} />;
        const model = asset ? (
          <ErrorBoundary fallback={fallback}>
            <Suspense fallback={fallback}>
              <AssetModel url={assetUrl(asset.file)} p={p} />
            </Suspense>
          </ErrorBoundary>
        ) : (
          fallback
        );
        return (
          <group key={i} position={[p.x, p.y, p.z]} rotation={[0, p.rotY, 0]}>
            {p.sway ? <Sway seed={i}>{model}</Sway> : model}
            {p.glow ? <Glow p={p} off={p.room !== undefined && dark.has(p.room)} /> : null}
          </group>
        );
      })}
    </group>
  );
}
