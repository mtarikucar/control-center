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

  it('notes decisions, reverts, playbook versions and knowledge notes in the feed', () => {
    const decision = { id: 'd1', ts: 0, by: 'c', title: 'Ses aracı', chosen: 'ElevenLabs', reason: 'r', alternatives: [], planId: null, reverts: null };
    const { rerender } = render(<EventItem stored={{ seq: 1, employeeId: 'c', ts: 0, event: { type: 'decision.recorded', decision } }} />);
    expect(screen.getByText('Karar: Ses aracı → ElevenLabs')).toBeTruthy();
    rerender(<EventItem stored={{ seq: 2, employeeId: 'c', ts: 0, event: { type: 'decision.recorded', decision: { ...decision, id: 'd2', title: 'Geri alındı: Ses aracı', reverts: 'd1' } } }} />);
    expect(screen.getByText('Sahibi bir kararı geri aldı: Ses aracı')).toBeTruthy();
    rerender(<EventItem stored={{ seq: 3, employeeId: 'c', ts: 0, event: { type: 'playbook.updated', topic: 'Test', version: 2, reason: '' } }} />);
    expect(screen.getByText('El kitabı: Test (sürüm 2)')).toBeTruthy();
    rerender(<EventItem stored={{ seq: 4, employeeId: 'c', ts: 0, event: { type: 'note.written', id: 3, title: 'Seslendirme', tags: [] } }} />);
    expect(screen.getByText('Not: Seslendirme')).toBeTruthy();
  });

  it('notes spending and model changes in the feed', () => {
    const { rerender } = render(<EventItem stored={{ seq: 1, employeeId: 'e1', ts: 0, event: { type: 'spend.recorded', spend: { id: 's', ts: 0, by: 'e1', service: 'Canva', usd: 12.5, purpose: 'görsel', planId: null } } }} />);
    expect(screen.getByText('Harcama: Canva $12.5 — görsel')).toBeTruthy();
    rerender(<EventItem stored={{ seq: 2, employeeId: 'e1', ts: 0, event: { type: 'model.changed', model: 'sonnet' } }} />);
    expect(screen.getByText('Model: sonnet')).toBeTruthy();
  });
});
