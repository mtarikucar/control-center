import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EventItem } from './EventItem.tsx';

afterEach(cleanup);

describe('EventItem', () => {
  it('folds unreachable connections into one collapsed line', () => {
    const mcp = [
      { name: 'office', status: 'connected' },
      { name: 'plugin:design:gmail', status: 'failed' },
      { name: 'plugin:marketing:gmail', status: 'failed' },
      { name: 'claude.ai Slack', status: 'needs-auth' },
    ];
    const { container } = render(<EventItem stored={{ seq: 1, employeeId: 'e1', ts: 0, event: { type: 'session.started', model: 'm', mcp } }} />);
    expect(screen.getByText('2 bağlantı açılamadı')).toBeTruthy();
    expect(container.querySelector('details')?.open).toBe(false);
    expect(screen.getByText('plugin:design:gmail, plugin:marketing:gmail')).toBeTruthy();
  });

  it('says nothing when every connection is up', () => {
    const { container } = render(<EventItem stored={{ seq: 1, employeeId: 'e1', ts: 0, event: { type: 'session.started', model: 'm', mcp: [{ name: 'office', status: 'connected' }] } }} />);
    expect(container.textContent).toBe('');
  });

  it('says a plan was reopened when a finished plan gets a new task', () => {
    const plan = {
      id: 'p1', title: 'Lansman', goal: 'g', approach: 'a', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '',
      status: 'approved' as const, version: 1, proposedBy: 'c', createdAt: 1, updatedAt: 1, approvedAt: 1,
    };
    render(<EventItem stored={{ seq: 1, employeeId: 'c', ts: 0, event: { type: 'plan.changed', change: 'reopened', plan } }} />);
    expect(screen.getByText(/Lansman.*yeniden açıldı/)).toBeTruthy();
  });
});
