import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOffice } from '../store/office.ts';
import { TopBar } from './TopBar.tsx';

vi.mock('../net/api.ts', () => ({ api: { pauseCompany: vi.fn(async () => ({ paused: true })), resumeCompany: vi.fn(async () => ({ paused: false })) } }));
const { api } = await import('../net/api.ts');
const RESERVE_OFF = { reserve: { active: false, limitPct: 75, fiveHourPct: null, sevenDayPct: null } } as never;

afterEach(cleanup);

describe('TopBar — what waits for the owner', () => {
  it('counts draft plans and proposals waiting for the owner on the Şirket button', () => {
    useOffice.setState({
      plans: { p: { id: 'p', title: 'P', goal: '', approach: '', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '', status: 'draft', version: 1, proposedBy: 'c', createdAt: 1, updatedAt: 1, approvedAt: null } },
      proposals: { q: { id: 'q', ts: 1, by: 'a', kind: 'purchase', title: 'T', text: '', usd: null, planId: null, status: 'owner', routedTo: null, decidedBy: null, note: null, decidedAt: null } },
    });
    render(<TopBar />);
    expect(screen.getByRole('button', { name: /Şirket/ }).textContent).toContain('2');
  });

  it('pauses and resumes the company, and says when it is paused', async () => {
    useOffice.setState({ paused: false, budget: RESERVE_OFF });
    const { rerender } = render(<TopBar />);
    fireEvent.click(screen.getByRole('button', { name: 'Şirketi duraklat' }));
    await waitFor(() => expect(api.pauseCompany).toHaveBeenCalled());
    useOffice.setState({ paused: true });
    rerender(<TopBar />);
    expect(screen.getByText('Şirket duraklatıldı')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sürdür' }));
    await waitFor(() => expect(api.resumeCompany).toHaveBeenCalled());
  });
});
