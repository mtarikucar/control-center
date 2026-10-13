import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ComponentProps, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mesh, MeshStandardMaterial } from 'three';
import type { Department, Employee } from '@cc/shared';
import { LAYOUT } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';
import { EMPTY_CARPET, useRoomStates, type RoomState } from './rooms.ts';

// test-renderer drives React through act(); tell React this is a test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// drei's Html renders into a DOM root the test renderer never attaches: every render of a tag is recorded instead.
type HtmlProps = ComponentProps<typeof import('@react-three/drei').Html>;
const tagRenders: HtmlProps[] = [];
vi.mock('@react-three/drei', () => ({
  Html: (p: HtmlProps) => {
    tagRenders.push(p);
    return <group name={p.name} />;
  },
}));
const { RoomsLayer } = await import('./RoomsLayer.tsx');

afterEach(() => {
  useOffice.setState({ departments: {}, views: {} });
  tagRenders.length = 0;
});

const dep = (id: string, name: string, room: number, o: Partial<Department> = {}): Department => ({
  id, name, mission: 'm', scope: '', template: null, headId: null, status: 'open', createdAt: 1, closedAt: null, room, ...o,
});
const person = (id: string, deskIndex: number): Employee => ({
  id, slug: id, name: id, role: 'r', model: 'haiku', characterId: 'coder', title: '', team: '', kind: 'member', reportsTo: null, deskIndex, sessionId: `s-${id}`, sessionStarted: true,
  lifecycle: 'idle', limitResetsAt: null, lastError: null, createdAt: 1,
});
const views = (...people: Employee[]) => Object.fromEntries(people.map((e) => [e.id, { employee: e, events: [], openTools: {}, idleSince: null, eventsLoaded: true }]));
const markup = (p: HtmlProps) => renderToStaticMarkup(<>{p.children as ReactNode}</>);

describe('RoomsLayer', () => {
  it('lays each room’s carpet in its department’s colour, dark grey when empty, and hangs a sign over every door', async () => {
    useOffice.setState({ views: {}, departments: { d: dep('d', 'Pazarlama', 4) } });
    const r = await ReactThreeTestRenderer.create(<RoomsLayer />);
    const colour = (i: number) => `#${((r.scene.findByProps({ name: `room-carpet-${i}` }).instance as Mesh).material as MeshStandardMaterial).color.getHexString()}`;
    expect(LAYOUT.rooms.map((x) => colour(x.index))).toEqual(LAYOUT.rooms.map((x) => (x.index === 4 ? x.carpet.color : EMPTY_CARPET)));
    expect(LAYOUT.rooms.map((x) => r.scene.findAllByProps({ name: `room-sign-${x.index}` }).length)).toEqual([1, 1, 1, 1, 1, 1]);
    await r.unmount();
  });

  it('final review I2: a room a department holds has a floor tag with its name and colour; a room nobody holds has none', async () => {
    useOffice.setState({ views: views(person('nur', 31)), departments: { d: dep('d', 'Pazarlama', 4), c: dep('c', 'Eski', 1, { status: 'closed', closedAt: 5 }) } });
    const r = await ReactThreeTestRenderer.create(<RoomsLayer />);
    expect(LAYOUT.rooms.map((x) => r.scene.findAll((n) => n.props.name === `room-tag-${x.index}`).length)).toEqual([0, 0, 0, 0, 1, 0]);
    const tag = tagRenders.at(-1)!;
    expect(markup(tag)).toContain('Pazarlama');
    expect(markup(tag)).toContain(LAYOUT.rooms[4]!.carpet.color.slice(1));
    await r.unmount();
  });

  it('final review I2: the tag takes no pointer (drags and clicks reach the view and the characters) and stacks below the people’s tags', async () => {
    useOffice.setState({ departments: { d: dep('d', 'Pazarlama', 0) } });
    const r = await ReactThreeTestRenderer.create(<RoomsLayer />);
    const tag = tagRenders.at(-1)!;
    expect(tag.pointerEvents).toBe('none');
    expect(tag.style?.pointerEvents).toBe('none');
    expect(tag.center).toBe(true);
    // The people's tags are [20, 0] (Character.tsx).
    expect(tag.zIndexRange![0]).toBeLessThan(20);
    expect(markup(tag)).toContain('class="room-tag"');
    await r.unmount();
  });

  it('final review I2: a streamed event re-renders no tag, nor does someone walking to another seat (which redraws the rooms); a renamed department does', async () => {
    const open = dep('d', 'Pazarlama', 2);
    useOffice.setState({ views: views(person('ada', 37)), departments: { d: open } });
    const r = await ReactThreeTestRenderer.create(<RoomsLayer />);
    const rendered = tagRenders.length;
    expect(rendered).toBeGreaterThan(0);
    const change = (employee: Partial<Employee>) =>
      ReactThreeTestRenderer.act(async () => {
        const v = useOffice.getState().views.ada!;
        useOffice.setState({ views: { ada: { ...v, events: [...v.events], employee: { ...v.employee, ...employee } } } });
      });
    await change({ lifecycle: 'working' });
    await change({ deskIndex: 31 });
    expect(tagRenders).toHaveLength(rendered);
    await ReactThreeTestRenderer.act(async () => {
      useOffice.setState({ departments: { d: { ...open, name: 'Büyüme' } } });
    });
    expect(tagRenders.length).toBeGreaterThan(rendered);
    expect(markup(tagRenders.at(-1)!)).toContain('Büyüme');
    await r.unmount();
  });

  it('final review I1: a room nobody holds where someone sits reads “Ortak oda” on its sign; when they leave, “Boş oda” again', async () => {
    let states: RoomState[] = [];
    function Probe() {
      states = useRoomStates();
      return null;
    }
    useOffice.setState({ views: views(person('nur', 31)), departments: {} });
    const r = await ReactThreeTestRenderer.create(<Probe />);
    expect(states[5]!.sign).toEqual({ title: 'Ortak oda', subtitle: null });
    expect(states[5]!.lit).toBe(true);
    await ReactThreeTestRenderer.act(async () => {
      useOffice.setState({ views: views(person('nur', 40)) });
    });
    expect(states[5]!.sign).toEqual({ title: 'Boş oda', subtitle: null });
    expect(states[5]!.lit).toBe(false);
    await r.unmount();
  });
});
