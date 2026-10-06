import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group, Mesh, MeshBasicMaterial } from 'three';

const PUFFS = 7;
const RISE = 0.55;
const PERIOD = 2.4;

/** Wisps rising from a cup or a coffee machine: each puff rises, swells and fades, then starts again. */
export function Steam({ position }: { position: [number, number, number] }) {
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = clock.getElapsedTime();
    g.children.forEach((child, i) => {
      const k = ((t / PERIOD + i / PUFFS) % 1 + 1) % 1;
      const mesh = child as Mesh;
      mesh.position.set(Math.sin(t * 1.3 + i) * 0.03 * k, k * RISE, Math.cos(t + i * 2) * 0.03 * k);
      mesh.scale.setScalar(0.03 + k * 0.06);
      (mesh.material as MeshBasicMaterial).opacity = 0.35 * Math.sin(Math.PI * k);
    });
  });
  return (
    <group ref={group} position={position}>
      {Array.from({ length: PUFFS }, (_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[1, 8, 6]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
