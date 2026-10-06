import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { CanvasTexture, Color, Object3D, RepeatWrapping, SRGBColorSpace, type InstancedMesh } from 'three';
import { LAYOUT, type Desk } from '../office/layout.ts';

const SURFACE = 0.75;
const CODE_COLORS = ['#7ec8ff', '#ffd27a', '#ff8fa3', '#9be28f', '#c8a8ff', '#e8edf5'];
const MUGS = ['#f4f1ea', '#e07a3a', '#2f7c83', '#f4f1ea'];

/** A tall strip of made-up code; scrolling it upwards makes every screen look busy. */
function codeTexture(seed: number, background: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  let r = seed * 9301 + 49297;
  const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  if (ctx) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, 128, 512);
    for (let y = 6; y < 512; y += 9) {
      let x = 6 + Math.floor(rand() * 4) * 8;
      const words = 1 + Math.floor(rand() * 4);
      for (let w = 0; w < words && x < 120; w += 1) {
        const len = 8 + Math.floor(rand() * 28);
        ctx.fillStyle = CODE_COLORS[Math.floor(rand() * CODE_COLORS.length)]!;
        ctx.fillRect(x, y, Math.min(len, 122 - x), 4);
        x += len + 5;
      }
    }
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(1, 0.32);
  return t;
}

function Monitor({ x, screen }: { x: number; screen: CanvasTexture }) {
  return (
    <group position={[x, SURFACE, 0.1]}>
      <mesh position={[0, 0.02, 0]} castShadow>
        <boxGeometry args={[0.18, 0.02, 0.12]} />
        <meshStandardMaterial color="#2a2d33" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.12, 0.02]} castShadow>
        <boxGeometry args={[0.04, 0.2, 0.03]} />
        <meshStandardMaterial color="#2a2d33" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.34, 0]} castShadow>
        <boxGeometry args={[0.56, 0.34, 0.035]} />
        <meshStandardMaterial color="#1b1e23" roughness={0.45} />
      </mesh>
      {/* The screen faces the person (local −z). */}
      <mesh position={[0, 0.34, -0.019]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.52, 0.3]} />
        <meshBasicMaterial map={screen} color={[1.7, 1.7, 1.7]} toneMapped={false} />
      </mesh>
    </group>
  );
}

function DeskThings({ desk, index, screens }: { desk: Desk; index: number; screens: CanvasTexture[] }) {
  const screen = screens[index % screens.length]!;
  const mug = MUGS[index % MUGS.length]!;
  return (
    // Local +z is the way the person faces, i.e. towards the far edge of the desk.
    <group position={[desk.x, 0, desk.z]} rotation={[0, desk.rotY, 0]}>
      {desk.monitors === 2 ? (
        <>
          <Monitor x={-0.3} screen={screen} />
          <Monitor x={0.3} screen={screens[(index + 1) % screens.length]!} />
        </>
      ) : (
        <Monitor x={0} screen={screen} />
      )}
      <mesh position={[0, SURFACE + 0.012, -0.2]} castShadow receiveShadow>
        <boxGeometry args={[0.42, 0.022, 0.13]} />
        <meshStandardMaterial color="#e9e7e3" roughness={0.7} />
      </mesh>
      <mesh position={[0.29, SURFACE + 0.012, -0.2]} castShadow>
        <boxGeometry args={[0.06, 0.022, 0.1]} />
        <meshStandardMaterial color="#e9e7e3" roughness={0.7} />
      </mesh>
      <mesh position={[-0.47, SURFACE + 0.05, -0.2]} castShadow>
        <cylinderGeometry args={[0.04, 0.036, 0.1, 12]} />
        <meshStandardMaterial color={mug} roughness={0.5} />
      </mesh>
    </group>
  );
}

/** Monitors with code that keeps scrolling, keyboards, mice and mugs on every desk. */
export function DeskDressing() {
  const screens = useMemo(() => [codeTexture(1, '#0f1a2b'), codeTexture(2, '#141c26'), codeTexture(3, '#10233a')], []);
  useFrame((_, dt) => {
    screens.forEach((s, i) => {
      s.offset.y -= dt * (0.035 + i * 0.012);
    });
  });
  return (
    <group>
      {LAYOUT.desks.map((desk, i) => (
        <DeskThings key={i} desk={desk} index={i} screens={screens} />
      ))}
    </group>
  );
}

const LED_COLORS = [new Color('#59ff8a').multiplyScalar(4), new Color('#5ab8ff').multiplyScalar(4), new Color('#ffb347').multiplyScalar(4)];
const OFF = new Color('#1d2a22');

/** Rows of tiny lights on every server rack, blinking at random like the reference's racks. */
export function ServerLights() {
  const racks = useMemo(() => LAYOUT.furniture.filter((p) => p.assetId === 'server_rack'), []);
  const perRack = 24;
  const ref = useRef<InstancedMesh>(null);
  const state = useRef({ next: 0 });
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new Object3D();
    racks.forEach((rack, r) => {
      for (let k = 0; k < perRack; k += 1) {
        const col = k % 3;
        const row = Math.floor(k / 3);
        // The rack's front faces +z (rotY 0): lights sit just in front of it.
        o.position.set(rack.x - 0.18 + col * 0.18, 0.35 + row * 0.2, rack.z + rack.d / 2 + 0.01);
        o.updateMatrix();
        mesh.setMatrixAt(r * perRack + k, o.matrix);
        mesh.setColorAt(r * perRack + k, LED_COLORS[(r + k) % LED_COLORS.length]!);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [racks]);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    const t = clock.getElapsedTime();
    if (!mesh || t < state.current.next) return;
    state.current.next = t + 0.18;
    for (let i = 0; i < racks.length * perRack; i += 1) {
      if (Math.random() < 0.25) mesh.setColorAt(i, Math.random() < 0.8 ? LED_COLORS[i % LED_COLORS.length]! : OFF);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, racks.length * perRack]}>
      <boxGeometry args={[0.05, 0.025, 0.01]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}
