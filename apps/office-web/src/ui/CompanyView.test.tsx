import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Employee, PlanView, Task } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { CompanyView } from './CompanyView.tsx';

vi.mock('../net/api.ts', () => ({
  api: {
    hireCoordinator: vi.fn(async () => ({ id: 'new' })), appointCoordinator: vi.fn(async () => ({})), events: vi.fn(async () => []),
    agenda: vi.fn(async () => ({ generatedAt: 0, horizonMs: 0, clock: { nextDueAt: null, nextDueLabel: null, lastRunAt: null, lastJumpAt: null }, employees: [] })),
    management: vi.fn(async () => ({ generatedAt: Date.now(), open: null, cycles: [
      { seq: 3, startedAt: Date.now() - 600_000, endedAt: Date.now() - 300_000, closed: true, model: 'opus', costUsd: 0.3, triggers: [{ kind: 'delivery', at: 1, note: '“Giriş” (Ada)', seq: 2 }], changes: ['Kayıt işini Can’a verdim'], reasoning: 'Can boştaydı.', next: null },
    ] })),
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
    departments: {},
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

  it('the org chart groups people by department in opening order, the head first, then the centre', () => {
    office([person('k', { kind: 'coordinator', name: 'Koordinatör' }), person('mert', { departmentId: 'd1' }), person('selin', { kind: 'lead', departmentId: 'd1' }), person('deniz', { departmentId: 'd2' }), person('ada')]);
    useOffice.setState({
      departments: {
        d2: { id: 'd2', name: 'Pazarlama', mission: 'm', scope: '', template: null, headId: null, status: 'open', createdAt: 2, closedAt: null },
        d1: { id: 'd1', name: 'Yazılım', mission: 'm', scope: '', template: null, headId: 'selin', status: 'open', createdAt: 1, closedAt: null },
      },
    } as never);
    render(<CompanyView />);
    const groups = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label')).filter((l) => l !== 'Koordinatör');
    expect(groups).toEqual(['Yazılım', 'Pazarlama', 'Merkez']);
    const yazilim = screen.getByRole('region', { name: 'Yazılım' });
    expect(within(yazilim).getAllByRole('button').map((b) => b.textContent)[0]).toMatch(/selin/);
    expect(screen.getByRole('tab', { name: 'Departmanlar' })).toBeTruthy();
  });

  it('a department named like the centre does not swallow it: two sections, each with its own people', () => {
    office([person('k', { kind: 'coordinator', name: 'Koordinatör' }), person('selin', { departmentId: 'd1' }), person('ada')]);
    useOffice.setState({
      departments: { d1: { id: 'd1', name: 'Merkez', mission: 'm', scope: '', template: null, headId: null, status: 'open', createdAt: 1, closedAt: null } },
    } as never);
    render(<CompanyView />);
    const sections = screen.getAllByRole('region', { name: 'Merkez' });
    expect(sections).toHaveLength(2);
    expect(within(sections[0]!).getByText('selin')).toBeTruthy();
    expect(within(sections[0]!).queryByText('ada')).toBeNull();
    expect(within(sections[1]!).getByText('ada')).toBeTruthy();
    expect(within(sections[1]!).queryByText('selin')).toBeNull();
  });

  it('a closed department draws no section of its own; its people are in the centre', () => {
    office([person('k', { kind: 'coordinator', name: 'Koordinatör' }), person('mert', { departmentId: 'd1' }), person('deniz', { departmentId: 'd2' })]);
    useOffice.setState({
      departments: {
        d1: { id: 'd1', name: 'Eski', mission: 'm', scope: '', template: null, headId: null, status: 'closed', createdAt: 1, closedAt: 5 },
        d2: { id: 'd2', name: 'Yazılım', mission: 'm', scope: '', template: null, headId: null, status: 'open', createdAt: 2, closedAt: null },
      },
    } as never);
    render(<CompanyView />);
    expect(screen.queryByRole('region', { name: 'Eski' })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Merkez' })).getByText('mert')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Yazılım' })).queryByText('mert')).toBeNull();
  });

  it('marks the department head’s card with ★ and no other', () => {
    office([person('k', { kind: 'coordinator', name: 'Koordinatör' }), person('mert', { departmentId: 'd1' }), person('selin', { kind: 'lead', departmentId: 'd1' }), person('ada')]);
    useOffice.setState({
      departments: { d1: { id: 'd1', name: 'Yazılım', mission: 'm', scope: '', template: null, headId: 'selin', status: 'open', createdAt: 1, closedAt: null } },
    } as never);
    render(<CompanyView />);
    const cards = within(screen.getByRole('region', { name: 'Yazılım' })).getAllByRole('button');
    expect(cards[0]!.textContent).toMatch(/selin/);
    expect(cards[0]!.textContent).toContain('★');
    expect(cards[1]!.textContent).not.toContain('★');
    expect(within(screen.getByRole('region', { name: 'Merkez' })).getByRole('button').textContent).not.toContain('★');
  });

  it('the head’s ★ is decoration for a screen reader (the card names the role) and a tooltip for the eye', () => {
    office([person('k', { kind: 'coordinator', name: 'Koordinatör' }), person('selin', { kind: 'lead', title: 'Departman başkanı', departmentId: 'd1' })]);
    useOffice.setState({
      departments: { d1: { id: 'd1', name: 'Yazılım', mission: 'm', scope: '', template: null, headId: 'selin', status: 'open', createdAt: 1, closedAt: null } },
    } as never);
    const { container } = render(<CompanyView />);
    const star = container.querySelector('.org-head')!;
    expect(star.getAttribute('title')).toBe('Departman başkanı');
    expect(star.getAttribute('aria-hidden')).toBe('true');
    expect(star.hasAttribute('aria-label')).toBe(false);
  });

  it('does not repeat a word the name, title and role badge share', () => {
    office([person('koor', { name: 'Koordinatör', kind: 'coordinator', title: 'Koordinatör' }), person('ada', { name: 'Ada', kind: 'lead', title: 'Departman başkanı' })]);
    render(<CompanyView />);
    expect(within(screen.getByRole('region', { name: 'Koordinatör' })).getAllByText(/Koordinatör/)).toHaveLength(1);
    expect(within(screen.getByRole('region', { name: 'Ekipsiz' })).getAllByText(/Departman başkanı/)).toHaveLength(1);
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

  it('has a Yönetim tab with the coordinator’s management log', async () => {
    office([person('koor', { kind: 'coordinator' })]);
    render(<CompanyView />);
    fireEvent.click(screen.getByRole('tab', { name: 'Yönetim' }));
    await waitFor(() => expect(api.management).toHaveBeenCalled());
    expect(await screen.findByText('Kayıt işini Can’a verdim')).toBeTruthy();
    expect(screen.getByText('Teslim: “Giriş” (Ada)')).toBeTruthy();
  });

  it('management cycle §3.4: a task card names its plan’s stream', () => {
    const plan: PlanView = {
      id: 'p1', title: 'Site', goal: 'g', approach: 'a', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '', status: 'approved', version: 1, proposedBy: 'koor',
      createdAt: 1, updatedAt: 1, approvedAt: 1, streams: [{ id: 'api', title: 'API', owner: 'ada', dependsOn: [], status: 'active' }],
    };
    office([person('ada', { name: 'Ada' })], [task('Uç noktalar', { planId: 'p1', streamId: 'api' }), task('Akışsız iş', { planId: 'p1' })]);
    useOffice.setState({ plans: { p1: plan } });
    render(<CompanyView />);
    fireEvent.click(screen.getByRole('tab', { name: 'Görevler' }));
    const card = screen.getByText('Uç noktalar').closest('article')!;
    expect(within(card).getByText('akış: API')).toBeTruthy();
    expect(screen.getByText('Akışsız iş').closest('article')!.textContent).not.toContain('akış');
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
