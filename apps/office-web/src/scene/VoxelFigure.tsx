import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { Group } from 'three';
import type { ModelRole } from './CharacterModel.tsx';

const SHIRTS = ['#2f6fdf', '#5b7f45', '#e07a3a', '#283a6b', '#8a4fbf', '#c0392b', '#1f8a8a', '#7a5c3e'];

function hash(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/** Stand-in when no character model is available: a small voxel person that sits, walks and types. */
export function VoxelFigure({ seed, role, faded }: { seed: string; role: ModelRole; faded: boolean }) {
  const shirt = useMemo(() => SHIRTS[hash(seed) % SHIRTS.length]!, [seed]);
  const body = useRef<Group>(null);
  const seated = role === 'sit' || role === 'typing' || role === 'talkSeated' || role === 'sitDown';
  useFrame(({ clock }) => {
    const b = body.current;
    if (!b) return;
    const t = clock.getElapsedTime();
    b.position.y = (seated ? -0.35 : 0) + (role === 'walk' ? Math.abs(Math.sin(t * 8)) * 0.05 : 0);
    b.rotation.x = role === 'typing' ? Math.sin(t * 12) * 0.02 : 0;
  });
  const material = (color: string) => <meshStandardMaterial color={color} transparent={faded} opacity={faded ? 0.45 : 1} />;
  return (
    <group ref={body}>
      <mesh position={[-0.1, 0.4, seated ? 0.2 : 0]} castShadow>
        <boxGeometry args={[0.16, seated ? 0.3 : 0.8, seated ? 0.5 : 0.18]} />
        {material('#24272d')}
      </mesh>
      <mesh position={[0.1, 0.4, seated ? 0.2 : 0]} castShadow>
        <boxGeometry args={[0.16, seated ? 0.3 : 0.8, seated ? 0.5 : 0.18]} />
        {material('#24272d')}
      </mesh>
      <mesh position={[0, 1.1, 0]} castShadow>
        <boxGeometry args={[0.5, 0.6, 0.28]} />
        {material(shirt)}
      </mesh>
      <mesh position={[0, 1.6, 0]} castShadow>
        <boxGeometry args={[0.36, 0.36, 0.36]} />
        {material('#f0c39a')}
      </mesh>
      <mesh position={[0, 1.82, -0.02]} castShadow>
        <boxGeometry args={[0.4, 0.12, 0.4]} />
        {material('#2a1d17')}
      </mesh>
    </group>
  );
}
