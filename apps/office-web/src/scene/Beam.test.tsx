import ReactThreeTestRenderer from '@react-three/test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import type { Mesh, SpotLight } from 'three';
import type { Employee, EmployeeKind, Lifecycle } from '@cc/shared';
import { LAYOUT } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import type { EmployeeView } from '../store/reducers.ts';
import { Beam, PULSE_SECONDS, beamBrightness, beamLevel, coordinatorLifecycle } from './Beam.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => useOffice.setState({ views: {} }));

const someone = (id: string, kind: EmployeeKind, lifecycle: Lifecycle): Employee => ({
  id, slug: id, name: id, role: 'r', model: 'sonnet', characterId: 'manager', title: '', team: '', kind, reportsTo: null, deskIndex: 0,
  sessionId: `s-${id}`, sessionStarted: true, lifecycle, limitResetsAt: null, lastError: null, createdAt: 1,
});
const view = (employee: Employee): EmployeeView => ({ employee, events: [], openTools: {}, idleSince: null, eventsLoaded: true });

describe('the beam’s brightness (spec office rooms §4.3)', () => {
  it('pulses while the coordinator works, is calm when idle or starting, dim in every other state, gone without a coordinator', () => {
    expect(beamLevel('working')).toBe('pulse');
    expect([beamLevel('idle'), beamLevel('starting')]).toEqual(['calm', 'calm']);
    expect((['sleeping', 'stopped', 'limited', 'error', 'interrupted', 'in_terminal'] as const).map(beamLevel)).toEqual(Array(6).fill('dim'));
    expect(beamLevel(null)).toBe('off');
    expect(beamLevel('archived')).toBe('off');
  });

  it('a working beam breathes every 2.5 s between half and full; calm is steady and brighter than dim', () => {
    const at = (t: number) => beamBrightness('pulse', t);
    expect(PULSE_SECONDS).toBe(2.5);
    expect(at(0)).toBeCloseTo(at(PULSE_SECONDS));
    expect(at(PULSE_SECONDS / 4)).toBeCloseTo(1);
    expect(at((3 * PULSE_SECONDS) / 4)).toBeCloseTo(0.5);
    expect(beamBrightness('calm', 0)).toBe(beamBrightness('calm', 1.3));
    expect(beamBrightness('calm', 0)).toBeGreaterThan(beamBrightness('dim', 0));
    expect(beamBrightness('dim', 0)).toBeGreaterThan(0);
    expect(beamBrightness('off', 0)).toBe(0);
  });

  it('follows the coordinator, never someone else', () => {
    expect(coordinatorLifecycle({ a: view(someone('a', 'member', 'working')), k: view(someone('k', 'coordinator', 'sleeping')) })).toBe('sleeping');
    expect(coordinatorLifecycle({ a: view(someone('a', 'member', 'working')) })).toBeNull();
    expect(coordinatorLifecycle({ k: view(someone('k', 'coordinator', 'archived')) })).toBeNull();
  });
});

describe('Beam', () => {
  it('stands over the coordinator’s desk while there is a coordinator, with one spot light; without one it is gone', async () => {
    useOffice.setState({ views: { k: view(someone('k', 'coordinator', 'working')) } });
    const r = await ReactThreeTestRenderer.create(<Beam />);
    const cone = r.scene.findByProps({ name: 'beam-cone' }).instance as Mesh;
    expect([cone.position.x, cone.position.z]).toEqual([LAYOUT.beam.x, LAYOUT.beam.z]);
    expect(r.scene.findAll((n) => n.type === 'SpotLight')).toHaveLength(1);
    await r.unmount();
    useOffice.setState({ views: {} });
    const none = await ReactThreeTestRenderer.create(<Beam />);
    expect(none.scene.children).toHaveLength(0);
    await none.unmount();
  });

  it('keeps its one spot light when the coordinator’s state changes — only the intensity moves', async () => {
    useOffice.setState({ views: { k: view(someone('k', 'coordinator', 'working')) } });
    const r = await ReactThreeTestRenderer.create(<Beam />);
    const spot = () => r.scene.findAll((n) => n.type === 'SpotLight').map((n) => n.instance as SpotLight);
    const first = spot();
    expect(first).toHaveLength(1);
    await r.advanceFrames(1, 0.1);
    const working = first[0]!.intensity;
    expect(working).toBeGreaterThan(0);
    await ReactThreeTestRenderer.act(async () => {
      useOffice.setState({ views: { k: view(someone('k', 'coordinator', 'sleeping')) } });
    });
    await r.advanceFrames(1, 0.1);
    expect(spot()).toEqual(first);
    expect(first[0]!.intensity).toBeCloseTo(30 * beamBrightness('dim', 0));
    expect(first[0]!.intensity).toBeLessThan(working);
    await r.unmount();
  });
});
