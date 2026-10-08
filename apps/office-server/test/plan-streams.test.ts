import { afterEach, describe, expect, it } from 'vitest';
import { companyFor, METHOD } from './company-helpers.ts';
import { fakeEngine } from './engine-helpers.ts';
import { setup } from './helpers.ts';

/* Management cycle §3.4 — the living plan: streams on plans, tasks linked to a stream, status derived from the tasks. */

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function make(autonomy: 'free' | 'plans' = 'free') {
  const s = setup();
  const f = fakeEngine(s);
  cleanups.push(f.cleanup, s.cleanup);
  const c = companyFor(s, f);
  c.budget.setConstitution({ autonomy });
  const coordinator = c.company.hireCoordinator('sonnet');
  const ada = c.company.hire(coordinator.id, { name: 'Ada', role: 'yazılımcı' });
  const can = c.company.hire(coordinator.id, { name: 'Can', role: 'yazılımcı' });
  return { ...s, ...c, coordinator, ada, can };
}

const DRAFT = { title: 'Site', goal: 'g', approach: 'a', method: METHOD };
const STREAMS = [
  { id: 'api', title: 'API', owner: 'Ada', dependsOn: [] },
  { id: 'ui', title: 'Arayüz', owner: 'alınacak: tasarımcı', dependsOn: ['api'] },
];
const planEvents = (t: ReturnType<typeof make>) => t.events.list({ limit: 1000 }).filter((e) => e.event.type === 'plan.changed').length;

describe('plan streams', () => {
  it('planPropose keeps the streams, an owner named by name stored by id', () => {
    const t = make();
    const plan = t.company.propose(t.coordinator.id, { ...DRAFT, streams: STREAMS });
    const expected = [
      { id: 'api', title: 'API', owner: t.ada.id, dependsOn: [] },
      { id: 'ui', title: 'Arayüz', owner: 'alınacak: tasarımcı', dependsOn: ['api'] },
    ];
    expect(plan.streams).toEqual(expected);
    expect(t.plans.get(plan.id).streams).toEqual(expected);
    expect(t.company.propose(t.coordinator.id, DRAFT).streams).toEqual([]);
  });

  it('a plan with streams that do not hold is refused before anything is written', () => {
    const t = make();
    const before = planEvents(t);
    expect(() => t.company.propose(t.coordinator.id, { ...DRAFT, streams: [{ id: 'api', title: 'API', owner: 'Zeynep' }] })).toThrow(/akışının sahibi bulunamadı: Zeynep/);
    expect(() => t.company.propose(t.coordinator.id, { ...DRAFT, streams: [{ id: 'a', title: 'A', owner: 'Ada', dependsOn: ['a'] }] })).toThrow(/kendine bağlı/);
    expect(t.plans.list()).toEqual([]);
    expect(planEvents(t)).toBe(before);
  });

  it('planRevise keeps the streams when not given and replaces the whole list when given', () => {
    const t = make();
    const plan = t.company.propose(t.coordinator.id, { ...DRAFT, streams: STREAMS });
    expect(t.company.revise(t.coordinator.id, plan.id, { days: 3 }).streams).toHaveLength(2);
    // null is "not given", as everywhere in the tools; [] is what clears them.
    expect(t.company.revise(t.coordinator.id, plan.id, { streams: null }).streams).toHaveLength(2);
    const revised = t.company.revise(t.coordinator.id, plan.id, { streams: [{ id: 'api', title: 'API', owner: 'Can' }, { id: 'ui', title: 'Arayüz', owner: 'Ada', dependsOn: ['api'] }, { id: 'doc', title: 'Belgeler', owner: 'Can' }] });
    expect(revised).toMatchObject({ status: 'approved', version: 4 });
    expect(revised.streams?.map((s) => [s.id, s.owner])).toEqual([['api', t.can.id], ['ui', t.ada.id], ['doc', t.can.id]]);
  });

  it('“plans to the owner”: a stream change to a running plan is a revision for the owner; declining it keeps the approved streams', () => {
    const t = make('plans');
    const plan = t.company.propose(t.coordinator.id, { ...DRAFT, streams: STREAMS });
    t.company.approve(plan.id);
    const revised = t.company.revise(t.coordinator.id, plan.id, { streams: [...STREAMS, { id: 'doc', title: 'Belgeler', owner: 'Can' }] });
    expect(revised).toMatchObject({ status: 'draft', version: 2 });
    expect(revised.streams).toHaveLength(3);
    const kept = t.company.decline(plan.id);
    expect(kept).toMatchObject({ status: 'approved', version: 1 });
    expect(kept.streams?.map((s) => s.id)).toEqual(['api', 'ui']);
  });

  it('a stream with tasks cannot be dropped by a revision; one without tasks can, and one with tasks can change', () => {
    const t = make();
    const plan = t.company.propose(t.coordinator.id, { ...DRAFT, streams: [...STREAMS, { id: 'doc', title: 'Belgeler', owner: 'Can' }] });
    t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Uç noktalar', planId: plan.id, streamId: 'api' });
    expect(() => t.company.revise(t.coordinator.id, plan.id, { streams: [STREAMS[1]!].map((s) => ({ ...s, dependsOn: [] })) })).toThrow(/“API” akışına bağlı görevler var/);
    expect(t.plans.get(plan.id).streams).toHaveLength(3);
    const revised = t.company.revise(t.coordinator.id, plan.id, { streams: [{ id: 'api', title: 'API ve veri', owner: 'Can' }, STREAMS[1]] });
    expect(revised.streams?.map((s) => [s.id, s.title, s.owner])).toEqual([['api', 'API ve veri', t.can.id], ['ui', 'Arayüz', 'alınacak: tasarımcı']]);
  });

  it('a revision that resends the owner of a stream who was let go says they left and the stream needs a new owner', () => {
    const t = make();
    const plan = t.company.propose(t.coordinator.id, { ...DRAFT, streams: STREAMS });
    t.roster.update(t.ada.id, { lifecycle: 'archived' });
    const same = t.plans.get(plan.id).streams!;
    expect(() => t.company.revise(t.coordinator.id, plan.id, { streams: same })).toThrow(/“api” akışının sahibi Ada işten ayrıldı; akışa yeni bir sahip ver/);
    expect(t.company.revise(t.coordinator.id, plan.id, { days: 2 }).streams?.[0]?.owner).toBe(t.ada.id);
    expect(t.company.revise(t.coordinator.id, plan.id, { streams: [{ ...same[0]!, owner: 'Can' }, same[1]!] }).streams?.[0]?.owner).toBe(t.can.id);
  });

  it('taskCreate links a task to a stream of its plan', () => {
    const t = make();
    const plan = t.company.propose(t.coordinator.id, { ...DRAFT, streams: STREAMS });
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Uç noktalar', planId: plan.id, streamId: 'api' });
    expect(task.streamId).toBe('api');
    expect(t.tasks.get(task.id).streamId).toBe('api');
    expect(t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Akışsız', planId: plan.id }).streamId).toBeNull();
  });

  it('taskCreate refuses a stream that is not its plan’s, and a stream with no plan', () => {
    const t = make();
    const plan = t.company.propose(t.coordinator.id, { ...DRAFT, streams: STREAMS });
    const bare = t.company.propose(t.coordinator.id, { ...DRAFT, title: 'Akışsız plan' });
    expect(() => t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'x', planId: plan.id, streamId: 'doc' })).toThrow(/“Site” planında “doc” akışı yok. Planın akışları: api, ui/);
    expect(() => t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'x', planId: bare.id, streamId: 'api' })).toThrow(/“Akışsız plan” planının akışı yok/);
    expect(() => t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'x', streamId: 'api' })).toThrow(/planId de ver/);
    expect(t.tasks.list().filter((x) => x.title === 'x')).toEqual([]);
  });

  it('a stream’s status comes from its tasks; the review of a stream’s task belongs to the stream too', () => {
    const t = make();
    const plan = t.company.propose(t.coordinator.id, { ...DRAFT, streams: [...STREAMS, { id: 'doc', title: 'Belgeler', owner: 'Can' }] });
    const status = () => Object.fromEntries(t.company.planStreams(plan.id).map((s) => [s.id, s.status]));
    expect(status()).toEqual({ api: 'planned', ui: 'planned', doc: 'planned' });
    const api = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'Uç noktalar', planId: plan.id, streamId: 'api', reviewer: t.can.id });
    const doc = t.company.createTask(t.coordinator.id, { assignee: t.can.id, title: 'README', planId: plan.id, streamId: 'doc' });
    t.company.createTask(t.coordinator.id, { assignee: t.can.id, title: 'Ekran', planId: plan.id, streamId: 'ui' });
    t.company.start(api.id);
    t.company.start(doc.id);
    t.company.update(t.can.id, doc.id, { blocked: true, note: 'erişim yok' });
    expect(status()).toEqual({ api: 'active', ui: 'planned', doc: 'blocked' });
    t.company.finish(t.ada.id, api.id, { summary: 'tamam', outputs: [], learned: '' });
    const review = t.tasks.list({ planId: plan.id }).find((x) => x.kind === 'review')!;
    expect(review.streamId).toBe('api');
    expect(status().api).toBe('active');
    t.company.reviewDecide(t.can.id, review.id, { decision: 'approve' });
    expect(status()).toEqual({ api: 'done', ui: 'planned', doc: 'blocked' });
    expect(t.company.planStreams(plan.id)[0]).toEqual({ id: 'api', title: 'API', owner: t.ada.id, dependsOn: [], status: 'done' });
  });

  it('hasRunningPlan: a plan waiting for the owner or under way; not one done, declined or stopped', () => {
    const t = make('plans');
    expect(t.company.hasRunningPlan()).toBe(false);
    const a = t.company.propose(t.coordinator.id, DRAFT);
    expect(t.company.hasRunningPlan()).toBe(true);
    t.company.decline(a.id);
    expect(t.company.hasRunningPlan()).toBe(false);
    const b = t.company.propose(t.coordinator.id, DRAFT);
    t.company.approve(b.id);
    expect(t.company.hasRunningPlan()).toBe(true);
    const task = t.company.createTask(t.coordinator.id, { assignee: t.ada.id, title: 'tek iş', planId: b.id });
    t.company.start(task.id);
    t.company.finish(t.ada.id, task.id, { summary: 'tamam', outputs: [], learned: '' });
    expect(t.plans.get(b.id).status).toBe('done');
    expect(t.company.hasRunningPlan()).toBe(false);
    const c = t.company.propose(t.coordinator.id, DRAFT);
    t.company.approve(c.id);
    t.company.stopPlan(c.id);
    expect(t.company.hasRunningPlan()).toBe(false);
  });
});
