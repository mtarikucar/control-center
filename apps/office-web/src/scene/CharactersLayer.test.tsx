import ReactThreeTestRenderer from '@react-three/test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Employee } from '@cc/shared';
import type { CharacterAsset } from '../assets/manifest.ts';
import { LAYOUT, spotFor, type Spot } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';

interface Drawn {
  employee: Employee;
  asset: CharacterAsset | null;
  spot: Spot;
  task?: string | null;
  ping?: string | null;
  reports?: number;
}
// test-renderer drives React through act(); tell React this is a test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const drawn = new Map<string, Drawn>();
vi.mock('./Character.tsx', () => ({
  Character: (p: Drawn) => {
    drawn.set(p.employee.id, p);
    return null;
  },
}));
const { CharactersLayer } = await import('./CharactersLayer.tsx');

const coder: CharacterAsset = { id: 'coder', kind: 'character', name: 'Kodcu', file: 'c/base.glb', height: 1.7, clips: {} };
const person = (id: string, deskIndex: number, characterId = 'coder'): Employee => ({
  id, slug: id, name: id, role: 'r', model: 'haiku', characterId, title: '', team: '', kind: 'member', reportsTo: null, deskIndex, sessionId: `s-${id}`, sessionStarted: true,
  lifecycle: 'idle', limitResetsAt: null, lastError: null, createdAt: 1,
});
function office(...employees: Employee[]) {
  useOffice.setState({
    manifest: { items: [coder] },
    views: Object.fromEntries(employees.map((e) => [e.id, { employee: e, events: [], openTools: {}, idleSince: null, eventsLoaded: true }])),
  });
}

afterEach(() => drawn.clear());

describe('CharactersLayer', () => {
  it('draws an employee without a model as a voxel figure, not as someone else', async () => {
    office(person('ada', 0, 'voxel'), person('can', 1, 'coder'));
    const r = await ReactThreeTestRenderer.create(<CharactersLayer />);
    expect(drawn.get('ada')?.asset).toBeNull();
    expect(drawn.get('can')?.asset?.id).toBe('coder');
    await r.unmount();
  });

  it('gives the tag the running task, a fresh pass note and unread reports; a planning coordinator meets', async () => {
    const coord = { ...person('koor', 0), kind: 'coordinator' as const, lifecycle: 'working' as const };
    const lead = { ...person('ada', 1), kind: 'lead' as const, team: 'İçerik' };
    office(coord, lead);
    useOffice.setState({
      tasks: { t1: { id: 't1', kind: 'work', planId: null, title: 'Lansman metni', description: '', done: [], requester: 'owner', assignee: 'ada', priority: 2, dependsOn: [], status: 'in_progress', chainDepth: 0, note: null, result: null, nudged: false, createdAt: 1, startedAt: 2, finishedAt: null } },
      plans: { p1: { id: 'p1', title: 'P', goal: '', approach: '', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '', status: 'draft', version: 1, proposedBy: 'koor', createdAt: 1, updatedAt: 1, approvedAt: null } },
      pings: { ada: { text: 'Yeni iş: Slogan', at: Date.now() } },
      unseenReports: { koor: 2 },
    });
    const r = await ReactThreeTestRenderer.create(<CharactersLayer />);
    expect(drawn.get('ada')).toMatchObject({ task: 'Lansman metni', ping: 'Yeni iş: Slogan', reports: 0 });
    expect(drawn.get('koor')).toMatchObject({ task: null, reports: 2, spot: spotFor(LAYOUT, 'meeting', 0) });
    await r.unmount();
  });
});
