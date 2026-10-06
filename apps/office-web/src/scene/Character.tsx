import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { Group } from 'three';
import type { Employee, EmployeeUsage } from '@cc/shared';
import type { CharacterAsset } from '../assets/manifest.ts';
import type { Behavior } from '../office/behavior.ts';
import { findPath, type Pt } from '../office/grid.ts';
import { GRID, type Spot } from '../office/layout.ts';
import { stepAlong } from '../office/motion.ts';
import { useOffice } from '../store/office.ts';
import { formatCost, formatTokens, tokensOf } from '../ui/format.ts';
import { limitNote } from '../ui/labels.ts';
import { CharacterModel } from './CharacterModel.tsx';
import { roleFor } from './clips.ts';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { TAG_HEIGHT, registerTag } from './TagLayout.tsx';
import { VoxelFigure } from './VoxelFigure.tsx';

const WALK_SPEED = 1.4;

interface Props {
  employee: Employee;
  behavior: Behavior;
  spot: Spot;
  asset: CharacterAsset | null;
  usage: EmployeeUsage | undefined;
  selected: boolean;
}

export function Character({ employee, behavior, spot, asset, usage, selected }: Props) {
  const select = useOffice((s) => s.select);
  const group = useRef<Group>(null);
  const motion = useRef<{ pos: Pt; heading: number; path: Pt[]; moving: boolean; goal: string }>({
    pos: { x: spot.x, z: spot.z },
    heading: spot.rotY,
    path: [],
    moving: false,
    goal: '',
  });
  const [moving, setMoving] = useState(false);
  // drei's <Html> renders nothing if it mounts before the canvas is attached to the page, which is exactly what
  // happens to the first character; mounting the tag one render later avoids that.
  const [tagReady, setTagReady] = useState(false);
  useEffect(() => setTagReady(true), []);
  // drei renders the tag in its own React root, so a callback ref is the reliable way to know its element.
  const tagRef = useCallback((el: HTMLButtonElement | null) => (el ? registerTag(employee.id, group, el) : undefined), [employee.id]);
  const goal = `${spot.x},${spot.z},${spot.rotY}`;

  useEffect(() => {
    const m = motion.current;
    if (m.goal === goal) return;
    const first = m.goal === '';
    m.goal = goal;
    if (first) return;
    m.path = findPath(GRID, m.pos, { x: spot.x, z: spot.z });
    m.moving = true;
  }, [goal, spot.x, spot.z]);

  useFrame((_, dt) => {
    const m = motion.current;
    const g = group.current;
    if (!g) return;
    if (m.moving) {
      const step = stepAlong(m.path, m.pos, m.heading, WALK_SPEED, Math.min(dt, 0.1));
      m.pos = step.pos;
      m.heading = step.heading;
      m.path = step.path;
      if (step.arrived) {
        m.moving = false;
        m.heading = spot.rotY;
      }
    }
    g.position.set(m.pos.x, 0, m.pos.z);
    g.rotation.y = m.heading;
    if (m.moving !== moving) setMoving(m.moving);
  });

  const role = roleFor(behavior.activity, moving);
  const faded = behavior.marker === 'faded' || behavior.marker === 'terminal';
  const figure = <VoxelFigure seed={employee.name} role={role} faded={faded} />;
  const today = usage?.today;

  return (
    <group
      ref={group}
      onClick={(e) => {
        e.stopPropagation();
        select(employee.id);
      }}
    >
      {asset ? (
        <ErrorBoundary fallback={figure}>
          <Suspense fallback={figure}>
            <CharacterModel asset={asset} role={role} faded={faded} />
          </Suspense>
        </ErrorBoundary>
      ) : (
        figure
      )}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.45, 0.56, 40]} />
          <meshBasicMaterial color="#f08a3c" />
        </mesh>
      )}
      {tagReady && (
      <Html position={[0, TAG_HEIGHT, 0]} center zIndexRange={[20, 0]}>
        {/* Two short lines instead of one long one: eight desks sit close together on screen. */}
        <button
          type="button"
          className={`tag ${behavior.marker} ${selected ? 'selected' : ''}`}
          ref={tagRef}
          onClick={() => select(employee.id)}
        >
          <span className="tag-line">
            <span className={`dot ${employee.lifecycle}`} aria-hidden="true" />
            <strong className="tag-name">{employee.name}</strong>
            {behavior.marker === 'alert' && <span aria-label="dikkat">⚠</span>}
            {behavior.marker === 'terminal' && <span aria-label="terminalde">⌨</span>}
          </span>
          <span className="tag-usage">
            {formatTokens(tokensOf(today))} · {formatCost(today?.costUsd ?? 0)}
          </span>
          {limitNote(employee, Date.now()) && <span className="tag-usage">{limitNote(employee, Date.now())}</span>}
        </button>
      </Html>
      )}
    </group>
  );
}
