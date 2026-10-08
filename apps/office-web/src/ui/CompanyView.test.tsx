import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Employee, Task } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { CompanyView } from './CompanyView.tsx';

vi.mock('../net/api.ts', () => ({
  api: {
    hireCoordinator: vi.fn(async () => ({ id: 'new' })), appointCoordinator: vi.fn(async () => ({})), events: vi.fn(async () => []),
    agenda: vi.fn(async () => ({ generatedAt: 0, horizonMs: 0, clock: { nextDueAt: null, nextDueLabel: null, lastRunAt: null, lastJumpAt: null }, employees: [] })),
  },
}));
const { api } = await import('../net/api.ts');

const person = (id: string, over: Partial<Employee> = {}): Employee => ({
  id, slug: id, name: id, role: 'r', model: 'haiku', characterId: 'coder', title: '', team: '', kind: 'member', reportsTo: null, deskIndex: 0,
  sessionId: `s-${id}`, sessionStarted: true, lifecycle: 'idle', limitResetsAt: null, lastError: null, createdAt: 1, ...over,
});
const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, kind: 'work', planId: null, title: id, description: '', done: [], requester: 'owner', assignee: 'ada', priority: 3, dependsOn: [], status: 'waiting',
  chainDepth: 0, note: null, result: null, nudged: false, createdAt: 1, startedAt: null, finishedAt: null, ...over,
});
const office = (employees: Employee[], tasks: Task[] = []) =>
  useOffice.setState({
    companyOpen: true,
    views: Object.fromEntries(employees.map((e) => [e.id, { employee: e, events: [], openTools: {}, idleSince: null, eventsLoaded: true }])),
    tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    plans: {},
  });

beforeEach(() => office([]));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CompanyView', () => {
  it('opens on the tab it was asked for (a top-bar figure asks for the Ajanda), else on the org chart', () => {
    useOffice.setState({ companyTab: 'agenda' });
    const { unmount } = render(<CompanyView />);
    expect(screen.getByRole('tab', { name: 'Ajanda' }).getAttribute('aria-selected')).toBe('true');
    unmount();
    useOffice.setState({ companyTab: null });
    render(<CompanyView />);
    expect(screen.getByRole('tab', { name: 'Örgüt' }).getAttribute('aria-selected')).toBe('true');
  });

  it('without a coordinator, offers to hire one or to make an employee coordinator', async () => {
    office([person('ada', { name: 'Ada' })]);
    render(<CompanyView />);
    expect(screen.getByText(/koordinatörü yok/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Koordinatör işe al' }));
    await waitFor(() => expect(api.hireCoordinator).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Koordinatör yapılacak çalışan'), { target: { value: 'ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Koordinatör yap' }));
    await waitFor(() => expect(api.appointCoordinator).toHaveBeenCalledWith('ada'));
  });

  it('draws the org chart: the coordinator on top, teams below, with what each person is doing', () => {
    office(
      [person('koor', { name: 'Koordinatör', kind: 'coordinator', title: 'Koordinatör' }), person('ada', { name: 'Ada', team: 'İçerik', title: 'Yazar' }), person('can', { name: 'Can' })],
      [task('Blog yazısı', { assignee: 'ada', status: 'in_progress' })],
    );
    render(<CompanyView />);
    const top = screen.getByRole('region', { name: 'Koordinatör' });
    expect(within(top).getByRole('button', { name: /Koordinatör/ })).toBeTruthy();
    const content = screen.getByRole('region', { name: 'İçerik' });
    expect(within(content).getByText('Ada')).toBeTruthy();
    expect(within(content).getByText(/Blog yazısı/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Ekipsiz' })).toBeTruthy();
    expect(screen.queryByText(/koordinatörü yok/)).toBeNull();
  });

  it('does not repeat a word the name, title and role badge share', () => {
    office([person('koor', { name: 'Koordinatör', kind: 'coordinator', title: 'Koordinatör' }), person('ada', { name: 'Ada', kind: 'lead', title: 'Ekip lideri' })]);
    render(<CompanyView />);
    expect(within(screen.getByRole('region', { name: 'Koordinatör' })).getAllByText(/Koordinatör/)).toHaveLength(1);
    expect(within(screen.getByRole('region', { name: 'Ekipsiz' })).getAllByText(/Ekip lideri/)).toHaveLength(1);
  });

  it('puts tasks in columns by state and filters them by person', () => {
    office(
      [person('koor', { kind: 'coordinator' }), person('ada', { name: 'Ada' }), person('can', { name: 'Can' })],
      [task('Bekleyen iş'), task('Süren iş', { status: 'in_progress', difficulty: 'hard' }), task('Takılan iş', { status: 'blocked', note: 'şifre yok' }), task('Biten iş', { status: 'done', finishedAt: 5 }), task('Can işi', { assignee: 'can' }), task('Ertelenen', { status: 'parked', notBefore: Date.now() + 3_600_000, parkedReason: 'bekle' })],
    );
    render(<CompanyView />);
    fireEvent.click(screen.getByRole('tab', { name: 'Görevler' }));
    expect(within(screen.getByRole('region', { name: 'Bekliyor' })).getByText('Bekleyen iş')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Sürüyor' })).getByText('Süren iş')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Sürüyor' })).getByText('zor').className).toContain('difficulty');
    expect(within(screen.getByRole('region', { name: 'Takıldı' })).getByText(/şifre yok/)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Bitti' })).getByText('Biten iş')).toBeTruthy();
    // A parked task waits in Bekliyor with its return time (no column of its own).
    expect(within(screen.getByRole('region', { name: 'Bekliyor' })).getByText(/ertelendi/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Ertelendi' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Kişi'), { target: { value: 'can' } });
    expect(screen.queryByText('Bekleyen iş')).toBeNull();
    expect(screen.getByText('Can işi')).toBeTruthy();
  });

  it('has an Ajanda tab that shows the agenda', async () => {
    office([person('koor', { kind: 'coordinator' })]);
    render(<CompanyView />);
    fireEvent.click(screen.getByRole('tab', { name: 'Ajanda' }));
    await waitFor(() => expect(api.agenda).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Zaman çizelgesi' })).toBeTruthy();
  });

  it('opens an employee’s panel from the chart and closes', () => {
    office([person('koor', { name: 'Koordinatör', kind: 'coordinator' })]);
    render(<CompanyView />);
    fireEvent.click(screen.getByRole('button', { name: /Koordinatör/ }));
    expect(useOffice.getState()).toMatchObject({ selectedId: 'koor', companyOpen: false });
  });

  it('lists what waits for the owner first in the Öneriler tab', () => {
    office([person('koor', { kind: 'coordinator' }), person('ada', { name: 'Ada' })]);
    useOffice.setState({
      proposals: {
        a: { id: 'a', ts: 2, by: 'ada', kind: 'idea', title: 'Blog', text: 't', usd: null, planId: null, status: 'open', routedTo: 'koor', decidedBy: null, note: null, decidedAt: null },
        b: { id: 'b', ts: 1, by: 'ada', kind: 'purchase', title: 'Telefon', text: 't', usd: 9, planId: null, status: 'owner', routedTo: null, decidedBy: null, note: null, decidedAt: null },
      },
    });
    render(<CompanyView />);
    fireEvent.click(screen.getByRole('tab', { name: 'Öneriler' }));
    const owner = screen.getByRole('region', { name: 'Senin kararını bekleyenler' });
    expect(within(owner).getByText('Telefon')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Ekipte karar bekleyenler' })).getByText('Blog')).toBeTruthy();
  });

  it('has an İncelemede column with the reviewer and the round on the card', () => {
    office(
      [person('ada', { name: 'Ada' }), person('can', { name: 'Can' })],
      [
        task('Tanıtım metni', { status: 'review', assignee: 'ada', reviewer: 'can', round: 2 }),
        task('İnceleme: Tanıtım metni (tur 2)', { kind: 'review', assignee: 'can', reviewOf: 'Tanıtım metni' }),
      ],
    );
    render(<CompanyView />);
    fireEvent.click(screen.getByRole('tab', { name: 'Görevler' }));
    const column = screen.getByRole('region', { name: 'İncelemede' });
    expect(within(column).getByText('Tanıtım metni')).toBeTruthy();
    expect(column.textContent).toContain('İnceleyen: Can');
    expect(column.textContent).toContain('tur 2');
    expect(within(screen.getByRole('region', { name: 'Bekliyor' })).getByText('İnceleme').className).toContain('review');
  });
});
