import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Approval, Employee, Goal, Integration, PlanView, Task } from '@cc/shared';
import { useOffice } from '../store/office.ts';

vi.mock('../net/api.ts', () => ({
  api: {
    integrations: vi.fn(async (): Promise<Integration[]> => []),
    setIntegration: vi.fn(async (): Promise<Integration> => ({}) as Integration),
    send: vi.fn(async () => ({ ok: true })),
    events: vi.fn(async () => []),
    approvePlan: vi.fn(async () => ({})),
    declinePlan: vi.fn(async () => ({})),
    stopPlan: vi.fn(async () => ({})),
    approveApproval: vi.fn(async () => ({})),
    denyApproval: vi.fn(async () => ({})),
    approveProposal: vi.fn(async () => ({})),
    rejectProposal: vi.fn(async () => ({})),
    streamNotes: vi.fn(async () => []),
  },
}));
const { api } = await import('../net/api.ts');
const { Cockpit } = await import('./Cockpit.tsx');

const person = (id: string, name: string, over: Partial<Employee> = {}): Employee => ({
  id, slug: id, name, role: 'r', model: 'haiku', characterId: 'coder', title: '', team: '', kind: 'member', reportsTo: null, deskIndex: 0, sessionId: `s-${id}`,
  sessionStarted: true, lifecycle: 'idle', limitResetsAt: null, lastError: null, createdAt: 1, ...over,
});
const view = (e: Employee) => ({ employee: e, events: [], openTools: {}, idleSince: null, eventsLoaded: true });
const task = (id: string, title: string, over: Partial<Task> = {}): Task => ({
  id, kind: 'work', planId: null, title, description: '', done: [], requester: 'k', assignee: 'elif', priority: 3, dependsOn: [], status: 'in_progress', chainDepth: 0,
  note: null, result: null, nudged: false, createdAt: 1, startedAt: 2, finishedAt: null, ...over,
});
const plan = (over: Partial<PlanView> = {}): PlanView => ({
  id: 'p1', title: 'İlk iki haftalık yayın', goal: 'g', approach: 'a', people: '', steps: ['Takvimi kur.', 'Sekiz gönderi yaz.'], quotaPct: null, usd: null, days: null, risks: '',
  status: 'draft', version: 1, proposedBy: 'k', createdAt: 1, updatedAt: 1, approvedAt: null, goalId: 'g1', ...over,
});
const approval = (over: Partial<Approval> = {}): Approval => ({
  id: 'a1', employeeId: 'k', taskId: null, kind: 'other', tool: 'browser', target: 'WhatsApp', fingerprint: 'f', summary: 'WhatsApp numarasını Jeeta’ya bağla', scope: 'call',
  status: 'pending', requestedAt: 5, decidedAt: null, decidedBy: null, decidedVia: null, expiresAt: null, usedAt: null, note: null, ...over,
});
const goal = (over: Partial<Goal> = {}): Goal => ({ id: 'g1', title: 'Figurunica: Jeeta ile pazarlama', why: 'w', done: ['4 yayın'], status: 'active', createdBy: 'k', createdAt: 1, closedAt: null, note: null, kpis: [], ...over });

beforeEach(() => {
  useOffice.setState({
    views: {
      k: view(person('k', 'Koordinatör', { kind: 'coordinator', lifecycle: 'working' })),
      elif: view(person('elif', 'Elif', { title: 'Sosyal medya', lifecycle: 'idle' })),
      deniz: view(person('deniz', 'Deniz', { title: 'Editör', lifecycle: 'working' })),
    },
    tasks: {
      t1: task('t1', 'İçerik formatı araştırması', { assignee: 'deniz' }),
      t2: task('t2', 'Meta App Review', { assignee: 'k', status: 'blocked', note: 'tarayıcı gerek' }),
      t3: task('t3', 'Eski iş', { status: 'done', finishedAt: 9 }),
    },
    plans: { p1: plan() },
    approvals: { a1: approval() },
    proposals: {},
    goals: { g1: goal() },
    selectedId: null,
    synced: true,
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Cockpit — the flat one-page office', () => {
  it('lists the team with what each does, coordinator first; a click opens that desk', () => {
    render(<Cockpit />);
    const team = screen.getByRole('list', { name: 'Ekip' });
    const names = within(team).getAllByRole('button').map((b) => b.textContent);
    expect(names[0]).toContain('Koordinatör');
    expect(names[0]).toContain('Meta App Review');
    // After the coordinator, desk order, then the name: Deniz before Elif.
    expect(names[1]).toContain('Deniz');
    expect(names[1]).toContain('İçerik formatı araştırması');
    expect(names[2]).toContain('Elif');
    expect(names[2]).toContain('Boşta');
    fireEvent.click(within(team).getAllByRole('button')[1]!);
    expect(useOffice.getState().selectedId).toBe('deniz');
  });

  it('puts what waits for the owner first: the pending approval and the draft plan, with their buttons', async () => {
    render(<Cockpit />);
    const waiting = screen.getByRole('region', { name: 'Senden bekleyenler' });
    expect(within(waiting).getByText('2')).toBeTruthy();
    expect(within(waiting).getByText('WhatsApp numarasını Jeeta’ya bağla')).toBeTruthy();
    expect(within(waiting).getByText('İlk iki haftalık yayın')).toBeTruthy();
    fireEvent.click(within(waiting).getAllByRole('button', { name: 'Onayla' })[0]!);
    await waitFor(() => expect(api.approveApproval).toHaveBeenCalledWith('a1'));
  });

  it('says so when nothing waits', () => {
    useOffice.setState({ approvals: {}, plans: {} });
    render(<Cockpit />);
    expect(within(screen.getByRole('region', { name: 'Senden bekleyenler' })).getByText(/Senden bir şey beklenmiyor/)).toBeTruthy();
  });

  it('shows the goals with their plans and the open tasks, stuck ones first, and never the finished', () => {
    render(<Cockpit />);
    const goals = screen.getByRole('region', { name: 'Hedefler' });
    expect(within(goals).getByText('Figurunica: Jeeta ile pazarlama')).toBeTruthy();
    expect(within(goals).getByText('İlk iki haftalık yayın')).toBeTruthy();
    const open = screen.getByRole('list', { name: 'Açık işler' });
    const items = within(open).getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toContain('Meta App Review');
    expect(items[0]).toContain('Takıldı');
    expect(items[1]).toContain('İçerik formatı araştırması');
    expect(items.join(' ')).not.toContain('Eski iş');
  });

  const conn = (name: string, status: Integration['status'], over: Partial<Integration> = {}): Integration => ({
    name, kind: name.startsWith('claude.ai') ? 'claude_ai' : 'local_mcp', status, registryClosed: false, desks: [], capabilities: [], authNeeded: null, costNote: null, note: null,
    registeredBy: null, registeredAt: null, firstSeen: 1, lastSeen: 2, ...over,
  });

  it('shows the connections in use — connected, broken or recorded — broken first; the account’s unused connectors fold away; the office’s own server is left out', async () => {
    vi.mocked(api.integrations).mockResolvedValueOnce([
      conn('claude.ai Gmail', 'connected'),
      conn('office', 'connected', { kind: 'office' }),
      conn('jeeta', 'failed', { authNeeded: 'sunucu kapalı' }),
      conn('claude.ai Booking.com', 'needs_auth'),
      conn('claude.ai Expedia', 'denied'),
      conn('Muhasebe CLI', 'needs_auth', { registeredBy: 'k' }),
      conn('claude.ai Slack', 'closed', { registryClosed: true }),
    ]);
    render(<Cockpit />);
    const list = await screen.findByRole('list', { name: 'Bağlantılar' });
    const rows = within(list).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('jeeta');
    expect(rows[0]).toContain('hata');
    expect(rows[1]).toContain('Muhasebe CLI');
    expect(rows[2]).toContain('claude.ai Gmail');
    expect(rows[2]).toContain('bağlı');
    const idle = screen.getByText('2 bağlayıcı kullanılmıyor').closest('details')!;
    expect(idle.open).toBe(false);
    expect(within(idle).getByText('claude.ai Booking.com')).toBeTruthy();
    expect(within(idle).getByText('claude.ai Expedia')).toBeTruthy();
    expect(screen.queryByText('claude.ai Slack')).toBeNull();
  });

  it('“Kapat” closes a connector in the registry and drops it from the list; a connected one has no such button', async () => {
    vi.mocked(api.integrations).mockResolvedValueOnce([conn('claude.ai Gmail', 'connected'), conn('jeeta', 'failed')]);
    vi.mocked(api.setIntegration).mockResolvedValueOnce(conn('jeeta', 'closed', { registryClosed: true }));
    render(<Cockpit />);
    const list = await screen.findByRole('list', { name: 'Bağlantılar' });
    expect(within(list).queryByRole('button', { name: 'claude.ai Gmail bağlantısını kapat' })).toBeNull();
    fireEvent.click(within(list).getByRole('button', { name: 'jeeta bağlantısını kapat' }));
    await waitFor(() => expect(api.setIntegration).toHaveBeenCalledWith('jeeta', { closed: true }));
    await waitFor(() => expect(within(list).queryByText('jeeta')).toBeNull());
  });

  it('sends a message to the coordinator from the page itself', async () => {
    render(<Cockpit />);
    const box = screen.getByRole('textbox', { name: 'Koordinatöre yaz' });
    fireEvent.change(box, { target: { value: 'telefonu taktım' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gönder' }));
    await waitFor(() => expect(api.send).toHaveBeenCalledWith('k', 'telefonu taktım'));
    expect((box as HTMLTextAreaElement).value).toBe('');
  });

  it('the desk the owner opens takes the middle column; closing it brings the waiting list back', () => {
    render(<Cockpit />);
    act(() => useOffice.getState().select('deniz'));
    const panel = screen.getByRole('complementary', { name: 'Deniz paneli' });
    expect(panel.closest('.cockpit-main')).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'Senden bekleyenler' })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'Paneli kapat' }));
    expect(screen.getByRole('region', { name: 'Senden bekleyenler' })).toBeTruthy();
  });

  it('without a coordinator there is no message box, and the team list still shows', () => {
    act(() => useOffice.setState({ views: { elif: view(person('elif', 'Elif')) } }));
    render(<Cockpit />);
    expect(screen.queryByRole('textbox', { name: 'Koordinatöre yaz' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Ekip' })).toBeTruthy();
  });
});
