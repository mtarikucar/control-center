import { describe, expect, it } from 'vitest';
import { migrateUp, openDb } from '../src/db.ts';
import { NoticeStore, PlanStore, TaskStore, type NewTask } from '../src/company/store.ts';

function stores() {
  const db = openDb(':memory:');
  migrateUp(db);
  let t = 1_000;
  const now = () => (t += 1);
  return { tasks: new TaskStore(db, now), plans: new PlanStore(db, now), notices: new NoticeStore(db, now) };
}

const task = (over: Partial<NewTask> = {}): NewTask => ({
  planId: null, title: 'Yaz', description: 'd', done: ['bitti'], requester: 'owner', assignee: 'e1', priority: 3,
  dependsOn: [], chainDepth: 0, ...over,
});

describe('TaskStore', () => {
  it('creates and reads a task with its lists intact', () => {
    const { tasks } = stores();
    const created = tasks.create(task({ done: ['a', 'b'], dependsOn: [] }));
    expect(tasks.get(created.id)).toEqual(created);
    expect(created).toMatchObject({ status: 'waiting', done: ['a', 'b'], note: null, result: null, nudged: false, startedAt: null });
  });

  it('gives the most urgent waiting task first, then the oldest, and skips tasks whose dependencies are not done', () => {
    const { tasks } = stores();
    const later = tasks.create(task({ title: 'sonra', priority: 3 }));
    const urgent = tasks.create(task({ title: 'acil', priority: 1 }));
    const blocked = tasks.create(task({ title: 'bekleyen', priority: 1, dependsOn: [later.id] }));
    expect(tasks.nextFor('e1')?.id).toBe(urgent.id);
    tasks.update(urgent.id, { status: 'done' });
    expect(tasks.nextFor('e1')?.id).toBe(later.id);
    tasks.update(later.id, { status: 'done' });
    expect(tasks.nextFor('e1')?.id).toBe(blocked.id);
    expect(tasks.nextFor('someone-else')).toBeNull();
  });

  it('knows what is in progress, what one person opened lately and how much of a plan is open', () => {
    const { tasks } = stores();
    const a = tasks.create(task({ requester: 'e2', planId: 'p1' }));
    tasks.create(task({ requester: 'e2', planId: 'p1' }));
    expect(tasks.inProgressOf('e1')).toBeNull();
    tasks.update(a.id, { status: 'in_progress', startedAt: 5 });
    expect(tasks.inProgressOf('e1')?.id).toBe(a.id);
    expect(tasks.createdSince('e2', 0)).toBe(2);
    expect(tasks.createdSince('e2', 10_000)).toBe(0);
    expect(tasks.openInPlan('p1')).toBe(2);
    tasks.update(a.id, { status: 'done', result: { summary: 's', outputs: ['x.md'], learned: '' } });
    expect(tasks.openInPlan('p1')).toBe(1);
    expect(tasks.get(a.id).result).toEqual({ summary: 's', outputs: ['x.md'], learned: '' });
  });

  it('lists by assignee, plan and status', () => {
    const { tasks } = stores();
    tasks.create(task({ assignee: 'e1', planId: 'p1' }));
    const b = tasks.create(task({ assignee: 'e2', planId: 'p1' }));
    tasks.update(b.id, { status: 'blocked' });
    expect(tasks.list({ assignee: 'e2' }).map((t) => t.id)).toEqual([b.id]);
    expect(tasks.list({ planId: 'p1' })).toHaveLength(2);
    expect(tasks.list({ statuses: ['blocked'] }).map((t) => t.id)).toEqual([b.id]);
  });

  it('keeps the task kind, work by default', () => {
    const { tasks } = stores();
    expect(tasks.create(task()).kind).toBe('work');
    const handover = tasks.create(task({ kind: 'handover' }));
    expect(tasks.get(handover.id).kind).toBe('handover');
  });

  it('says so in Turkish when a task does not exist', () => {
    expect(() => stores().tasks.get('nope')).toThrow(/Görev bulunamadı/);
  });
});

describe('PlanStore', () => {
  it('creates a draft at version 1 and updates it, newest first in the list', () => {
    const { plans } = stores();
    const first = plans.create({ title: 'A', goal: 'g', approach: 'a', people: 'p', steps: ['1', '2'], quotaPct: 10, usd: null, days: 2, risks: '', proposedBy: 'c' });
    expect(first).toMatchObject({ status: 'draft', version: 1, steps: ['1', '2'], approvedAt: null });
    const second = plans.create({ title: 'B', goal: 'g', approach: 'a', people: 'p', steps: [], quotaPct: null, usd: 5, days: null, risks: 'r', proposedBy: 'c' });
    const approved = plans.update(first.id, { status: 'approved', approvedAt: 7 });
    expect(approved).toMatchObject({ status: 'approved', approvedAt: 7 });
    expect(approved.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(plans.list().map((p) => p.id)).toEqual([second.id, first.id]);
    expect(() => plans.get('nope')).toThrow(/Plan bulunamadı/);
  });
});

describe('NoticeStore', () => {
  it('keeps notices until they are delivered', () => {
    const { notices } = stores();
    notices.add('e1', 'plan.approved', 'bir');
    notices.add('e1', 'task.finished', 'iki');
    notices.add('e2', 'task.blocked', 'başka');
    const pending = notices.pending('e1');
    expect(pending.map((n) => n.text)).toEqual(['bir', 'iki']);
    expect(pending.map((n) => [n.kind, n.topic])).toEqual([['decision', 'plan.approved'], ['info', 'task.finished']]);
    expect(pending[0]?.createdAt).toEqual(expect.any(Number));
    notices.markDelivered(pending.map((n) => n.id));
    expect(notices.pending('e1')).toEqual([]);
    expect(notices.pending('e2')).toHaveLength(1);
  });
});

describe('TaskStore — review fields (v8)', () => {
  it('keeps a reviewer, the reviewed task and the round; a new task has round 0', () => {
    const { tasks } = stores();
    const work = tasks.create(task({ done: ['a'], reviewer: 'e2' }));
    expect(work).toMatchObject({ reviewer: 'e2', reviewOf: null, round: 0 });
    expect(tasks.get(work.id)).toMatchObject({ reviewer: 'e2', reviewOf: null, round: 0 });
    const next = tasks.update(work.id, { status: 'review', round: 1, reviewer: 'e3' });
    expect(tasks.get(work.id)).toMatchObject({ status: 'review', round: 1, reviewer: 'e3' });
    expect(next.round).toBe(1);
    const review = tasks.create(task({ kind: 'review', title: 'İnceleme: Yaz (tur 1)', done: [], assignee: 'e3', reviewOf: work.id }));
    expect(tasks.get(review.id)).toMatchObject({ kind: 'review', reviewOf: work.id, reviewer: null });
  });

  it('counts a task in review as open, and finds the latest finished review of a task', () => {
    const { tasks } = stores();
    const work = tasks.create(task({ planId: 'p1', done: [], reviewer: 'e2' }));
    tasks.update(work.id, { status: 'review' });
    expect(tasks.openInPlan('p1')).toBe(1);
    expect(tasks.latestReview(work.id)).toBeNull();
    const first = tasks.create(task({ kind: 'review', planId: 'p1', title: 'İnceleme 1', done: [], assignee: 'e2', reviewOf: work.id }));
    tasks.update(first.id, { status: 'done', finishedAt: 5000, result: { summary: 'Değişiklik istendi', outputs: [], learned: '', review: { decision: 'changes', findings: [{ severity: 'important', text: 'eksik' }] } } });
    const second = tasks.create(task({ kind: 'review', planId: 'p1', title: 'İnceleme 2', done: [], assignee: 'e2', reviewOf: work.id }));
    expect(tasks.latestReview(work.id)?.id).toBe(first.id);
    tasks.update(second.id, { status: 'done', finishedAt: 6000, result: { summary: 'Onaylandı', outputs: [], learned: '', review: { decision: 'approve', findings: [] } } });
    expect(tasks.latestReview(work.id)?.id).toBe(second.id);
    expect(tasks.latestReview(work.id)?.result?.review?.decision).toBe('approve');
  });
});

describe('PlanStore — method (v8)', () => {
  it('stores a plan’s method and reads an old plan’s as null', () => {
    const { plans } = stores();
    const method = { workType: 'content' as const, stages: [{ name: 'Taslak', role: 'yazar', review: false }, { name: 'Editör', role: 'editör', review: true }], checks: ['marka diline uygun'] };
    const p = plans.create({ title: 'Metin', goal: 'g', approach: 'a', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '', proposedBy: 'c', method });
    expect(plans.get(p.id).method).toEqual(method);
    const old = plans.create({ title: 'Eski', goal: 'g', approach: 'a', people: '', steps: [], quotaPct: null, usd: null, days: null, risks: '', proposedBy: 'c' });
    expect(plans.get(old.id).method).toBeNull();
    plans.update(old.id, { method });
    expect(plans.get(old.id).method).toEqual(method);
  });
});
