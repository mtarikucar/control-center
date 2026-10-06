import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useOffice } from '../store/office.ts';
import { TopBar } from './TopBar.tsx';

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
});
