import { LAYOUT, type Wall } from '../office/layout.ts';

const FRAME = '#2b2f36';
const WALL = '#f1ede6';

function WallMesh({ wall }: { wall: Wall }) {
  const dx = wall.x2 - wall.x1;
  const dz = wall.z2 - wall.z1;
  const len = Math.hypot(dx, dz);
  const rot = -Math.atan2(dz, dx);
  const cx = (wall.x1 + wall.x2) / 2;
  const cz = (wall.z1 + wall.z2) / 2;
  if (wall.kind === 'glass') {
    return (
      <group position={[cx, 0, cz]} rotation={[0, rot, 0]}>
        <mesh position={[0, wall.height / 2, 0]}>
          <boxGeometry args={[len, wall.height, 0.04]} />
          <meshStandardMaterial color="#bfe3ef" transparent opacity={0.22} />
        </mesh>
        <mesh position={[0, wall.height, 0]}>
          <boxGeometry args={[len, 0.08, 0.1]} />
          <meshStandardMaterial color={FRAME} />
        </mesh>
        <mesh position={[0, 0.04, 0]}>
          <boxGeometry args={[len, 0.08, 0.1]} />
          <meshStandardMaterial color={FRAME} />
        </mesh>
      </group>
    );
  }
  if (wall.kind === 'window') {
    const mullions = Math.max(1, Math.round(len / 1.5));
    return (
      <group position={[cx, 0, cz]} rotation={[0, rot, 0]}>
        <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
          <boxGeometry args={[len, 0.9, 0.25]} />
          <meshStandardMaterial color={WALL} />
        </mesh>
        <mesh position={[0, 1.9, 0]}>
          <boxGeometry args={[len, 2.0, 0.04]} />
          <meshStandardMaterial color="#a9d4ee" transparent opacity={0.35} />
        </mesh>
        <mesh position={[0, wall.height - 0.1, 0]} castShadow>
          <boxGeometry args={[len, 0.2, 0.25]} />
          <meshStandardMaterial color={WALL} />
        </mesh>
        {Array.from({ length: mullions + 1 }, (_, i) => (
          <mesh key={i} position={[-len / 2 + (i * len) / mullions, 1.9, 0]}>
            <boxGeometry args={[0.08, 2.0, 0.12]} />
            <meshStandardMaterial color={FRAME} />
          </mesh>
        ))}
      </group>
    );
  }
  return (
    <mesh position={[cx, wall.height / 2, cz]} rotation={[0, rot, 0]} castShadow receiveShadow>
      <boxGeometry args={[len + 0.2, wall.height, 0.2]} />
      <meshStandardMaterial color={wall.kind === 'low' ? '#9a958c' : WALL} />
    </mesh>
  );
}

export function Room() {
  return (
    <group>
      <mesh position={[LAYOUT.width / 2, -0.1, LAYOUT.depth / 2]} receiveShadow>
        <boxGeometry args={[LAYOUT.width + 0.4, 0.2, LAYOUT.depth + 0.4]} />
        <meshStandardMaterial color="#d5cfc5" />
      </mesh>
      {LAYOUT.carpets.map((c, i) => (
        <mesh key={i} position={[(c.x1 + c.x2) / 2, 0.012, (c.z1 + c.z2) / 2]} receiveShadow>
          <boxGeometry args={[c.x2 - c.x1, 0.024, c.z2 - c.z1]} />
          <meshStandardMaterial color={c.color} />
        </mesh>
      ))}
      {LAYOUT.walls.map((w, i) => (
        <WallMesh key={i} wall={w} />
      ))}
    </group>
  );
}
