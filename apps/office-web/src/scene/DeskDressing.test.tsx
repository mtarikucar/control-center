import ReactThreeTestRenderer from '@react-three/test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import type { Mesh, Texture } from 'three';
import type { Department, Employee } from '@cc/shared';
import { LAYOUT, type Desk } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import { DeskDressing } from './DeskDressing.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => useOffice.setState({ departments: {}, views: {} }));
const person = (id: string, deskIndex: number): Employee => ({
  id, slug: id, name: id, role: 'r', model: 'haiku', characterId: 'coder', title: '', team: '', kind: 'member', reportsTo: null, deskIndex, sessionId: `s-${id}`, sessionStarted: true,
  lifecycle: 'idle', limitResetsAt: null, lastError: null, createdAt: 1,
});
const views = (...people: Employee[]) => Object.fromEntries(people.map((e) => [e.id, { employee: e, events: [], openTools: {}, idleSince: null, eventsLoaded: true }]));


describe('DeskDressing', () => {
  it('review focus 5: the screens of an empty room are off; a working room’s, the hub’s and the coordinator’s are on', async () => {
    useOffice.setState({ departments: { d: { id: 'd', name: 'Yazılım', mission: 'm', scope: '', template: null, headId: null, status: 'open', createdAt: 1, closedAt: null, room: 0 } } });
    const r = await ReactThreeTestRenderer.create(<DeskDressing />);
    const screens = r.scene.findAll((n) => n.props.name === 'screen').map((n) => (n.instance as Mesh).material as unknown as { map: Texture | null });
    const monitors = (pick: (d: Desk) => boolean) => LAYOUT.desks.filter(pick).reduce((n, d) => n + d.monitors, 0);
    expect(screens).toHaveLength(monitors(() => true));
    expect(screens.filter((m) => m.map).length).toBe(monitors((d) => d.room === undefined || d.room === 0));
    await r.unmount();
  });

  it('a department closing while the scene stands: its room’s screens go dark, the others stay on', async () => {
    const open: Department = { id: 'd', name: 'Yazılım', mission: 'm', scope: '', template: null, headId: null, status: 'open', createdAt: 1, closedAt: null, room: 2 };
    useOffice.setState({ departments: { d: open } });
    const r = await ReactThreeTestRenderer.create(<DeskDressing />);
    const lit = () => r.scene.findAll((n) => n.props.name === 'screen').filter((n) => ((n.instance as Mesh).material as unknown as { map: Texture | null }).map).length;
    const monitors = (pick: (d: Desk) => boolean) => LAYOUT.desks.filter(pick).reduce((n, d) => n + d.monitors, 0);
    const roomTwo = monitors((d) => d.room === 2);
    expect(roomTwo).toBeGreaterThan(0);
    expect(lit()).toBe(monitors((d) => d.room === undefined || d.room === 2));
    await ReactThreeTestRenderer.act(async () => {
      useOffice.setState({ departments: { d: { ...open, status: 'closed', closedAt: 5 } } });
    });
    expect(lit()).toBe(monitors((d) => d.room === undefined));
    expect(r.scene.findAll((n) => n.props.name === 'screen')).toHaveLength(monitors(() => true));
    await r.unmount();
  });

  it('final review I1: in a room no department holds, the desk someone sits at has its screens on and the room’s other desks stay dark', async () => {
    useOffice.setState({ departments: {}, views: views(person('ada', 31)) });
    const r = await ReactThreeTestRenderer.create(<DeskDressing />);
    // Each desk's screens, by seat: DeskDressing draws LAYOUT.desks in seat order.
    const screens = r.scene.findAll((n) => n.props.name === 'screen').map((n) => ((n.instance as Mesh).material as unknown as { map: Texture | null }).map !== null);
    const bySeat: boolean[][] = [];
    let k = 0;
    for (const desk of LAYOUT.desks) bySeat.push(screens.slice(k, (k += desk.monitors)));
    const on = (seat: number) => bySeat[seat]!.every(Boolean);
    const off = (seat: number) => bySeat[seat]!.every((x) => !x);
    expect(on(31)).toBe(true);
    expect([32, 33, 34, 35, 36].every(off)).toBe(true);
    expect(LAYOUT.desks.every((d, seat) => (d.room === undefined || seat === 31 ? on(seat) : off(seat)))).toBe(true);
    await r.unmount();
  });
});
