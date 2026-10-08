import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plan } from '@cc/shared';
import { useOffice } from '../store/office.ts';
import { PlanCard } from './PlanCard.tsx';

vi.mock('../net/api.ts', () => ({ api: { approvePlan: vi.fn(async () => ({})), declinePlan: vi.fn(async () => ({})), stopPlan: vi.fn(async () => ({})) } }));
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
        constitution: { maxEmployees: 8, ownerReservePct: 25, monthlyUsdCap: null, chainDepth: 5, tasksPerDay: 30, openTasksPerPlan: 60, idleSleepMinutes: 30, digestHours: [9, 17], coordinatorModels: { kickoff: 'fable', cycle: 'opus', routine: 'sonnet' }, cacheTtlMinutes: 5, difficultyModels: { easy: 'haiku', medium: 'sonnet', hard: 'opus', critical: 'fable' }, digestEnabled: false, modelPolicyEnabled: false, difficultyModelsEnabled: false, autonomy: 'free', activeGoals: 10, pulseHours: 6, idleCapacityHours: 2, defaultTaskMinutes: 45, minScheduleMinutes: 60, maxSchedules: 20 },
        reserve: { active: false, limitPct: 75, fiveHourPct: null, sevenDayPct: null }, month: { key: '2026-10', usd: 0 }, plans: { p1: { spentUsd: 30, claudeUsd: 1.5 } },
      },
    });
    render(<PlanCard plan={plan({ status: 'approved' })} />);
    expect(screen.getByText('Harcanan: $30 / $25 · Claude ~$1.5').className).toContain('over');
  });

  it('shows how the work will be done', () => {
    const method = { workType: 'content' as const, stages: [{ name: 'Taslak', role: 'yazar', review: false }, { name: 'Editör', role: 'editör', review: true }], checks: ['marka dili'] };
    useOffice.setState({ plans: { p1: plan({ method }) } });
    render(<PlanCard plan={plan({ method })} />);
    const section = screen.getByRole('region', { name: 'Nasıl yapılacak' });
    expect(section.textContent).toContain('İçerik ve pazarlama');
    expect(section.textContent).toContain('Taslak — yazar');
    expect(section.textContent).toContain('Editör — editör · incelemeli');
    expect(section.textContent).toContain('marka dili');
  });

  it('a plan without a method shows no method section', () => {
    render(<PlanCard plan={plan({ method: null })} />);
    expect(screen.queryByRole('region', { name: 'Nasıl yapılacak' })).toBeNull();
  });

  it('marks a plan the coordinator started and lets the owner stop a running plan', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    useOffice.setState({ plans: { p1: plan({ status: 'approved', approvedBy: 'coordinator' }) } });
    render(<PlanCard plan={plan({ status: 'approved', approvedBy: 'coordinator' })} />);
    expect(screen.getByText('Koordinatör başlattı')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Durdur' }));
    await waitFor(() => expect(api.stopPlan).toHaveBeenCalledWith('p1'));
  });
});
