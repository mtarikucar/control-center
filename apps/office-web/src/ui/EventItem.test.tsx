import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityChange, CustomCapability } from '@cc/shared';
import { useOffice } from '../store/office.ts';
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

  it('spec capabilities §7: an outward call let out reads as its outbox line, saying who let it out', () => {
    const entry = { id: 1, employeeId: 'e1', departmentId: null, tool: 'mcp__claude_ai_Gmail__send_message', kind: 'send' as const, target: 'send_message to=a@x.co', recipients: ['a@x.co'], summary: '{}', via: 'system' as const, approvalId: null, at: 0 };
    render(<EventItem stored={{ seq: 1, employeeId: 'e1', ts: 0, event: { type: 'outbox.sent', entry } }} />);
    expect(screen.getByText('Giden: gönderim — send_message to=a@x.co (sistem geçirdi)')).toBeTruthy();
    cleanup();
    render(<EventItem stored={{ seq: 2, employeeId: 'e1', ts: 0, event: { type: 'outbox.sent', entry: { ...entry, kind: 'call', target: 'jeeta_click_to_dial', via: 'owner', approvalId: 'a1' } } }} />);
    expect(screen.getByText('Giden: arama — jeeta_click_to_dial (sahibinin onayıyla)')).toBeTruthy();
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

  it('notes a company profile change with its section, version and whether assumed', () => {
    const entry = { id: 'p1', version: 3, section: 'identity' as const, fields: { name: 'Tatlı Fırın' }, assumed: true, assumedFields: ['name'], by: 'c', ts: 0 };
    const { rerender } = render(<EventItem stored={{ seq: 1, employeeId: 'c', ts: 0, event: { type: 'profile.updated', entry } }} />);
    expect(screen.getByText('Şirket profili: Kimlik (sürüm 3, varsayım)')).toBeTruthy();
    rerender(<EventItem stored={{ seq: 2, employeeId: 'c', ts: 0, event: { type: 'profile.updated', entry: { ...entry, section: 'customers', version: 4, assumed: false, assumedFields: [] } } }} />);
    expect(screen.getByText('Şirket profili: Müşteri ve kanallar (sürüm 4)')).toBeTruthy();
  });

  it('notes goals and the pause in the feed', () => {
    const goal = { id: 'g1', title: 'Lansman', why: 'w', done: ['d'], kpis: [], status: 'active' as const, createdBy: 'c', createdAt: 1, closedAt: null, note: null };
    const { rerender } = render(<EventItem stored={{ seq: 1, employeeId: 'c', ts: 0, event: { type: 'goal.changed', change: 'set', goal } }} />);
    expect(screen.getByText('Hedef: Lansman')).toBeTruthy();
    rerender(<EventItem stored={{ seq: 2, employeeId: 'c', ts: 0, event: { type: 'goal.changed', change: 'stopped', goal: { ...goal, status: 'dropped' } } }} />);
    expect(screen.getByText('Hedef durduruldu: Lansman')).toBeTruthy();
    rerender(<EventItem stored={{ seq: 3, employeeId: 'c', ts: 0, event: { type: 'company.paused', paused: true } }} />);
    expect(screen.getByText('Şirket duraklatıldı')).toBeTruthy();
    rerender(<EventItem stored={{ seq: 4, employeeId: 'c', ts: 0, event: { type: 'company.paused', paused: true, reason: 'Haftalık Claude kotası %90 (sınır %90): ofis kendini duraklattı; sürdürmek sahibinde.' } }} />);
    expect(screen.getByText('Şirket duraklatıldı: Haftalık Claude kotası %90 (sınır %90): ofis kendini duraklattı; sürdürmek sahibinde.')).toBeTruthy();
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

  it('final review F8: a park reads as it was said — “yarın” relative to the event, not to when the feed is read', () => {
    const parkedAt = new Date(2026, 9, 7, 14, 10).getTime();
    const back = new Date(2026, 9, 8, 14, 55).getTime();
    const task = { id: 't1', kind: 'work' as const, planId: null, title: 'Pencere', description: '', done: [], requester: 'owner', assignee: 'ada', priority: 3, dependsOn: [], status: 'parked' as const, chainDepth: 0, note: null, result: null, nudged: false, createdAt: 1, startedAt: null, finishedAt: null, notBefore: back, parkedReason: 'ölçüm' };
    // The feed is read the next morning.
    vi.useFakeTimers({ now: new Date(2026, 9, 8, 9, 0) });
    try {
      render(<EventItem stored={{ seq: 1, employeeId: 'ada', ts: parkedAt, event: { type: 'task.changed', change: 'parked', task } }} />);
      expect(screen.getByText('Görev ertelendi: Pencere (yarın 14:55 — ölçüm)')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('EventItem: capability.changed (final review I2)', () => {
  beforeEach(() =>
    useOffice.setState({
      views: { koord: { employee: { id: 'koord', name: 'Koordinatör', kind: 'coordinator' } } as never, ada: { employee: { id: 'ada', name: 'Ada', kind: 'member' } } as never },
    }),
  );
  const capability = (over: Partial<CustomCapability>): CustomCapability => ({
    id: 'sms.send', title: 'SMS gönderme', summary: 'Netgsm ile SMS.', kind: 'send', tools: ['mcp__netgsm__send_sms', 'mcp__netgsm__send_bulk'], status: 'active',
    proposedBy: 'ada', decidedBy: 'koord', note: null, createdAt: 1, decidedAt: 2, ...over,
  });
  const show = (change: CapabilityChange, c: CustomCapability, employeeId: string | null = 'koord') =>
    render(<EventItem stored={{ seq: 1, employeeId, ts: 0, event: { type: 'capability.changed', change, capability: c } }} />).container;

  it('the coordinator’s own proposal is the owner’s: it says so and where to decide', () => {
    show('proposed', capability({ status: 'proposed', proposedBy: 'koord', decidedBy: null, decidedAt: null }));
    expect(screen.getByText('Koordinatör bir yetenek önerdi: SMS gönderme (gönderim) — karar senin, Yetenekler sekmesinde.')).toBeTruthy();
  });

  it('an employee’s proposal is the coordinator’s to decide: the feed stays quiet', () => {
    expect(show('proposed', capability({ status: 'proposed', proposedBy: 'ada', decidedBy: null, decidedAt: null }), 'ada').textContent).toBe('');
  });

  it('an activation by the coordinator names the kind and the tools, and says the gate asks the owner until it is opened to the system', () => {
    show('activated', capability({}));
    const line = screen.getByText(/Koordinatör bir yeteneği etkinleştirdi/).textContent ?? '';
    expect(line).toContain('SMS gönderme (gönderim; araçlar: mcp__netgsm__send_sms, mcp__netgsm__send_bulk)');
    expect(line).toMatch(/sisteme açılana dek kapıda sana sorulur/);
    expect(line).toMatch(/Yetenekler sekmesinde/);
  });

  it('an activation of a kind the owner is always asked about does not promise a button that changes nothing', () => {
    show('activated', capability({ kind: 'pay', tools: ['mcp__netgsm__buy_credits'] }));
    const line = screen.getByText(/Koordinatör bir yeteneği etkinleştirdi/).textContent ?? '';
    expect(line).toContain('ödeme/harcama; araçlar: mcp__netgsm__buy_credits');
    expect(line).toMatch(/her zaman sana sorulur/);
    expect(line).not.toMatch(/sisteme açılana dek/);
  });

  it('the owner’s own actions, and the coordinator’s rejection, leave the feed quiet', () => {
    const owner = capability({ proposedBy: 'owner', decidedBy: 'owner' });
    for (const change of ['activated', 'confirmed', 'kind', 'retired'] as const) expect([change, show(change, owner, null).textContent]).toEqual([change, '']);
    expect(show('rejected', capability({ status: 'rejected', note: 'Gereksiz.' })).textContent).toBe('');
  });
});
