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

  it('says when a task goes to review and how a review was decided', () => {
    const base = {
      id: 't1', kind: 'work' as const, planId: null, title: 'Metin', description: '', done: [], requester: 'owner', assignee: 'ada', priority: 3, dependsOn: [],
      status: 'review' as const, chainDepth: 0, note: null, result: null, nudged: false, createdAt: 1, startedAt: null, finishedAt: null,
    };
    const { rerender } = render(<EventItem stored={{ seq: 1, employeeId: 'ada', ts: 0, event: { type: 'task.changed', change: 'in_review', task: base } }} />);
    expect(screen.getByText('Görev incelemede: Metin')).toBeTruthy();
    const findings = [{ severity: 'important' as const, text: 'a' }, { severity: 'important' as const, text: 'b' }, { severity: 'minor' as const, text: 'c' }];
    const review = { ...base, id: 't2', kind: 'review' as const, title: 'İnceleme: Metin (tur 1)', status: 'done' as const, result: { summary: 'x', outputs: [], learned: '', review: { decision: 'changes' as const, findings } } };
    rerender(<EventItem stored={{ seq: 2, employeeId: 'can', ts: 0, event: { type: 'task.changed', change: 'reviewed', task: review } }} />);
    expect(screen.getByText('İnceleme: Metin (tur 1) — değişiklik istendi (2 önemli, 1 küçük)')).toBeTruthy();
  });

  it('notes goals and the pause in the feed', () => {
    const goal = { id: 'g1', title: 'Lansman', why: 'w', done: ['d'], status: 'active' as const, createdBy: 'c', createdAt: 1, closedAt: null, note: null };
    const { rerender } = render(<EventItem stored={{ seq: 1, employeeId: 'c', ts: 0, event: { type: 'goal.changed', change: 'set', goal } }} />);
    expect(screen.getByText('Hedef: Lansman')).toBeTruthy();
    rerender(<EventItem stored={{ seq: 2, employeeId: 'c', ts: 0, event: { type: 'goal.changed', change: 'stopped', goal: { ...goal, status: 'dropped' } } }} />);
    expect(screen.getByText('Hedef durduruldu: Lansman')).toBeTruthy();
    rerender(<EventItem stored={{ seq: 3, employeeId: 'c', ts: 0, event: { type: 'company.paused', paused: true } }} />);
    expect(screen.getByText('Şirket duraklatıldı')).toBeTruthy();
  });

  it('notes parks, returns and routines in the feed', () => {
    const base = { id: 't1', kind: 'work' as const, planId: null, title: 'Pencere', description: '', done: [], requester: 'owner', assignee: 'ada', priority: 3, dependsOn: [], status: 'parked' as const, chainDepth: 0, note: null, result: null, nudged: false, createdAt: 1, startedAt: null, finishedAt: null, notBefore: 5, parkedReason: 'ölçüm' };
    const { rerender } = render(<EventItem stored={{ seq: 1, employeeId: 'ada', ts: 0, event: { type: 'task.changed', change: 'parked', task: base } }} />);
    expect(screen.getByText(/Görev ertelendi: Pencere/)).toBeTruthy();
    rerender(<EventItem stored={{ seq: 2, employeeId: 'ada', ts: 0, event: { type: 'task.changed', change: 'returned', task: { ...base, status: 'waiting' } } }} />);
    expect(screen.getByText('Görev sıraya döndü: Pencere')).toBeTruthy();
    const schedule = { id: 's1', title: 'Günlük', description: '', done: [], assignee: 'ada', reviewer: null, planId: null, priority: 3, difficulty: null, cron: '0 9 * * *', until: null, status: 'active' as const, nextRunAt: 5, lastRunAt: null, lastTaskId: null, skipCount: 0, failCount: 0, createdBy: 'c', createdAt: 1, note: null };
    rerender(<EventItem stored={{ seq: 3, employeeId: 'c', ts: 0, event: { type: 'schedule.changed', change: 'fired', schedule } }} />);
    expect(screen.getByText('Rutin çalıştı: Günlük')).toBeTruthy();
    rerender(<EventItem stored={{ seq: 4, employeeId: null, ts: 0, event: { type: 'clock.jumped', expectedAt: 1, actualAt: 2 } }} />);
    expect(screen.getByText(/Saat atladı/)).toBeTruthy();
    rerender(<EventItem stored={{ seq: 5, employeeId: null, ts: 0, event: { type: 'clock.error', job: 'rutin s1', message: 'veritabanı kilitli' } }} />);
    expect(screen.getByText('Saat: rutin s1 başarısız — veritabanı kilitli')).toBeTruthy();
  });
});
