import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Goal, PlanView } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { GoalsTab } from './GoalsTab.tsx';

vi.mock('../net/api.ts', () => ({ api: { stopGoal: vi.fn(async () => ({})) } }));
const { api } = await import('../net/api.ts');

const goal = (over: Partial<Goal> = {}): Goal => ({ id: 'g1', title: 'İlk müşteriler', why: 'Misyon', done: ['10 görüşme'], kpis: [], status: 'active', createdBy: 'c', createdAt: 1, closedAt: null, note: null, ...over });
const plan = (over: Partial<PlanView> = {}): PlanView => ({
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

  it('lists a goal’s KPIs as the coordinator reads them; a goal without KPIs shows no KPI list', () => {
    const kpis: Goal['kpis'] = [
      { name: 'Zamanında hazır oranı', target: 90, direction: 'atLeast', unit: '%', source: 'manual', metric: null, cadence: 'weekly' },
      { name: 'Onay oranı', target: 70, direction: 'atLeast', unit: '%', source: 'office', metric: 'firstPassRate', cadence: 'weekly' },
    ];
    useOffice.setState({ goals: { g1: goal({ kpis }), g2: goal({ id: 'g2', title: 'Sade' }) }, plans: {} });
    render(<GoalsTab />);
    const card = screen.getByRole('region', { name: 'İlk müşteriler' });
    expect(within(card).getByText("KPI'lar")).toBeTruthy();
    expect(within(card).getByText('Zamanında hazır oranı ≥ %90 (elle, haftalık)')).toBeTruthy();
    expect(within(card).getByText('Onay oranı ≥ %70 (ofis: ilk geçişte onay oranı, haftalık)')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Sade' })).queryByText("KPI'lar")).toBeNull();
  });

  it('says when there is no goal yet', () => {
    useOffice.setState({ goals: {}, plans: {} });
    render(<GoalsTab />);
    expect(screen.getByText(/Henüz hedef yok/)).toBeTruthy();
  });
});
