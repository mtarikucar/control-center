import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfficeMetrics } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { TopBar } from './TopBar.tsx';

const NOW = new Date(2026, 9, 8, 15, 0).getTime();
const MIN = 60_000;
const H = 60 * MIN;
const reading = (over: Partial<OfficeMetrics> = {}): OfficeMetrics => ({
  generatedAt: NOW,
  busy: { busy: 1, total: 3, idle: [{ id: 'd', name: 'Deniz', title: 'Testçi', since: NOW - 6 * H - 10 * MIN }, { id: 's', name: 'Selin', title: '', since: NOW - 5 * H }] },
  delivered: { count: 7, firstPassRate: 4 / 7, windowHours: 24 },
  stuck: { count: 1, items: [{ taskId: 't6', title: 'B6 raporu', assignee: 'Mert', reason: 'stalled' }] },
  ...over,
});

vi.mock('../net/api.ts', () => ({
  api: { pauseCompany: vi.fn(async () => ({ paused: true })), resumeCompany: vi.fn(async () => ({ paused: false })), metrics: vi.fn(async () => reading()) },
}));
const { api } = await import('../net/api.ts');
const RESERVE_OFF = { reserve: { active: false, limitPct: 75, fiveHourPct: null, sevenDayPct: null } } as never;

beforeEach(() => useOffice.setState({ budget: null, companyOpen: false, companyTab: null, agendaRev: 0, plans: {}, proposals: {} }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TopBar — what waits for the owner', () => {
  it('counts draft plans and proposals waiting for the owner on the Şirket button', () => {
    useOffice.setState({
      plans: { p: { id: 'p', title: 'P', goal: '', approach: '', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '', status: 'draft', version: 1, proposedBy: 'c', createdAt: 1, updatedAt: 1, approvedAt: null } },
      proposals: { q: { id: 'q', ts: 1, by: 'a', kind: 'purchase', title: 'T', text: '', usd: null, planId: null, status: 'owner', routedTo: null, decidedBy: null, note: null, decidedAt: null } },
    });
    render(<TopBar />);
    expect(screen.getByRole('button', { name: /Şirket/ }).textContent).toContain('2');
  });

  it('pauses and resumes the company, and says when it is paused', async () => {
    useOffice.setState({ paused: false, budget: RESERVE_OFF });
    const { rerender } = render(<TopBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Şirketi duraklat' }));
    await waitFor(() => expect(api.pauseCompany).toHaveBeenCalled());
    useOffice.setState({ paused: true });
    rerender(<TopBar />);
    expect(screen.getByText('Şirket duraklatıldı')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sürdür' }));
    await waitFor(() => expect(api.resumeCompany).toHaveBeenCalled());
  });
});

describe('TopBar — the office at a glance', () => {
  const chip = (name: string) => screen.findByRole('button', { name });

  it('after the first reading: busy of the team, delivered in 24 h, stuck — each explained in its tooltip', async () => {
    useOffice.setState({ budget: RESERVE_OFF });
    render(<TopBar />);
    expect(screen.queryByRole('button', { name: /Meşgul/ })).toBeNull();
    const busy = await chip('Meşgul 1/3');
    expect(busy.title).toBe('Deniz — 6 sa boşta, Selin — 5 sa boşta');
    // Someone has been idle two hours or more while the team is not all busy.
    expect(busy.className).toContain('warn');
    const delivered = await chip('Teslim (24 sa) 7');
    expect(delivered.title).toBe('İlk turda geçen: %57');
    const stuck = await chip('Takılan 1');
    expect(stuck.title).toBe('Mert: B6 raporu — hatırlatmaya rağmen ilerlemiyor');
    expect(stuck.className).toContain('bad');
  });

  it('calm figures look calm: idle under two hours, nothing stuck, nothing reviewed yet', async () => {
    useOffice.setState({ budget: RESERVE_OFF });
    vi.mocked(api.metrics).mockResolvedValueOnce(
      reading({
        busy: { busy: 2, total: 3, idle: [{ id: 'c', name: 'Can', title: '', since: NOW - 90 * MIN }] },
        delivered: { count: 0, firstPassRate: null, windowHours: 24 },
        stuck: { count: 0, items: [] },
      }),
    );
    render(<TopBar />);
    const busy = await chip('Meşgul 2/3');
    expect(busy.title).toBe('Can — 1 sa boşta');
    expect(busy.className).not.toContain('warn');
    expect((await chip('Teslim (24 sa) 0')).title).toBe('İlk turda geçen: henüz incelenen yok');
    const stuck = await chip('Takılan 0');
    expect(stuck.title).toBe('Takılan iş yok');
    expect(stuck.className).not.toContain('bad');
  });

  it('says who is idle in minutes, hours or days; everyone busy says so; a long stuck list is cut short', async () => {
    useOffice.setState({ budget: RESERVE_OFF });
    const items = Array.from({ length: 12 }, (_, i) => ({ taskId: `t${i}`, title: `İş ${i + 1}`, assignee: 'Ada', reason: (['blocked', 'overdue', 'stalled'] as const)[i % 3]! }));
    vi.mocked(api.metrics).mockResolvedValueOnce(
      reading({
        busy: { busy: 1, total: 3, idle: [{ id: 'a', name: 'Ali', title: '', since: NOW - 50 * H }, { id: 'e', name: 'Ece', title: '', since: NOW - 40 * MIN }] },
        stuck: { count: 12, items },
      }),
    );
    const { unmount } = render(<TopBar />);
    expect((await chip('Meşgul 1/3')).title).toBe('Ali — 2 gün boşta, Ece — 40 dk boşta');
    const lines = (await chip('Takılan 12')).title.split('\n');
    expect(lines.slice(0, 3)).toEqual(['Ada: İş 1 — engellendi', 'Ada: İş 2 — son tarihi geçti', 'Ada: İş 3 — hatırlatmaya rağmen ilerlemiyor']);
    expect(lines).toHaveLength(11);
    expect(lines[10]).toBe('… ve 2 iş daha');
    unmount();
    vi.mocked(api.metrics).mockResolvedValueOnce(reading({ busy: { busy: 3, total: 3, idle: [] } }));
    render(<TopBar />);
    expect((await chip('Meşgul 3/3')).title).toBe('Herkes meşgul');
  });

  it('a figure opens the company on the Ajanda tab; the Şirket button on its first tab', async () => {
    useOffice.setState({ budget: RESERVE_OFF });
    render(<TopBar />);
    fireEvent.click(await chip('Takılan 1'));
    expect(useOffice.getState()).toMatchObject({ companyOpen: true, companyTab: 'agenda' });
    act(() => useOffice.getState().setCompanyOpen(false));
    fireEvent.click(await chip('Meşgul 1/3'));
    expect(useOffice.getState()).toMatchObject({ companyOpen: true, companyTab: 'agenda' });
    act(() => useOffice.getState().setCompanyOpen(false));
    fireEvent.click(screen.getByRole('button', { name: 'Şirket' }));
    expect(useOffice.getState()).toMatchObject({ companyOpen: true, companyTab: null });
  });

  it('no figures without a company, whatever the server answers', async () => {
    render(<TopBar />);
    await waitFor(() => expect(api.metrics).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByRole('button', { name: /Meşgul|Teslim|Takılan/ })).toBeNull();
  });
});
