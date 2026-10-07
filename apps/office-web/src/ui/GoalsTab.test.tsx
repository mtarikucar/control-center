import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Goal, Plan } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { GoalsTab } from './GoalsTab.tsx';

vi.mock('../net/api.ts', () => ({ api: { stopGoal: vi.fn(async () => ({})) } }));
const { api } = await import('../net/api.ts');

const goal = (over: Partial<Goal> = {}): Goal => ({ id: 'g1', title: 'İlk müşteriler', why: 'Misyon', done: ['10 görüşme'], status: 'active', createdBy: 'c', createdAt: 1, closedAt: null, note: null, ...over });
const plan = (over: Partial<Plan> = {}): Plan => ({
  id: 'p1', title: 'Görüşmeler', goal: 'g', approach: 'a', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '', status: 'approved', version: 1,
  proposedBy: 'c', createdAt: 1, updatedAt: 1, approvedAt: 1, goalId: 'g1', approvedBy: 'coordinator', ...over,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('GoalsTab', () => {
  it('shows each goal with why, its definition of done and its plans; the owner can stop an active one', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    useOffice.setState({ goals: { g1: goal(), g2: goal({ id: 'g2', title: 'Eski', status: 'done' }) }, plans: { p1: plan() } });
    render(<GoalsTab />);
    const card = screen.getByRole('region', { name: 'İlk müşteriler' });
    expect(card.textContent).toContain('Misyon');
    expect(card.textContent).toContain('10 görüşme');
    expect(card.textContent).toContain('Görüşmeler');
    expect(within(screen.getByRole('region', { name: 'Eski' })).queryByRole('button', { name: 'Durdur' })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Durdur' }));
    await waitFor(() => expect(api.stopGoal).toHaveBeenCalledWith('g1'));
  });

  it('says when there is no goal yet', () => {
    useOffice.setState({ goals: {}, plans: {} });
    render(<GoalsTab />);
    expect(screen.getByText(/Henüz hedef yok/)).toBeTruthy();
  });
});
