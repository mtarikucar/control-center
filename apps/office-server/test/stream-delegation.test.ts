import { afterEach, describe, expect, it } from 'vitest';
import { OWNER } from '@cc/shared';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make(autonomy: 'free' | 'plans' = 'free') {
  const s = setup(12);
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f, ['coder', 'designer', 'manager'], undefined, undefined, { departments: true });
  c.budget.setConstitution({ autonomy, maxEmployees: 8 });
  const coordinator = c.company.hireCoordinator('sonnet');
  const departments = c.departments!;
  const yaz = departments.create(OWNER, { template: 'yazilim-otomasyon' });
  const pzr = departments.create(OWNER, { template: 'pazarlama' });
  const selin = c.company.hire(OWNER, { name: 'Selin', role: 'r', departmentId: yaz.id, head: true });
  const mert = c.company.hire(OWNER, { name: 'Mert', role: 'r', departmentId: yaz.id });
  const deniz = c.company.hire(OWNER, { name: 'Deniz', role: 'r', departmentId: pzr.id });
  const said = (id: string) => c.notices.pending(id).map((n) => `${n.topic}: ${n.text}`).join('\n');
  return { ...s, ...c, departments, coordinator, yaz, pzr, selin, mert, deniz, said };
}

const DRAFT = { title: 'Site', goal: 'Yeni site', approach: 'a', method: { ...METHOD, checks: ['Testler geçiyor'] }, usd: 50 };

describe('A department owns a stream (spec §6.1)', () => {
  it('“departman: <ad>” and a plain department name both store departman:<id>; an unknown one is refused', () => {
    const t = make();
    const plan = t.company.propose(t.coordinator.id, {
      ...DRAFT,
      streams: [{ id: 'api', title: 'API', owner: 'departman: yazılım ve otomasyon' }, { id: 'tanitim', title: 'Tanıtım', owner: 'Pazarlama', dependsOn: ['api'] }],
    });
    expect(plan.streams!.map((s) => s.owner)).toEqual([`departman:${t.yaz.id}`, `departman:${t.pzr.id}`]);
    expect(() => t.company.propose(t.coordinator.id, { ...DRAFT, streams: [{ id: 'x', title: 'X', owner: 'departman: Satış' }] })).toThrow(/“x” akışının sahibi departman bulunamadı: Satış\. Açık departmanlar: Yazılım ve Otomasyon, Pazarlama/);
  });
});

describe('Handing streams over (spec §6.2)', () => {
  it('a plan that starts tells each department’s head its stream once; a headless department gets nothing; a revision tells only the new owners', () => {
    const t = make('free');
    const plan = t.company.propose(t.coordinator.id, {
      ...DRAFT,
      streams: [{ id: 'api', title: 'API', owner: 'Yazılım ve Otomasyon' }, { id: 'tanitim', title: 'Tanıtım', owner: 'Pazarlama', dependsOn: ['api'] }],
    });
    expect(t.said(t.selin.id)).toMatch(/stream.assigned: “Site” planının “API” akışı \(api\) Yazılım ve Otomasyon departmanının: hedef Yeni site\. Planın kalite kontrolleri: Testler geçiyor\. Planın tahmini: \$50\. streamPlan ile/);
    expect(t.said(t.deniz.id)).not.toMatch(/stream.assigned/);
    const before = t.notices.pending(t.selin.id).length;
    t.company.revise(t.coordinator.id, plan.id, { streams: [{ id: 'api', title: 'API v2', owner: 'Yazılım ve Otomasyon' }, { id: 'tanitim', title: 'Tanıtım', owner: 'Selin', dependsOn: ['api'] }] });
    expect(t.notices.pending(t.selin.id).length).toBe(before);
  });

  it('under the owner’s approval the head hears at approval, not at the proposal', () => {
    const t = make('plans');
    const plan = t.company.propose(t.coordinator.id, { ...DRAFT, streams: [{ id: 'api', title: 'API', owner: 'Yazılım ve Otomasyon' }] });
    expect(t.said(t.selin.id)).not.toMatch(/stream.assigned/);
    t.company.approve(plan.id);
    expect(t.said(t.selin.id)).toMatch(/stream.assigned: “Site” planının “API” akışı/);
  });

  it('the stream’s last task closing tells the head to report; the head plans and reports, the coordinator hears; others may not', () => {
    const t = make('free');
    const plan = t.company.propose(t.coordinator.id, { ...DRAFT, streams: [{ id: 'api', title: 'API', owner: 'Yazılım ve Otomasyon' }] });
    const note = t.company.streamPlan(t.selin.id, plan.id, 'api', 'Önce uç noktalar, sonra testler.');
    expect(note).toMatchObject({ kind: 'plan', text: 'Önce uç noktalar, sonra testler.', by: t.selin.id });
    const task = t.company.createTask(t.selin.id, { assignee: t.mert.id, title: 'Uç noktalar', planId: plan.id, streamId: 'api' });
    t.company.start(task.id);
    t.company.finish(t.mert.id, task.id, { summary: 'bitti', outputs: [], learned: '' } as never);
    expect(t.said(t.selin.id)).toMatch(/stream.done: “Site” planının “API” akışının açık görevi kalmadı\. streamReport ile/);
    const report = t.company.streamReport(t.selin.id, plan.id, 'api', { summary: 'Uç noktalar hazır.', evidence: ['pnpm test geçti'], next: 'Tanıtım' });
    expect(report).toMatchObject({ kind: 'report', evidence: ['pnpm test geçti'], next: 'Tanıtım' });
    expect(t.said(t.coordinator.id)).toMatch(/stream.report: Selin “Site” planının “API” akışını raporladı: Uç noktalar hazır\. Sırada: Tanıtım/);
    expect(t.company.streamNotes(plan.id)).toEqual([{ streamId: 'api', plan: note, report }]);
    expect(() => t.company.streamPlan(t.deniz.id, plan.id, 'api', 'x')).toThrow(/Bu akış senin departmanının değil/);
    expect(() => t.company.streamPlan(t.mert.id, plan.id, 'api', 'x')).toThrow(/Bu akış senin departmanının değil/);
    expect(t.company.streamPlan(t.coordinator.id, plan.id, 'api', 'koordinatör notu').by).toBe(t.coordinator.id);
    expect(() => t.company.streamPlan(t.selin.id, plan.id, 'yok', 'x')).toThrow(/“Site” planında “yok” akışı yok/);
  });

  it('a headless department’s stream: done goes to the coordinator; losing the head sends stream.returned', () => {
    const t = make('free');
    const plan = t.company.propose(t.coordinator.id, { ...DRAFT, streams: [{ id: 'tanitim', title: 'Tanıtım', owner: 'Pazarlama' }, { id: 'api', title: 'API', owner: 'Yazılım ve Otomasyon' }] });
    t.departments.setHead(OWNER, t.yaz.id, null);
    expect(t.said(t.coordinator.id)).toMatch(/stream.returned: Yazılım ve Otomasyon departmanının başkanı yok; açık akışları sende: “API” \(plan “Site”, api\)/);
    const task = t.company.createTask(t.coordinator.id, { assignee: t.deniz.id, title: 'Duyuru', planId: plan.id, streamId: 'tanitim' });
    t.company.start(task.id);
    t.company.finish(t.deniz.id, task.id, { summary: 'bitti', outputs: [], learned: '' } as never);
    expect(t.said(t.coordinator.id)).toMatch(/stream.done: “Site” planının “Tanıtım” akışının açık görevi kalmadı/);
  });
});

describe('Edges of a department’s stream', () => {
  it('stream.done waits for the review and for the stream’s other tasks; a stream owned by a person never sends it', () => {
    const t = make('free');
    const plan = t.company.propose(t.coordinator.id, {
      ...DRAFT,
      streams: [{ id: 'api', title: 'API', owner: 'Yazılım ve Otomasyon' }, { id: 'kisi', title: 'Kişi', owner: 'Deniz' }],
    });
    const first = t.company.createTask(t.selin.id, { assignee: t.mert.id, title: 'Uç noktalar', planId: plan.id, streamId: 'api', reviewer: t.selin.id });
    const second = t.company.createTask(t.selin.id, { assignee: t.mert.id, title: 'Testler', planId: plan.id, streamId: 'api' });
    t.company.start(first.id);
    t.company.finish(t.mert.id, first.id, { summary: 'bitti', outputs: [], learned: '' } as never);
    expect(t.said(t.selin.id)).not.toMatch(/stream.done/);
    const review = t.tasks.list({ assignee: t.selin.id }).find((x) => x.kind === 'review')!;
    t.company.reviewDecide(t.selin.id, review.id, { decision: 'approve', findings: [] });
    expect(t.said(t.selin.id)).not.toMatch(/stream.done/);
    t.company.start(second.id);
    t.company.finish(t.mert.id, second.id, { summary: 'bitti', outputs: [], learned: '' } as never);
    expect(t.said(t.selin.id).match(/stream.done/g)).toHaveLength(1);
    const own = t.company.createTask(t.coordinator.id, { assignee: t.deniz.id, title: 'Kendi işi', planId: plan.id, streamId: 'kisi' });
    t.company.start(own.id);
    t.company.finish(t.deniz.id, own.id, { summary: 'bitti', outputs: [], learned: '' } as never);
    expect(t.said(t.deniz.id)).not.toMatch(/stream.done/);
    expect(t.said(t.coordinator.id)).not.toMatch(/stream.done/);
  });

  it('without departments a department owner is refused and streamPlan says notes are off', () => {
    const s = setup(8);
    const f = fakeEngine(s);
    cleanups.push(f.cleanup, s.cleanup);
    const c = companyFor(s, f);
    c.budget.setConstitution({ autonomy: 'free' });
    const coordinator = c.company.hireCoordinator('sonnet');
    expect(() => c.company.propose(coordinator.id, { ...DRAFT, streams: [{ id: 'x', title: 'X', owner: 'departman: Satış' }] })).toThrow(/departman bulunamadı: Satış\. Açık departman yok\./);
    const plan = c.company.propose(coordinator.id, { ...DRAFT, streams: [{ id: 'x', title: 'X', owner: coordinator.name }] });
    expect(() => c.company.streamPlan(coordinator.id, plan.id, 'x', 'not')).toThrow(/akış notları açık değil/);
  });
});

describe('Streams given after the start (review round 1)', () => {
  const told = (said: string) => (said.match(/stream\.assigned/g) ?? []).length;
  const TWO = [
    { id: 'api', title: 'API', owner: 'Yazılım ve Otomasyon' },
    { id: 'tanitim', title: 'Tanıtım', owner: 'Pazarlama', dependsOn: ['api'] },
  ];

  it('a free revision that gives a stream to a second headed department tells that head once and the first not again', () => {
    const t = make('free');
    t.departments.setHead(OWNER, t.pzr.id, t.deniz.id);
    const plan = t.company.propose(t.coordinator.id, { ...DRAFT, streams: [TWO[0]!] });
    expect(told(t.said(t.selin.id))).toBe(1);
    expect(told(t.said(t.deniz.id))).toBe(0);
    t.company.revise(t.coordinator.id, plan.id, { streams: TWO });
    expect(told(t.said(t.deniz.id))).toBe(1);
    expect(t.said(t.deniz.id)).toMatch(/stream.assigned: “Site” planının “Tanıtım” akışı \(tanitim\) Pazarlama departmanının/);
    expect(told(t.said(t.selin.id))).toBe(1);
  });

  it('under the owner’s approval: propose, approve, revise to a second department, approve — only the new owner is told', () => {
    const t = make('plans');
    t.departments.setHead(OWNER, t.pzr.id, t.deniz.id);
    const plan = t.company.propose(t.coordinator.id, { ...DRAFT, streams: [TWO[0]!] });
    t.company.approve(plan.id);
    expect(told(t.said(t.selin.id))).toBe(1);
    t.company.revise(t.coordinator.id, plan.id, { streams: TWO });
    expect(told(t.said(t.deniz.id))).toBe(0);
    t.company.approve(plan.id);
    expect(told(t.said(t.deniz.id))).toBe(1);
    expect(told(t.said(t.selin.id))).toBe(1);
  });

  it('a draft that never ran and is then revised under full autonomy starts: every department’s head is told', () => {
    const t = make('plans');
    t.departments.setHead(OWNER, t.pzr.id, t.deniz.id);
    const plan = t.company.propose(t.coordinator.id, { ...DRAFT, streams: TWO });
    expect(told(t.said(t.selin.id)) + told(t.said(t.deniz.id))).toBe(0);
    t.budget.setConstitution({ autonomy: 'free' });
    const revised = t.company.revise(t.coordinator.id, plan.id, { title: 'Site v2' });
    expect(revised.status).toBe('approved');
    expect(t.said(t.selin.id)).toMatch(/stream.assigned: “Site v2” planının “API” akışı/);
    expect(t.said(t.deniz.id)).toMatch(/stream.assigned: “Site v2” planının “Tanıtım” akışı/);
    expect(told(t.said(t.selin.id))).toBe(1);
    expect(told(t.said(t.deniz.id))).toBe(1);
  });

  it('a revision waiting for the owner leaves the running plan’s streams writable; a plan that never ran refuses', () => {
    const t = make('plans');
    const plan = t.company.propose(t.coordinator.id, { ...DRAFT, streams: [TWO[0]!] });
    expect(() => t.company.streamPlan(t.selin.id, plan.id, 'api', 'x')).toThrow(/“Site” planı sürmüyor/);
    expect(() => t.company.streamPlan(t.coordinator.id, plan.id, 'api', 'x')).toThrow(/“Site” planı sürmüyor/);
    t.company.approve(plan.id);
    const waiting = t.company.revise(t.coordinator.id, plan.id, { title: 'Site v2' });
    expect(waiting.status).toBe('draft');
    expect(t.company.streamPlan(t.selin.id, plan.id, 'api', 'Önce uç noktalar.')).toMatchObject({ kind: 'plan', by: t.selin.id });
    const report = t.company.streamReport(t.selin.id, plan.id, 'api', { summary: 'Uç noktalar hazır.' });
    expect(report).toMatchObject({ kind: 'report', next: null });
    expect(t.said(t.coordinator.id)).toMatch(/stream.report: Selin “Site v2” planının “API” akışını raporladı: Uç noktalar hazır\./);
  });

  it('a department given a head later hears of its open streams (not the finished ones, nor another department’s)', () => {
    const t = make('free');
    const plan = t.company.propose(t.coordinator.id, { ...DRAFT, streams: TWO });
    t.departments.setHead(OWNER, t.yaz.id, null);
    const task = t.company.createTask(t.coordinator.id, { assignee: t.deniz.id, title: 'Duyuru', planId: plan.id, streamId: 'tanitim' });
    t.company.start(task.id);
    t.company.finish(t.deniz.id, task.id, { summary: 'bitti', outputs: [], learned: '' } as never);
    expect(told(t.said(t.mert.id))).toBe(0);
    t.departments.setHead(OWNER, t.yaz.id, t.mert.id);
    expect(t.said(t.mert.id)).toContain(`stream.assigned: Artık başkanı olduğun Yazılım ve Otomasyon departmanının açık akışları: “API” (plan “Site”, planId ${plan.id}, streamId api). Her birini streamPlan ile planla`);
    expect(t.said(t.mert.id)).not.toMatch(/Tanıtım/);
    expect(told(t.said(t.mert.id))).toBe(1);
  });
});
