import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Employee, Task } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { CompanyView } from './CompanyView.tsx';

vi.mock('../net/api.ts', () => ({ api: { hireCoordinator: vi.fn(async () => ({ id: 'new' })), appointCoordinator: vi.fn(async () => ({})), events: vi.fn(async () => []) } }));
const { api } = await import('../net/api.ts');

const person = (id: string, over: Partial<Employee> = {}): Employee => ({
  id, slug: id, name: id, role: 'r', model: 'haiku', characterId: 'coder', title: '', team: '', kind: 'member', reportsTo: null, deskIndex: 0,
  sessionId: `s-${id}`, sessionStarted: true, lifecycle: 'idle', limitResetsAt: null, lastError: null, createdAt: 1, ...over,
});
const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, planId: null, title: id, description: '', done: [], requester: 'owner', assignee: 'ada', priority: 3, dependsOn: [], status: 'waiting',
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
      [task('Bekleyen iş'), task('Süren iş', { status: 'in_progress' }), task('Takılan iş', { status: 'blocked', note: 'şifre yok' }), task('Biten iş', { status: 'done', finishedAt: 5 }), task('Can işi', { assignee: 'can' })],
    );
    render(<CompanyView />);
    fireEvent.click(screen.getByRole('tab', { name: 'Görevler' }));
    expect(within(screen.getByRole('region', { name: 'Bekliyor' })).getByText('Bekleyen iş')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Sürüyor' })).getByText('Süren iş')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Takıldı' })).getByText(/şifre yok/)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Bitti' })).getByText('Biten iş')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Kişi'), { target: { value: 'can' } });
    expect(screen.queryByText('Bekleyen iş')).toBeNull();
    expect(screen.getByText('Can işi')).toBeTruthy();
  });

  it('opens an employee’s panel from the chart and closes', () => {
    office([person('koor', { name: 'Koordinatör', kind: 'coordinator' })]);
    render(<CompanyView />);
    fireEvent.click(screen.getByRole('button', { name: /Koordinatör/ }));
    expect(useOffice.getState()).toMatchObject({ selectedId: 'koor', companyOpen: false });
  });
});
