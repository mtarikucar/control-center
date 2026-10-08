import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GATE_LIMIT_TEXT, type Approval, type BudgetSummary } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { ApprovalCard, ApprovalsTab } from './ApprovalCard.tsx';

vi.mock('../net/api.ts', () => ({ api: { approveApproval: vi.fn(async () => ({})), denyApproval: vi.fn(async () => ({})) } }));
const { api } = await import('../net/api.ts');

const approval = (over: Partial<Approval> = {}): Approval => ({
  id: 'a1', employeeId: 'ada', taskId: 't1', kind: 'publish', tool: 'Bash', target: 'git push origin', fingerprint: 'f', summary: 'Sürümü yayımlamam gerek.',
  scope: 'call', status: 'pending', requestedAt: 1, decidedAt: null, decidedBy: null, decidedVia: null, expiresAt: null, usedAt: null, note: null, ...over,
});
const ada = { employee: { id: 'ada', name: 'Ada' } } as never;
const budget = (gateEnabled: boolean) => ({ constitution: { gateEnabled } }) as unknown as BudgetSummary;

beforeEach(() => useOffice.setState({ approvals: {}, views: { ada }, tasks: { t1: { id: 't1', title: 'Sürüm 1.2' } as never }, budget: budget(true) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ApprovalCard (B9a)', () => {
  it('shows who asks, which tool, the target and why; the owner approves or denies', async () => {
    render(<ApprovalCard approval={approval()} />);
    expect(screen.getByText('yayın')).toBeTruthy();
    expect(screen.getByText('git push origin')).toBeTruthy();
    expect(screen.getByText(/Ada/)).toBeTruthy();
    expect(screen.getByText(/Bash/)).toBeTruthy();
    expect(screen.getByText(/Sürüm 1\.2/)).toBeTruthy();
    expect(screen.getByText('Sürümü yayımlamam gerek.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Onayla' }));
    await waitFor(() => expect(api.approveApproval).toHaveBeenCalledWith('a1'));
    fireEvent.click(screen.getByRole('button', { name: 'Reddet' }));
    await waitFor(() => expect(api.denyApproval).toHaveBeenCalledWith('a1'));
  });

  it('a decided one has no buttons and says how it stands (the live record wins)', () => {
    useOffice.setState({ approvals: { a1: approval({ status: 'used', note: 'tamam', decidedVia: 'page' }) } });
    render(<ApprovalCard approval={approval()} />);
    expect(screen.queryByRole('button', { name: 'Onayla' })).toBeNull();
    expect(screen.getByText('kullanıldı')).toBeTruthy();
    expect(screen.getByText(/tamam/)).toBeTruthy();
  });

  it('shows the server’s error', async () => {
    vi.mocked(api.denyApproval).mockRejectedValueOnce(new Error('Bu onay isteği artık beklemiyor.'));
    render(<ApprovalCard approval={approval()} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reddet' })));
    expect(screen.getByRole('alert').textContent).toMatch(/beklemiyor/);
  });
});

describe('ApprovalsTab (B9a)', () => {
  it('what waits first, then the decided; the gate’s limit is said; a switched-off gate says so', () => {
    useOffice.setState({ approvals: { a1: approval(), a2: approval({ id: 'a2', status: 'denied', target: 'npm publish', requestedAt: 2 }) }, budget: budget(false) });
    const { container } = render(<ApprovalsTab />);
    const sections = [...container.querySelectorAll('.proposal-list')].map((r) => r.getAttribute('aria-label'));
    expect(sections).toEqual(['Senin onayını bekleyenler', 'Karara bağlananlar']);
    expect(screen.getByText(GATE_LIMIT_TEXT)).toBeTruthy();
    expect(screen.getByText(/Kapı kapalı/)).toBeTruthy();
  });
});
