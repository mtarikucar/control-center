import ReactThreeTestRenderer from '@react-three/test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { AdditiveBlending, type Mesh, type MeshBasicMaterial, type SpotLight } from 'three';
import { LIFECYCLES, type Employee, type EmployeeKind, type Lifecycle } from '@cc/shared';
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

  it('says something for every lifecycle there is: a state added later is dim until the table says otherwise (the table is compiler-checked)', () => {
    for (const lifecycle of LIFECYCLES) {
      const expected = lifecycle === 'working' ? 'pulse' : lifecycle === 'idle' || lifecycle === 'starting' ? 'calm' : lifecycle === 'archived' ? 'off' : 'dim';
      expect(beamLevel(lifecycle), lifecycle).toBe(expected);
    }
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
  it('stands over the coordinator’s desk while there is a coordinator, with one spot light aimed at the desk from the beam’s own group', async () => {
    useOffice.setState({ views: { k: view(someone('k', 'coordinator', 'working')) } });
    const r = await ReactThreeTestRenderer.create(<Beam />);
    const group = r.scene.findByProps({ name: 'beam' }).instance;
    const cone = r.scene.findByProps({ name: 'beam-cone' }).instance as Mesh;
    expect([cone.position.x, cone.position.z]).toEqual([LAYOUT.beam.x, LAYOUT.beam.z]);
    expect(cone.visible).toBe(true);
    const spots = r.scene.findAll((n) => n.type === 'SpotLight').map((n) => n.instance as SpotLight);
    expect(spots).toHaveLength(1);
    const spot = spots[0]!;
    expect(spot.parent).toBe(group);
    expect([spot.target.position.x, spot.target.position.y, spot.target.position.z]).toEqual([LAYOUT.beam.x, 0, LAYOUT.beam.z]);
    expect(spot.target.parent, 'the target is in the scene, so its world position follows the room').toBe(group);
    await r.unmount();
  });

  it('the cone is added light that writes no depth, so the coordinator shows through it', async () => {
    useOffice.setState({ views: { k: view(someone('k', 'coordinator', 'working')) } });
    const r = await ReactThreeTestRenderer.create(<Beam />);
    const material = (r.scene.findByProps({ name: 'beam-cone' }).instance as Mesh).material as MeshBasicMaterial;
    expect(material.transparent).toBe(true);
    expect(material.blending).toBe(AdditiveBlending);
    expect(material.depthWrite).toBe(false);
    await r.unmount();
  });

  it('without a coordinator the light stays mounted at intensity 0 and only the cone and the fixture are hidden — a light is never added or removed', async () => {
    const r = await ReactThreeTestRenderer.create(<Beam />);
    const spots = r.scene.findAll((n) => n.type === 'SpotLight').map((n) => n.instance as SpotLight);
    expect(spots).toHaveLength(1);
    await r.advanceFrames(2, 0.1);
    expect(spots[0]!.intensity).toBe(0);
    const meshes = r.scene.findAll((n) => n.type === 'Mesh').map((n) => n.instance as Mesh);
    expect(meshes).toHaveLength(2);
    expect(meshes.filter((m) => m.visible)).toEqual([]);
    // A coordinator hired later lights the very same spot and shows the cone and the fixture.
    await ReactThreeTestRenderer.act(async () => {
      useOffice.setState({ views: { k: view(someone('k', 'coordinator', 'working')) } });
    });
    await r.advanceFrames(1, 0.1);
    expect(r.scene.findAll((n) => n.type === 'SpotLight').map((n) => n.instance)).toEqual(spots);
    expect(spots[0]!.intensity).toBeGreaterThan(0);
    expect(meshes.filter((m) => m.visible)).toHaveLength(2);
    // And an archived coordinator puts it out again, the light still in place.
    await ReactThreeTestRenderer.act(async () => {
      useOffice.setState({ views: { k: view(someone('k', 'coordinator', 'archived')) } });
    });
    await r.advanceFrames(1, 0.1);
    expect(r.scene.findAll((n) => n.type === 'SpotLight').map((n) => n.instance)).toEqual(spots);
    expect(spots[0]!.intensity).toBe(0);
    expect(meshes.filter((m) => m.visible)).toEqual([]);
    await r.unmount();
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
