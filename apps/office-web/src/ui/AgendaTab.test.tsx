import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgendaReport, Employee, Schedule } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { AgendaTab } from './AgendaTab.tsx';

const NOW = new Date(2026, 9, 7, 14, 10).getTime();
const H = 3_600_000;
const report = (): AgendaReport => ({
  generatedAt: NOW, horizonMs: 7 * 24 * H,
  clock: { nextDueAt: NOW + 24 * H + 45 * 60_000, nextDueLabel: 'Adım 1 penceresi · Koordinatör', lastRunAt: NOW - 30_000, lastJumpAt: null },
  employees: [
    { id: 'k', name: 'Koordinatör', state: null, entries: [
      { kind: 'now', taskId: 't1', scheduleId: null, title: 'İş paketi tasarımı', at: NOW - 10 * 60_000, until: NOW + 45 * 60_000, basis: 'son 10 iş', note: null, priority: 2, dueAt: null, overdue: false, lowConfidence: false },
      { kind: 'queued', taskId: 't2', scheduleId: null, title: 'Gelir araştırması', at: NOW + 45 * 60_000, until: NOW + 75 * 60_000, basis: 'varsayılan', note: null, priority: 3, dueAt: null, overdue: false, lowConfidence: false },
      { kind: 'parked', taskId: 't3', scheduleId: null, title: 'Adım 1 penceresi', at: NOW + 24 * H + 45 * 60_000, until: null, basis: null, note: 'ölçüm penceresi dolsun', priority: 3, dueAt: null, overdue: false, lowConfidence: false },
      { kind: 'scheduled', taskId: null, scheduleId: 's1', title: 'Günlük ölçüm', at: NOW + 19 * H, until: null, basis: null, note: 'her gün 09:00', priority: 3, dueAt: null, overdue: false, lowConfidence: false },
    ] },
    { id: 'd', name: 'Deniz', state: 'uyuyor', entries: [
      { kind: 'queued', taskId: 't4', scheduleId: null, title: 'Harness', at: NOW + 75 * 60_000, until: NOW + 195 * 60_000, basis: 'varsayılan', note: '“İş paketi tasarımı” bitince', priority: 3, dueAt: NOW - H, overdue: true, lowConfidence: true },
    ] },
  ],
});

vi.mock('../net/api.ts', () => ({
  api: { agenda: vi.fn(async () => report()), parkTask: vi.fn(async () => ({})), releaseTask: vi.fn(async () => ({})), prioritizeTask: vi.fn(async () => ({})), scheduleAction: vi.fn(async () => ({})) },
}));
const { api } = await import('../net/api.ts');

const routine = (over: Partial<Schedule> = {}): Schedule => ({
  id: 's2', title: 'Haftalık rapor', description: '', done: [], assignee: 'ada', reviewer: null, planId: null, priority: 3, difficulty: null, cron: '0 9 * * 1', until: null,
  status: 'paused', nextRunAt: NOW + 48 * H, lastRunAt: null, lastTaskId: null, skipCount: 0, failCount: 0, createdBy: 'c', createdAt: 1, note: null, ...over,
});
const ada: Employee = {
  id: 'ada', slug: 'ada', name: 'Ada', role: 'r', model: 'haiku', characterId: 'coder', title: '', team: '', kind: 'member', reportsTo: null, deskIndex: 0,
  sessionId: 's', sessionStarted: true, lifecycle: 'idle', limitResetsAt: null, lastError: null, createdAt: 1,
};

beforeEach(() => useOffice.setState({ schedules: {}, paused: false, budget: null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AgendaTab', () => {
  it('shows the clock line, each employee’s entries with times and estimates, parked reasons, overdue and dependencies', async () => {
    useOffice.setState({ agendaRev: 0, views: {} });
    render(<AgendaTab />);
    await waitFor(() => expect(screen.getByText(/Adım 1 penceresi · Koordinatör/)).toBeTruthy());
    const k = screen.getByRole('region', { name: 'Koordinatör' });
    expect(k.textContent).toContain('İş paketi tasarımı');
    expect(k.textContent).toContain('~son 10 iş');
    expect(k.textContent).toContain('ölçüm penceresi dolsun');
    expect(k.textContent).toContain('her gün 09:00');
    const d = screen.getByRole('region', { name: 'Deniz' });
    expect(d.textContent).toContain('uyuyor');
    expect(d.textContent).toContain('“İş paketi tasarımı” bitince');
    expect(within(d).getByText(/son tarih geçti/i)).toBeTruthy();
  });

  it('the owner releases, parks (with a reason) and prioritizes; the buttons match the entry kind', async () => {
    useOffice.setState({ agendaRev: 0, views: {} });
    render(<AgendaTab />);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Koordinatör' })).toBeTruthy());
    const k = screen.getByRole('region', { name: 'Koordinatör' });
    const parkedRow = within(k).getByText('Adım 1 penceresi').closest('li')!;
    fireEvent.click(within(parkedRow).getByRole('button', { name: 'Şimdi başlasın' }));
    await waitFor(() => expect(api.releaseTask).toHaveBeenCalledWith('t3'));
    const queuedRow = within(k).getByText('Gelir araştırması').closest('li')!;
    fireEvent.click(within(queuedRow).getByRole('button', { name: 'Öne al' }));
    await waitFor(() => expect(api.prioritizeTask).toHaveBeenCalledWith('t2'));
    // The row's buttons stay disabled while its request runs; wait for it to finish before the next click.
    await waitFor(() => expect((within(queuedRow).getByRole('button', { name: 'Park et…' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(queuedRow).getByRole('button', { name: 'Park et…' }));
    fireEvent.change(screen.getByLabelText('Gerekçe'), { target: { value: 'yarına kalsın' } });
    fireEvent.click(screen.getByRole('button', { name: 'Yarın 09:00' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Park et' })));
    await waitFor(() => expect(api.parkTask).toHaveBeenCalledWith('t2', expect.stringMatching(/^\d{4}-\d{2}-\d{2}T09:00$/), 'yarına kalsın'));
    const nowRow = within(k).getByText('İş paketi tasarımı').closest('li')!;
    expect(within(nowRow).queryByRole('button', { name: 'Şimdi başlasın' })).toBeNull();
    const routineRow = within(k).getByText('Günlük ölçüm').closest('li')!;
    fireEvent.click(within(routineRow).getByRole('button', { name: 'Duraklat' }));
    await waitFor(() => expect(api.scheduleAction).toHaveBeenCalledWith('s1', 'pause'));
  });

  it('shows the server’s Turkish message by the row when a button fails', async () => {
    vi.mocked(api.releaseTask).mockRejectedValueOnce(new Error('Bu görev ertelenmiş değil.'));
    useOffice.setState({ agendaRev: 0, views: {} });
    render(<AgendaTab />);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Koordinatör' })).toBeTruthy());
    const parkedRow = within(screen.getByRole('region', { name: 'Koordinatör' })).getByText('Adım 1 penceresi').closest('li')!;
    fireEvent.click(within(parkedRow).getByRole('button', { name: 'Şimdi başlasın' }));
    expect((await within(parkedRow).findByRole('alert')).textContent).toBe('Bu görev ertelenmiş değil.');
  });

  it('switches to the timeline view', async () => {
    useOffice.setState({ agendaRev: 0, views: {} });
    render(<AgendaTab />);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Koordinatör' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Zaman çizelgesi' }));
    expect(screen.getByRole('img', { name: /Koordinatör zaman çizelgesi/ })).toBeTruthy();
  });

  it('lists the routines, a paused one too, so the owner can resume it; a stopped one has no buttons', async () => {
    useOffice.setState({
      agendaRev: 0,
      views: { ada: { employee: ada, events: [], openTools: {}, idleSince: null, eventsLoaded: true } },
      schedules: { s2: routine(), s3: routine({ id: 's3', title: 'Eski rutin', status: 'stopped', nextRunAt: null }) },
    });
    render(<AgendaTab />);
    const list = screen.getByRole('region', { name: 'Rutinler' });
    const paused = within(list).getByText('Haftalık rapor').closest('li')!;
    expect(paused.textContent).toContain('Ada');
    expect(paused.textContent).toContain('Duraklatıldı');
    expect(paused.textContent).toContain('0 9 * * 1');
    expect(within(paused).queryByRole('button', { name: 'Duraklat' })).toBeNull();
    expect(within(paused).getByRole('button', { name: 'Durdur' })).toBeTruthy();
    fireEvent.click(within(paused).getByRole('button', { name: 'Sürdür' }));
    await waitFor(() => expect(api.scheduleAction).toHaveBeenCalledWith('s2', 'resume'));
    const stopped = within(list).getByText('Eski rutin').closest('li')!;
    expect(within(stopped).queryAllByRole('button')).toHaveLength(0);
  });
});
