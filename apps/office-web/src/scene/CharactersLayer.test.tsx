import ReactThreeTestRenderer from '@react-three/test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Employee } from '@cc/shared';
import type { CharacterAsset } from '../assets/manifest.ts';
import type { Spot } from '../office/layout.ts';
import { useOffice } from '../store/office.ts';

interface Drawn {
  employee: Employee;
  asset: CharacterAsset | null;
  spot: Spot;
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
  id, slug: id, name: id, role: 'r', model: 'haiku', characterId, deskIndex, sessionId: `s-${id}`, sessionStarted: true,
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
});
