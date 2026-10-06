import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Employee, OfficeSnapshot, StoredEvent } from '@cc/shared';

vi.mock('../net/api.ts', () => ({ api: { events: vi.fn(), office: vi.fn() } }));
const { api } = await import('../net/api.ts');
const { useOffice } = await import('./office.ts');
const { openToolSince } = await import('./reducers.ts');

const employee = (id: string, lifecycle: Employee['lifecycle']): Employee => ({
  id, slug: id, name: id, role: 'r', model: 'haiku', characterId: 'coder', deskIndex: 0,
  sessionId: `s-${id}`, sessionStarted: true, lifecycle, limitResetsAt: null, lastError: null, createdAt: 1,
});

afterEach(() => vi.clearAllMocks());

describe('office store', () => {
  it('review focus: loads every employee’s recent history when the office first appears, so a tool already running is known', async () => {
    const running: StoredEvent[] = [{ seq: 5, employeeId: 'busy', ts: 1000, event: { type: 'tool.started', toolUseId: 't', name: 'Bash', input: {} } }];
    vi.mocked(api.events).mockImplementation(async (id: string) => (id === 'busy' ? running : []));
    const snapshot: OfficeSnapshot = { employees: [employee('busy', 'working'), employee('calm', 'idle')], quota: null, usage: {}, lastSeq: 5 };
    useOffice.getState().receive({ type: 'snapshot', snapshot });
    await vi.waitFor(() => expect(useOffice.getState().views.busy?.eventsLoaded).toBe(true));
    expect(api.events).toHaveBeenCalledWith('busy', 500);
    expect(api.events).toHaveBeenCalledWith('calm', 500);
    expect(openToolSince(useOffice.getState().views.busy!)).toBe(1000);
    useOffice.getState().receive({ type: 'snapshot', snapshot });
    expect(api.events).toHaveBeenCalledTimes(2);
  });

  it('refreshes the office at local midnight so "today" starts over', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 9, 6, 23, 59, 0));
      vi.mocked(api.office).mockResolvedValue({ employees: [], quota: null, usage: {}, lastSeq: 0 });
      await useOffice.getState().refresh();
      expect(api.office).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(61_000);
      expect(api.office).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

