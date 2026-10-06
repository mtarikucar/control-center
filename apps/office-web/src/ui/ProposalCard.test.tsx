import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Proposal } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { ProposalCard } from './ProposalCard.tsx';

vi.mock('../net/api.ts', () => ({ api: { approveProposal: vi.fn(async () => ({})), rejectProposal: vi.fn(async () => ({})) } }));
const { api } = await import('../net/api.ts');

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: 'q1', ts: 1, by: 'ada', kind: 'purchase', title: 'Telefon hattı', text: 'Müşteriler bizi arayabilsin.', usd: 12, planId: null, status: 'owner',
  routedTo: null, decidedBy: null, note: null, decidedAt: null, ...over,
});

beforeEach(() => useOffice.setState({ proposals: {}, views: {} }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProposalCard', () => {
  it('asks the owner to approve or reject what waits for them', async () => {
    render(<ProposalCard proposal={proposal()} />);
    expect(screen.getByText('Satın alma')).toBeTruthy();
    expect(screen.getByText('Telefon hattı')).toBeTruthy();
    expect(screen.getByText(/\$12/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Onayla' }));
    await waitFor(() => expect(api.approveProposal).toHaveBeenCalledWith('q1'));
  });

  it('has no buttons while the coordinator decides, and shows the decision once made', () => {
    useOffice.setState({ proposals: { q1: proposal({ kind: 'idea', status: 'accepted', note: 'Başla.' }) } });
    render(<ProposalCard proposal={proposal({ kind: 'idea', status: 'open' })} />);
    expect(screen.queryByRole('button', { name: 'Onayla' })).toBeNull();
    expect(screen.getByText('Kabul edildi')).toBeTruthy();
    expect(screen.getByText(/Başla\./)).toBeTruthy();
  });

  it('shows the server’s error', async () => {
    vi.mocked(api.rejectProposal).mockRejectedValueOnce(new Error('Bu öneri sahibinin kararını beklemiyor.'));
    render(<ProposalCard proposal={proposal()} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reddet' })));
    expect(screen.getByRole('alert').textContent).toMatch(/beklemiyor/);
  });
});
