import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, Color, DoubleSide, Object3D, type MeshBasicMaterial, type SpotLight } from 'three';
import type { Lifecycle } from '@cc/shared';
import { LAYOUT } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import type { EmployeeView } from '../store/reducers.ts';

export type BeamLevel = 'pulse' | 'calm' | 'dim' | 'off';
/** One breath of the working beam, seconds. */
export const PULSE_SECONDS = 2.5;
/** The beam comes down from the ceiling (y ≈ 6) onto the coordinator's desk. */
export const BEAM_TOP = 6;
const RADIUS = 1.4;
const CONE_OPACITY = 0.22;
const SPOT_INTENSITY = 30;
const LIGHT = new Color('#ffe2b0');
/** The fixture at the top is the beam's bright part: above the bloom's threshold (0.92), so it glows a little. */
const FIXTURE = new Color('#ffe9c4').multiplyScalar(4);

/** Every lifecycle's beam, as a table the compiler checks: a state added to the shared list has no beam until it is given one here. */
const BEAM_LEVELS: Record<Lifecycle, BeamLevel> = {
  working: 'pulse',
  idle: 'calm',
  starting: 'calm',
  sleeping: 'dim',
  stopped: 'dim',
  limited: 'dim',
  error: 'dim',
  interrupted: 'dim',
  in_terminal: 'dim',
  archived: 'off',
};

/** What the beam says about the coordinator (spec office rooms §4.3): working pulses, idle or starting is calm, any other state dim; no coordinator, no beam. */
export function beamLevel(lifecycle: Lifecycle | null): BeamLevel {
  // A state only a newer server knows is not in the table: dim, like any state that is not at work.
  return lifecycle === null ? 'off' : (BEAM_LEVELS[lifecycle] ?? 'dim');
}

/** The beam's brightness (0–1) at `seconds`: a slow breath while working, steady otherwise. */
export function beamBrightness(level: BeamLevel, seconds: number): number {
  if (level === 'pulse') return 0.75 + 0.25 * Math.sin((2 * Math.PI * seconds) / PULSE_SECONDS);
  if (level === 'calm') return 0.5;
  if (level === 'dim') return 0.15;
  return 0;
}

/** The coordinator's lifecycle; null: no coordinator at work. */
export function coordinatorLifecycle(views: Readonly<Record<string, EmployeeView>>): Lifecycle | null {
  return Object.values(views).map((v) => v.employee).find((e) => e.kind === 'coordinator' && e.lifecycle !== 'archived')?.lifecycle ?? null;
}

/**
 * The light over the coordinator's desk: a see-through cone (added light that writes no depth, so the coordinator shows
 * through it) and a spot light on the desk, both as bright as the coordinator's state says. Without a coordinator the
 * cone and the fixture are hidden and the spot's intensity is 0, but the spot stays: a light is never added or removed
 * (every material's shader would compile again).
 */
export function Beam() {
  const level = beamLevel(useOffice((s) => coordinatorLifecycle(s.views)));
  const cone = useRef<MeshBasicMaterial>(null);
  const fixture = useRef<MeshBasicMaterial>(null);
  const spot = useRef<SpotLight>(null);
  const target = useMemo(() => {
    const o = new Object3D();
    o.position.set(LAYOUT.beam.x, 0, LAYOUT.beam.z);
    return o;
  }, []);
  useFrame(({ clock }) => {
    const b = beamBrightness(level, clock.getElapsedTime());
    if (cone.current) cone.current.opacity = CONE_OPACITY * b;
    if (fixture.current) fixture.current.opacity = b;
    if (spot.current) spot.current.intensity = SPOT_INTENSITY * b;
  });
  const { x, z } = LAYOUT.beam;
  const start = beamBrightness(level, 0);
  const shown = level !== 'off';
  return (
    <group name="beam">
      <primitive object={target} />
      <mesh name="beam-cone" position={[x, BEAM_TOP / 2, z]} visible={shown}>
        <coneGeometry args={[RADIUS, BEAM_TOP, 48, 1, true]} />
        <meshBasicMaterial ref={cone} color={LIGHT} transparent opacity={CONE_OPACITY * start} blending={AdditiveBlending} depthWrite={false} side={DoubleSide} toneMapped={false} />
      </mesh>
      <mesh name="beam-fixture" position={[x, BEAM_TOP, z]} rotation={[Math.PI / 2, 0, 0]} visible={shown}>
        <circleGeometry args={[0.28, 32]} />
        <meshBasicMaterial ref={fixture} color={FIXTURE} transparent opacity={start} side={DoubleSide} toneMapped={false} />
      </mesh>
      <spotLight ref={spot} position={[x, BEAM_TOP, z]} target={target} color={LIGHT} intensity={SPOT_INTENSITY * start} angle={0.3} penumbra={0.7} distance={9} decay={1.2} />
    </group>
  );
}
