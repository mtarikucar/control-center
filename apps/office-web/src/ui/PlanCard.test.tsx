import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plan } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { PlanCard } from './PlanCard.tsx';

vi.mock('../net/api.ts', () => ({ api: { approvePlan: vi.fn(async () => ({})), declinePlan: vi.fn(async () => ({})) } }));
const { api } = await import('../net/api.ts');

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: 'p1', title: 'Tanıtım videosu', goal: 'Ürünü tanıtmak', approach: 'Senaryo, çekim, kurgu', people: 'yazar + videocu', steps: ['senaryo', 'kurgu'],
  quotaPct: 10, usd: 25, days: 3, risks: 'kota', status: 'draft', version: 1, proposedBy: 'c', createdAt: 1, updatedAt: 1, approvedAt: null, ...over,
});

beforeEach(() => useOffice.setState({ plans: { p1: plan() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PlanCard', () => {
  it('shows what the coordinator proposes and asks the owner to approve', async () => {
    render(<PlanCard plan={plan()} />);
    expect(screen.getByText('Tanıtım videosu')).toBeTruthy();
    expect(screen.getByText('Ürünü tanıtmak')).toBeTruthy();
    expect(screen.getByText(/kota %10 · \$25 · 3 gün/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Onayla' }));
    await waitFor(() => expect(api.approvePlan).toHaveBeenCalledWith('p1'));
  });

  it('drops the buttons once the plan is decided, and an older version only points at the newer one', () => {
    useOffice.setState({ plans: { p1: plan({ status: 'approved', version: 2 }) } });
    render(<PlanCard plan={plan({ version: 1 })} />);
    expect(screen.queryByRole('button', { name: 'Onayla' })).toBeNull();
    expect(screen.getByText(/sürüm 2 geldi/)).toBeTruthy();
  });

  it('lets the owner decline and shows an API error', async () => {
    vi.mocked(api.declinePlan).mockRejectedValueOnce(new Error('Yalnız taslak bir plan reddedilebilir.'));
    render(<PlanCard plan={plan()} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' })));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Yalnız taslak bir plan reddedilebilir.');
  });

  it('shows what an approved plan has spent next to its money', () => {
    useOffice.setState({
      plans: { p1: plan({ status: 'approved' }) },
      budget: {
        constitution: { maxEmployees: 8, ownerReservePct: 25, monthlyUsdCap: null, chainDepth: 5, tasksPerDay: 30, openTasksPerPlan: 60, idleSleepMinutes: 30 },
        reserve: { active: false, limitPct: 75, fiveHourPct: null, sevenDayPct: null }, month: { key: '2026-10', usd: 0 }, plans: { p1: { spentUsd: 30, claudeUsd: 1.5 } },
      },
    });
    render(<PlanCard plan={plan({ status: 'approved' })} />);
    expect(screen.getByText('Harcanan: $30 / $25 · Claude ~$1.5').className).toContain('over');
  });
});
