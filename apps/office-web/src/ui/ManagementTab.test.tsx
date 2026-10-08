import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagementLog } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { ManagementTab } from './ManagementTab.tsx';

const MIN = 60_000;
const NOW = new Date(2026, 9, 8, 14, 30).getTime();
const log = (): ManagementLog => ({
  generatedAt: NOW,
  open: { startedAt: NOW - 3 * MIN, triggers: [{ kind: 'delivery', at: NOW - 5 * MIN, note: '“Kayıt sayfası” (Can)', seq: 40 }], model: 'opus', costUsd: 0.12, close: null },
  cycles: [
    {
      seq: 31, startedAt: NOW - 50 * MIN, endedAt: NOW - 46 * MIN, closed: true, model: 'opus', costUsd: 0.42,
      triggers: [{ kind: 'stuck', at: NOW - 52 * MIN, note: '“Giriş” takıldı (Ada)', seq: 20 }, { kind: 'idle', at: NOW - 51 * MIN, note: 'Can', seq: 21 }],
      changes: ['Giriş işini Can’a verdim', 'Ada’ya belgeleri açtım'], reasoning: 'Ada takıldı, Can boştaydı.', next: 'Can’ın teslimine bak',
    },
    { seq: 25, startedAt: NOW - 100 * MIN, endedAt: NOW - 98 * MIN, closed: true, model: 'opus', costUsd: 0.2, triggers: [{ kind: 'heartbeat', at: NOW - 100 * MIN, note: '', seq: null }], changes: [], reasoning: 'değişiklik yok, çünkü iki akış da planda yürüyor', next: null },
    { seq: 12, startedAt: NOW - 26 * 60 * MIN, endedAt: NOW - 26 * 60 * MIN + 30_000, closed: false, model: null, costUsd: null, triggers: [{ kind: 'start', at: NOW - 26 * 60 * MIN, note: '', seq: null }], changes: [], reasoning: '', next: null },
  ],
});

vi.mock('../net/api.ts', () => ({ api: { management: vi.fn(async () => log()) } }));
const { api } = await import('../net/api.ts');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
  useOffice.setState({ managementRev: 0, views: {} });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const rows = () => screen.getAllByRole('article');

describe('ManagementTab', () => {
  it('shows the cycle that is going on first, marked “sürüyor”, with what opened it, its model and its cost so far', async () => {
    render(<ManagementTab />);
    await waitFor(() => expect(rows()).toHaveLength(4));
    const open = rows()[0]!;
    expect(open.className).toContain('open');
    expect(within(open).getByText('sürüyor')).toBeTruthy();
    expect(open.textContent).toContain('bugün 14:27');
    expect(open.textContent).toContain('3 dk');
    expect(open.textContent).toContain('Opus');
    expect(open.textContent).toContain('Teslim: “Kayıt sayfası” (Can)');
    expect(open.textContent).toContain('şimdiye dek $0.12');
  });

  it('a closed cycle: when, how long, the model, what opened it in Turkish, the changes as a list, why, what next, the cost', async () => {
    render(<ManagementTab />);
    await waitFor(() => expect(rows()).toHaveLength(4));
    const closed = rows()[1]!;
    expect(closed.textContent).toContain('bugün 13:40');
    expect(closed.textContent).toContain('4 dk');
    expect(closed.textContent).toContain('Opus');
    expect(closed.textContent).toContain('$0.42');
    const opened = within(closed).getByRole('list', { name: 'Açan olaylar' });
    expect(within(opened).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Takılma: “Giriş” takıldı (Ada)', 'Boşa çıktı: Can']);
    const changes = within(closed).getByRole('list', { name: 'Değişiklikler' });
    expect(within(changes).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Giriş işini Can’a verdim', 'Ada’ya belgeleri açtım']);
    expect(closed.textContent).toContain('Ada takıldı, Can boştaydı.');
    expect(closed.textContent).toContain('Can’ın teslimine bak');
    expect(within(closed).queryByText('kapanmadı')).toBeNull();
  });

  it('a cycle with no change says “değişiklik yok, çünkü …”, with no change list', async () => {
    render(<ManagementTab />);
    await waitFor(() => expect(rows()).toHaveLength(4));
    const none = rows()[2]!;
    expect(within(none).queryByRole('list', { name: 'Değişiklikler' })).toBeNull();
    expect(none.textContent).toContain('değişiklik yok, çünkü iki akış da planda yürüyor');
    expect(none.textContent).toContain('Kalp atışı');
  });

  it('a cycle whose turn ended without cycleClose is marked “kapanmadı”, its day named, no cost or model known', async () => {
    render(<ManagementTab />);
    await waitFor(() => expect(rows()).toHaveLength(4));
    const unclosed = rows()[3]!;
    expect(unclosed.className).toContain('unclosed');
    expect(within(unclosed).getByText('kapanmadı')).toBeTruthy();
    expect(unclosed.textContent).toContain('7 Eki 12:30');
    expect(unclosed.textContent).toContain('<1 dk');
    expect(unclosed.textContent).toContain('Ofis açıldı');
    expect(unclosed.textContent).not.toContain('$');
    // The summary counts it.
    expect(screen.getByText(/3 tur/).textContent).toContain('1 kapanmadı');
  });

  it('reads the log again when a cycle starts or is recorded', async () => {
    render(<ManagementTab />);
    await waitFor(() => expect(api.management).toHaveBeenCalledTimes(1));
    act(() => useOffice.getState().receive({ type: 'event', event: { seq: 99, employeeId: 'k', ts: NOW, event: { type: 'turn.started' } } }));
    act(() => useOffice.getState().receive({ type: 'event', event: { seq: 100, employeeId: 'k', ts: NOW, event: { type: 'management.cycle', closed: true, startedAt: NOW - 3 * MIN, triggers: [], changes: [], reasoning: 'değişiklik yok, çünkü x', next: null, costUsd: 0.1, model: 'opus' } } }));
    await act(async () => vi.advanceTimersByTimeAsync(1100));
    await waitFor(() => expect(api.management).toHaveBeenCalledTimes(2));
  });

  it('with no cycle yet says what a cycle is; an error is shown', async () => {
    vi.mocked(api.management).mockResolvedValueOnce({ generatedAt: NOW, open: null, cycles: [] });
    const { unmount } = render(<ManagementTab />);
    expect(await screen.findByText(/Henüz yönetim turu yok/)).toBeTruthy();
    unmount();
    vi.mocked(api.management).mockRejectedValueOnce(new Error('Bulunamadı.'));
    render(<ManagementTab />);
    expect((await screen.findByRole('alert')).textContent).toBe('Bulunamadı.');
  });
});
