import { useTexture } from '@react-three/drei';
import { Suspense, useLayoutEffect, useMemo, useRef } from 'react';
import { Object3D, SRGBColorSpace, type InstancedMesh, type Texture } from 'three';
import { LAYOUT, type Wall } from '../office/layout.ts';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { PALETTE } from './palette.ts';
import { ReflectiveFloor } from './ReflectiveFloor.tsx';

const T = 0.25; // wall thickness
const CITY_URL = '/assets3d/backdrop/city.jpg';
const CENTER = { x: LAYOUT.width / 2, z: LAYOUT.depth / 2 };

interface Frame {
  len: number;
  /** +1 when the wall's local +z faces into the room, −1 otherwise. */
  inside: 1 | -1;
}

function frameOf(wall: Wall): Frame & { cx: number; cz: number; rot: number } {
  const dx = wall.x2 - wall.x1;
  const dz = wall.z2 - wall.z1;
  const rot = -Math.atan2(dz, dx);
  const cx = (wall.x1 + wall.x2) / 2;
  const cz = (wall.z1 + wall.z2) / 2;
  // Local +z in world space after rotating by `rot` about y.
  const nx = Math.sin(rot);
  const nz = Math.cos(rot);
  const inside = nx * (CENTER.x - cx) + nz * (CENTER.z - cz) >= 0 ? 1 : -1;
  return { len: Math.hypot(dx, dz), inside, cx, cz, rot };
}

const box = (w: number, h: number, d: number) => <boxGeometry args={[w, h, d]} />;
const paint = (color: string, extra: Record<string, unknown> = {}) => <meshStandardMaterial color={color} roughness={0.85} {...extra} />;

function SolidWall({ wall, f }: { wall: Wall; f: Frame }) {
  return (
    <>
      <mesh position={[0, wall.height / 2, 0]} castShadow receiveShadow>
        {box(f.len + T, wall.height, T)}
        {paint(PALETTE.wall)}
      </mesh>
      <mesh position={[0, 0.06, f.inside * (T / 2 + 0.012)]} receiveShadow>
        {box(f.len, 0.12, 0.024)}
        {paint(PALETTE.baseboard)}
      </mesh>
    </>
  );
}

function LowWall({ wall, f }: { wall: Wall; f: Frame }) {
  return (
    <>
      <mesh position={[0, wall.height / 2, 0]} castShadow receiveShadow>
        {box(f.len + T, wall.height, T)}
        {paint(PALETTE.wall)}
      </mesh>
      <mesh position={[0, wall.height + 0.02, 0]} castShadow>
        {box(f.len + T + 0.04, 0.04, T + 0.04)}
        {paint(PALETTE.wallShade)}
      </mesh>
    </>
  );
}

// Glass stays slightly rough: a near-mirror highlight overflows the half-float frame buffer and bloom spreads it
// over the whole picture (a black screen when zoomed in).
function GlassWall({ wall, f }: { wall: Wall; f: Frame }) {
  const posts = Math.max(1, Math.round(f.len / 1.2));
  return (
    <>
      <mesh position={[0, wall.height / 2, 0]}>
        {box(f.len, wall.height, 0.03)}
        <meshPhysicalMaterial color={PALETTE.glass} transparent opacity={0.18} roughness={0.18} metalness={0} />
      </mesh>
      {[0.03, wall.height].map((y) => (
        <mesh key={y} position={[0, y, 0]} castShadow>
          {box(f.len, 0.06, 0.07)}
          {paint(PALETTE.frame, { roughness: 0.5 })}
        </mesh>
      ))}
      {Array.from({ length: posts + 1 }, (_, i) => (
        <mesh key={i} position={[-f.len / 2 + (i * f.len) / posts, wall.height / 2, 0]} castShadow>
          {box(0.06, wall.height, 0.07)}
          {paint(PALETTE.frame, { roughness: 0.5 })}
        </mesh>
      ))}
    </>
  );
}

/** Vertical oak slats on both faces of a backing panel; instanced, they are dozens of boards in one draw. */
function SlatWall({ wall, f }: { wall: Wall; f: Frame }) {
  const ref = useRef<InstancedMesh>(null);
  const pitch = 0.11;
  const count = Math.max(1, Math.floor(f.len / pitch));
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new Object3D();
    let i = 0;
    for (const side of [1, -1]) {
      for (let s = 0; s < count; s += 1) {
        o.position.set(-f.len / 2 + pitch / 2 + s * pitch, wall.height / 2, side * (0.06 + 0.02));
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
        i += 1;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [count, f.len, wall.height]);
  return (
    <>
      <mesh position={[0, wall.height / 2, 0]} castShadow receiveShadow>
        {box(f.len, wall.height, 0.12)}
        {paint(PALETTE.oakDark)}
      </mesh>
      <instancedMesh ref={ref} args={[undefined, undefined, count * 2]} castShadow receiveShadow>
        {box(0.065, wall.height, 0.04)}
        {paint(PALETTE.oak, { roughness: 0.7 })}
      </instancedMesh>
    </>
  );
}

/** The city outside, cut to each window so it never shows above the wall. */
function CityPane({ len, height, offset, total, inside }: { len: number; height: number; offset: number; total: number; inside: 1 | -1 }) {
  const city = useTexture(CITY_URL) as Texture;
  const map = useMemo(() => {
    const t = city.clone();
    t.colorSpace = SRGBColorSpace;
    // Each pane shows its own slice of one wide picture, so the skyline runs on behind the pilasters.
    t.repeat.set(len / total, 0.82);
    t.offset.set(offset / total, 0.1);
    t.needsUpdate = true;
    return t;
  }, [city, len, offset, total]);
  return (
    <mesh position={[0, 0.7 + height / 2, -inside * 0.09]} rotation={[0, inside === 1 ? 0 : Math.PI, 0]}>
      <planeGeometry args={[len, height]} />
      <meshBasicMaterial map={map} toneMapped={false} />
    </mesh>
  );
}

function WindowWall({ wall, f }: { wall: Wall; f: Frame }) {
  const bays = Math.max(1, Math.round(f.len / 3));
  const bay = f.len / bays;
  const sill = 0.7;
  const top = wall.height - 0.35;
  const paneH = top - sill;
  const sky = (
    <mesh position={[0, sill + paneH / 2, -f.inside * 0.09]}>
      <planeGeometry args={[f.len, paneH]} />
      <meshBasicMaterial color="#f6c99b" />
    </mesh>
  );
  return (
    <>
      <mesh position={[0, sill / 2, 0]} castShadow receiveShadow>
        {box(f.len + T, sill, T)}
        {paint(PALETTE.wall)}
      </mesh>
      <mesh position={[0, sill + 0.025, f.inside * 0.06]} castShadow>
        {box(f.len, 0.05, T + 0.12)}
        {paint(PALETTE.wallShade)}
      </mesh>
      <mesh position={[0, (top + wall.height) / 2, 0]} castShadow receiveShadow>
        {box(f.len + T, wall.height - top, T)}
        {paint(PALETTE.wall)}
      </mesh>
      <ErrorBoundary fallback={sky}>
        <Suspense fallback={sky}>
          {Array.from({ length: bays }, (_, b) => (
            <group key={b} position={[-f.len / 2 + bay / 2 + b * bay, 0, 0]}>
              {/* Seen from inside, the bays run the other way when the wall's local +z points outside. */}
              <CityPane len={bay} height={paneH} offset={f.inside === 1 ? b * bay : f.len - (b + 1) * bay} total={f.len} inside={f.inside} />
            </group>
          ))}
        </Suspense>
      </ErrorBoundary>
      {/* Black window frames: a 3 × 2 grid of panes per bay. */}
      {Array.from({ length: bays }, (_, b) => {
        const x0 = -f.len / 2 + b * bay;
        return (
          <group key={b}>
            {[1, 2].map((k) => (
              <mesh key={`v${k}`} position={[x0 + (k * bay) / 3, sill + paneH / 2, 0]} castShadow>
                {box(0.05, paneH, 0.06)}
                {paint(PALETTE.frame, { roughness: 0.5 })}
              </mesh>
            ))}
            {[sill + 0.03, sill + paneH * 0.55, top - 0.03].map((y) => (
              <mesh key={y} position={[x0 + bay / 2, y, 0]} castShadow>
                {box(bay, 0.05, 0.06)}
                {paint(PALETTE.frame, { roughness: 0.5 })}
              </mesh>
            ))}
            <mesh position={[x0 + bay / 2, sill + paneH / 2, 0.005]}>
              {box(bay, paneH, 0.01)}
              <meshPhysicalMaterial color={PALETTE.glass} transparent opacity={0.08} roughness={0.18} />
            </mesh>
          </group>
        );
      })}
      {/* Pilasters between the bays, with dark caps like the reference. */}
      {Array.from({ length: bays + 1 }, (_, b) => (
        <group key={b} position={[-f.len / 2 + b * bay, 0, f.inside * 0.08]}>
          <mesh position={[0, wall.height / 2, 0]} castShadow receiveShadow>
            {box(0.42, wall.height, 0.42)}
            {paint(PALETTE.pilaster)}
          </mesh>
          <mesh position={[0, wall.height + 0.09, 0]} castShadow>
            {box(0.48, 0.18, 0.48)}
            {paint(PALETTE.cap, { roughness: 0.6 })}
          </mesh>
        </group>
      ))}
    </>
  );
}

function WallMesh({ wall }: { wall: Wall }) {
  const f = frameOf(wall);
  return (
    <group position={[f.cx, 0, f.cz]} rotation={[0, f.rot, 0]}>
      {wall.kind === 'window' && <WindowWall wall={wall} f={f} />}
      {wall.kind === 'glass' && <GlassWall wall={wall} f={f} />}
      {wall.kind === 'low' && <LowWall wall={wall} f={f} />}
      {wall.kind === 'slats' && <SlatWall wall={wall} f={f} />}
      {wall.kind === 'solid' && <SolidWall wall={wall} f={f} />}
    </group>
  );
}

export function Room() {
  return (
    <group>
      {/* The building's slab, cut open like a diorama: a thick grey base under the floor. */}
      <mesh position={[LAYOUT.width / 2, -0.22, LAYOUT.depth / 2]} receiveShadow>
        {box(LAYOUT.width + 0.6, 0.44, LAYOUT.depth + 0.6)}
        {paint(PALETTE.plinth)}
      </mesh>
      <mesh position={[LAYOUT.width / 2, -0.47, LAYOUT.depth / 2]}>
        {box(LAYOUT.width + 0.7, 0.06, LAYOUT.depth + 0.7)}
        {paint(PALETTE.plinthDark)}
      </mesh>
      <ReflectiveFloor width={LAYOUT.width} depth={LAYOUT.depth} color={PALETTE.floor} strength={0.3} blur={1.6} />
      {LAYOUT.carpets.map((c, i) => (
        <mesh key={i} position={[(c.x1 + c.x2) / 2, 0.012, (c.z1 + c.z2) / 2]} receiveShadow>
          {box(c.x2 - c.x1, 0.022, c.z2 - c.z1)}
          {paint(c.color, { roughness: 1 })}
        </mesh>
      ))}
      {LAYOUT.walls.map((w, i) => (
        <WallMesh key={i} wall={w} />
      ))}
    </group>
  );
}
